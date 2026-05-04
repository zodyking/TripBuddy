<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getHighwayTraffic } from '../api.js'
import { bridgeDelayTier } from '../utils/bridgeDelayTier.js'

defineOptions({ name: 'TrafficCorridorsContent' })

const POLL_MS = 5 * 60 * 1000

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
 * @param {unknown} hw
 */
function travelMinutes(hw) {
  if (hw == null || typeof hw !== 'object') return Number.POSITIVE_INFINITY
  const live = /** @type {Record<string, unknown>} */(hw).live
  if (!live || typeof live !== 'object') return Number.POSITIVE_INFINITY
  const m = /** @type {Record<string, unknown>} */(live).routeTravelTime
  if (typeof m === 'number' && Number.isFinite(m)) return m
  return Number.POSITIVE_INFINITY
}

/**
 * @param {unknown} hw
 */
function finiteTravelMinutes(hw) {
  const m = travelMinutes(hw)
  return Number.isFinite(m) && m !== Number.POSITIVE_INFINITY ? m : null
}

/**
 * @param {unknown} hw
 */
function delayTierForHighway(hw) {
  const fm = finiteTravelMinutes(hw)
  return fm != null ? bridgeDelayTier(fm) : 'orange'
}

/**
 * @param {unknown} hw
 */
