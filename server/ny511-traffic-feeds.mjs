/**
 * NY511 (511NY.org) traffic feeds for NYC-region truck-relevant corridors.
 *
 * Upstream: `https://511ny.org/api/v2/get/{resource}?key=...&format=json`
 * — same family as bridge cameras in `server/index.mjs`.
 *
 * Observed without a key: XML `<Error><Message>Invalid Key</Message></Error>`.
 * With a valid developer key, responses are JSON; shape varies by feed — this module
 * uses defensive extraction (known wrapper keys + first-level object arrays) and
 * PascalCase / camelCase field aliases (consistent with cameras: `Id`, `Location`, …).
 *
 * Feeds merged: `events`, `construction`, `incidents`, `roadconditions` (alerts omitted
 * to reduce overlap with events; add if needed).
 */

import { createHash } from 'node:crypto'

/** NYC metro bounding box (approx): NYC + NJ approaches / SI. */
export const NYC_TRUCK_BBOX = Object.freeze({
  minLat: 40.42,
  maxLat: 40.96,
  minLng: -74.45,
  maxLng: -73.62,
})

/**
 * Substrings / route tokens for major truck corridors & crossings (tune without UI changes).
 * Match is case-insensitive on a blob of title + description + roadway fields.
 */
export const NYC_TRUCK_ROUTE_TOKENS = [
  'I-278',
  'I278',
  'BQE',
  'BROOKLYN-QUEENS EXPRESSWAY',
  'I-495',
  'I495',
  'LIE',
  'LONG ISLAND EXPRESSWAY',
  'I-678',
  'I678',
  'VAN WYCK',
  'I-95',
  'I95',
  'NJ TURNPIKE',
  'NEW JERSEY TURNPIKE',
  'US-1',
  'US-9',
  'US 1',
  'US 9',
  'ROUTE 1',
  'ROUTE 9',
  'GEORGE WASHINGTON',
  'GWB',
  'GOETHALS',
  'BAYONNE BR',
  'BAYONNE BRIDGE',
  'OUTERBRIDGE',
  'VERRAZZANO',
  'VERAZZANO',
  'HOLLAND TUNNEL',
  'LINCOLN TUNNEL',
  'STATEN ISLAND EXPRESSWAY',
  ' SIE ',
  'GOWANUS',
  'BRUCKNER',
  'CROSS BRONX',
  'MAJOR DEEGAN',
  'CLEARVIEW',
  'GRAND CENTRAL',
  'GCP',
  'FDR DRIVE',
  'WEST SIDE HWY',
  'HENRY HUDSON',
  'WHITESTONE',
  'THROGS NECK',
  'RFK BRIDGE',
  'TRIBORO',
  'KOSCIUSZKO',
  'BROOKLYN BRIDGE',
  'MANHATTAN BRIDGE',
  'WILLIAMSBURG BRIDGE',
  'QUEENS MIDTOWN',
  'MIDTOWN TUNNEL',
  'MEADOWLANDS',
]

/**
 * 511NY official API endpoints (per https://511ny.org/developers/help/api).
 * Format: [apiPath, kindLabel]
 * - getevents: all event types (incidents, roadwork, closures, etc.)
 * - getalerts: traffic alerts
 * Note: "construction" / "incidents" / "roadconditions" are NOT separate endpoints;
 * they are EventType values within getevents.
 */
const FEEDS = /** @type {const} */ ([
  ['getevents', 'event'],
  ['getalerts', 'alert'],
])

/**
 * @param {unknown} body
 * @returns {unknown[]}
 */
export function extractPrimaryArraysFrom511Json(body) {
  if (body == null) return []
  if (Array.isArray(body)) return body
  if (typeof body !== 'object') return []

  const o = /** @type {Record<string, unknown>} */ (body)
  const keys = [
    'Events',
    'events',
    'Construction',
    'construction',
    'Incidents',
    'incidents',
    'RoadConditions',
    'roadConditions',
    'Alerts',
    'alerts',
    'Data',
    'data',
    'Items',
    'items',
  ]
  for (const k of keys) {
    const v = o[k]
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] != null) {
      return v
    }
  }
  /** @type {unknown[]} */
  const merged = []
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) {
      for (const row of v) {
        if (row != null && typeof row === 'object') merged.push(row)
      }
    }
  }
  return merged
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function str(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return String(v).trim()
}

/**
 * @param {Record<string, unknown>} r
 * @param {string[]} names
 */
function pickStr(r, names) {
  for (const n of names) {
    if (n in r && str(r[n])) return str(r[n])
  }
  return ''
}

