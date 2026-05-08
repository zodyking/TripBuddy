/**
 * Highway traffic data via HERE Traffic Flow API.
 * Pre-defined highway corridors with traffic time + speed + series history.
 * Falls back to TomTom Routing API if HERE key is unavailable.
 */
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'
import {
  encodeFlexiblePolyline,
  getTrafficFlowCorridor,
  parseTrafficFlowResponse,
  sanitizeHereApiKey,
} from './here-traffic-api.mjs'
import { getHereApiKeyForAccount, getTomtomApiKeyForAccount } from './user-profile-pg.mjs'
import { getCalculateRoutePolyline } from './tomtom-routing-calculate.mjs'
import {
  assertApiAllowed,
  recordApiCompletedCall,
  ApiQuotaError,
} from './api-quota.mjs'

const KEY = G('traffic:highways:series')
const SNAPPED_KEY = G('traffic:highways:snapped')
const MAX_POINTS_PER_HIGHWAY = 500
const MPS_TO_MPH = 2.23694
const CACHE_TTL_MS = 90 * 1000
const SNAPPED_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Highway definitions with polyline waypoints.
 * Each highway has a straight-ish path along the main corridor.
 */
const HIGHWAYS = {
  'van-wyck': {
    name: 'Van Wyck Expressway',
    shortName: 'Van Wyck',
    route: 'I-678',
    waypoints: [
      { lat: 40.6413, lng: -73.7781 }, // JFK Airport
      { lat: 40.6608, lng: -73.7822 },
      { lat: 40.6842, lng: -73.7975 },
      { lat: 40.7065, lng: -73.8125 },
      { lat: 40.7280, lng: -73.8210 },
      { lat: 40.7450, lng: -73.8295 },
      { lat: 40.7614, lng: -73.8364 }, // Whitestone area
    ],
  },
  'bqe': {
    name: 'Brooklyn-Queens Expressway',
    shortName: 'BQE',
    route: 'I-278',
    waypoints: [
      { lat: 40.6761, lng: -73.9903 }, // Gowanus
      { lat: 40.6895, lng: -73.9845 },
      { lat: 40.6990, lng: -73.9780 },
      { lat: 40.7125, lng: -73.9625 },
      { lat: 40.7285, lng: -73.9510 },
      { lat: 40.7442, lng: -73.9435 },
      { lat: 40.7598, lng: -73.9340 },
      { lat: 40.7720, lng: -73.9270 },
      { lat: 40.7831, lng: -73.9209 }, // Astoria
    ],
  },
  'lie': {
    name: 'Long Island Expressway',
    shortName: 'LIE',
    route: 'I-495',
    waypoints: [
      { lat: 40.7484, lng: -73.9621 }, // Queens Midtown Tunnel
      { lat: 40.7505, lng: -73.9355 },
      { lat: 40.7535, lng: -73.9025 },
      { lat: 40.7558, lng: -73.8680 },
      { lat: 40.7572, lng: -73.8340 },
      { lat: 40.7580, lng: -73.7880 },
      { lat: 40.7585, lng: -73.7500 },
      { lat: 40.7589, lng: -73.7088 }, // Nassau border
    ],
  },
  'route-1-9': {
    name: 'US Route 1-9',
    shortName: 'Route 1-9',
    route: 'US-1/9',
    waypoints: [
      { lat: 40.7357, lng: -74.1724 }, // Newark
      { lat: 40.7340, lng: -74.1510 },
      { lat: 40.7310, lng: -74.1250 },
      { lat: 40.7288, lng: -74.0980 },
      { lat: 40.7270, lng: -74.0720 },
      { lat: 40.7261, lng: -74.0469 }, // Holland Tunnel area
    ],
  },
  'nj-turnpike': {
    name: 'New Jersey Turnpike',
    shortName: 'NJ Turnpike',
    route: 'I-95',
    waypoints: [
      { lat: 40.6895, lng: -74.1745 }, // Newark Airport
      { lat: 40.7120, lng: -74.1545 },
      { lat: 40.7385, lng: -74.1285 },
      { lat: 40.7650, lng: -74.0945 },
      { lat: 40.7920, lng: -74.0580 },
      { lat: 40.8190, lng: -74.0150 },
      { lat: 40.8420, lng: -73.9750 },
      { lat: 40.8517, lng: -73.9527 }, // GWB area
    ],
  },
  'i-80': {
    name: 'Interstate 80',
    shortName: 'I-80',
    route: 'I-80',
    waypoints: [
      { lat: 40.8858, lng: -74.0437 }, // GWB approach
      { lat: 40.8720, lng: -74.0820 },
      { lat: 40.8605, lng: -74.1240 },
      { lat: 40.8530, lng: -74.1685 },
      { lat: 40.8490, lng: -74.2125 },
      { lat: 40.8545, lng: -74.2580 },
      { lat: 40.8695, lng: -74.3050 }, // Parsippany
    ],
  },
  'i-78': {
    name: 'Interstate 78',
    shortName: 'I-78',
    route: 'I-78',
    waypoints: [
      { lat: 40.7283, lng: -74.0082 }, // Holland Tunnel
      { lat: 40.7195, lng: -74.0520 },
      { lat: 40.7100, lng: -74.1020 },
      { lat: 40.7008, lng: -74.1495 },
      { lat: 40.6890, lng: -74.1920 },
      { lat: 40.6720, lng: -74.2405 },
      { lat: 40.6625, lng: -74.2850 }, // Newark Airport area
    ],
  },
  'route-17': {
    name: 'NJ Route 17',
    shortName: 'Route 17',
    route: 'NJ-17',
    waypoints: [
      { lat: 40.9320, lng: -74.0680 }, // Paramus
      { lat: 40.9508, lng: -74.0750 },
      { lat: 40.9750, lng: -74.0870 },
      { lat: 40.9995, lng: -74.1010 },
      { lat: 41.0225, lng: -74.1180 },
      { lat: 41.0450, lng: -74.1365 },
      { lat: 41.0680, lng: -74.1520 }, // Ramsey
    ],
  },
  'belt-parkway': {
    name: 'Belt Parkway',
    shortName: 'Belt Pkwy',
    route: 'Belt Pkwy',
    waypoints: [
      { lat: 40.6062, lng: -74.0350 }, // Verrazzano
      { lat: 40.5895, lng: -74.0020 },
      { lat: 40.5785, lng: -73.9620 },
      { lat: 40.5820, lng: -73.9180 },
      { lat: 40.5965, lng: -73.8750 },
      { lat: 40.6190, lng: -73.8350 },
      { lat: 40.6450, lng: -73.7920 },
      { lat: 40.6575, lng: -73.7680 }, // JFK
    ],
  },
  'cross-bronx': {
    name: 'Cross Bronx Expressway',
    shortName: 'Cross Bronx',
    route: 'I-95',
    waypoints: [
      { lat: 40.8540, lng: -73.9430 }, // GWB
      { lat: 40.8505, lng: -73.9180 },
      { lat: 40.8468, lng: -73.8920 },
      { lat: 40.8430, lng: -73.8650 },
      { lat: 40.8398, lng: -73.8375 },
      { lat: 40.8365, lng: -73.8105 },
      { lat: 40.8335, lng: -73.7850 }, // Throgs Neck
    ],
  },
}

