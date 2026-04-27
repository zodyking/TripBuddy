import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'

const PA_URL =
  'https://www.panynj.gov/bin/portauthority/crossingtimesapi.json'
const POLL_MS = 5 * 60 * 1000
const SERIES_FILE = path.join(LOCAL_DIR, 'bridge-panynj-series.json')
const MAX_PER_ROUTE = 400

let pollTimer = null
let lastLive = /** @type {unknown[] | null} */ (null)
let lastFetchAt = 0
let lastError = /** @type {string | null} */ (null)

/**
 * @param {unknown} x
 * @returns {x is Record<string, unknown>}
 */
function isOb(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x)
}

async function readSeriesState() {
  try {
    const raw = await fs.readFile(SERIES_FILE, 'utf8')
    const d = JSON.parse(raw)
    if (d && typeof d === 'object' && d.pointsByRoute && typeof d.pointsByRoute === 'object') {
      return d
    }
  } catch {
    /* first run */
  }
  return { lastAppendTs: 0, pointsByRoute: {} }
}

async function writeSeriesState(st) {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  await fs.writeFile(SERIES_FILE, JSON.stringify(st), 'utf8')
}

export async function fetchPanynjCrossingJson() {
  const r = await fetch(PA_URL, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`Port Authority: HTTP ${r.status}`)
  return r.json()
}

export async function refreshPanynjCrossingData() {
  const j = await fetchPanynjCrossingJson()
  const live = Array.isArray(j) ? j : []
  if (live.length === 0) throw new Error('Empty response')
  lastLive = live
  lastFetchAt = Date.now()
  lastError = null

  const st = await readSeriesState()
  const now = Date.now()
  for (const row of live) {
    if (!isOb(row) || row.routeId == null) continue
    const key = String(row.routeId)
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
    const a = st.pointsByRoute[key]
    if (a.length > MAX_PER_ROUTE) st.pointsByRoute[key] = a.slice(a.length - MAX_PER_ROUTE)
  }
  st.lastAppendTs = now
  await writeSeriesState(st)
  return st
}

function trendFromPoints(a) {
  if (!Array.isArray(a) || a.length < 2) return 'unknown'
  const d = a[a.length - 1].m - a[a.length - 2].m
  if (Math.abs(d) < 0.75) return 'neutral'
  if (d > 0) return 'worse'
  return 'better'
}

export function getPanynjSnapshot() {
  return { live: lastLive, fetchedAt: lastFetchAt, fetchError: lastError, source: PA_URL, pollIntervalMs: POLL_MS }
}

export async function getBridgesResponsePayload() {
  const { live, fetchedAt, fetchError, source, pollIntervalMs } = getPanynjSnapshot()
  const st = await readSeriesState()
  /** @type {Record<string, { trend: string, series: { t: number, m: number, s: number }[] }>} */
  const byRoute = {}
  if (Array.isArray(live)) {
    for (const row of live) {
      if (!isOb(row) || row.routeId == null) continue
      const id = String(row.routeId)
      if (byRoute[id]) continue
      const a = st.pointsByRoute?.[id]
      if (!Array.isArray(a) || a.length < 1) {
        byRoute[id] = { trend: 'unknown', series: [] }
        continue
      }
      byRoute[id] = { trend: trendFromPoints(a), series: a.slice(-144) }
    }
  }
  return {
    ok: true,
    source,
    pollIntervalMs,
    fetchedAt,
    fetchError: fetchError || null,
    lastStoredTs: st.lastAppendTs,
    live: live || [],
    byRoute,
  }
}

export function startPanynjBridgePoll() {
  if (pollTimer) return
  const tick = () => {
    void refreshPanynjCrossingData().catch((e) => {
      lastError = e instanceof Error ? e.message : String(e)
    })
  }
  void tick()
  pollTimer = setInterval(tick, POLL_MS)
}

export { PA_URL, POLL_MS }
