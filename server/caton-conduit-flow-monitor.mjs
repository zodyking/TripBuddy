/**
 * TomTom Traffic Flow Segment Data for the Caton → Conduit corridor (fixed samples).
 * Caches full aggregation for 60 seconds. Not routing — flowSegmentData only.
 */

import { CATON_CONDUIT_CORRIDOR_POINTS } from './caton-conduit-corridor.mjs'

const FLOW_PREFIX = 'https://api.tomtom.com/traffic/services/4/flowSegmentData'
/** Match Flow raster tiles on Crossings map when possible */
const ZOOM = 16
const STYLE = 'absolute'
const FORMAT = 'json'
const UNIT = 'MPH'

/** Target spacing along polyline for sampling (~300–500 m) */
const TARGET_SAMPLE_METERS = 400

/** In-memory cache */
let cacheKey = ''
let cacheExpiresAt = 0
/** @type {unknown} */
let cachePayload = null

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeTomtomApiKey(raw) {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  if (s.length < 8 || s.length > 256) return ''
  if (!/^[A-Za-z0-9._~-]+$/.test(s)) return ''
  return s
}

/**
 * Haversine meters between two WGS84 points.
 */
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Vertex indices ~every TARGET_SAMPLE_METERS along cumulative path (always include ends).
 * @param {{ lat: number, lon: number }[]} pts
 * @returns {number[]}
 */
function sampleIndicesAlongPolyline(pts) {
  if (!pts.length) return []
  if (pts.length === 1) return [0]
  /** @type {number[]} */
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon),
    )
  }
  /** @type {number[]} */
  const idx = [0]
  let target = TARGET_SAMPLE_METERS
  for (let i = 1; i < pts.length - 1; i++) {
    if (cum[i] >= target) {
      idx.push(i)
      target += TARGET_SAMPLE_METERS
    }
  }
  const last = pts.length - 1
  if (idx[idx.length - 1] !== last) idx.push(last)
  return [...new Set(idx)].sort((a, b) => a - b)
}

/**
 * @param {string} key
 * @param {number} lat
 * @param {number} lon
 */
async function fetchFlowSegment(key, lat, lon) {
  const point = `${lat},${lon}`
  const url = `${FLOW_PREFIX}/${STYLE}/${ZOOM}/${FORMAT}?key=${encodeURIComponent(key)}&point=${encodeURIComponent(point)}&unit=${UNIT}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    return { ok: false, httpStatus: res.status, error: 'Invalid JSON from TomTom' }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && data.detailedError) ||
      (data && typeof data === 'object' && data.message) ||
      text.slice(0, 120) ||
      `HTTP ${res.status}`
    return { ok: false, httpStatus: res.status, error: String(msg) }
  }
  const flow =
    data &&
    typeof data === 'object' &&
    data.flowSegmentData &&
    typeof data.flowSegmentData === 'object'
      ? data.flowSegmentData
      : null
  if (!flow) {
    return { ok: false, httpStatus: res.status, error: 'Missing flowSegmentData' }
  }
  return { ok: true, flow }
}

/**
 * @param {readonly { lat: number, lon: number }[]} samples
 * @param {string} key
 * @param {number} concurrency
 */
async function fetchAllSamples(samples, key, concurrency = 4) {
  /** @type {Awaited<ReturnType<typeof fetchFlowSegment>>[]} */
  const results = new Array(samples.length)
  let i = 0

  async function worker() {
    while (i < samples.length) {
      const j = i++
      const p = samples[j]
      results[j] = await fetchFlowSegment(key, p.lat, p.lon)
    }
  }

  const n = Math.min(concurrency, Math.max(1, samples.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

/**
 * @param {string} apiKey
 */
export async function getCatonConduitCorridorStatus(apiKey) {
  const key = sanitizeTomtomApiKey(apiKey)
  if (!key) {
    return {
      ok: false,
      error: 'TomTom API key required (Settings traffic key or TOMTOM_API_KEY).',
    }
  }

  const now = Date.now()
  if (cachePayload && cacheKey === key && now < cacheExpiresAt) {
    return /** @type {Record<string, unknown>} */ (cachePayload)
  }

  const pts = CATON_CONDUIT_CORRIDOR_POINTS
  const indices = sampleIndicesAlongPolyline(pts)
  const samples = indices.map((idx) => ({
    index: idx,
    lat: pts[idx].lat,
    lon: pts[idx].lon,
  }))

  const rawResults = await fetchAllSamples(samples, key, 4)

  let totalTravelTime = 0
  let totalDelay = 0
  /** @type {number[]} */
  const speedsCur = []
  /** @type {number[]} */
  const speedsFf = []
  /** @type {unknown[]} */
  const segments = []

  for (let si = 0; si < samples.length; si++) {
    const s = samples[si]
    const r = rawResults[si]
    /** @type {Record<string, unknown>} */
    const row = {
      sampleIndex: s.index,
      lat: s.lat,
      lon: s.lon,
    }
    if (!r || !r.ok || !r.flow) {
      row.ok = false
      row.error = r && 'error' in r ? String(r.error) : 'No data'
      segments.push(row)
      continue
    }
    const f = /** @type {Record<string, unknown>} */ (r.flow)
    const ct = Number(f.currentTravelTime)
    const fft = Number(f.freeFlowTravelTime)
    const cs = Number(f.currentSpeed)
    const ff = Number(f.freeFlowSpeed)
    const closure = f.roadClosure === true

    row.ok = true
    row.currentTravelTime = Number.isFinite(ct) ? ct : null
    row.freeFlowTravelTime = Number.isFinite(fft) ? fft : null
    row.currentSpeed = Number.isFinite(cs) ? cs : null
    row.freeFlowSpeed = Number.isFinite(ff) ? ff : null
    row.roadClosure = closure
    segments.push(row)

    if (closure) continue
    if (Number.isFinite(ct) && ct >= 0) totalTravelTime += ct
    if (Number.isFinite(ct) && Number.isFinite(fft)) {
      totalDelay += Math.max(0, ct - fft)
    }
    if (Number.isFinite(cs) && cs >= 0) speedsCur.push(cs)
    if (Number.isFinite(ff) && ff >= 0) speedsFf.push(ff)
  }

  const avg = (arr) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const payload = {
    ok: true,
    corridorId: 'caton-linden-conduit',
    corridorLabel: 'Caton Ave → Linden Blvd → S Conduit Ave',
    fetchedAt: now,
    cacheTtlMs: 60_000,
    zoom: ZOOM,
    sampleSpacingTargetM: TARGET_SAMPLE_METERS,
    sampleCount: samples.length,
    vertexCount: pts.length,
    totalTravelTimeSec: Math.round(totalTravelTime),
    totalDelaySec: Math.round(totalDelay),
    avgCurrentSpeedMph: avg(speedsCur),
    avgFreeFlowSpeedMph: avg(speedsFf),
    segments,
    polyline: pts.map((p) => ({ lat: p.lat, lng: p.lon })),
  }

  cacheKey = key
  cacheExpiresAt = now + 60_000
  cachePayload = payload

  return payload
}
