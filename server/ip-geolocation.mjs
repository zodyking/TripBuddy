import { isPrivateOrLocalIp } from './client-ip.mjs'
import { emitLog } from './log-bus.mjs'

/** @type {Map<string, { lat: number, lng: number, at: number }>} */
const cache = new Map()
const CACHE_MS = 60 * 60 * 1000

/**
 * Free IP → lat/lon (no API key). Used for geo-fence.
 * @param {string} ip
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
export async function lookupIpLatLng(ip) {
  if (!ip || isPrivateOrLocalIp(ip)) return null
  const now = Date.now()
  const hit = cache.get(ip)
  if (hit && now - hit.at < CACHE_MS) {
    return { lat: hit.lat, lng: hit.lng }
  }

  try {
    const u = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon`
    const res = await fetch(u, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 'success' || data.lat == null || data.lon == null) {
      return null
    }
    const lat = Number(data.lat)
    const lng = Number(data.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    cache.set(ip, { lat, lng, at: now })
    return { lat, lng }
  } catch {
    return null
  }
}

/**
 * Reverse geocode via Nominatim (OSM) for display / logging.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string | null>}
 */
export async function reverseGeocodeNominatim(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  try {
    const url = buildNominatimUrl(
      `reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`,
    )
    const data = await nominatimGetJson(url, 'reverse')
    if (!data || typeof data !== 'object') return null
    if (typeof data.display_name === 'string' && data.display_name.trim()) {
      return data.display_name.trim()
    }
    return null
  } catch {
    return null
  }
}

/** @type {Map<string, { lat: number, lng: number, at: number }>} */
const forwardGeocodeCache = new Map()
const FORWARD_GEOCODE_CACHE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Normalize free-text address for cache key.
 * @param {string} q
 */
function normalizeForwardGeocodeKey(q) {
  return String(q ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Normalize FedEx-style addresses for Nominatim:
 * - Pad short ZIP codes (e.g. "1022" → "01022")
 * - Append ", USA" if it looks like a US address
 * @param {string} raw
 */
function prepareAddressForNominatim(raw) {
  let q = raw
  q = q.replace(/,\s*(\d{3,4})\s*$/, (_, z) => `, ${z.padStart(5, '0')}`)
  if (/\b[A-Z]{2}\b/.test(q) && !/\bUS(A)?\b/i.test(q)) {
    q += ', USA'
  }
  return q
}

const NOMINATIM_BASE = (
  process.env.NOMINATIM_API_BASE || 'https://nominatim.openstreetmap.org'
).replace(/\/$/, '')
const NOMINATIM_USER_AGENT =
  (process.env.NOMINATIM_USER_AGENT || '').trim() ||
  'FedExTool/1.0 (https://github.com/zodyking/TripBuddy; directory geocode)'
const NOMINATIM_EMAIL = (process.env.NOMINATIM_CONTACT_EMAIL || '').trim()
const FORWARD_GEOCODE_MIN_INTERVAL_MS = Math.max(
  800,
  Math.floor(
    Number(process.env.FORWARD_GEOCODE_MIN_INTERVAL_MS || process.env.NOMINATIM_MIN_INTERVAL_MS) ||
      1100,
  ),
)

let nextForwardGeocodeSlot = 0
let warnedMissingEmail = false

/**
 * @param {string} pathQuery path + query (no leading slash)
 */
function buildNominatimUrl(pathQuery) {
  if (!NOMINATIM_EMAIL) return `${NOMINATIM_BASE}/${pathQuery}`
  const glue = pathQuery.includes('?') ? '&' : '?'
  return `${NOMINATIM_BASE}/${pathQuery}${glue}email=${encodeURIComponent(NOMINATIM_EMAIL)}`
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitForwardGeocodeSlot() {
  const now = Date.now()
  const wait = Math.max(0, nextForwardGeocodeSlot - now)
  if (wait > 0) await sleep(wait)
}

function markForwardGeocodeRequestDone() {
  nextForwardGeocodeSlot = Date.now() + FORWARD_GEOCODE_MIN_INTERVAL_MS
}

/**
 * @param {string} url full URL
 * @param {string} kind log label
 * @returns {Promise<unknown | null>} parsed JSON or null
 */
async function nominatimGetJson(url, kind) {
  if (!NOMINATIM_EMAIL && !warnedMissingEmail) {
    warnedMissingEmail = true
    emitLog(
      'warn',
      '[nominatim] NOMINATIM_CONTACT_EMAIL is unset — set it in .env for reliable public Nominatim usage (usage policy).',
    )
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    await waitForwardGeocodeSlot()
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': NOMINATIM_USER_AGENT,
          Accept: 'application/json',
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(18_000),
      })
      markForwardGeocodeRequestDone()

      if (res.status === 429 || res.status === 503) {
        const ra = res.headers.get('retry-after')
        const sec = ra ? parseInt(ra, 10) : NaN
        const backoff = Number.isFinite(sec) && sec > 0 ? sec * 1000 : 2500 * (attempt + 1)
        emitLog('warn', `[nominatim] ${kind} HTTP ${res.status} — backing off ${Math.round(backoff)}ms`)
        await sleep(Math.min(backoff, 60_000))
        continue
      }

      if (res.status === 403) {
        emitLog('warn', `[nominatim] ${kind} HTTP 403 — check User-Agent / email policy`)
        await sleep(5000 * (attempt + 1))
        continue
      }

      if (!res.ok) {
        emitLog('warn', `[nominatim] ${kind} HTTP ${res.status}`)
        return null
      }

      return await res.json()
    } catch (e) {
      markForwardGeocodeRequestDone()
      const msg = e instanceof Error ? e.message : String(e)
      emitLog('warn', `[nominatim] ${kind} fetch error: ${msg}`)
      await sleep(1500 * (attempt + 1))
    }
  }
  return null
}