function trendInfo(hw) {
  if (hw == null || typeof hw !== 'object') {
    return { short: '·', cls: 't--unk', full: 'Not enough data yet' }
  }
  const t = /** @type {Record<string, unknown>} */(hw).trend
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
 * @param {unknown} hw
 */
function seriesForHighway(hw) {
  if (hw == null || typeof hw !== 'object') return []
  const s = /** @type {Record<string, unknown>} */(hw).series
  return Array.isArray(s) ? s : []
}

/**
 * @param {unknown} hw
 */
function chartStrokeColor(hw) {
  const t = delayTierForHighway(hw)
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
 * @param {unknown} hw
 */
function chartModel(hw) {
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
  const strokeColor = chartStrokeColor(hw)

  const raw = seriesForHighway(hw)
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

  const fmtCrossMin = (v) => {
    const r = Math.round(v)
    if (Math.abs(v - r) < 0.08) return String(r)
    return `${v.toFixed(1)}`.replace(/\.0$/, '')
  }
  const yLevels = [maxM, maxM - spanM / 3, maxM - (2 * spanM) / 3, minM]
  /** @type {{ y: number, lab: string }[]} */
  const yTicks = []
  const seenYLab = new Set()
  for (const v of yLevels) {
    let lab = fmtCrossMin(v)
    if (seenYLab.has(lab)) lab = `${v.toFixed(1)}`.replace(/\.0$/, '')
    seenYLab.add(lab)
    yTicks.push({ y: yOf(v), lab })
  }

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

  const FOUR_MS = 4 * 60 * 60 * 1000
  /** @type {number[]} */
  let xTickTs = []
  {
    const d = new Date(tMin)
    d.setMinutes(0, 0, 0)
    d.setMilliseconds(0)
    const h = d.getHours()
    let nextH = Math.ceil(h / 4) * 4
    if (nextH >= 24) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
    } else {
      d.setHours(nextH, 0, 0, 0)
    }
    let t = d.getTime()
    while (t < tMin) t += FOUR_MS
    while (t <= tMax) {
      xTickTs.push(t)
      t += FOUR_MS
    }
    if (xTickTs.length === 0) {
      xTickTs = [tMin, tMax]
    }
  }
  /** @type {{ x: number, lab: string }[]} */
  const xTicks = xTickTs.map((ts) => ({ x: xOf(ts), lab: fmtHour(ts) }))
  if (xTicks.length === 0) {
    xTicks.push({ x: xOf(tMin), lab: fmtHour(tMin) })
    if (tMax !== tMin) xTicks.push({ x: xOf(tMax), lab: fmtHour(tMax) })
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

const rankedHighways = computed(() => {
  const highways = payload.value?.highways
  if (!Array.isArray(highways)) return []
  return [...highways].sort((a, b) => travelMinutes(a) - travelMinutes(b))
})

async function load() {
  error.value = ''
  const gen = ++tick
  const first = !payload.value
  if (first) loading.value = true
  try {
    const p = await getHighwayTraffic()
    if (gen === tick) payload.value = p
  } catch (e) {
    if (gen === tick) {
      error.value = e instanceof Error ? e.message : 'Failed to load highways'
    }
  } finally {
    if (gen === tick) loading.value = false
  }
}

onMounted(() => {
  void load()
  intervalId = setInterval(() => void load(), POLL_MS)
})

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
})
</script>

<template>
  <div class="highways-page">
    <div class="highways-list-column">
      <div class="highways-list-inner">
        <div class="highways-bar">
          <div class="highways-bar-top">
            <h1 class="highways-h1">Highways</h1>
            <p v-if="payload?.error" class="highways-warn" role="status">
              {{ payload.error }}
            </p>
            <p v-else class="highways-pill">
              <span>Travel time · fastest first</span>
              <span v-if="payload?.fetchedAt" class="highways-time"
              >· {{ fmtTime(payload.fetchedAt) }}</span>
            </p>
          </div>
        </div>

        <p v-if="error" class="highways-err">{{ error }}</p>
        <div v-if="loading && !payload" class="highways-skel" aria-busy="true">Loading…</div>

        <div v-else class="highways-content-panel" aria-label="Highway traffic list">
          <h2 v-if="rankedHighways.length" class="highways-trips-h2">Major Highways</h2>
          <ul v-if="rankedHighways.length" class="highway-grid" aria-label="Highways, fastest first">
            <li
              v-for="(hw, idx) in rankedHighways"
              :key="hw.id"
              class="highway-tile"
              :class="{
                'highway-tile--d-green': delayTierForHighway(hw) === 'green',
                'highway-tile--d-orange': delayTierForHighway(hw) === 'orange',
                'highway-tile--d-red': delayTierForHighway(hw) === 'red',
              }"
            >
              <div class="highway-tile-inner">
                <div class="highway-data-col">
                  <div class="highway-card-head">
                    <div class="highway-card-id">
                      <span class="highway-rank" aria-hidden="true">{{ idx + 1 }}</span>
                      <div class="highway-title-wrap">
                        <h2 class="highway-title">{{ hw.name }}</h2>
                        <span class="highway-route">{{ hw.route }}</span>
                      </div>
                    </div>
                    <div
                      class="highway-trend ico"
                      :class="[trendInfo(hw).cls, `highway-trend--delay-${delayTierForHighway(hw)}`]"
                      :title="trendInfo(hw).full"
                    >{{ trendInfo(hw).short }}</div>
                  </div>
                  <div class="highway-card-metrics">
                    <div class="highway-kpi highway-kpi--cross">
                      <span class="highway-kpi-lab">Travel time</span>
                      <div class="highway-kpi-row">
                        <span class="highway-kpi-num">
                          <template v-if="hw.live?.routeTravelTime != null">{{ hw.live.routeTravelTime }}</template>
                          <template v-else>—</template>
                        </span>
                        <span class="highway-kpi-unit">min</span>
                      </div>
                    </div>
                    <div class="highway-kpi-divider" aria-hidden="true" />
                    <div class="highway-kpi highway-kpi--speed">
                      <span class="highway-kpi-lab">Avg speed</span>
                      <div class="highway-kpi-row highway-kpi-row--speed">
                        <template v-if="hw.live?.routeSpeed != null">
                          <span class="highway-kpi-num">{{ hw.live.routeSpeed }}</span>
                          <span class="highway-kpi-unit">mph</span>
                        </template>
                        <template v-else>
                          <span class="highway-kpi-num highway-kpi-num--muted">—</span>
                        </template>
                      </div>
                    </div>
                  </div>
                  <div v-if="chartModel(hw).hasPath" class="highway-chart-shell">
                    <div class="highway-chart-head">
                      <span class="highway-chart-title">History</span>
                      <span class="highway-chart-sub">Minutes · local time</span>
                    </div>
                    <div class="highway-chart-panel">
                      <svg
                        class="highway-chart-svg"
                        :viewBox="`0 0 ${chartModel(hw).vb.w} ${chartModel(hw).vb.h}`"
                        preserveAspectRatio="xMidYMid meet"
                        width="100%"
                        :style="{ aspectRatio: `${chartModel(hw).vb.w} / ${chartModel(hw).vb.h}` }"
                        role="img"
                        :aria-label="`Travel time history for ${hw.name}`"
                      >
                        <defs>
                          <linearGradient :id="`hcg-${hw.id}`" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" :stop-color="chartModel(hw).strokeColor" stop-opacity="0.14" />
                            <stop offset="100%" :stop-color="chartModel(hw).strokeColor" stop-opacity="0.02" />
                          </linearGradient>
                        </defs>
                        <template v-if="chartModel(hw).hasPath">
                          <text
                            v-for="(yt, yi) in chartModel(hw).yTicks"
                            :key="`yt-${yi}`"
                            class="highway-chart-axis-title"
                            x="6"
                            :y="yt.y + 3.5"
                            text-anchor="start"
                          >{{ yt.lab }}</text>
                          <line
                            v-for="(g, gi) in chartModel(hw).hGrids"
                            :key="`hg-${gi}`"
                            :x1="g.x1"
                            :y1="g.y1"
                            :x2="g.x2"
                            :y2="g.y2"
                            class="highway-chart-grid"
                          />
                          <path :d="chartModel(hw).dArea" :fill="`url(#hcg-${hw.id})`" />
                          <path
                            :d="chartModel(hw).dLine"
                            fill="none"
                            :stroke="chartModel(hw).strokeColor"
                            stroke-width="0.95"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            opacity="0.82"
                          />
                          <circle
                            :cx="chartModel(hw).lastCx"
                            :cy="chartModel(hw).lastCy"
                            r="1.35"
                            :fill="chartModel(hw).strokeColor"
                            stroke="#0f0f14"
                            stroke-width="0.45"
                            opacity="0.9"
                          />
                          <text
                            v-for="(tk, ti) in chartModel(hw).xTicks"
                            :key="`xt-${ti}`"
                            class="highway-chart-tick-x"
                            :x="tk.x"
                            :y="chartModel(hw).vb.h - 5"
                            text-anchor="middle"
                          >{{ tk.lab }}</text>
                        </template>
                      </svg>
                    </div>
                  </div>
                  <div v-else class="highway-chart-empty" role="status">Collecting history…</div>
                </div>
              </div>
            </li>
          </ul>
          <p v-else-if="!loading" class="highways-no-data">
            No highway traffic data. Configure a HERE or TomTom API key in Settings.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.highways-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  color: var(--color-text-primary, #f4f4f8);
  box-sizing: border-box;
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0));
}

