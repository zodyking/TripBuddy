<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { getBridgesPanynj } from '../api.js'
import { getBridgeAnchorForRouteId } from '../bridges/bridgeRouteAnchors.js'
import BridgesMap from '../components/BridgesMap.vue'
import {
  bridgeShortLabelForRouteId,
  bridgeShortLabelFromDisplayName,
} from '../utils/mapMarkers.js'
import { bridgeDelayTier } from '../utils/bridgeDelayTier.js'
import { linehaulTractorBody } from '../stores/linehaulSnapshotStore.js'

defineOptions({ name: 'BridgesView' })

const POLL_MS = 5 * 60 * 1000

/** @typedef {'ToNY' | 'ToNJ'} TravelDir */
/** @type {import('vue').Ref<TravelDir>} */
const direction = ref('ToNY')

const loading = ref(true)
const error = ref('')

/** @type {import('vue').Ref<any | null>} */
const payload = ref(null)

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

const rankedRows = computed(() => {
  const live = payload.value?.live
  if (!Array.isArray(live)) return []
  const d = direction.value
  const out = live.filter((r) => {
    if (isTunnelRow(r)) return false
    if (!matchDir(r, d)) return false
    if (isGwbRow(r) && !gwbMatchRouteForToggle(r, d)) return false
    return true
  })
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
 * @param {unknown} row
 */
function trendInfo(row) {
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
 * Delay severity for card accent + trend chrome (empty string if closed).
 * @param {unknown} row
 */
function delayTierForRow(row) {
  if (isClosedRow(row)) return ''
  const fm = finiteTravelMinutes(row)
  return fm != null ? bridgeDelayTier(fm) : 'orange'
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
  const fm = finiteTravelMinutes(row)
  const t = fm != null ? bridgeDelayTier(fm) : 'orange'
  if (t === 'green') return '#4ade80'
  if (t === 'red') return '#f87171'
  return '#fb923c'
}

const MAX_CHART_POINTS = 96

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
  /** Wide viewBox; taller plot band so the history chart uses vertical space in the card */
  const vb = {
    w: 268,
    h: 78,
    plotL: 14,
    plotR: 266,
    plotT: 9,
    plotB: 54,
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
  const pts = downsampleSeries(raw, MAX_CHART_POINTS)
    .slice()
    .sort((a, b) => a.t - b.t)
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
  const pad = Math.max((maxM - minM) * 0.12, 1)
  minM = Math.max(0, minM - pad)
  maxM = maxM + pad
  const spanM = Math.max(maxM - minM, 0.5)

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

  const midM = (minM + maxM) / 2
  const yTicks = [
    { y: yOf(maxM), lab: String(Math.round(maxM)) },
    { y: yOf(midM), lab: String(Math.round(midM)) },
    { y: yOf(minM), lab: String(Math.round(minM)) },
  ]

  const fmtHour = (ts) => {
    try {
      return new Date(ts).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }
  const midT = (tMin + tMax) / 2
  const xTicks = [
    { x: xOf(tMin), lab: fmtHour(tMin) },
    { x: xOf(midT), lab: fmtHour(midT) },
    { x: xOf(tMax), lab: fmtHour(tMax) },
  ]

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
      delayTier: fm != null ? bridgeDelayTier(fm) : /** @type {'orange'} */ ('orange'),
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

const mapVehicleId = computed(() => {
  const n = linehaulTractorBody.value?.tractorNbr
  if (n == null) return ''
  return String(n).trim()
})

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

function setDir(d) {
  direction.value = d
}

onMounted(() => {
  updateLandscapeSplit()
  if (typeof window !== 'undefined' && window.matchMedia) {
    splitMql = window.matchMedia('(orientation: landscape) and (min-width: 700px)')
    splitMql.addEventListener('change', onSplitMqlChange)
  }
  void load()
  intervalId = setInterval(() => {
    void load()
  }, POLL_MS)
})

onUnmounted(() => {
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
          :fill-height="isLandscapeSplit"
          :vehicle-id="mapVehicleId"
          @select="onMapSelect"
        />
        <div
          v-else
          class="bridges-map-placeholder"
          role="status"
        >Map loading…</div>
      </div>
    </div>

    <div
      class="bridges-list-column"
      :class="{ 'is-scroll-pane': isLandscapeSplit }"
    >
      <div
        class="bridges-list-inner"
        :class="{ 'is-scroll-pane': isLandscapeSplit }"
      >
        <div class="bridges-bar">
          <div class="bridges-bar-top">
            <h1 class="bridges-h1">Bridges</h1>
            <p v-if="payload?.fetchError" class="bridges-warn" role="status">
              Data may be stale · {{ payload.fetchError }}
            </p>
            <p v-else class="bridges-pill">
              <span>Fastest first</span>
              <span v-if="payload?.fetchedAt" class="bridges-time"
              >· {{ fmtTime(payload.fetchedAt) }}</span>
              <span class="bridges-note">· Tunnels off</span>
            </p>
          </div>

          <div class="bridges-toggle" role="group" aria-label="Direction">
            <button
              type="button"
              class="dir-btn tap"
              :class="{ 'is-on': direction === 'ToNY' }"
              @click="setDir('ToNY')"
            >
              To NY
            </button>
            <button
              type="button"
              class="dir-btn tap"
              :class="{ 'is-on': direction === 'ToNJ' }"
              @click="setDir('ToNJ')"
            >
              To NJ
            </button>
          </div>
        </div>

        <p v-if="error" class="bridges-err">{{ error }}</p>
        <div v-if="loading && !payload" class="bridges-skel" aria-busy="true">Loading…</div>

        <div
          v-else
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
                'bridge-tile--d-red': delayTierForRow(row) === 'red',
              }"
              @click="onListTileClick(row)"
            >
              <div class="bridge-tile-inner">
                <div class="bridge-card-head">
                  <div class="bridge-card-id">
                    <span class="bridge-rank" aria-hidden="true">{{ idx + 1 }}</span>
                    <h2 class="bridge-title">{{ displayTitle(row) }}</h2>
                  </div>
                  <div
                    class="bridge-trend ico"
                    :class="[trendInfo(row).cls, delayTierClass(row)]"
                    :title="trendInfo(row).full"
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
                          <stop offset="0%" :stop-color="bridgeChartModel(row).strokeColor" stop-opacity="0.28" />
                          <stop offset="100%" :stop-color="bridgeChartModel(row).strokeColor" stop-opacity="0.04" />
                        </linearGradient>
                      </defs>
                      <template v-if="bridgeChartModel(row).hasPath">
                        <text
                          class="bridge-chart-axis-title"
                          x="6"
                          :y="bridgeChartModel(row).yTicks[0].y + 3.5"
                          text-anchor="start"
                        >{{ bridgeChartModel(row).yTicks[0].lab }}</text>
                        <text
                          class="bridge-chart-axis-title"
                          x="6"
                          :y="bridgeChartModel(row).yTicks[2].y + 3.5"
                          text-anchor="start"
                        >{{ bridgeChartModel(row).yTicks[2].lab }}</text>
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
                          stroke-width="1.35"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <circle
                          :cx="bridgeChartModel(row).lastCx"
                          :cy="bridgeChartModel(row).lastCy"
                          r="1.85"
                          :fill="bridgeChartModel(row).strokeColor"
                          stroke="#0f0f14"
                          stroke-width="0.65"
                        />
                        <text
                          v-for="(tk, ti) in bridgeChartModel(row).xTicks"
                          :key="`xt-${ti}`"
                          class="bridge-chart-tick-x"
                          :x="tk.x"
                          y="69"
                          text-anchor="middle"
                        >{{ tk.lab }}</text>
                      </template>
                    </svg>
                  </div>
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="bridges-no-crossings">No bridge data for this direction</p>
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
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  color: var(--color-text-primary, #f4f4f8);
  --b-spark: #a78bfa;
  --b-pick: rgba(52, 211, 153, 0.5);
  box-sizing: border-box;
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0));
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
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0));
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
  min-height: min(42vh, 19rem);
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
}

.bridges-map-shell.is-tall {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
}

.bridges-map-placeholder {
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
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.bridges-list-inner {
  padding: 0.65rem min(1.25rem, 3.5vw) 0.85rem;
  flex: 1 1 auto;
  min-height: 0;
}

.bridges-list-inner.is-scroll-pane {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.bridges-page.is-split .bridges-list-inner {
  padding-top: 0.65rem;
  padding-left: var(--space-3, 0.75rem);
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-3, 0.75rem));
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

.bridges-toggle {
  display: flex;
  gap: 0.45rem;
  width: 100%;
}

.dir-btn {
  flex: 1;
  min-height: 2.75rem;
  min-width: 0;
  font-size: clamp(0.85rem, 2.8vw, 1rem);
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border-radius: 0.8rem;
  border: 2px solid rgba(123, 77, 181, 0.35);
  background: rgba(0, 0, 0, 0.4);
  color: #9a9aac;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.dir-btn.is-on {
  background: linear-gradient(
    160deg,
    rgba(123, 77, 181, 0.55),
    rgba(60, 35, 110, 0.4)
  );
  border-color: rgba(199, 168, 255, 0.6);
  color: #f8f4ff;
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.2);
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
  border-radius: 16px;
  border: 1px solid rgba(199, 168, 255, 0.12);
  background: linear-gradient(165deg, #101018 0%, #0a0a0e 100%);
  padding: 0.6rem 0.55rem 0.8rem;
  box-sizing: border-box;
  margin-top: 0.25rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
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
  gap: 0.4rem;
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
  padding: 0.48rem 0.55rem 0.48rem 0.62rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
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
  font-size: var(--text-sm, 0.8125rem);
  font-weight: 650;
  line-height: 1.28;
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: -0.01em;
  word-break: break-word;
}

.bridge-trend {
  flex-shrink: 0;
  width: 1.42rem;
  height: 1.42rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.76rem;
  line-height: 1;
  font-weight: 900;
  border-radius: 10px;
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
  padding: 0.38rem 0.42rem;
  border-radius: 11px;
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
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.11em;
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
  font-size: clamp(1.35rem, 5vw, 1.72rem);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.03em;
  color: #f2efff;
  font-variant-numeric: tabular-nums;
}

.bridge-kpi-num--muted {
  font-size: 1.15rem;
  font-weight: 700;
  color: #5c5c6c;
}

.bridge-tile.is-pick .bridge-kpi-num:not(.bridge-kpi-num--muted) {
  color: #d1fae5;
}

.bridge-kpi-unit {
  font-size: 0.62rem;
  font-weight: 750;
  color: #8b8b9c;
  letter-spacing: 0.02em;
}

.bridge-chart-shell {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.bridge-chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0 0.06rem;
}

.bridge-chart-title {
  font-size: 0.52rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6e6e7e;
}

.bridge-chart-sub {
  font-size: 0.52rem;
  font-weight: 700;
  color: #5a5a68;
  letter-spacing: 0.04em;
}

.bridge-chart-panel {
  border-radius: 10px;
  padding: 0.14rem 0 0.04rem;
  background: rgba(0, 0, 0, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.05);
  width: 100%;
  min-width: 0;
}

.bridge-chart-svg {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.bridge-chart-grid {
  stroke: rgba(255, 255, 255, 0.06);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.bridge-chart-axis-title {
  fill: #8b8b9a;
  font-size: 4.75px;
  font-weight: 700;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.bridge-chart-tick-x {
  fill: #8b8b9a;
  font-size: 4.6px;
  font-weight: 650;
  font-family: var(--font-sans, system-ui, sans-serif);
}
</style>