/**
 * @typedef {{ t: number, m: number, s: number }} DataPoint
 * @typedef {{ lastAppendTs: number, pointsByHighway: Record<string, DataPoint[]> }} SeriesState
 * @typedef {{ fetchedAt: number, snappedByHighway: Record<string, Array<{ lat: number, lng: number }>> }} SnappedState
 */

/**
 * @returns {Promise<SeriesState>}
 */
async function readState() {
  return readKeyJson(KEY, () => ({
    lastAppendTs: 0,
    pointsByHighway: {},
  }))
}

/**
 * @returns {Promise<SnappedState>}
 */
async function readSnappedState() {
  return readKeyJson(SNAPPED_KEY, () => ({
    fetchedAt: 0,
    snappedByHighway: {},
  }))
}

/**
 * @param {SnappedState} st
 */
async function writeSnappedState(st) {
  await writeKeyJson(SNAPPED_KEY, st)
}

/**
 * Fetch snapped waypoints for a highway using TomTom Routing API.
 * @param {string} accountKey
 * @param {string} tomtomApiKey
 * @param {string} highwayId
 * @returns {Promise<Array<{ lat: number, lng: number }> | null>}
 */
async function fetchSnappedWaypoints(accountKey, tomtomApiKey, highwayId) {
  const hw = HIGHWAYS[highwayId]
  if (!hw || !Array.isArray(hw.waypoints) || hw.waypoints.length < 2) {
    return null
  }

  const ak = String(accountKey || '').trim()
  try {
    if (ak) await assertApiAllowed(ak, 'tomtom')
  } catch (e) {
    if (e instanceof ApiQuotaError) return null
    throw e
  }

  const pathPoints = hw.waypoints.map((w) => ({
    latitude: w.lat,
    longitude: w.lng,
  }))

  const res = await getCalculateRoutePolyline(tomtomApiKey, pathPoints)
  if (!res.ok || !res.points || res.points.length < 2) {
    return null
  }

  if (ak) await recordApiCompletedCall(ak, 'tomtom').catch(() => {})

  return res.points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }))
}