/**
 * @param {Record<string, unknown>} r
 * @param {string[]} names
 */
function pickNum(r, names) {
  for (const n of names) {
    const v = r[n]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const x = Number(v)
      if (Number.isFinite(x)) return x
    }
  }
  return null
}

/**
 * Normalize a row from 511NY API to our internal item format.
 * @see https://511ny.org/developers/help/api/get-api-getevents_key_format
 * @see https://511ny.org/developers/help/api/get-api-getalerts_key_format
 * @param {unknown} raw
 * @param {string} sourceFeed
 * @param {string} defaultKind
 */
export function normalize511RowToItem(raw, sourceFeed, defaultKind) {
  if (raw == null || typeof raw !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (raw)

  const id =
    pickStr(r, ['ID', 'Id', 'id', 'EventId', 'eventId']) || ''

  const eventType = pickStr(r, ['EventType', 'eventType'])
  const eventSubType = pickStr(r, ['EventSubType', 'eventSubType'])

  const description = pickStr(r, [
    'Description',
    'Message',
    'Notes',
    'FullDescription',
    'description',
  ])

  const roadway = pickStr(r, [
    'RoadwayName',
    'Location',
    'PrimaryLocation',
    'roadwayName',
    'location',
  ])

  const region = pickStr(r, ['RegionName', 'Region', 'region'])
  const county = pickStr(r, ['CountyName', 'County', 'county'])
  const severity = pickStr(r, ['Severity', 'severity', 'Impact', 'impact'])

  let lat = pickNum(r, ['Latitude', 'Lat', 'lat'])
  let lng = pickNum(r, ['Longitude', 'Lng', 'lng', 'lon'])

  const startsAt = pickStr(r, ['StartDate', 'Reported', 'startDate'])
  const endsAt = pickStr(r, ['PlannedEndDate', 'EndDate', 'endDate'])

  const kind = eventType || eventSubType || String(defaultKind || 'event').toLowerCase()

  const displayTitle = eventSubType || eventType || roadway || description?.slice(0, 60) || `${kind} (511NY)`

  const blob = [displayTitle, description, roadway, region, county, eventType, eventSubType, sourceFeed].join(' ').toUpperCase()

  return {
    id: id || '',
    sourceFeed,
    kind,
    severity: severity || undefined,
    title: displayTitle,
    description: description || undefined,
    roads: roadway ? [roadway] : [],
    region: region || undefined,
    county: county || undefined,
    lat: lat != null ? lat : undefined,
    lng: lng != null ? lng : undefined,
    startsAt: startsAt || undefined,
    endsAt: endsAt || undefined,
    _blob: blob,
  }
}

/**
 * @param {number} lat
 * @param {number} lng
 */
export function pointInNycTruckBBox(lat, lng) {
  return (
    lat >= NYC_TRUCK_BBOX.minLat &&
    lat <= NYC_TRUCK_BBOX.maxLat &&
    lng >= NYC_TRUCK_BBOX.minLng &&
    lng <= NYC_TRUCK_BBOX.maxLng
  )
}

/**
 * @param {{ _blob: string, lat?: number, lng?: number }} item
 */
export function passesNycTruckFilter(item) {
  const blob = item._blob || ''
  const tokenHit = NYC_TRUCK_ROUTE_TOKENS.some((t) => blob.includes(t.toUpperCase()))
  if (!tokenHit) return false
  if (item.lat != null && item.lng != null) {
    if (!pointInNycTruckBBox(item.lat, item.lng)) return false
  }
  return true
}

/**
 * @param {Array<{ id: string, title: string, startsAt?: string, kind: string }>} items
 */
export function dedupeNy511Items(items) {
  const seen = new Set()
  /** @type {typeof items} */
  const out = []
  for (const it of items) {
    const key =
      it.id && String(it.id).trim() !== ''
        ? String(it.id).trim()
        : createHash('sha256')
            .update(`${it.kind}|${it.title}|${it.startsAt || ''}`)
            .digest('hex')
            .slice(0, 24)
    if (seen.has(key)) continue
    seen.add(key)
    const { _blob, ...rest } = /** @type {any} */ (it)
    out.push(rest)
  }
  return out
}

/**
 * Fetch from 511NY official API.
 * Endpoint format: https://511ny.org/api/{apiPath}?key=...&format=json
 * @see https://511ny.org/developers/help/api/get-api-getevents_key_format
 * @param {string} apiKey
 * @param {string} apiPath e.g. "getevents", "getalerts"
 */
async function fetch511Json(apiKey, apiPath) {
  const url = `https://511ny.org/api/${apiPath}?key=${encodeURIComponent(apiKey)}&format=json`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(18_000),
  })
  const text = await res.text()
  const trimmed = text.trim()
  if (trimmed.startsWith('<')) {
    throw new Error(`${apiPath}: non-JSON response (${trimmed.slice(0, 80)})`)
  }
  let data
  try {
    data = JSON.parse(trimmed)
  } catch {
    throw new Error(`${apiPath}: invalid JSON`)
  }
  if (!res.ok) {
    throw new Error(`${apiPath}: HTTP ${res.status}`)
  }
  return data
}

