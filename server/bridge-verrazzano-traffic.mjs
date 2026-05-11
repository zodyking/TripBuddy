/**
 * Verrazzano-Narrows Bridge traffic data via HERE Traffic Flow API.
 * Mirrors the PANYNJ bridge pattern: live crossing time + speed + series history.
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

const KEY = G('bridge:verrazzano:series')
const MAX_POINTS_PER_DIRECTION = 500
const MPS_TO_MPH = 2.23694

/**
 * Verrazzano-Narrows Bridge polyline waypoints.
 * Short polyline along I-278 across the span, tuned against map.
 * ToNY: SI → Brooklyn; ToNJ: Brooklyn → SI.
 */
const POLYLINES = {
  ToNY: [
    { lat: 40.6025, lng: -74.0455 },
    { lat: 40.6048, lng: -74.0448 },
    { lat: 40.6092, lng: -74.0425 },
    { lat: 40.6135, lng: -74.0390 },
    { lat: 40.6165, lng: -74.0355 },
    { lat: 40.6195, lng: -74.0320 },
  ],
  ToNJ: [
    { lat: 40.6195, lng: -74.0320 },
    { lat: 40.6165, lng: -74.0355 },
    { lat: 40.6135, lng: -74.0390 },
    { lat: 40.6092, lng: -74.0425 },
    { lat: 40.6048, lng: -74.0448 },
    { lat: 40.6025, lng: -74.0455 },
  ],
}

/**
 * @typedef {{ t: number, m: number, s: number }} DataPoint
 * @typedef {{ lastAppendTs: number, pointsByDirection: { ToNY: DataPoint[], ToNJ: DataPoint[] } }} SeriesState
 */

/**
 * @returns {Promise<SeriesState>}
 */
async function readState() {
  return readKeyJson(KEY, () => ({
    lastAppendTs: 0,
    pointsByDirection: { ToNY: [], ToNJ: [] },
  }))
}

/**
 * @param {SeriesState} st
 */
function trimDirectionPoints(st) {
  for (const dir of ['ToNY', 'ToNJ']) {
    const a = st.pointsByDirection[dir]
    if (Array.isArray(a) && a.length > MAX_POINTS_PER_DIRECTION) {
      st.pointsByDirection[dir] = a.slice(a.length - MAX_POINTS_PER_DIRECTION)
    }
  }
}

/**
 * Append a data point to the series for a direction.
 * @param {'ToNY' | 'ToNJ'} dir
 * @param {number} minutes
 * @param {number} speedMph
 */
async function appendDataPoint(dir, minutes, speedMph) {
  const st = await readState()
  const now = Date.now()
  if (!st.pointsByDirection[dir]) {
    st.pointsByDirection[dir] = []
  }
  st.pointsByDirection[dir].push({
    t: now,
    m: Number.isFinite(minutes) ? Math.round(minutes * 10) / 10 : 0,
    s: Number.isFinite(speedMph) ? Math.round(speedMph) : 0,
  })
  st.lastAppendTs = now
  trimDirectionPoints(st)
  await writeKeyJson(KEY, st)
  return st
}

/**
 * Get traffic data from HERE Traffic Flow API.
 * @param {string} hereApiKey
 * @param {'ToNY' | 'ToNJ'} dir
 * @returns {Promise<{ ok: boolean, travelMinutes: number | null, speedMph: number | null, error?: string }>}
 */
async function fetchHereTraffic(accountKey, hereApiKey, dir) {
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
  const waypoints = POLYLINES[dir]
  const polyline = encodeFlexiblePolyline(waypoints, 5)
  if (!polyline) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'Failed to encode polyline' }
  }

  const res = await getTrafficFlowCorridor(hereApiKey, polyline, 150)
  if (!res.ok) {
    const d = res.data && typeof res.data === 'object' ? res.data : {}
    const errMsg = d.error || d.title || `HERE HTTP ${res.status}`
    return { ok: false, travelMinutes: null, speedMph: null, error: String(errMsg) }
  }

  const parsed = parseTrafficFlowResponse(res.data)
  if (parsed.travelTimeSeconds <= 0) {
    return { ok: false, travelMinutes: null, speedMph: null, error: 'No flow data returned' }
  }

  const travelMinutes = parsed.travelTimeSeconds / 60
  const speedMph = parsed.avgSpeedMps * MPS_TO_MPH

  if (ak) await recordApiCompletedCall(ak, 'here').catch(() => {})

  return { ok: true, travelMinutes, speedMph }
}

/**
 * Get traffic data from TomTom Routing API (fallback).
 * @param {string} accountKey
 * @param {string} tomtomApiKey
 * @param {'ToNY' | 'ToNJ'} dir
 * @returns {Promise<{ ok: boolean, travelMinutes: number | null, speedMph: number | null, error?: string }>}
 */