/**
 * Get or fetch snapped waypoints for all highways.
 * Caches results in KV storage for 24 hours.
 * @param {string} accountKey
 * @returns {Promise<Record<string, Array<{ lat: number, lng: number }>>>}
 */
async function getSnappedWaypoints(accountKey) {
  const snappedState = await readSnappedState()
  const now = Date.now()

  if (
    snappedState.fetchedAt > 0 &&
    now - snappedState.fetchedAt < SNAPPED_CACHE_TTL_MS &&
    Object.keys(snappedState.snappedByHighway).length > 0
  ) {
    return snappedState.snappedByHighway
  }

  const ak = String(accountKey || '').trim()
  const tomtomKey = ak ? await getTomtomApiKeyForAccount(ak) : ''

  if (!tomtomKey) {
    return snappedState.snappedByHighway || {}
  }

  const newSnapped = { ...snappedState.snappedByHighway }

  for (const highwayId of Object.keys(HIGHWAYS)) {
    if (newSnapped[highwayId] && newSnapped[highwayId].length > 0) {
      continue
    }
    const snapped = await fetchSnappedWaypoints(ak, tomtomKey, highwayId)
    if (snapped && snapped.length > 0) {
      newSnapped[highwayId] = snapped
    }
  }

  snappedState.fetchedAt = now
  snappedState.snappedByHighway = newSnapped
  await writeSnappedState(snappedState)

  return newSnapped
}

/**
 * @param {SeriesState} st
 */
function trimHighwayPoints(st) {
  for (const id of Object.keys(st.pointsByHighway)) {
    const a = st.pointsByHighway[id]
    if (Array.isArray(a) && a.length > MAX_POINTS_PER_HIGHWAY) {
      st.pointsByHighway[id] = a.slice(a.length - MAX_POINTS_PER_HIGHWAY)
    }
  }
}

/**
 * Append a data point to the series for a highway.
 * @param {string} highwayId
 * @param {number} minutes
 * @param {number} speedMph
 */
async function appendDataPoint(highwayId, minutes, speedMph) {
  const st = await readState()
  const now = Date.now()
  if (!st.pointsByHighway[highwayId]) {
    st.pointsByHighway[highwayId] = []
  }
  st.pointsByHighway[highwayId].push({
    t: now,
    m: Number.isFinite(minutes) ? Math.round(minutes * 10) / 10 : 0,
    s: Number.isFinite(speedMph) ? Math.round(speedMph) : 0,
  })
  st.lastAppendTs = now
  trimHighwayPoints(st)
  await writeKeyJson(KEY, st)
  return st
}

/**
 * Get traffic data from HERE Traffic Flow API.
 * @param {string} accountKey
 * @param {string} hereApiKey
 * @param {string} highwayId
 * @returns {Promise<{ ok: boolean, travelMinutes: number | null, speedMph: number | null, error?: string }>}
 */
