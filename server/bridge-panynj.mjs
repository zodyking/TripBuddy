import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'
import { maybeNotifyBridgeCrossingDigest } from './notification-publish.mjs'
import { maybeNotifyBridgeTierChanges } from './bridge-tier-notifications.mjs'
import {
  getQuotaAccountKey,
  assertApiAllowed,
  recordApiCompletedCall,
} from './api-quota.mjs'
import {
  canonicalPanynjSeriesKey,
  panynjSeriesStorageKeys,
} from '../src/bridges/panynjRouteKeys.js'

const KEY = G('bridge:panynj:series')
const PA_URL =
  'https://www.panynj.gov/bin/portauthority/crossingtimesapi.json'
const POLL_MS = 5 * 60 * 1000
const MAX_POINTS_PER_ROUTE = 500

let pollTimer = null
let lastFetchError = null
let lastFetchAt = 0
/** @type {unknown[]|null} */
let lastLiveArray = null
/** @type {Promise<unknown> | null} */
let refreshInFlight = null

/**
 * @param {unknown} x
 * @returns {x is Record<string, unknown>}
 */
function isOb(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x)
}

/**
 * @returns {Promise<unknown[]>}
 */
export async function fetchPanynjCrossingJson() {
  const r = await fetch(PA_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'TripBuddy/1.0 (+https://github.com/zodyking/TripBuddy)',
    },
  })
  if (!r.ok) {
    throw new Error(`Port Authority: HTTP ${r.status}`)
  }
  return /** @type {unknown} */ (await r.json())
}

/**
 * @typedef {{ lastAppendTs: number, pointsByRoute: Record<string, { t: number, m: number, s: number }[]> }} SeriesState
 */

/**
 * @returns {Promise<SeriesState>}
 */
async function readState() {
  return readKeyJson(KEY, () => ({
    lastAppendTs: 0,
    pointsByRoute: {},
  }))
}

/**
 * @param {SeriesState} st
 */
function trimRoutePoints(st) {
  for (const k of Object.keys(st.pointsByRoute)) {
    const a = st.pointsByRoute[k]
    if (Array.isArray(a) && a.length > MAX_POINTS_PER_ROUTE) {
      st.pointsByRoute[k] = a.slice(a.length - MAX_POINTS_PER_ROUTE)
    }
  }
}

/**
 * Merge history from canonical + legacy routeId keys (GWB id churn).
 * @param {SeriesState['pointsByRoute']} pointsByRoute
 * @param {unknown} row
 */
function mergedSeriesForRow(pointsByRoute, row) {
  if (!pointsByRoute || typeof pointsByRoute !== 'object') return []
  /** @type {Array<{ t: number, m: number, s: number }>} */
  const merged = []
  const seen = new Set()
  for (const key of panynjSeriesStorageKeys(row)) {
    const a = pointsByRoute[key]
    if (!Array.isArray(a)) continue
    for (const p of a) {
      if (!p || typeof p !== 'object') continue
      const t = Number(p.t)
      if (!Number.isFinite(t) || seen.has(t)) continue
      seen.add(t)
      merged.push({
        t,
        m: Number(p.m),
        s: Number(p.s),
      })
    }
  }
  merged.sort((a, b) => a.t - b.t)
  if (merged.length > MAX_POINTS_PER_ROUTE) {
    return merged.slice(merged.length - MAX_POINTS_PER_ROUTE)
  }
  return merged
}

/**
 * Append one sample from live API array.
 * @param {unknown[]} live
 */
