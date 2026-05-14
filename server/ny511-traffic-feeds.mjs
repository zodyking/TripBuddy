/**
 * NY511 (511NY.org) traffic feeds for NYC-region truck-relevant corridors.
 *
 * Upstream: `https://511ny.org/api/getevents|getalerts?key=...&format=json`
 * @see https://511ny.org/developers/help/api/get-api-getevents_key_format
 *
 * Response payload splits **alerts** (getalerts) vs **items** (getevents: incidents,
 * roadwork, closures, winter index) so the client can show two sections. Transit /
 * parade / general-info noise is dropped; date windows use 511NY `dd/MM/yyyy HH:mm:ss`
 * interpreted as US Eastern (approximate DST).
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

/** Event types we show on the truck road list (511NY EventType). */
const ALLOWED_TRUCK_EVENT_TYPES = new Set([
  'accidentsandincidents',
  'roadwork',
  'closures',
  'winterdrivingindex',
])

/** Dropped entirely (transit detours, parades, generic info). */
const EXCLUDED_TRUCK_EVENT_TYPES = new Set([
  'transitmode',
  'transitoperations',
  'specialevents',
  'generalinfo',
])

/** Transit / bus / parade noise — dropped even if EventType is mis-tagged. */
const TRANSIT_NOISE_SUBSTRINGS = [
  'NJ TRANSIT',
  'MTA BUS',
  ' BUS ',
  'BUS ROUTE',
  'BUS DETOUR',
  'SUBWAY',
  'LIGHT RAIL',
  'TRANSITOPERATIONS',
  'TRANSIT MODE',
  'PARADE',
  'SPECIAL EVENT',
]