async function fetchHereTraffic(accountKey, hereApiKey, highwayId) {
  const hw = HIGHWAYS[highwayId]
  if (!hw) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'Unknown highway' }
  }

  const ak = String(accountKey || '').trim()
  try {
    if (ak) await assertApiAllowed(ak, 'here')
  } catch (e) {
    if (e instanceof ApiQuotaError) {
      return {
        ok: false,
        travelMinutes: null,
        speedMph: null,
        error: e.message,
      }
    }
    throw e
  }

  const polyline = encodeFlexiblePolyline(hw.waypoints, 5)
  if (!polyline) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'Failed to encode polyline' }
  }

  const res = await getTrafficFlowCorridor(hereApiKey, polyline, 200)
  if (!res.ok) {
    const d = res.data && typeof res.data === 'object' ? res.data : {}
    const errMsg = d.error || d.title || `HERE HTTP ${res.status}`
    return { ok: false, travelMinutes: null, speedMph: null, error: String(errMsg) }
  }

  const parsed = parseTrafficFlowResponse(res.data)
  if (parsed.travelTimeSeconds <= 0) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'No flow data returned' }
  }

  if (ak) await recordApiCompletedCall(ak, 'here').catch(() => {})

  const travelMinutes = parsed.travelTimeSeconds / 60
  const speedMph = parsed.avgSpeedMps * MPS_TO_MPH

  return { ok: true, travelMinutes, speedMph }
}

/**
 * Get traffic data from TomTom Routing API (fallback).
 * @param {string} accountKey
 * @param {string} tomtomApiKey
 * @param {string} highwayId
 * @returns {Promise<{ ok: boolean, travelMinutes: number | null, speedMph: number | null, error?: string }>}
 */
async function fetchTomtomTraffic(accountKey, tomtomApiKey, highwayId) {
  const hw = HIGHWAYS[highwayId]
  if (!hw) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'Unknown highway' }
  }

  const ak = String(accountKey || '').trim()
  try {
    if (ak) await assertApiAllowed(ak, 'tomtom')
  } catch (e) {
    if (e instanceof ApiQuotaError) {
      return {
        ok: false,
        travelMinutes: null,
        speedMph: null,
        error: e.message,
      }
    }
    throw e
  }

  const pathPoints = hw.waypoints.map((p) => ({ latitude: p.lat, longitude: p.lng }))

  const res = await getCalculateRoutePolyline(tomtomApiKey, pathPoints)
  if (!res.ok) {
    const d = res.data && typeof res.data === 'object' ? res.data : {}
    const errMsg = d.error || d.message || `TomTom HTTP ${res.status}`
    return { ok: false, travelMinutes: null, speedMph: null, error: String(errMsg) }
  }

  const data = res.data
  if (!data || typeof data !== 'object') {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'Invalid TomTom response' }
  }

  const routes = data.routes
  if (!Array.isArray(routes) || routes.length === 0) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'No route found' }
  }

  const route = routes[0]
  const summary = route.summary
  if (!summary || typeof summary !== 'object') {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'No route summary' }
  }

  const travelTimeSeconds = Number(summary.travelTimeInSeconds) || 0
  const lengthMeters = Number(summary.lengthInMeters) || 0

  if (travelTimeSeconds <= 0) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'No travel time in response' }
  }

  if (ak) await recordApiCompletedCall(ak, 'tomtom').catch(() => {})

  const travelMinutes = travelTimeSeconds / 60
  const speedMph =
    lengthMeters > 0 && travelTimeSeconds > 0
      ? (lengthMeters / travelTimeSeconds) * MPS_TO_MPH
      : null

  return { ok: true, travelMinutes, speedMph }
}

/**
 * Trend: worse = higher travel time (minutes) vs the prior stored sample.
 * @param {DataPoint[]} a
 * @returns {'better' | 'worse' | 'neutral' | 'unknown'}
 */
function trendFromSeries(a) {
  if (!Array.isArray(a) || a.length < 2) return 'unknown'
  const p = a[a.length - 2].m
  const c = a[a.length - 1].m
  const d = c - p
  if (Math.abs(d) < 0.75) return 'neutral'
  if (d > 0) return 'worse'
  return 'better'
}

/** @type {Record<string, { travelMinutes: number | null, speedMph: number | null }> | null} */
let lastLive = null
let lastFetchedAt = 0
let lastSource = /** @type {'here' | 'tomtom' | null} */ (null)
let lastError = /** @type {string | null} */ (null)

/**
 * Get list of highway IDs.
 * @returns {string[]}
 */
export function getHighwayIds() {
  return Object.keys(HIGHWAYS)
}

/**
 * Get highway metadata.
 * @param {string} highwayId
 * @returns {{ name: string, shortName: string, route: string } | null}
 */