export async function appendPanynjSnapshotFromLive(live) {
  const st = await readState()
  const now = Date.now()
  for (const row of live) {
    if (!isOb(row)) continue
    if (row.routeId == null || (typeof row.routeId !== 'number' && typeof row.routeId !== 'string')) {
      continue
    }
    const key = canonicalPanynjSeriesKey(row) || String(row.routeId)
    const m =
      typeof row.routeTravelTime === 'number' && Number.isFinite(row.routeTravelTime)
        ? row.routeTravelTime
        : 0
    const s =
      typeof row.routeSpeed === 'number' && Number.isFinite(row.routeSpeed)
        ? row.routeSpeed
        : 0
    if (!st.pointsByRoute[key]) st.pointsByRoute[key] = []
    st.pointsByRoute[key].push({ t: now, m, s })
  }
  st.lastAppendTs = now
  trimRoutePoints(st)
  await writeKeyJson(KEY, st)
  return st
}

/**
 * One Port Authority pull + store.
 */
export async function refreshPanynjCrossingData() {
  const ak = getQuotaAccountKey()
  if (ak) await assertApiAllowed(ak, 'panynj')
  const j = await fetchPanynjCrossingJson()
  const live = Array.isArray(j) ? j : []
  if (live.length === 0) {
    throw new Error('Empty or invalid response')
  }
  lastLiveArray = live
  lastFetchAt = Date.now()
  lastFetchError = null
  const st = await appendPanynjSnapshotFromLive(live)
  if (process.env.BRIDGE_IN_APP_NOTIFICATIONS === '1') {
    maybeNotifyBridgeCrossingDigest(live)
    await maybeNotifyBridgeTierChanges(live)
  }
  if (ak) await recordApiCompletedCall(ak, 'panynj').catch(() => {})
  return st
}

/**
 * Refresh when cache is empty or older than poll interval (client reads stay fresh).
 */
async function ensureFreshPanynjLive() {
  const now = Date.now()
  const stale = !lastLiveArray || !lastFetchAt || now - lastFetchAt > POLL_MS
  if (!stale) return
  if (!refreshInFlight) {
    refreshInFlight = refreshPanynjCrossingData()
      .catch((e) => {
        lastFetchError = e instanceof Error ? e.message : String(e)
        throw e
      })
      .finally(() => {
        refreshInFlight = null
      })
  }
  try {
    await refreshInFlight
  } catch {
    /* serve last good cache if refresh fails */
  }
}

export function getLastPanynjLive() {
  return {
    live: lastLiveArray,
    fetchedAt: lastFetchAt,
    fetchError: lastFetchError,
  }
}

/**
 * @param {(e: unknown) => void} [onErr]
 */
export function startPanynjBridgePoll(onErr) {
  if (pollTimer) return
  const tick = () => {
    void refreshPanynjCrossingData().catch((e) => {
      lastFetchError = e instanceof Error ? e.message : String(e)
      onErr?.(e)
    })
  }
  tick()
  pollTimer = setInterval(tick, POLL_MS)
}

/**
 * Worse = higher travel time (minutes) vs the prior stored sample.
 * @param {Array<{ t: number, m: number, s: number }>} a
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

export async function getBridgesResponsePayload() {
  await ensureFreshPanynjLive()
  const { live, fetchedAt, fetchError } = getLastPanynjLive()
  const st = await readState()
  /** @type {Record<string, { trend: 'better' | 'worse' | 'neutral' | 'unknown', series: { t: number, m: number, s: number }[] }>} */
  const byRoute = {}
  if (Array.isArray(live)) {
    for (const row of live) {
      if (!isOb(row) || row.routeId == null) continue
      const id = String(row.routeId)
      if (byRoute[id]) continue
      const merged = mergedSeriesForRow(st.pointsByRoute, row)
      if (!merged.length) {
        byRoute[id] = { trend: 'unknown', series: [] }
        continue
      }
      byRoute[id] = { trend: trendFromSeries(merged), series: merged.slice(-288) }
    }
  }
  return {
    ok: true,
    source: PA_URL,
    pollIntervalMs: POLL_MS,
    fetchedAt,
    fetchError: fetchError || null,
    lastStoredTs: st.lastAppendTs,
    live: live || [],
    byRoute,
  }
}

export { PA_URL, POLL_MS }
