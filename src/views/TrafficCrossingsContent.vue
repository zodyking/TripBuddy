<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { getBridgesPanynj, getNy511Cameras, getVerrazzanoTraffic, getCredentials, apiFetch } from '../api.js'
import { getBridgeAnchorForRouteId } from '../bridges/bridgeRouteAnchors.js'
import { findVerrazzanoCamera, resolveBridgeCameraFeed } from '../bridges/bridgeCameraMapping.js'
import BridgesMap from '../components/BridgesMap.vue'
import BridgeCameraPlayer from '../components/BridgeCameraPlayer.vue'
import {
  bridgeShortLabelForRouteId,
  bridgeShortLabelFromDisplayName,
} from '../utils/mapMarkers.js'
import {
  bridgeDelayTierForRow,
  classifyBridgeTraffic,
} from '../utils/bridgeDelayTier.js'
import { useMapVehicleId } from '../composables/useMapVehicleId.js'
import { sanitizeNy511ImpactFootnote } from '../utils/ny511ImpactFootnote.js'
import { extractYoutubeVideoIdFromInput } from '../utils/youtubeVideoId.js'

defineOptions({ name: 'TrafficCrossingsContent' })

/**
 * Poll PANYNJ on the same cadence as server-side PANYNJ refresh (5 min).
 * NY511 traffic feeds are cached server-side ~5 min.
 * @see server/bridge-panynj.mjs POLL_MS
 */
const POLL_MS = 5 * 60 * 1000

/** @typedef {'ToNY' | 'ToNJ'} TravelDir */
/** @type {import('vue').Ref<TravelDir>} */
const direction = ref('ToNY')

/** @typedef {'crossings' | 'ny511'} ViewMode */
/** @type {import('vue').Ref<ViewMode>} */
const viewMode = ref('crossings')

const loading = ref(true)
const error = ref('')

/** @type {import('vue').Ref<any | null>} */
const payload = ref(null)

/** @type {import('vue').Ref<Array<{ bridge: string, videoUrl: string | null, imageUrl: string | null, status: string }>>} */
const cameras = ref([])
const camerasLoading = ref(false)
const camerasError = ref('')

/** @type {import('vue').Ref<any | null>} */
const verrazzanoPayload = ref(null)
const verrazzanoLoading = ref(false)

/** @type {import('vue').Ref<any | null>} */
const ny511Payload = ref(null)
const ny511Loading = ref(false)
const ny511Error = ref('')

let tick = 0
/** @type {ReturnType<typeof setInterval> | null} */
let intervalId = null

function fmtTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—'
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

/**
 * @param {unknown} text
 * @param {number} max
 */