/**
 * @param {unknown} data
 * @param {string} sourceFeed
 * @param {string} kind
 */
export function rowsFrom511Response(data, sourceFeed, kind) {
  const rows = extractPrimaryArraysFrom511Json(data)
  /** @type {ReturnType<typeof normalize511RowToItem>[]} */
  const items = []
  for (const row of rows) {
    const n = normalize511RowToItem(row, sourceFeed, kind)
    if (n) items.push(n)
  }
  return items
}

const TRAFFIC_CACHE_TTL_MS = 5 * 60 * 1000
/** @type {Map<string, { payload: object, fetchedAt: number }>} */
const trafficCacheByAccount = new Map()

/**
 * @param {string} accountKey
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, items: object[], fetchedAt: number, feedErrors?: Record<string, string>, error?: string }>}
 */
export async function buildNy511TruckNycBundle(accountKey, apiKey) {
  const key = String(apiKey || '').trim()
  if (!key) {
    return { ok: false, items: [], fetchedAt: Date.now(), error: 'NO_API_KEY' }
  }
  void accountKey

  /** @type {Record<string, string>} */
  const feedErrors = {}
  /** @type {Record<string, number>} */
  const feedCounts = {}
  /** @type {ReturnType<typeof normalize511RowToItem>[]} */
  const merged = []

  await Promise.all(
    FEEDS.map(async ([resource, kind]) => {
      try {
        const data = await fetch511Json(key, resource)
        const rows = rowsFrom511Response(data, resource, kind)
        feedCounts[resource] = rows.length
        merged.push(...rows)
      } catch (e) {
        feedErrors[resource] = e instanceof Error ? e.message : String(e)
      }
    }),
  )

  const filtered = merged.filter((x) => x && passesNycTruckFilter(/** @type {any} */ (x)))
  const deduped = dedupeNy511Items(filtered)

  deduped.sort((a, b) => {
    const ta = String(a.title || '')
    const tb = String(b.title || '')
    return ta.localeCompare(tb)
  })

  const sampleUnfiltered = merged.slice(0, 5).map((it) => {
    const { _blob, ...rest } = /** @type {any} */ (it)
    return rest
  })

  return {
    ok: true,
    items: deduped,
    fetchedAt: Date.now(),
    feedErrors: Object.keys(feedErrors).length ? feedErrors : undefined,
    _stats: {
      totalFetched: merged.length,
      afterFilter: filtered.length,
      afterDedupe: deduped.length,
      feedCounts,
    },
    _sampleUnfiltered: sampleUnfiltered.length ? sampleUnfiltered : undefined,
  }
}

/**
 * @param {string} accountKey
 * @param {string} apiKey
 * @param {{ bypassCache?: boolean }} [opts]
 */
export async function getNy511TruckNycPayload(accountKey, apiKey, opts = {}) {
  const ak = String(accountKey || '').trim()
  const key = String(apiKey || '').trim()
  if (!key) {
    return { ok: false, items: [], fetchedAt: Date.now(), error: 'NO_API_KEY' }
  }
  const now = Date.now()
  if (!opts.bypassCache && ak) {
    const hit = trafficCacheByAccount.get(ak)
    if (hit && now - hit.fetchedAt < TRAFFIC_CACHE_TTL_MS) {
      return { ...hit.payload, cached: true }
    }
  }

  const bundle = await buildNy511TruckNycBundle(ak, key)
  const payload =
    bundle.ok === true
      ? {
          ok: true,
          items: bundle.items,
          fetchedAt: bundle.fetchedAt,
          feedErrors: bundle.feedErrors,
          _stats: bundle._stats,
          _sampleUnfiltered: bundle._sampleUnfiltered,
        }
      : { ok: false, items: [], fetchedAt: bundle.fetchedAt, error: bundle.error || 'fetch_failed' }

  if (ak && payload.ok) {
    trafficCacheByAccount.set(ak, { payload: { ...payload, cached: false }, fetchedAt: now })
  }

  return { ...payload, cached: false }
}