/**
 * @param {string} q address query
 * @returns {Promise<Array<Record<string, unknown>> | null>}
 */
async function nominatimSearch(q) {
  const path = `search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`
  const url = buildNominatimUrl(path)
  const data = await nominatimGetJson(url, 'search')
  if (!Array.isArray(data)) return null
  return data
}

function rowToLatLng(row) {
  if (!row || typeof row !== 'object') return null
  const lat = Number(row.lat)
  const lng = Number(row.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/**
 * Photon (Komoot) — OSM-backed, no API key.
 * @param {string} q
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
function coordsFromPhotonFeature(f) {
  if (!f || typeof f !== 'object') return null
  const geom = /** @type {{ coordinates?: unknown }} */ (f).geometry
  if (!geom || typeof geom !== 'object') return null
  const c = geom.coordinates
  if (!Array.isArray(c) || c.length < 2) return null
  const lng = Number(c[0])
  const lat = Number(c[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

async function forwardGeocodePhoton(q) {
  const s = String(q ?? '').trim()
  if (s.length < 4) return null
  await waitForwardGeocodeSlot()
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(s.slice(0, 500))}&limit=1&lang=en&bbox=-125,24,-66,50`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: AbortSignal.timeout(18_000),
    })
    markForwardGeocodeRequestDone()
    if (!res.ok) return null
    const data = await res.json()
    const feat = Array.isArray(data.features) && data.features[0] ? data.features[0] : null
    return coordsFromPhotonFeature(feat)
  } catch {
    markForwardGeocodeRequestDone()
    return null
  }
}

/**
 * Open-Meteo geocoding — free, no key (non-commercial use per their terms).
 * @param {string} q
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
async function forwardGeocodeOpenMeteo(q) {
  const s = String(q ?? '').trim()
  if (s.length < 4) return null
  await waitForwardGeocodeSlot()
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(s.slice(0, 256))}&count=8&language=en&format=json`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: AbortSignal.timeout(18_000),
    })
    markForwardGeocodeRequestDone()
    if (!res.ok) return null
    const data = await res.json()
    const results = Array.isArray(data.results) ? data.results : []
    for (const r of results) {
      if (!r || typeof r !== 'object') continue
      const lat = Number(r.latitude)
      const lng = Number(r.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }
    return null
  } catch {
    markForwardGeocodeRequestDone()
    return null
  }
}

/**
 * Forward geocode (address → lat/lng): OpenStreetMap Nominatim, then Photon, then Open-Meteo.
 * All are free with no API key; a shared min interval applies across providers.
 * @param {string} query
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
export async function forwardGeocodeNominatim(query) {
  const raw = String(query ?? '').trim()
  if (raw.length < 6) return null
  const key = normalizeForwardGeocodeKey(raw)
  const now = Date.now()
  const hit = forwardGeocodeCache.get(key)
  if (hit && now - hit.at < FORWARD_GEOCODE_CACHE_MS) {
    return { lat: hit.lat, lng: hit.lng }
  }

  const prepared = prepareAddressForNominatim(raw)

  try {
    let data = await nominatimSearch(prepared)
    let row = data && data.length > 0 ? data[0] : null
    let coords = rowToLatLng(row)

    if (!coords && prepared !== raw) {
      data = await nominatimSearch(raw)
      row = data && data.length > 0 ? data[0] : null
      coords = rowToLatLng(row)
    }

    if (!coords) {
      coords = await forwardGeocodePhoton(prepared)
    }
    if (!coords && prepared !== raw) {
      coords = await forwardGeocodePhoton(raw)
    }
    if (!coords) {
      coords = await forwardGeocodeOpenMeteo(prepared)
    }
    if (!coords && prepared !== raw) {
      coords = await forwardGeocodeOpenMeteo(raw)
    }

    if (!coords) return null
    forwardGeocodeCache.set(key, { lat: coords.lat, lng: coords.lng, at: now })
    return coords
  } catch {
    return null
  }
}