.highways-list-column {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.highways-list-inner {
  padding: 0.65rem min(1.25rem, 3.5vw) 0.85rem;
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.highways-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.highways-bar-top {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.highways-h1 {
  margin: 0;
  font-size: var(--text-xl, 1.25rem);
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}

.highways-warn {
  font-size: 0.68rem;
  color: #fbbf24;
  margin: 0;
  line-height: 1.3;
  font-weight: 600;
}

.highways-pill {
  margin: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #7a7a8c;
  font-weight: 700;
}

.highways-time {
  color: #5a5a6a;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.highways-err {
  color: #f87171;
  font-size: 0.8rem;
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.highways-skel {
  padding: 1.2rem 0;
  color: #9a9ab0;
  font-size: 0.9rem;
}

.highways-content-panel {
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

.highways-trips-h2 {
  margin: 0 0 0.4rem 0.15rem;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #6e6e7e;
}

.highways-no-data {
  margin: 0.5rem 0.25rem 0.35rem;
  font-size: 0.8rem;
  color: #7a7a8c;
}

.highway-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  width: 100%;
  max-width: none;
}

.highway-tile {
  min-width: 0;
  width: 100%;
  border-radius: 14px;
  position: relative;
  background: linear-gradient(155deg, rgba(26, 26, 34, 0.98) 0%, rgba(12, 12, 18, 0.99) 48%, rgba(10, 10, 14, 1) 100%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 18px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.highway-tile::before {
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

.highway-tile--d-green::before {
  background: linear-gradient(180deg, #4ade80, #22c55e);
  box-shadow: 0 0 14px rgba(74, 222, 128, 0.35);
}

.highway-tile--d-orange::before {
  background: linear-gradient(180deg, #fb923c, #ea580c);
  box-shadow: 0 0 14px rgba(251, 146, 60, 0.28);
}

.highway-tile--d-red::before {
  background: linear-gradient(180deg, #f87171, #dc2626);
  box-shadow: 0 0 14px rgba(248, 113, 113, 0.28);
}

.highway-tile-inner {
  padding: 0.38rem 0.48rem 0.38rem 0.54rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.26rem;
}

.highway-data-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.26rem;
}

.highway-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
}

.highway-card-id {
  display: flex;
  align-items: flex-start;
  gap: 0.42rem;
  min-width: 0;
  flex: 1;
}

.highway-rank {
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

.highway-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
  min-width: 0;
}

.highway-title {
  margin: 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: -0.01em;
  word-break: break-word;
}

.highway-route {
  font-size: 0.55rem;
  font-weight: 650;
  color: #8b8b9a;
  letter-spacing: 0.02em;
}

.highway-trend {
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

.highway-trend.highway-trend--delay-green {
  color: #ecfdf5;
  background: rgba(22, 101, 52, 0.55);
  border-color: rgba(74, 222, 128, 0.45);
}

.highway-trend.highway-trend--delay-orange {
  color: #fff7ed;
  background: rgba(154, 52, 18, 0.52);
  border-color: rgba(251, 146, 60, 0.48);
}

.highway-trend.highway-trend--delay-red {
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

.highway-card-metrics {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 0;
  padding: 0.28rem 0.34rem;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.highway-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

.highway-kpi--cross {
  padding-right: 0.35rem;
}

.highway-kpi--speed {
  padding-left: 0.35rem;
  align-items: flex-end;
  text-align: right;
}

.highway-kpi-divider {
  width: 1px;
  align-self: stretch;
  margin: 0.12rem 0;
  background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.08) 15%, rgba(255, 255, 255, 0.08) 85%, transparent);
}

.highway-kpi-lab {
  font-size: 0.47rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6b6b78;
  line-height: 1.15;
}

.highway-kpi-row {
  display: flex;
  align-items: baseline;
  gap: 0.14rem;
  flex-wrap: nowrap;
}

.highway-kpi-row--speed {
  justify-content: flex-end;
}

.highway-kpi-num {
  font-size: clamp(1.05rem, 4.2vw, 1.38rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: #ebe8f7;
  font-variant-numeric: tabular-nums;
}

.highway-kpi-num--muted {
  font-size: 1rem;
  font-weight: 650;
  color: #5c5c6c;
}

.highway-kpi-unit {
  font-size: 0.56rem;
  font-weight: 650;
  color: #8b8b9c;
  letter-spacing: 0.02em;
}

.highway-chart-shell {
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
}

.highway-chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem;
  padding: 0 0.04rem;
}

.highway-chart-title {
  font-size: 0.48rem;
  font-weight: 800;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #6e6e7e;
}

.highway-chart-sub {
  font-size: 0.48rem;
  font-weight: 650;
  color: #5a5a68;
  letter-spacing: 0.04em;
}

.highway-chart-panel {
  border-radius: 8px;
  padding: 0.06rem 0 0;
  background: rgba(0, 0, 0, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.05);
  width: 100%;
  min-width: 0;
}

.highway-chart-empty {
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

.highway-chart-svg {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.highway-chart-grid {
  stroke: rgba(255, 255, 255, 0.045);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.highway-chart-axis-title {
  fill: #8b8b9a;
  font-size: 4.35px;
  font-weight: 650;
  font-family: var(--font-sans, system-ui, sans-serif);
}

.highway-chart-tick-x {
  fill: #8b8b9a;
  font-size: 4.25px;
  font-weight: 600;
  font-family: var(--font-sans, system-ui, sans-serif);
}

@media (orientation: landscape) and (min-width: 700px) {
  .highways-list-inner {
    padding-top: 0.65rem;
    padding-left: var(--space-3, 0.75rem);
    padding-right: max(env(safe-area-inset-right, 0px), var(--space-3, 0.75rem));
  }
}
</style>
