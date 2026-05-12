import { isPrivateOrLocalIp } from './client-ip.mjs'

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
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FedExTool/1.0 (geo-fence; self-hosted)',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
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
 * Forward geocode (address → lat/lng) via Nominatim (OSM).
 * Respects usage policy: callers should not exceed ~1 request/sec per deployment.
 * @param {string} query
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
/**
 * Normalize FedEx-style addresses for Nominatim:
 * - Pad short ZIP codes (e.g. "1022" → "01022")
 * - Append ", USA" if it looks like a US address
 * @param {string} raw
 */
function prepareAddressForNominatim(raw) {
  let q = raw
  q = q.replace(/,\s*(\d{3,4})$/,  (_, z) => `, ${z.padStart(5, '0')}`)
  q = q.replace(/,\s*(\d{3,4})\s*$/,  (_, z) => `, ${z.padStart(5, '0')}`)
  if (/\b[A-Z]{2}\b/.test(q) && !/\bUS(A)?\b/i.test(q)) {
    q += ', USA'
  }
  return q
}

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
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(prepared)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FedExTool/1.0 (directory geocode; self-hosted)',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) {
      const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(raw)}`
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'FedExTool/1.0 (directory geocode; self-hosted)' },
        signal: AbortSignal.timeout(12000),
      })
      if (!fallbackRes.ok) return null
      const fallbackData = await fallbackRes.json()
      if (!Array.isArray(fallbackData) || fallbackData.length === 0) return null
      const row = fallbackData[0]
      if (!row || typeof row !== 'object') return null
      const lat = Number(row.lat)
      const lng = Number(row.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      forwardGeocodeCache.set(key, { lat, lng, at: now })
      return { lat, lng }
    }
    const row = data[0]
    if (!row || typeof row !== 'object') return null
    const lat = Number(row.lat)
    const lng = Number(row.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    forwardGeocodeCache.set(key, { lat, lng, at: now })
    return { lat, lng }
  } catch {
    return null
  }
}