/** Alerts: NYC metro hint when route tokens are missing. */
const NYC_ALERT_AREA_SUBSTRINGS = [
  'NEW YORK CITY',
  'LONG ISLAND',
  'NY/NJ',
  'NEW YORK / NJ',
  'NEW JERSEY',
  'HUDSON VALLEY',
  'WESTCHESTER',
  'ROCKLAND',
  'NASSAU',
  'SUFFOLK',
  'QUEENS',
  'BROOKLYN',
  'BRONX',
  'MANHATTAN',
  'STATEN ISLAND',
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
 * Parse 511NY `dd/MM/yyyy HH:mm:ss` as US Eastern wall clock (UTC via approximate DST).
 * @param {string} s
 * @returns {number | null} epoch ms
 */
export function parseNy511DateMs(s) {
  const t = str(s)
  if (!t) return null
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(t)
  if (!m) {
    const x = Date.parse(t)
    return Number.isFinite(x) ? x : null
  }
  const d = Number(m[1])
  const mo = Number(m[2])
  const y = Number(m[3])
  const hh = Number(m[4])
  const mi = Number(m[5])
  const ss = Number(m[6])
  /** Rough US Eastern DST (good enough for “still active?” windows). */
  const leanDst = mo >= 4 && mo <= 10 || (mo === 3 && d >= 8) || (mo === 11 && d <= 7)
  const offsetH = leanDst ? 4 : 5
  return Date.UTC(y, mo - 1, d, hh + offsetH, mi, ss)
}

/**
 * @param {string} eventTypeKey
 */
export function humanize511KindLabel(eventTypeKey) {
  const k = String(eventTypeKey || 'event').toLowerCase().replace(/\s+/g, '')
  const map = {
    alert: 'Alert',
    accidentsandincidents: 'Incident',
    roadwork: 'Roadwork',
    closures: 'Closure',
    winterdrivingindex: 'Winter',
  }
  return map[k] || (k ? k.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Event')
}

/**
 * @param {string} blob
 */
export function passesTransitNoiseBlob(blob) {
  const b = (blob || '').toUpperCase()
  return TRANSIT_NOISE_SUBSTRINGS.some((s) => b.includes(s.toUpperCase()))
}

/**
 * @param {string} blob
 */
export function passesMetroAlertRelevance(blob) {
  const b = (blob || '').toUpperCase()
  if (NYC_TRUCK_ROUTE_TOKENS.some((t) => b.includes(t.toUpperCase()))) return true
  if (NYC_ALERT_AREA_SUBSTRINGS.some((s) => b.includes(s))) return true
  return false
}

/**
 * @param {{ eventTypeKey?: string, sourceFeed?: string, _blob?: string }} item
 */
export function passesAllowedTruckEventType(item) {
  if (item.sourceFeed === 'getalerts') return true
  if (passesTransitNoiseBlob(item._blob || '')) return false
  const k = String(item.eventTypeKey || '')
    .toLowerCase()
    .replace(/\s+/g, '')
  if (EXCLUDED_TRUCK_EVENT_TYPES.has(k)) return false
  if (!k || k === 'unknown') return true
  return ALLOWED_TRUCK_EVENT_TYPES.has(k)
}

/**
 * @param {{ startsAt?: string, endsAt?: string }} item
 * @param {number} [nowMs]
 */
export function isNy511ItemActiveInTimeWindow(item, nowMs = Date.now()) {
  const endMs = item.endsAt ? parseNy511DateMs(String(item.endsAt)) : null
  const startMs = item.startsAt ? parseNy511DateMs(String(item.startsAt)) : null
  const hour = 60 * 60 * 1000
  if (endMs != null && endMs < nowMs - hour) return false
  if (startMs != null && startMs > nowMs + 48 * hour) return false
  return true
}

/**
 * @param {Record<string, unknown>} r
 */
function pickAreaNames(r) {
  const a = r.AreaNames ?? r.areaNames
  if (!Array.isArray(a)) return []
  return a.map((x) => str(x)).filter(Boolean)
}

/**
 * Normalize a row from 511NY API to our internal item format.
 * @see https://511ny.org/developers/help/api/get-api-getevents_key_format
 * @see https://511ny.org/developers/help/api/get-api-getalerts_key_format
 * @param {unknown} raw
 * @param {string} sourceFeed
 * @param {string} _defaultKind
 */
export function normalize511RowToItem(raw, sourceFeed, _defaultKind) {
  void _defaultKind
  if (raw == null || typeof raw !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (raw)

  if (sourceFeed === 'getalerts') {
    const id = pickStr(r, ['Id', 'ID', 'id']) || ''
    const msg = pickStr(r, ['Message'])
    const notes = pickStr(r, ['Notes'])
    const description = [msg, notes].filter(Boolean).join(' — ') || undefined
    const areas = pickAreaNames(r)
    const displayTitle =
      msg.length > 88 ? `${msg.slice(0, 87)}…` : msg || 'Traffic alert'
    const blob = [displayTitle, description, ...areas].join(' ').toUpperCase()
    return {
      id: id || '',
      sourceFeed,
      eventTypeKey: 'alert',
      kind: humanize511KindLabel('alert'),
      severity: undefined,
      title: displayTitle,
      description: description || undefined,
      roads: areas.length ? areas : [],
      region: undefined,
      county: undefined,
      lat: undefined,
      lng: undefined,
      startsAt: undefined,
      endsAt: undefined,
      _blob: blob,
    }
  }

  const id = pickStr(r, ['ID', 'Id', 'id', 'EventId', 'eventId']) || ''

  const eventType = pickStr(r, ['EventType', 'eventType'])
  const eventSubType = pickStr(r, ['EventSubType', 'eventSubType'])

  const description = pickStr(r, [
    'Description',
    'FullDescription',
    'description',
  ])

  const roadway = pickStr(r, [
    'RoadwayName',
    'PrimaryLocation',
    'Location',
    'roadwayName',
    'location',
  ])

  const region = pickStr(r, ['RegionName', 'Region', 'region'])
  const county = pickStr(r, ['CountyName', 'County', 'county'])
  const severity = pickStr(r, ['Severity', 'severity', 'Impact', 'impact'])

  const lat = pickNum(r, ['Latitude', 'Lat', 'lat'])
  const lng = pickNum(r, ['Longitude', 'Lng', 'lng', 'lon'])

  const startsAt = pickStr(r, ['StartDate', 'Reported', 'startDate'])
  const endsAt = pickStr(r, ['PlannedEndDate', 'EndDate', 'endDate'])

  const eventTypeKey = eventType
    ? eventType.toLowerCase().replace(/\s+/g, '')
    : 'unknown'

  const headlineParts = [roadway, eventSubType].filter(Boolean)
  const displayTitle =
    headlineParts.length >= 2
      ? `${roadway} · ${eventSubType}`
      : roadway || eventSubType || eventType || (description ? description.slice(0, 88) : '') || '511NY event'

  const blob = [
    displayTitle,
    description,
    roadway,
    region,
    county,
    eventType,
    eventSubType,
    sourceFeed,
  ]
    .join(' ')
    .toUpperCase()

  return {
    id: id || '',
    sourceFeed,
    eventTypeKey,
    kind: humanize511KindLabel(eventTypeKey),
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
    const src = String(/** @type {any} */ (it).sourceFeed || '')
    const key =
      it.id && String(it.id).trim() !== ''
        ? `${src}:${String(it.id).trim()}`
        : createHash('sha256')
            .update(`${src}|${it.kind}|${it.title}|${it.startsAt || ''}`)
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
 */
export async function buildNy511TruckNycBundle(accountKey, apiKey) {
  const key = String(apiKey || '').trim()
  if (!key) {
    return { ok: false, items: [], alerts: [], fetchedAt: Date.now(), error: 'NO_API_KEY' }
  }
  void accountKey

  /** @type {Record<string, string>} */
  const feedErrors = {}
  /** @type {Record<string, number>} */
  const feedCounts = {}
  /** @type {ReturnType<typeof normalize511RowToItem>[]} */
  const rawEvents = []
  /** @type {ReturnType<typeof normalize511RowToItem>[]} */
  const rawAlerts = []
  const now = Date.now()

  await Promise.all(
    FEEDS.map(async ([resource, kind]) => {
      try {
        const data = await fetch511Json(key, resource)
        const rows = rowsFrom511Response(data, resource, kind)
        feedCounts[resource] = rows.length
        if (resource === 'getalerts') rawAlerts.push(...rows)
        else rawEvents.push(...rows)
      } catch (e) {
        feedErrors[resource] = e instanceof Error ? e.message : String(e)
      }
    }),
  )

  const eventFiltered = rawEvents.filter((x) => {
    if (!x) return false
    if (!passesAllowedTruckEventType(/** @type {any} */ (x))) return false
    if (!passesNycTruckFilter(/** @type {any} */ (x))) return false
    if (!isNy511ItemActiveInTimeWindow(/** @type {any} */ (x), now)) return false
    return true
  })

  const alertFiltered = rawAlerts.filter((x) => {
    if (!x) return false
    if (passesTransitNoiseBlob(x._blob || '')) return false
    if (!passesMetroAlertRelevance(x._blob || '')) return false
    if (!isNy511ItemActiveInTimeWindow(/** @type {any} */ (x), now)) return false
    return true
  })

  const items = dedupeNy511Items(eventFiltered)
  const alerts = dedupeNy511Items(alertFiltered)

  const sortByTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''))
  items.sort(sortByTitle)
  alerts.sort(sortByTitle)

  return {
    ok: true,
    items,
    alerts,
    fetchedAt: Date.now(),
    feedErrors: Object.keys(feedErrors).length ? feedErrors : undefined,
    _stats: {
      totalFetchedEvents: rawEvents.length,
      totalFetchedAlerts: rawAlerts.length,
      afterFilterEvents: eventFiltered.length,
      afterFilterAlerts: alertFiltered.length,
      itemsOut: items.length,
      alertsOut: alerts.length,
      feedCounts,
    },
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
    return { ok: false, items: [], alerts: [], fetchedAt: Date.now(), error: 'NO_API_KEY' }
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
          alerts: bundle.alerts,
          fetchedAt: bundle.fetchedAt,
          feedErrors: bundle.feedErrors,
          _stats: bundle._stats,
        }
      : {
          ok: false,
          items: [],
          alerts: [],
          fetchedAt: bundle.fetchedAt,
          error: bundle.error || 'fetch_failed',
        }

  if (ak && payload.ok) {
    trafficCacheByAccount.set(ak, { payload: { ...payload, cached: false }, fetchedAt: now })
  }

  return { ...payload, cached: false }
}