export function getHighwayMeta(highwayId) {
  const hw = HIGHWAYS[highwayId]
  if (!hw) return null
  return { name: hw.name, shortName: hw.shortName, route: hw.route }
}

/**
 * Fetch traffic for all highways.
 * @param {string} accountKey
 * @returns {Promise<{ ok: boolean, fetchedAt: number, highways: any, source: 'here' | 'tomtom' | null, error: string | null }>}
 */
export async function fetchAllHighwayTraffic(accountKey) {
  const ak = String(accountKey || '').trim()
  
  const hereKey = ak ? sanitizeHereApiKey(await getHereApiKeyForAccount(ak)) : ''
  const tomtomKey = ak ? await getTomtomApiKeyForAccount(ak) : ''

  if (!hereKey && !tomtomKey) {
    return {
      ok: false,
      fetchedAt: lastFetchedAt,
      highways: null,
      source: null,
      error: 'No HERE or TomTom API key configured in Settings.',
    }
  }

  const results = /** @type {Record<string, { travelMinutes: number | null, speedMph: number | null }>} */ ({})
  let usedSource = /** @type {'here' | 'tomtom' | null} */ (null)
  let fetchError = /** @type {string | null} */ (null)

  for (const highwayId of Object.keys(HIGHWAYS)) {
    let result = { ok: false, travelMinutes: null, speedMph: null, error: 'No API key' }

    if (hereKey) {
      result = await fetchHereTraffic(ak, hereKey, highwayId)
      if (result.ok) {
        usedSource = 'here'
      }
    }

    if (!result.ok && tomtomKey) {
      result = await fetchTomtomTraffic(ak, tomtomKey, highwayId)
      if (result.ok) {
        usedSource = 'tomtom'
      }
    }

    if (result.ok) {
      results[highwayId] = {
        travelMinutes: result.travelMinutes,
        speedMph: result.speedMph,
      }
      if (result.travelMinutes != null && result.speedMph != null) {
        await appendDataPoint(highwayId, result.travelMinutes, result.speedMph)
      }
    } else if (!fetchError) {
      fetchError = result.error || 'Unknown error'
    }
  }

  const hasData = Object.values(results).some(r => r.travelMinutes != null)

  lastLive = results
  lastFetchedAt = Date.now()
  lastSource = usedSource
  lastError = hasData ? null : fetchError

  return {
    ok: hasData,
    fetchedAt: lastFetchedAt,
    highways: results,
    source: usedSource,
    error: hasData ? null : fetchError,
  }
}

/**
 * Get highway traffic response payload.
 * Uses cache if fresh enough, otherwise fetches.
 * @param {string} accountKey
 */
export async function getHighwayTrafficPayload(accountKey) {
  const now = Date.now()
  
  if (!lastLive || now - lastFetchedAt > CACHE_TTL_MS) {
    await fetchAllHighwayTraffic(accountKey)
  }

  const st = await readState()
  const snappedWaypoints = await getSnappedWaypoints(accountKey)
  
  /** @type {Array<{ id: string, name: string, shortName: string, route: string, waypoints: Array<{ lat: number, lng: number }>, trend: string, series: DataPoint[], live: { routeTravelTime: number | null, routeSpeed: number | null } }>} */
  const highways = []

  for (const highwayId of Object.keys(HIGHWAYS)) {
    const hw = HIGHWAYS[highwayId]
    const series = st.pointsByHighway?.[highwayId] || []
    const recent = series.slice(-288)
    const live = lastLive?.[highwayId] || { travelMinutes: null, speedMph: null }
    const waypoints = snappedWaypoints[highwayId] || hw.waypoints
    
    highways.push({
      id: highwayId,
      name: hw.name,
      shortName: hw.shortName,
      route: hw.route,
      waypoints,
      trend: trendFromSeries(series),
      series: recent,
      live: {
        routeTravelTime: live.travelMinutes != null 
          ? Math.round(live.travelMinutes * 10) / 10 
          : null,
        routeSpeed: live.speedMph != null 
          ? Math.round(live.speedMph) 
          : null,
      },
    })
  }

  return {
    ok: Object.values(lastLive || {}).some(r => r?.travelMinutes != null),
    fetchedAt: lastFetchedAt,
    highways,
    source: lastSource,
    error: lastError,
  }
}