function ny511Snippet(text, max = 200) {
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return ''
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/**
 * PANYNJ JSON usually uses "ToNY" / "ToNJ" but normalize in case of spacing/casing drift.
 * @param {unknown} v
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
function normalizeApiTravelDir(v) {
  const s = String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (s === 'TONY' || s === 'TOWARDNY' || s === 'TONYC') return 'ToNY'
  if (s === 'TONJ' || s === 'TOWARDNJ' || s === 'TONJE') return 'ToNJ'
  if (s.includes('TO') && s.includes('NY') && !s.includes('NJ')) return 'ToNY'
  if (s.includes('TO') && s.includes('NJ') && !s.includes('NY')) return 'ToNJ'
  return ''
}

/**
 * @param {unknown} row
 * @param {string} d
 */
function matchDir(row, d) {
  if (row == null || typeof row !== 'object' || !('travelDirection' in row)) {
    return false
  }
  const raw = /** @type {Record<string, unknown>} */(row).travelDirection
  return normalizeApiTravelDir(raw) === d
}

/**
 * Tunnels (Holland, Lincoln) — not shown on this page.
 * @param {unknown} row
 */
function isTunnelRow(row) {
  if (row == null || typeof row !== 'object') return false
  const n = String(
    (/** @type {Record<string, unknown>} */(row)).crossingDisplayName || '',
  )
  return /\btunnel\b/i.test(n)
}

/**
 * @param {unknown} row
 */
function isClosedRow(row) {
  return (
    row != null &&
    typeof row === 'object' &&
    /** @type {any} */(row).isCrossingClosed === true
  )
}

/**
 * @param {unknown} row
 */
function travelMinutes(row) {
  if (row == null || typeof row !== 'object') return Number.POSITIVE_INFINITY
  const m = (/** @type {Record<string, unknown>} */(row)).routeTravelTime
  if (typeof m === 'number' && Number.isFinite(m)) return m
  if (typeof m === 'string' && m !== '') {
    const n = Number(m)
    if (Number.isFinite(n)) return n
  }
  return Number.POSITIVE_INFINITY
}

/**
 * GWB: API returns 4 route rows; show only the pair for the current toggle (2 markers), not all four.
 * @param {unknown} row
 */
function isGwbRow(row) {
  return (
    row != null &&
    typeof row === 'object' &&
    /george washington bridge/i.test(
      String(/** @type {Record<string, unknown>} */(row).crossingDisplayName || ''),
    )
  )
}

/**
 * GWB: show **upper deck only** (one card + one map pin). Lower deck still in API for data.
 * To NY: 211 upper / 212 lower. To NJ: 12 upper / 11 lower.
 * @param {unknown} row
 * @param {'ToNY' | 'ToNJ'} d
 */
function gwbMatchRouteForToggle(row, d) {
  const o = /** @type {Record<string, unknown>} */(row)
  const rid = o.routeId
  const n = typeof rid === 'number' ? rid : Number(rid)
  if (d === 'ToNY') {
    return n === 211
  }
  return n === 12
}

const hasVerrazzanoCamera = computed(() => {
  return findVerrazzanoCamera(direction.value, cameras.value) !== null
})

const verrazzanoLiveData = computed(() => {
  const dir = direction.value
  const bd = verrazzanoPayload.value?.byDirection
  if (!bd || !bd[dir]) return null
  return bd[dir].live
})

const verrazzanoHasLiveData = computed(() => {
  const live = verrazzanoLiveData.value
  return live && live.routeTravelTime != null
})

const verrazzanoTrendInfo = computed(() => {
  const dir = direction.value
  const bd = verrazzanoPayload.value?.byDirection
  if (!bd || !bd[dir]) {
    return { short: '·', cls: 't--unk', full: 'Not enough data yet' }
  }
  const t = bd[dir].trend
  if (t === 'worse') {
    return { short: '▲', cls: 't--worse', full: 'Slower than last check' }
  }
  if (t === 'better') {
    return { short: '▼', cls: 't--better', full: 'Faster than last check' }
  }
  if (t === 'neutral') {
    return { short: '—', cls: 't--neutral', full: 'About the same' }
  }
  return { short: '·', cls: 't--unk', full: 'Not enough data yet' }
})

const verrazzanoSeries = computed(() => {
  const dir = direction.value
  const bd = verrazzanoPayload.value?.byDirection
  if (!bd || !bd[dir] || !Array.isArray(bd[dir].series)) return []
  return bd[dir].series
})

const rankedRows = computed(() => {
  const live = payload.value?.live
  const d = direction.value
  /** @type {any[]} */
  const out = []
  
  if (Array.isArray(live)) {
    for (const r of live) {
      if (isTunnelRow(r)) continue
      if (!matchDir(r, d)) continue
      if (isGwbRow(r) && !gwbMatchRouteForToggle(r, d)) continue
      out.push(r)
    }
  }
  
  const vzLive = verrazzanoLiveData.value
  if (vzLive && vzLive.routeTravelTime != null) {
    out.push({
      routeId: 'verrazzano',
      crossingDisplayName: 'Verrazzano-Narrows Bridge',
      routeTravelTime: vzLive.routeTravelTime,
      routeSpeed: vzLive.routeSpeed,
      travelDirection: d,
      isCrossingClosed: false,
      _isVerrazzano: true,
    })
  } else if (hasVerrazzanoCamera.value) {
    out.push({
      routeId: 'verrazzano',
      crossingDisplayName: 'Verrazzano-Narrows Bridge',
      routeTravelTime: null,
      routeSpeed: null,
      travelDirection: d,
      isCrossingClosed: false,
      _isVerrazzano: true,
    })
  }
  
  return out.sort((a, b) => {
    const ac = isClosedRow(a) ? 1 : 0
    const bc = isClosedRow(b) ? 1 : 0
    if (ac !== bc) return ac - bc
    return travelMinutes(a) - travelMinutes(b)
  })
})

/**
 * @param {unknown} row
 */
function rowRouteId(row) {
  if (row == null || typeof row !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */(row)
  if (o.routeId == null) return ''
  return String(o.routeId)
}

/**
 * @param {unknown} row
 */
function displayTitle(row) {
  if (row == null || typeof row !== 'object') return '—'
  const o = /** @type {Record<string, unknown>} */(row)
  const name =
    typeof o.crossingDisplayName === 'string' ? o.crossingDisplayName : 'Bridge'
  const mod = typeof o.facilityModifier === 'string' ? o.facilityModifier.trim() : ''
  if (isGwbRow(row)) {
    const base = String(name)
      .replace(/\s*[—–-]\s*(upper|lower)\s*$/i, '')
      .trim()
    return `${base || name} — Upper`
  }
  if (mod) return `${name} — ${mod}`
  return name
}

/**
 * Check if row is the Verrazzano synthetic row.
 * @param {unknown} row
 */
function isVerrazzanoRow(row) {
  return row != null && typeof row === 'object' && /** @type {any} */(row)._isVerrazzano === true
}

/**
 * @param {unknown} row
 */
function trendInfo(row) {
  if (isVerrazzanoRow(row)) {
    return verrazzanoTrendInfo.value
  }
  const id = rowRouteId(row)
  if (!id || !payload.value?.byRoute) {
    return { short: '·', cls: 't--unk', full: 'Not enough data yet' }
  }
  const b = payload.value.byRoute[id]
  if (!b || !b.trend) {
    return { short: '·', cls: 't--unk', full: 'Not enough data yet' }
  }
  const t = b.trend
  if (t === 'worse') {
    return { short: '▲', cls: 't--worse', full: 'Slower than last check' }
  }
  if (t === 'better') {
    return { short: '▼', cls: 't--better', full: 'Faster than last check' }
  }
  if (t === 'neutral') {
    return { short: '—', cls: 't--neutral', full: 'About the same' }
  }
  return { short: '·', cls: 't--unk', full: 'Not enough data yet' }
}

/**
 * @param {unknown} row
 */
function seriesForRow(row) {
  if (isVerrazzanoRow(row)) {
    return verrazzanoSeries.value
  }
  const id = rowRouteId(row)
  if (!id || !payload.value?.byRoute?.[id]) return []
  const s = payload.value.byRoute[id].series
  return Array.isArray(s) ? s : []
}

/**
 * @param {unknown} row
 */
function finiteTravelMinutes(row) {
  const m = travelMinutes(row)
  return Number.isFinite(m) && m !== Number.POSITIVE_INFINITY ? m : null
}

/**
 * @param {unknown} row
 */
function trafficInputForRow(row) {
  if (row == null || typeof row !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (row)
  return {
    routeId: o.routeId,
    travelDirection: o.travelDirection ?? direction.value,
    routeTravelTime: o.routeTravelTime,
    routeSpeed: o.routeSpeed,
    routeTravelTimeHist: o.routeTravelTimeHist,
    routeSpeedHist: o.routeSpeedHist,
    series: seriesForRow(row),
  }
}

/**
 * Delay severity for card accent + trend chrome (empty string if closed).
 * @param {unknown} row
 */
function delayTierForRow(row) {
  if (isClosedRow(row)) return ''
  const input = trafficInputForRow(row)
  if (!input || finitePositive(input.routeTravelTime) == null) return 'orange'
  return classifyBridgeTraffic(input).tier
}

/**
 * @param {unknown} v
 */
function finitePositive(v) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * @param {unknown} row
 */
function trafficLevelForRow(row) {
  if (isClosedRow(row)) return ''
  const input = trafficInputForRow(row)
  if (!input || finitePositive(input.routeTravelTime) == null) return 'medium'
  return classifyBridgeTraffic(input).level
}

const TRAFFIC_LEVEL_LABEL = {
  low: 'Light traffic',
  medium: 'Moderate traffic',
  high: 'Heavy traffic',
  standstill: 'Standstill / gridlock',
}

/**
 * @param {unknown} row
 */
function trafficStatusTitle(row) {
  const level = trafficLevelForRow(row)
  const trend = trendInfo(row).full
  const lab = level && TRAFFIC_LEVEL_LABEL[/** @type {keyof typeof TRAFFIC_LEVEL_LABEL} */ (level)]
  if (!lab) return trend
  return `${lab} · ${trend}`
}

/**
 * @param {unknown} row
 */
function delayTierClass(row) {
  const t = delayTierForRow(row)
  return t ? `bridge-trend--delay-${t}` : ''
}

/**
 * Accent for chart line/dot from current delay tier.
 * @param {unknown} row
 */
function bridgeChartStrokeColor(row) {
  if (isClosedRow(row)) return '#94a3b8'
  const input = trafficInputForRow(row)
  const t =
    input && finitePositive(input.routeTravelTime) != null
      ? classifyBridgeTraffic(input).tier
      : 'orange'
  if (t === 'green') return '#4ade80'
  if (t === 'red') return '#f87171'
  return '#fb923c'
}

const MAX_CHART_POINTS = 96
/** Cap time-axis labels — long Verrazzano histories used 4h ticks across weeks and overlapped. */
const MAX_X_AXIS_TICKS = 6

/**
 * Pick tick step so we stay at or under `maxTicks` labels across [tMin, tMax].
 * @param {number} tMin
 * @param {number} tMax
 * @param {number} maxTicks
 * @returns {number[]}
 */
function buildSparseTimeTickTimestamps(tMin, tMax, maxTicks) {
  const span = Math.max(tMax - tMin, 60_000)
  const n = Math.max(2, Math.min(8, maxTicks))
  const minStep = span / (n - 1)

  const STEPS_MS = [
    5 * 60 * 1000,
    10 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    3 * 60 * 60 * 1000,
    4 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
    2 * 24 * 60 * 60 * 1000,
    4 * 24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    14 * 24 * 60 * 60 * 1000,
    30 * 24 * 60 * 60 * 1000,
  ]

  let step = STEPS_MS.find((s) => s >= minStep) ?? STEPS_MS[STEPS_MS.length - 1]

  /** @type {number[]} */
  let ticks = []
  for (let guard = 0; guard < 12; guard++) {
    ticks = []
    let t = Math.floor(tMin / step) * step
    if (t < tMin) t += step
    while (t <= tMax + step * 0.001) {
      ticks.push(t)
      t += step
      if (ticks.length > maxTicks + 40) break
    }
    if (ticks.length <= maxTicks) break
    const idx = STEPS_MS.indexOf(step)
    step = idx >= 0 && idx < STEPS_MS.length - 1 ? STEPS_MS[idx + 1] : step * 2
  }

  if (ticks.length === 0) return [tMin, tMax]
  if (ticks.length === 1 && tMax !== tMin) return [tMin, tMax]
  return ticks
}

/**
 * @param {number} spanMs
 * @returns {(ts: number) => string}
 */
function makeAxisTimeFormatter(spanMs) {
  return (ts) => {
    try {
      const d = new Date(ts)
      if (spanMs <= 40 * 60 * 60 * 1000) {
        return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      }
      if (spanMs <= 16 * 24 * 60 * 60 * 1000) {
        return d.toLocaleString(undefined, {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })
      }
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }
}

/**
 * @param {Array<{ t: number, m: number, s: number }>} points
 * @param {number} maxN
 */
function downsampleSeries(points, maxN) {
  if (!Array.isArray(points) || points.length === 0) return []
  if (points.length <= maxN) return points
  const out = []
  const last = maxN - 1
  for (let k = 0; k < maxN; k++) {
    const i = Math.min(
      points.length - 1,
      Math.round((k * (points.length - 1)) / last),
    )
    out.push(points[i])
  }
  return out
}

/**
 * Time-based chart: x = sample time, y = crossing minutes (axis labels).
 * @param {unknown} row
 */
function bridgeChartModel(row) {
  /** Compact chart band — shorter cards; Y ledger shows four crossing-time ticks */
  const vb = {
    w: 268,
    h: 52,
    plotL: 14,
    plotR: 266,
    plotT: 7,
    plotB: 34,
  }
  const pw = vb.plotR - vb.plotL
  const ph = vb.plotB - vb.plotT
  const strokeColor = bridgeChartStrokeColor(row)

  if (isClosedRow(row)) {
    return {
      hasPath: false,
      strokeColor,
      vb,
    }
  }

  const raw = seriesForRow(row)
  let pts = downsampleSeries(raw, MAX_CHART_POINTS)
    .slice()
    .sort((a, b) => a.t - b.t)
  if (pts.length === 1) {
    const p0 = pts[0]
    pts = [{ t: p0.t - 5 * 60 * 1000, m: p0.m, s: p0.s }, p0]
  }
  if (pts.length < 2) {
    return { hasPath: false, strokeColor, vb }
  }

  const tMin = pts[0].t
  const tMax = pts[pts.length - 1].t
  const spanT = Math.max(tMax - tMin, 60_000)

  const vals = pts.map((p) => p.m).filter((v) => Number.isFinite(v))
  if (vals.length === 0) {
    return { hasPath: false, strokeColor, vb }
  }

  let minM = Math.min(...vals)
  let maxM = Math.max(...vals)
  const pad = Math.max((maxM - minM) * 0.12, 0.85)
  minM = Math.max(0, minM - pad)
  maxM = maxM + pad
  /** Ensure mid tick isn’t collapsed into max/min when range is tiny */
  if (maxM - minM < 1.25) {
    const c = (minM + maxM) / 2
    minM = Math.max(0, c - 1)
    maxM = c + 1
  }
  const spanM = Math.max(maxM - minM, 0.75)

  const xOf = /** @param {number} t */ (t) => vb.plotL + pw * ((t - tMin) / spanT)
  const yOf = /** @param {number} m */ (m) => vb.plotT + ph * (1 - (m - minM) / spanM)

  const pathPts = pts.map((pt) => ({
    x: xOf(pt.t),
    y: yOf(Number.isFinite(pt.m) ? pt.m : minM),
  }))

  const dLine = pathPts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join('')

  const yBase = vb.plotB
  const dArea =
    `M${pathPts[0].x.toFixed(2)},${yBase.toFixed(2)}` +
    pathPts.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('') +
    `L${pathPts[pathPts.length - 1].x.toFixed(2)},${yBase.toFixed(2)}Z`

  const last = pathPts[pathPts.length - 1]

  /** Crossing time axis: at least 4 labels (evenly spaced in value space). */
  const fmtCrossMin = (v) => {
    const r = Math.round(v)
    if (Math.abs(v - r) < 0.08) return String(r)
    return `${v.toFixed(1)}`.replace(/\.0$/, '')
  }
  const yLevels = [
    maxM,
    maxM - spanM / 3,
    maxM - (2 * spanM) / 3,
    minM,
  ]
  /** @type {{ y: number, lab: string }[]} */
  const yTicks = []
  const seenYLab = new Set()
  for (const v of yLevels) {
    let lab = fmtCrossMin(v)
    if (seenYLab.has(lab)) lab = `${v.toFixed(1)}`.replace(/\.0$/, '')
    seenYLab.add(lab)
    yTicks.push({ y: yOf(v), lab })
  }

  const xTickTs = buildSparseTimeTickTimestamps(tMin, tMax, MAX_X_AXIS_TICKS)
  const fmtAxisT = makeAxisTimeFormatter(spanT)
  /** @type {{ x: number, lab: string }[]} */
  const xTicks = xTickTs.map((ts) => ({ x: xOf(ts), lab: fmtAxisT(ts) }))
  if (xTicks.length === 0) {
    xTicks.push({ x: xOf(tMin), lab: fmtAxisT(tMin) })
    if (tMax !== tMin) xTicks.push({ x: xOf(tMax), lab: fmtAxisT(tMax) })
  }

  /** @type {{ x1: number, y1: number, x2: number, y2: number }[]} */
  const hGrids = yTicks.map((tk) => ({
    x1: vb.plotL,
    y1: tk.y,
    x2: vb.plotR,
    y2: tk.y,
  }))

  return {
    hasPath: true,
    vb,
    dLine,
    dArea,
    lastCx: last.x,
    lastCy: last.y,
    yTicks,
    xTicks,
    hGrids,
    strokeColor,
  }
}

/**
 * @param {unknown} row
 */
function rowKey(row) {
  if (row == null || typeof row !== 'object') return 'x'
  const o = /** @type {Record<string, unknown>} */(row)
  return [o.routeId, o.facilityModifier, o.cardinalDirection, o.travelDirection].join(
    ':',
  )
}

/**
 * @param {unknown} row
 * @param {number} i
 */
function isBestPick(i, row) {
  if (i !== 0 || isClosedRow(row)) return false
  return Number.isFinite(travelMinutes(row))
}

/** Current route id shown as selected (map + list) */
const highlightId = ref('')

/**
 * @param {unknown} row
 */
function trendKeyForRow(row) {
  const id = rowRouteId(row)
  const t = id && payload.value?.byRoute?.[id]?.trend
  if (t === 'worse') return /** @type {const} */('worse')
  if (t === 'better') return /** @type {const} */('better')
  if (t === 'neutral') return /** @type {const} */('neutral')
  return /** @type {const} */('unk')
}

/**
 * @param {unknown} row
 */
function displayTitleShort(row) {
  const t = displayTitle(row)
  if (t.length <= 22) return t
  return `${t.slice(0, 21)}…`
}

/**
 * One-word (or short token) label for map markers.
 * @param {unknown} row
 */
function mapPinShortLabel(row) {
  const id = rowRouteId(row)
  const byRoute = bridgeShortLabelForRouteId(id)
  if (byRoute) return byRoute
  if (row == null || typeof row !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */(row)
  const name =
    typeof o.crossingDisplayName === 'string' ? o.crossingDisplayName : ''
  return bridgeShortLabelFromDisplayName(name)
}

const mapPins = computed(() => {
  const rows = rankedRows.value
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const id = rowRouteId(row)
    if (!id) continue
    const pos = getBridgeAnchorForRouteId(id, direction.value)
    if (!pos) continue
    const ti = trendInfo(row)
    const fm = finiteTravelMinutes(row)
    out.push({
      id,
      lat: pos[0],
      lng: pos[1],
      title: displayTitleShort(row),
      shortLabel: mapPinShortLabel(row),
      delayTier: delayTierForRow(row) || /** @type {'orange'} */ ('orange'),
      minutes: isClosedRow(row) ? '—' : (() => {
        const m = travelMinutes(row)
        return Number.isFinite(m) ? String(Math.round(m)) : '—'
      })(),
      trendIcon: ti.short,
      trendKey: trendKeyForRow(row),
      trendFull: ti.full,
      isPick: isBestPick(i, row),
      isClosed: isClosedRow(row),
      rank: i + 1,
    })
  }
  return out
})

const { vehicleId: mapVehicleId } = useMapVehicleId()

const isLandscapeSplit = ref(false)
let splitMql = /** @type {MediaQueryList | null} */(null)
function updateLandscapeSplit() {
  if (typeof window === 'undefined') return
  isLandscapeSplit.value = window.matchMedia(
    '(orientation: landscape) and (min-width: 700px)',
  ).matches
}
function onSplitMqlChange() {
  updateLandscapeSplit()
}

function onGwbUpperCamUrlUpdated() {
  void loadGwbUpperCamYoutubeUrl()
}

/**
 * @param {string} id routeId
 */
function onMapSelect(id) {
  const k = String(id)
  highlightId.value = k
  void nextTick(() => {
    const el = document.getElementById(`bridge-tile-${k}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

/**
 * @param {unknown} row
 */
function onListTileClick(row) {
  const id = rowRouteId(row)
  if (id) highlightId.value = id
}

/**
 * @param {unknown} row
 * @param {string} [id] routeId
 */
function isHighlighted(row, id) {
  return highlightId.value && (id || rowRouteId(row)) === highlightId.value
}

watch(direction, () => {
  highlightId.value = ''
})
watch(rankedRows, () => {
  const h = highlightId.value
  if (h && !rankedRows.value.some((r) => rowRouteId(r) === h)) {
    highlightId.value = ''
  }
})

watch(viewMode, (mode) => {
  if (mode === 'ny511') {
    void loadNy511Traffic()
  }
})

/** Saved YouTube URL for GWB upper deck (PostgreSQL profile); video id derived client-side. */
const gwbUpperCamYoutubeUrl = ref('')

const gwbYoutubeFeedOpts = computed(() => {
  const url = String(gwbUpperCamYoutubeUrl.value || '').trim()
  const id = url ? extractYoutubeVideoIdFromInput(url) : null
  if (id) {
    return { gwbYoutubeVideoId: id, gwbNoFeedMessage: '' }
  }
  if (url) {
    return {
      gwbYoutubeVideoId: null,
      gwbNoFeedMessage:
        'Could not read a YouTube video id from that link. Fix it under Settings → GWB upper camera.',
    }
  }
  return {
    gwbYoutubeVideoId: null,
    gwbNoFeedMessage: 'Add your GWB upper camera YouTube link in Settings (GWB upper camera section).',
  }
})

async function loadGwbUpperCamYoutubeUrl() {
  try {
    const d = await getCredentials()
    gwbUpperCamYoutubeUrl.value =
      typeof d.gwbUpperCamYoutubeUrl === 'string' ? d.gwbUpperCamYoutubeUrl.trim() : ''
  } catch {
    gwbUpperCamYoutubeUrl.value = ''
  }
}

async function load() {
  error.value = ''
  const gen = ++tick
  const first = !payload.value
  if (first) loading.value = true
  try {
    const p = await getBridgesPanynj()
    if (gen === tick) payload.value = p
  } catch (e) {
    if (gen === tick) {
      error.value = e instanceof Error ? e.message : 'Failed to load bridges'
    }
  } finally {
    if (gen === tick) loading.value = false
  }
}

async function loadCameras() {
  camerasError.value = ''
  camerasLoading.value = true
  try {
    const res = await getNy511Cameras()
    if (res.ok && Array.isArray(res.cameras)) {
      cameras.value = res.cameras
    }
  } catch (e) {
    camerasError.value = e instanceof Error ? e.message : 'Failed to load cameras'
  } finally {
    camerasLoading.value = false
  }
}

async function loadVerrazzano() {
  verrazzanoLoading.value = true
  try {
    const res = await getVerrazzanoTraffic()
    verrazzanoPayload.value = res
  } catch {
    verrazzanoPayload.value = null
  } finally {
    verrazzanoLoading.value = false
  }
}

async function loadNy511Traffic() {
  ny511Error.value = ''
  const first = !ny511Payload.value
  if (first) ny511Loading.value = true
  try {
    const r = await apiFetch('/api/511ny/traffic')
    const text = await r.text()
    /** @type {Record<string, unknown>} */
    let p = {}
    try {
      p = text ? /** @type {Record<string, unknown>} */ (JSON.parse(text)) : {}
    } catch {
      p = { ok: false, error: 'Invalid JSON from server' }
    }
    if (!r.ok) {
      ny511Payload.value = {
        ok: false,
        items: [],
        alerts: [],
        code: typeof p.code === 'string' ? p.code : undefined,
        fetchedAt: Date.now(),
      }
      ny511Error.value = typeof p.error === 'string' ? p.error : r.statusText || 'Request failed'
      return
    }
    ny511Payload.value = p
  } catch (e) {
    ny511Error.value = e instanceof Error ? e.message : 'Failed to load NY511 traffic'
    ny511Payload.value = { ok: false, items: [], alerts: [], fetchedAt: Date.now() }
  } finally {
    ny511Loading.value = false
  }
}

const ny511RoadItems = computed(() => {
  const items = ny511Payload.value?.items
  return Array.isArray(items) ? items : []
})

/** Sort: closure → incident → roadwork → winter, then title. */
const NY511_TYPE_ORDER = ['closures', 'accidentsandincidents', 'roadwork', 'winterdrivingindex']

/** @type {import('vue').Ref<string>} */
const ny511KindFilter = ref('')

/**
 * @param {unknown} key
 */
function ny511EventTypeOrder(key) {
  const k = String(key || '')
    .toLowerCase()
    .replace(/\s+/g, '')
  const i = NY511_TYPE_ORDER.indexOf(k)
  return i === -1 ? 100 : i
}

/**
 * Prefer `impactSummary` from server; otherwise meaningful subtype / severity (511NY defaults Severity to Unknown).
 * @param {unknown} it
 */
function ny511ImpactLine(it) {
  if (it == null || typeof it !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (it)
  const imp = sanitizeNy511ImpactFootnote(String(o.impactSummary || ''))
  if (imp) return imp
  const sev = sanitizeNy511ImpactFootnote(String(o.severity || ''))
  if (sev && !/^unknown$/i.test(sev)) return sev
  const sub = sanitizeNy511ImpactFootnote(String(o.eventSubType || ''))
  if (sub && !/^unknown$/i.test(sub)) return sub
  return ''
}

const ny511RoadItemsView = computed(() => {
  const items = ny511RoadItems.value.slice()
  const fil = String(ny511KindFilter.value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
  const filtered = fil
    ? items.filter((x) => {
        if (x == null || typeof x !== 'object') return false
        const k = String(/** @type {any} */ (x).eventTypeKey || '')
          .toLowerCase()
          .replace(/\s+/g, '')
        return k === fil
      })
    : items
  filtered.sort((a, b) => {
    const ak = a && typeof a === 'object' ? /** @type {any} */ (a).eventTypeKey : ''
    const bk = b && typeof b === 'object' ? /** @type {any} */ (b).eventTypeKey : ''
    const oa = ny511EventTypeOrder(ak)
    const ob = ny511EventTypeOrder(bk)
    if (oa !== ob) return oa - ob
    const ta = a && typeof a === 'object' ? String(/** @type {any} */ (a).title || '') : ''
    const tb = b && typeof b === 'object' ? String(/** @type {any} */ (b).title || '') : ''
    return ta.localeCompare(tb)
  })
  return filtered
})

const ny511RoadFilterEmpty = computed(
  () =>
    !ny511Loading.value &&
    ny511RoadItems.value.length > 0 &&
    ny511RoadItemsView.value.length === 0,
)

const ny511AlertItems = computed(() => {
  const a = ny511Payload.value?.alerts
  return Array.isArray(a) ? a : []
})

const ny511HasAnyListings = computed(
  () => ny511RoadItems.value.length + ny511AlertItems.value.length > 0,
)

const ny511MarkersForMap = computed(() => {
  if (viewMode.value !== 'ny511') return []
  return ny511RoadItemsView.value
    .filter(
      (it) =>
        it &&
        typeof it === 'object' &&
        typeof /** @type {any} */ (it).lat === 'number' &&
        typeof /** @type {any} */ (it).lng === 'number',
    )
    .map((it, i) => ({
      id: String(/** @type {any} */ (it).id || `ny511-${i}`),
      lat: /** @type {any} */ (it).lat,
      lng: /** @type {any} */ (it).lng,
      title: String(/** @type {any} */ (it).title || ''),
      kind: String(/** @type {any} */ (it).kind || ''),
      kindLabel: String(/** @type {any} */ (it).kind || ''),
      eventTypeKey: String(/** @type {any} */ (it).eventTypeKey || ''),
      severity: String(/** @type {any} */ (it).severity || ''),
      impactSummary: String(/** @type {any} */ (it).impactSummary || ''),
      roads: Array.isArray(/** @type {any} */ (it).roads) ? /** @type {any} */ (it).roads : [],
    }))
})

const highwayPolylinesForMap = computed(() => [])

/**
 * 511NY stream or GWB YouTube embed.
 * @param {unknown} row
 */
function getBridgeCameraFeed(row) {
  if (isVerrazzanoRow(row)) {
    const cam = findVerrazzanoCamera(direction.value, cameras.value)
    return cam ? { videoUrl: cam.videoUrl, imageUrl: cam.imageUrl, status: cam.status } : null
  }
  return resolveBridgeCameraFeed(row, direction.value, cameras.value, gwbYoutubeFeedOpts.value)
}

/**
 * @param {Event} e
 */
function onDirToggleChange(e) {
  const t = e.target
  if (t instanceof HTMLInputElement) {
    direction.value = t.checked ? 'ToNJ' : 'ToNY'
  }
}

/**
 * @param {Event} e
 */
function onViewToggleChange(e) {
  const t = e.target
  if (t instanceof HTMLInputElement) {
    viewMode.value = t.checked ? 'ny511' : 'crossings'
  }
}

onMounted(() => {
  updateLandscapeSplit()
  if (typeof window !== 'undefined' && window.matchMedia) {
    splitMql = window.matchMedia('(orientation: landscape) and (min-width: 700px)')
    splitMql.addEventListener('change', onSplitMqlChange)
  }
  void load()
  void loadCameras()
  void loadVerrazzano()
  void loadNy511Traffic()
  void loadGwbUpperCamYoutubeUrl()
  if (typeof window !== 'undefined') {
    window.addEventListener('tripbuddy-gwb-upper-cam-url-updated', onGwbUpperCamUrlUpdated)
  }
  intervalId = setInterval(() => {
    void load()
    void loadVerrazzano()
    void loadGwbUpperCamYoutubeUrl()
    if (viewMode.value === 'ny511') {
      void loadNy511Traffic()
    }
  }, POLL_MS)
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('tripbuddy-gwb-upper-cam-url-updated', onGwbUpperCamUrlUpdated)
  }
  if (splitMql) {
    splitMql.removeEventListener('change', onSplitMqlChange)
  }
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
})
</script>

<template>
  <div class="bridges-page" :class="{ 'is-split': isLandscapeSplit }">
    <div class="bridges-map-column">
      <div class="bridges-map-shell" :class="{ 'is-tall': isLandscapeSplit }">
        <BridgesMap
          v-if="!loading && payload"
          :pins="mapPins"
          :travel-direction="direction"
          :highlight-id="highlightId"
          :fill-height="true"
          :vehicle-id="mapVehicleId"
          :highway-polylines="highwayPolylinesForMap"
          :ny511-markers="ny511MarkersForMap"
          @select="onMapSelect"
        />
        <div
          v-else
          class="bridges-map-placeholder"
          role="status"
        >Map loading…</div>
      </div>
    </div>

    <div class="bridges-list-column">
      <div class="bridges-list-inner">
        <div class="bridges-bar">
          <div class="bridges-bar-top">
            <h1 class="bridges-h1">{{ viewMode === 'crossings' ? 'Crossings' : 'NY511' }}</h1>
            <p v-if="viewMode === 'crossings' && payload?.fetchError" class="bridges-warn" role="status">
              Data may be stale · {{ payload.fetchError }}
            </p>
            <p v-else-if="viewMode === 'ny511' && ny511Payload?.feedErrors" class="bridges-warn" role="status">
              Some 511NY feeds failed to load · data may be partial
            </p>
            <p v-else class="bridges-pill">
              <span v-if="viewMode === 'crossings'">Fastest first</span>
              <span v-else>511NY · major truck routes · US Eastern · active now</span>
              <span v-if="viewMode === 'crossings' && payload?.fetchedAt" class="bridges-time"
              >· {{ fmtTime(payload.fetchedAt) }}</span>
              <span v-if="viewMode === 'ny511' && ny511Payload?.fetchedAt" class="bridges-time"
              >· {{ fmtTime(ny511Payload.fetchedAt) }}</span>
              <span v-if="viewMode === 'crossings'" class="bridges-note">· Tunnels off</span>
            </p>
          </div>

          <div class="bridges-toggles-row">
            <div class="bridges-dir-toggle-wrap">
              <span class="dir-toggle-caption">Direction</span>
              <div class="bridges-dir-toggle" role="group" aria-label="Travel direction">
                <span class="dir-toggle-lab" :class="{ 'is-on': direction === 'ToNY' }">NY</span>
                <label class="dir-toggle-switch tap">
                  <input
                    type="checkbox"
                    class="dir-toggle-input"
                    :checked="direction === 'ToNJ'"
                    aria-label="Toggle direction: New York or New Jersey"
                    @change="onDirToggleChange"
                  />
                  <span class="dir-toggle-track" aria-hidden="true">
                    <span class="dir-toggle-thumb" />
                  </span>
                </label>
                <span class="dir-toggle-lab" :class="{ 'is-on': direction === 'ToNJ' }">NJ</span>
              </div>
            </div>
            <div class="bridges-view-toggle-wrap">
              <span class="dir-toggle-caption">View</span>
              <div class="bridges-dir-toggle" role="group" aria-label="View mode">
                <span class="dir-toggle-lab" :class="{ 'is-on': viewMode === 'crossings' }">Crossings</span>
                <label class="dir-toggle-switch tap">
                  <input
                    type="checkbox"
                    class="dir-toggle-input"
                    :checked="viewMode === 'ny511'"
                    aria-label="Toggle view: Crossings or NY511"
                    @change="onViewToggleChange"
                  />
                  <span class="dir-toggle-track" aria-hidden="true">
                    <span class="dir-toggle-thumb" />
                  </span>
                </label>
                <span class="dir-toggle-lab" :class="{ 'is-on': viewMode === 'ny511' }">NY511</span>
              </div>
            </div>
          </div>
        </div>

        <p v-if="viewMode === 'crossings' && error" class="bridges-err">{{ error }}</p>
        <p v-if="viewMode === 'ny511' && ny511Error" class="bridges-err">{{ ny511Error }}</p>
        <div v-if="viewMode === 'crossings' && loading && !payload" class="bridges-skel" aria-busy="true">Loading…</div>
        <div v-if="viewMode === 'ny511' && ny511Loading && !ny511Payload" class="bridges-skel" aria-busy="true">Loading…</div>

        <!-- Crossings cards -->
        <div
          v-if="viewMode === 'crossings'"
          class="bridges-content-panel"
          aria-label="Crossing times list"
        >
          <h2 v-if="rankedRows.length" class="bridges-trips-h2">Crossings</h2>
          <ul
            v-if="rankedRows.length"
            class="bridge-grid"
            aria-label="Bridges, fastest first"
          >
            <li
              v-for="(row, idx) in rankedRows"
              :id="`bridge-tile-${rowRouteId(row)}`"
              :key="rowKey(row)"
              class="bridge-tile"
              :class="{
                'is-closed': isClosedRow(row),
                'is-pick': isBestPick(idx, row),
                'is-hi': isHighlighted(row),
                'bridge-tile--d-green': delayTierForRow(row) === 'green',
                'bridge-tile--d-orange': delayTierForRow(row) === 'orange',
                'bridge-tile--d-red':
                  delayTierForRow(row) === 'red' && trafficLevelForRow(row) !== 'standstill',
                'bridge-tile--d-standstill': trafficLevelForRow(row) === 'standstill',
              }"
              @click="onListTileClick(row)"
            >
              <div class="bridge-tile-inner" :class="{ 'has-camera': getBridgeCameraFeed(row) }">
                <div v-if="getBridgeCameraFeed(row)" class="bridge-camera-col">
                  <BridgeCameraPlayer
                    :youtube-video-id="getBridgeCameraFeed(row)?.youtubeVideoId || undefined"
                    :video-url="getBridgeCameraFeed(row)?.youtubeVideoId ? null : (getBridgeCameraFeed(row)?.videoUrl ?? null)"
                    :image-url="getBridgeCameraFeed(row)?.youtubeVideoId ? null : (getBridgeCameraFeed(row)?.imageUrl ?? null)"
                    :status="getBridgeCameraFeed(row)?.status || 'Unknown'"
                    :no-feed-message="getBridgeCameraFeed(row)?.noFeedMessage || 'No camera'"
                    :bridge-name="displayTitle(row)"
                    fill-column
                  />
                </div>
                <div class="bridge-data-col">
                  <div class="bridge-card-head">
                    <div class="bridge-card-id">
                      <span class="bridge-rank" aria-hidden="true">{{ idx + 1 }}</span>
                      <h2 class="bridge-title">{{ displayTitle(row) }}</h2>
                    </div>
                    <div
                      class="bridge-trend ico"
                      :class="[trendInfo(row).cls, delayTierClass(row)]"
                      :title="trafficStatusTitle(row)"
                    >{{ trendInfo(row).short }}</div>
                  </div>
                  <div class="bridge-card-metrics">
                  <div class="bridge-kpi bridge-kpi--cross">
                    <span class="bridge-kpi-lab">Crossing time</span>
                    <div class="bridge-kpi-row">
                      <span class="bridge-kpi-num">
                        <template
                          v-if="row && typeof row === 'object' && (/** @type {any} */(row)).isCrossingClosed"
                        >—</template>
                        <template
                          v-else-if="row && typeof row === 'object' && (/** @type {any} */(row)).routeTravelTime != null"
                        >{{ String((/** @type {any} */(row)).routeTravelTime) }}</template>
                        <template v-else>—</template>
                      </span>
                      <span class="bridge-kpi-unit">min</span>
                    </div>
                  </div>
                  <div class="bridge-kpi-divider" aria-hidden="true" />
                  <div class="bridge-kpi bridge-kpi--speed">
                    <span class="bridge-kpi-lab">Observed speed</span>
                    <div class="bridge-kpi-row bridge-kpi-row--speed">
                      <template
                        v-if="row && typeof row === 'object' && (/** @type {any} */(row)).routeSpeed != null"
                      >
                        <span class="bridge-kpi-num">{{ (/** @type {any} */(row)).routeSpeed }}</span>
                        <span class="bridge-kpi-unit">mph</span>
                      </template>
                      <template v-else>
                        <span class="bridge-kpi-num bridge-kpi-num--muted">—</span>
                      </template>
                    </div>
                  </div>
                </div>
                <div v-if="bridgeChartModel(row).hasPath" class="bridge-chart-shell">
                  <div class="bridge-chart-head">
                    <span class="bridge-chart-title">History</span>
                    <span class="bridge-chart-sub">Minutes · local time</span>
                  </div>
                  <div class="bridge-chart-panel">
                    <svg
                      class="bridge-chart-svg"
                      :viewBox="`0 0 ${bridgeChartModel(row).vb.w} ${bridgeChartModel(row).vb.h}`"
                      preserveAspectRatio="xMidYMid meet"
                      width="100%"
                      :style="{
                        aspectRatio: `${bridgeChartModel(row).vb.w} / ${bridgeChartModel(row).vb.h}`,
                      }"
                      role="img"
                      :aria-label="`Crossing time vs time for ${displayTitle(row)}`"
                    >
                      <defs>
                        <linearGradient
                          :id="`bcg-${rowRouteId(row)}`"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" :stop-color="bridgeChartModel(row).strokeColor" stop-opacity="0.14" />
                          <stop offset="100%" :stop-color="bridgeChartModel(row).strokeColor" stop-opacity="0.02" />
                        </linearGradient>
                      </defs>
                      <template v-if="bridgeChartModel(row).hasPath">
                        <text
                          v-for="(yt, yi) in bridgeChartModel(row).yTicks"
                          :key="`yt-${yi}`"
                          class="bridge-chart-axis-title"
                          x="6"
                          :y="yt.y + 3.5"
                          text-anchor="start"
                        >{{ yt.lab }}</text>
                        <line
                          v-for="(g, gi) in bridgeChartModel(row).hGrids"
                          :key="`hg-${gi}`"
                          :x1="g.x1"
                          :y1="g.y1"
                          :x2="g.x2"
                          :y2="g.y2"
                          class="bridge-chart-grid"
                        />
                        <path
                          :d="bridgeChartModel(row).dArea"
                          :fill="`url(#bcg-${rowRouteId(row)})`"
                        />
                        <path
                          :d="bridgeChartModel(row).dLine"
                          fill="none"
                          :stroke="bridgeChartModel(row).strokeColor"
                          stroke-width="0.95"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          opacity="0.82"
                        />
                        <circle
                          :cx="bridgeChartModel(row).lastCx"
                          :cy="bridgeChartModel(row).lastCy"
                          r="1.35"
                          :fill="bridgeChartModel(row).strokeColor"
                          stroke="#0f0f14"
                          stroke-width="0.45"
                          opacity="0.9"
                        />
                        <text
                          v-for="(tk, ti) in bridgeChartModel(row).xTicks"
                          :key="`xt-${ti}`"
                          class="bridge-chart-tick-x"
                          :x="tk.x"
                          :y="bridgeChartModel(row).vb.h - 5"
                          text-anchor="middle"
                        >{{ tk.lab }}</text>
                      </template>
                    </svg>
                  </div>
                </div>
                </div>
              </div>
            </li>
          </ul>
          
          <p v-else-if="!rankedRows.length" class="bridges-no-crossings">No bridge data for this direction</p>
        </div>

        <!-- NY511: alerts (511 getalerts) vs road events (getevents, truck-filtered) -->
        <div
          v-else-if="viewMode === 'ny511'"
          class="bridges-content-panel bridges-content-panel--ny511"
          aria-label="NY511 traffic list"
        >
          <section v-if="ny511AlertItems.length" class="ny511-section" aria-labelledby="ny511-alerts-h">
            <h2 id="ny511-alerts-h" class="ny511-section-h2">Traffic alerts</h2>
            <p class="ny511-section-sub">511NY-wide messages for NYC metro &amp; monitored crossings</p>
            <ul class="ny511-alert-list" aria-label="511NY traffic alerts">
              <li
                v-for="(it, idx) in ny511AlertItems"
                :key="`alert-${String(it.id || idx)}`"
                class="ny511-alert-card"
              >
                <span class="ny511-kind-badge ny511-kind-badge--alert">Alert</span>
                <p class="ny511-alert-title">{{ it.title }}</p>
                <p v-if="it.description && it.description !== it.title" class="ny511-alert-desc">
                  {{ ny511Snippet(it.description, 240) }}
                </p>
                <p v-if="it.roads && it.roads.length" class="ny511-alert-areas">
                  {{ it.roads.join(' · ') }}
                </p>
              </li>
            </ul>
          </section>

          <section
            v-if="ny511RoadItems.length"
            class="ny511-section"
            :class="{ 'ny511-section--spaced': ny511AlertItems.length }"
            aria-labelledby="ny511-roads-h"
          >
            <h2 id="ny511-roads-h" class="ny511-section-h2">Incidents &amp; work zones</h2>
            <p class="ny511-section-sub">Major highways &amp; crossings only · excludes transit detours</p>
            <div class="ny511-road-controls">
              <label class="ny511-road-controls__label" for="ny511-kind-filter">Type</label>
              <select id="ny511-kind-filter" v-model="ny511KindFilter" class="ny511-road-controls__select">
                <option value="">All types</option>
                <option value="closures">Closure</option>
                <option value="roadwork">Roadwork</option>
                <option value="accidentsandincidents">Incident</option>
                <option value="winterdrivingindex">Winter</option>
              </select>
            </div>
            <p v-if="ny511RoadFilterEmpty" class="ny511-filter-empty">No events match this type filter.</p>
            <ul class="bridge-grid ny511-road-list" aria-label="511NY road events">
              <li
                v-for="(it, idx) in ny511RoadItemsView"
                :key="`${String(it.id || 'item')}-${idx}`"
                class="bridge-tile bridge-tile--ny511"
              >
                <div class="bridge-tile-inner">
                  <div class="bridge-data-col">
                    <div class="bridge-card-head">
                      <div class="bridge-card-id">
                        <span class="bridge-rank" aria-hidden="true">{{ idx + 1 }}</span>
                        <div class="ny511-title-wrap">
                          <span class="ny511-kind-badge" :title="String(it.eventTypeKey || '')">{{ it.kind }}</span>
                          <h2 class="bridge-title">{{ it.title }}</h2>
                        </div>
                      </div>
                    </div>
                    <p v-if="it.description" class="ny511-desc">{{ ny511Snippet(it.description, 280) }}</p>
                    <div class="ny511-meta">
                      <span v-if="it.roads && it.roads.length" class="ny511-roads">{{ it.roads.join(' · ') }}</span>
                      <span v-if="it.region || it.county" class="ny511-region">
                        {{ [it.region, it.county].filter(Boolean).join(' · ') }}
                      </span>
                      <span v-if="it.startsAt || it.endsAt" class="ny511-times">
                        {{ it.startsAt || '—' }} → {{ it.endsAt || '—' }}
                      </span>
                      <span v-if="ny511ImpactLine(it)" class="ny511-impact">{{ ny511ImpactLine(it) }}</span>
                    </div>
                  </div>
                </div>
              </li>
            </ul>
          </section>

          <p
            v-if="!ny511Loading && ny511Payload?.code === 'NO_API_KEY'"
            class="bridges-no-crossings"
          >
            Add your 511NY API key in Settings (same key as bridge cameras) to load events and alerts.
          </p>
          <p
            v-else-if="!ny511Loading && ny511Payload?.ok && !ny511HasAnyListings"
            class="bridges-no-crossings"
          >
            No current incidents, work zones, or metro alerts for monitored NYC truck routes and crossings.
          </p>
          <p
            v-else-if="!ny511Loading && ny511Error && ny511Payload?.code !== 'NO_API_KEY'"
            class="bridges-no-crossings"
          >
            {{ ny511Error }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bridges-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  color: var(--color-text-primary, #f4f4f8);
  --b-spark: #a78bfa;
  --b-pick: rgba(52, 211, 153, 0.5);
  box-sizing: border-box;
}

.bridges-page:not(.is-split) {
  padding-left: max(env(safe-area-inset-left, 0px), var(--space-2, 0.5rem));
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-2, 0.5rem));
  padding-top: 0.5rem;
}

/* Landscape: map left, list right (scrolls) — same model as directory */
.bridges-page.is-split {
  flex: 1;
  min-height: 0;
  flex-direction: row;
  align-items: stretch;
  padding-left: 0;
  padding-right: 0;
  padding-top: 0;
}

.bridges-map-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.bridges-page.is-split .bridges-map-column {
  flex: 1.25 1 0;
  border-right: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.bridges-map-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.bridges-page:not(.is-split) .bridges-map-shell {
  flex: none;
  min-height: clamp(19rem, min(52vh, 100dvh - 14rem), 32rem);
  height: clamp(19rem, min(52vh, 100dvh - 14rem), 32rem);
}

.bridges-page.is-split .bridges-map-shell {
  min-height: min(42vh, 19rem);
}

.bridges-map-shell.is-tall {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
}

.bridges-map-placeholder {
  flex: 1 1 0;
  min-height: min(42vh, 19rem);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6e6e80;
  font-size: 0.9rem;
  background: #0a0a0f;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
}

.bridges-list-column {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bridges-list-inner {
  padding: 0.65rem min(1.25rem, 3.5vw) calc(0.85rem + env(safe-area-inset-bottom, 0px));
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.bridges-page.is-split .bridges-list-inner {
  padding-top: 0.65rem;
  padding-left: var(--space-3, 0.75rem);
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-3, 0.75rem));
  padding-bottom: calc(0.85rem + env(safe-area-inset-bottom, 0px));
}

.bridges-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.bridges-bar-top {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.bridges-h1 {
  margin: 0;
  font-size: var(--text-xl, 1.25rem);
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}

.bridges-warn {
  font-size: 0.68rem;
  color: #fbbf24;
  margin: 0;
  line-height: 1.3;
  font-weight: 600;
}

.bridges-pill {
  margin: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #7a7a8c;
  font-weight: 700;
}

.bridges-time {
  color: #5a5a6a;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.bridges-note {
  color: #4a4a5c;
  font-weight: 600;
}

.bridges-toggles-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.bridges-dir-toggle-wrap,
.bridges-view-toggle-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
}

.dir-toggle-caption {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5c5c6e;
}

.bridges-dir-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.dir-toggle-lab {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #5a5a6c;
  min-width: 1.5rem;
  text-align: center;
  transition: color 0.15s ease;
}

.dir-toggle-lab.is-on {
  color: #ddd6fe;
}

.dir-toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.dir-toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.dir-toggle-track {
  position: relative;
  display: block;
  width: 2.85rem;
  height: 1.55rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(123, 77, 181, 0.35);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.dir-toggle-thumb {
  position: absolute;
  top: 50%;
  left: 0.12rem;
  width: 1.22rem;
  height: 1.22rem;
  border-radius: 50%;
  background: linear-gradient(145deg, #c4b5fd, #7b4db5);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  transform: translateY(-50%);
  transition: transform 0.18s ease;
}

.dir-toggle-input:focus-visible + .dir-toggle-track {
  outline: 2px solid rgba(199, 168, 255, 0.65);
  outline-offset: 2px;
}

.dir-toggle-input:checked + .dir-toggle-track {
  border-color: rgba(199, 168, 255, 0.5);
  background: rgba(123, 77, 181, 0.22);
}

.dir-toggle-input:checked + .dir-toggle-track .dir-toggle-thumb {
  transform: translate(1.22rem, -50%);
}

.bridges-err {
  color: #f87171;
  font-size: 0.8rem;
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.bridges-skel {
  padding: 1.2rem 0;
  color: #9a9ab0;
  font-size: 0.9rem;
}

.bridges-content-panel {
  display: block;
  width: 100%;
  max-width: none;
  border-radius: 14px;
  border: 1px solid rgba(199, 168, 255, 0.12);
  background: linear-gradient(165deg, #101018 0%, #0a0a0e 100%);
  padding: 0.45rem 0.48rem 0.55rem;
  box-sizing: border-box;
  margin-top: 0.2rem;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.34);
}

.bridges-trips-h2 {
  margin: 0 0 0.4rem 0.15rem;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6e6e7e;
}

.bridges-no-crossings {
  margin: 0.5rem 0.25rem 0.35rem;
  font-size: 0.8rem;
  color: #7a7a8c;
}

/* Single full-width column for at-a-glance driving */
.bridge-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  width: 100%;
  max-width: none;
}
.bridges-page.is-split .bridge-grid {
  max-width: none;
}

.bridge-tile {
  min-width: 0;
  width: 100%;
  border-radius: 14px;
  position: relative;
  background:
    linear-gradient(155deg, rgba(26, 26, 34, 0.98) 0%, rgba(12, 12, 18, 0.99) 48%, rgba(10, 10, 14, 1) 100%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.05) inset,
    0 4px 18px rgba(0, 0, 0, 0.38);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.08s ease;
  overflow: hidden;
}

.bridge-tile::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 14px 0 0 14px;
  background: transparent;
  opacity: 0.95;
  pointer-events: none;
}

.bridge-tile--d-green::before {
  background: linear-gradient(180deg, #4ade80, #22c55e);
  box-shadow: 0 0 14px rgba(74, 222, 128, 0.35);
}

.bridge-tile--d-orange::before {
  background: linear-gradient(180deg, #fb923c, #ea580c);
  box-shadow: 0 0 14px rgba(251, 146, 60, 0.28);
}

.bridge-tile--d-red::before {
  background: linear-gradient(180deg, #f87171, #dc2626);
  box-shadow: 0 0 14px rgba(248, 113, 113, 0.28);
}

.bridge-tile--d-standstill::before {
  background: linear-gradient(180deg, #fb7185, #9f1239);
  box-shadow: 0 0 16px rgba(251, 113, 133, 0.42);
}

.bridge-tile--d-standstill {
  border-color: rgba(251, 113, 133, 0.35);
}

.bridge-tile:active {
  transform: scale(0.997);
}

.bridge-tile.is-hi {
  border-color: rgba(199, 168, 255, 0.55);
  box-shadow:
    0 0 0 1px rgba(199, 168, 255, 0.22),
    0 6px 22px rgba(0, 0, 0, 0.42);
}

.bridge-tile.is-pick {
  border-color: var(--b-pick);
  box-shadow:
    0 0 0 1px var(--b-pick),
    0 8px 26px rgba(0, 0, 0, 0.48);
}

.bridge-tile.is-closed {
  opacity: 0.72;
  border-color: rgba(248, 113, 113, 0.28);
}

.bridge-tile-inner {
  padding: 0.38rem 0.48rem 0.38rem 0.54rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.26rem;
}

.bridge-tile-inner.has-camera {
  flex-direction: row;
  gap: 0.5rem;
}

.bridge-camera-col {
  flex: 0 0 auto;
  width: 33.333%;
  min-width: 100px;
  max-width: 180px;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.bridge-camera-col :deep(.camera-player--fill) {
  height: 100%;
  aspect-ratio: unset;
}


.bridge-data-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.26rem;
}

@media (max-width: 520px) {
  .bridge-tile-inner.has-camera {
    flex-direction: column;
  }

  /* Stacked portrait: column needs explicit 16:9 box (YouTube iframe has no intrinsic height). */
  .bridge-camera-col {
    width: 100%;
    max-width: none;
    margin-bottom: 0.25rem;
    align-self: auto;
    max-height: none;
    aspect-ratio: 16 / 9;
    height: auto;
    flex: 0 0 auto;
  }

  .bridge-camera-col :deep(.camera-player--fill) {
    height: 100%;
    width: 100%;
    aspect-ratio: unset;
    flex: 1 1 auto;
    min-height: 0;
  }
}

.bridge-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
}

.bridge-card-id {
  display: flex;
  align-items: flex-start;
  gap: 0.42rem;
  min-width: 0;
  flex: 1;
}

.bridge-rank {
  flex-shrink: 0;
  font-size: 0.52rem;
  font-weight: 900;
  line-height: 1;
  color: #8b8b9a;
  width: 1.15rem;
  height: 1.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  margin-top: 0.12rem;
}

.bridge-tile.is-pick .bridge-rank {
  color: #a7f3d0;
  border-color: rgba(52, 211, 153, 0.35);
}

.bridge-title {
  margin: 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: -0.01em;
  word-break: break-word;
}

.bridge-trend {
  flex-shrink: 0;
  width: 1.28rem;
  height: 1.28rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  line-height: 1;
  font-weight: 750;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a1a1b0;
  background: rgba(0, 0, 0, 0.35);
}

/* Delay-tier chrome on trend badge (overrides trend palette below) */
.bridge-trend.bridge-trend--delay-green {
  color: #ecfdf5;
  background: rgba(22, 101, 52, 0.55);
  border-color: rgba(74, 222, 128, 0.45);
}

.bridge-trend.bridge-trend--delay-orange {
  color: #fff7ed;
  background: rgba(154, 52, 18, 0.52);
  border-color: rgba(251, 146, 60, 0.48);
}

.bridge-trend.bridge-trend--delay-red {
  color: #fef2f2;
  background: rgba(127, 29, 29, 0.55);
  border-color: rgba(248, 113, 113, 0.48);
}

.t--worse {
  color: #fecdd3;
  background: rgba(127, 29, 29, 0.45);
  border-color: rgba(248, 113, 113, 0.4);
}

.t--better {
  color: #a7f3d0;
  background: rgba(6, 78, 59, 0.4);
  border-color: rgba(52, 211, 153, 0.45);
}

.t--neutral {
  color: #fde68a;
  background: rgba(100, 80, 0, 0.35);
  border-color: rgba(250, 204, 21, 0.3);
}

.t--unk {
  color: #6a6a78;
}

.bridge-card-metrics {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 0;
  padding: 0.28rem 0.34rem;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.bridge-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

.bridge-kpi--cross {
  padding-right: 0.35rem;
}

.bridge-kpi--speed {
  padding-left: 0.35rem;
  align-items: flex-end;
  text-align: right;
}

.bridge-kpi-divider {
  width: 1px;
  align-self: stretch;
  margin: 0.12rem 0;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(255, 255, 255, 0.08) 15%,
    rgba(255, 255, 255, 0.08) 85%,
    transparent
  );
}

.bridge-kpi-lab {
  font-size: 0.47rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6b6b78;
  line-height: 1.15;
}

.bridge-kpi-row {
  display: flex;
  align-items: baseline;
  gap: 0.14rem;
  flex-wrap: nowrap;
}

.bridge-kpi-row--speed {
  justify-content: flex-end;
}

.bridge-kpi-num {
  font-size: clamp(1.05rem, 4.2vw, 1.38rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: #ebe8f7;
  font-variant-numeric: tabular-nums;
}

.bridge-kpi-num--muted {
  font-size: 1rem;
  font-weight: 650;
  color: #5c5c6c;
}

.bridge-tile.is-pick .bridge-kpi-num:not(.bridge-kpi-num--muted) {
  color: #d1fae5;
}

.bridge-kpi-unit {
  font-size: 0.56rem;
  font-weight: 650;
  color: #8b8b9c;
  letter-spacing: 0.02em;
}

.bridge-chart-shell {
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
}

.bridge-chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0 0.04rem;
}

.bridge-chart-title {
  font-size: 0.48rem;
  font-weight: 800;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #6e6e7e;
}

.bridge-chart-sub {
  font-size: 0.48rem;
  font-weight: 650;
  color: #5a5a68;
  letter-spacing: 0.04em;
}

.bridge-chart-panel {
  border-radius: 8px;
  padding: 0.06rem 0 0;
  background: rgba(0, 0, 0, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.05);
  width: 100%;
  min-width: 0;
}

.bridge-chart-empty {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 0.35rem;
  font-size: 0.62rem;
  font-weight: 600;
  color: #5c5c6e;
  letter-spacing: 0.04em;
}

.bridge-chart-svg {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.bridge-chart-grid {
  stroke: rgba(255, 255, 255, 0.045);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.bridge-chart-axis-title {
  fill: #8b8b9a;
  font-size: 4.35px;
  font-weight: 650;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.bridge-chart-tick-x {
  fill: #8b8b9a;
  font-size: 4.25px;
  font-weight: 600;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.bridges-content-panel--ny511 {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.ny511-section {
  margin: 0;
}

.ny511-section--spaced {
  padding-top: 0.35rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ny511-section-h2 {
  margin: 0 0 0.15rem 0.15rem;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9a9aac;
}

.ny511-section-sub {
  margin: 0 0 0.45rem 0.15rem;
  font-size: 0.62rem;
  line-height: 1.35;
  color: #6b6b7a;
  max-width: 40rem;
}

.ny511-road-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin: 0 0 0.4rem 0.15rem;
}

.ny511-road-controls__label {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #7a7a8c;
}

.ny511-road-controls__select {
  font: inherit;
  font-size: 0.68rem;
  font-weight: 600;
  color: #ececf4;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(167, 139, 250, 0.35);
  border-radius: 8px;
  padding: 0.28rem 0.45rem;
  min-height: 2rem;
}

.ny511-filter-empty {
  margin: 0 0 0.45rem 0.15rem;
  font-size: 0.62rem;
  color: #8b8b9a;
}

.ny511-impact {
  font-size: 0.6rem;
  color: #9a9ab0;
  line-height: 1.35;
}

.ny511-alert-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ny511-alert-card {
  border-radius: 12px;
  padding: 0.45rem 0.55rem 0.5rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(167, 139, 250, 0.2);
}

.ny511-kind-badge--alert {
  background: rgba(56, 189, 248, 0.14);
  color: #bae6fd;
  border-color: rgba(56, 189, 248, 0.35);
}

.ny511-alert-title {
  margin: 0.35rem 0 0;
  font-size: 0.78rem;
  font-weight: 650;
  line-height: 1.35;
  color: #ececf8;
}

.ny511-alert-desc {
  margin: 0.35rem 0 0;
  font-size: 0.68rem;
  line-height: 1.45;
  color: #9a9ab0;
}

.ny511-alert-areas {
  margin: 0.35rem 0 0;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #6e6e80;
}

.ny511-road-list {
  margin-top: 0.15rem;
}

.ny511-region {
  font-size: 0.58rem;
  color: #7a7a8c;
}

.ny511-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.ny511-kind-badge {
  align-self: flex-start;
  font-size: 0.52rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.12rem 0.35rem;
  border-radius: 4px;
  background: rgba(167, 139, 250, 0.2);
  color: #ddd6fe;
  border: 1px solid rgba(167, 139, 250, 0.35);
}

.ny511-desc {
  margin: 0.35rem 0 0;
  font-size: 0.72rem;
  line-height: 1.4;
  color: #b4b4c8;
}

.ny511-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.45rem;
  font-size: 0.62rem;
  color: #8b8b9a;
}

.ny511-roads {
  font-weight: 650;
  color: #c4c4d8;
}

.bridge-tile--ny511 {
  border-color: rgba(167, 139, 250, 0.12);
}

.bridge-chart-empty {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 0.35rem;
  font-size: 0.62rem;
  font-weight: 600;
  color: #5c5c6e;
  letter-spacing: 0.04em;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

</style>