async function fetchTomtomTraffic(accountKey, tomtomApiKey, dir) {
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
  const waypoints = POLYLINES[dir]
  const pathPoints = waypoints.map(p => ({ latitude: p.lat, longitude: p.lng }))
  
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

  const travelMinutes = travelTimeSeconds / 60
  const speedMph = lengthMeters > 0 && travelTimeSeconds > 0
    ? (lengthMeters / travelTimeSeconds) * MPS_TO_MPH
    : null

  if (ak) await recordApiCompletedCall(ak, 'tomtom').catch(() => {})

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

/** @type {{ ToNY: { travelMinutes: number | null, speedMph: number | null }, ToNJ: { travelMinutes: number | null, speedMph: number | null } } | null} */
let lastLive = null
let lastFetchedAt = 0
let lastSource = /** @type {'here' | 'tomtom' | null} */ (null)
let lastError = /** @type {string | null} */ (null)
/** Coalesce concurrent GETs (multiple tabs) into one HERE refresh. */
let verrazzanoRefreshInFlight = /** @type {Promise<void> | null} */ (null)

/** Match highway traffic cadence; see server/highway-traffic.mjs CACHE_TTL_MS */
const CACHE_TTL_MS = 50 * 60 * 1000

/**
 * Fetch Verrazzano traffic for both directions.
 * @param {string} accountKey
 * @returns {Promise<{ ok: boolean, fetchedAt: number, byDirection: any, source: 'here' | 'tomtom' | null, error: string | null }>}
 */
export async function fetchVerrazzanoTraffic(accountKey) {
  const ak = String(accountKey || '').trim()
  
  const hereKey = ak ? sanitizeHereApiKey(await getHereApiKeyForAccount(ak)) : ''
  const tomtomKey = ak ? await getTomtomApiKeyForAccount(ak) : ''

  if (!hereKey && !tomtomKey) {
    return {
      ok: false,
      fetchedAt: lastFetchedAt,
      byDirection: null,
      source: null,
      error: 'No HERE or TomTom API key configured in Settings.',
    }
  }

  const results = /** @type {{ ToNY: { travelMinutes: number | null, speedMph: number | null }, ToNJ: { travelMinutes: number | null, speedMph: number | null } }} */ ({
    ToNY: { travelMinutes: null, speedMph: null },
    ToNJ: { travelMinutes: null, speedMph: null },
  })
  let usedSource = /** @type {'here' | 'tomtom' | null} */ (null)
  let fetchError = /** @type {string | null} */ (null)

  for (const dir of /** @type {const} */ (['ToNY', 'ToNJ'])) {
    let result = { ok: false, travelMinutes: null, speedMph: null, error: 'No API key' }

    if (hereKey) {
      result = await fetchHereTraffic(ak, hereKey, dir)
      if (result.ok) {
        usedSource = 'here'
      }
    }

    if (!result.ok && tomtomKey) {
      result = await fetchTomtomTraffic(ak, tomtomKey, dir)
      if (result.ok) {
        usedSource = 'tomtom'
      }
    }

    if (result.ok) {
      results[dir] = {
        travelMinutes: result.travelMinutes,
        speedMph: result.speedMph,
      }
      if (result.travelMinutes != null && result.speedMph != null) {
        await appendDataPoint(dir, result.travelMinutes, result.speedMph)
      }
    } else if (!fetchError) {
      fetchError = result.error || 'Unknown error'
    }
  }

  const hasData = results.ToNY.travelMinutes != null || results.ToNJ.travelMinutes != null

  lastLive = results
  lastFetchedAt = Date.now()
  lastSource = usedSource
  lastError = hasData ? null : fetchError

  return {
    ok: hasData,
    fetchedAt: lastFetchedAt,
    byDirection: results,
    source: usedSource,
    error: hasData ? null : fetchError,
  }
}

/**
 * Get Verrazzano response payload (matching PANYNJ shape).
 * Uses cache if fresh enough, otherwise fetches.
 * @param {string} accountKey
 */
export async function getVerrazzanoResponsePayload(accountKey) {
  const now = Date.now()

  if (!lastLive || now - lastFetchedAt > CACHE_TTL_MS) {
    if (!verrazzanoRefreshInFlight) {
      verrazzanoRefreshInFlight = (async () => {
        await fetchVerrazzanoTraffic(accountKey)
      })().finally(() => {
        verrazzanoRefreshInFlight = null
      })
    }
    await verrazzanoRefreshInFlight
  }

  const st = await readState()
  
  /** @type {Record<string, { trend: 'better' | 'worse' | 'neutral' | 'unknown', series: DataPoint[], live: { routeTravelTime: number | null, routeSpeed: number | null } }>} */
  const byDirection = {}

  for (const dir of /** @type {const} */ (['ToNY', 'ToNJ'])) {
    const series = st.pointsByDirection?.[dir] || []
    const recent = series.slice(-288)
    const live = lastLive?.[dir] || { travelMinutes: null, speedMph: null }
    
    byDirection[dir] = {
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
    }
  }

  return {
    ok: !!(lastLive?.ToNY?.travelMinutes || lastLive?.ToNJ?.travelMinutes),
    fetchedAt: lastFetchedAt,
    byDirection,
    source: lastSource,
    error: lastError,
  }
}
