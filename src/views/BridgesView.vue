<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getBridgesPanynj } from '../api.js'

defineOptions({ name: 'BridgesView' })

const POLL_MS = 5 * 60 * 1000
const MAX_SPARK_POINTS = 20

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
 * @param {unknown} row
 * @param {string} d
 */
function matchDir(row, d) {
  if (row == null || typeof row !== 'object' || !('travelDirection' in row)) {
    return false
  }
  return String(/** @type {Record<string, unknown>} */(row).travelDirection) === d
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

const rankedRows = computed(() => {
  const live = payload.value?.live
  if (!Array.isArray(live)) return []
  const d = direction.value
  const out = live.filter((r) => !isTunnelRow(r) && matchDir(r, d))
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
  if (mod) return `${name} — ${mod}`
  return name
}

/**
 * @param {unknown} row
 */
function trendInfo(row) {
  const id = rowRouteId(row)
  if (!id || !payload.value?.byRoute) {
    return { short: '—', cls: 't--unk', full: 'No prior sample' }
  }
  const b = payload.value.byRoute[id]
  if (!b || !b.trend) {
    return { short: '—', cls: 't--unk', full: 'No prior sample' }
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
 * @param {Array<{ t: number, m: number, s: number }>} points
 * @param {number} [maxN]
 */
function downsampleTimeSeries(points, maxN = MAX_SPARK_POINTS) {
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
 * Simple spark: few points, thick line, no axes text.
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function sparklinePathD(points) {
  if (!Array.isArray(points) || points.length < 1) return ''
  const p = downsampleTimeSeries(points, MAX_SPARK_POINTS)
  if (p.length < 1) return ''
  const w = 100
  const h = 22
  const pad = 2
  const vals = p.map((x) => x.m)
  const minV = Math.min(...vals, 0)
  const maxV = Math.max(...vals, 1)
  const span = Math.max(maxV - minV, 0.1)
  const n = p.length
  return p
    .map((pt, i) => {
      const x = pad + (w - 2 * pad) * (n <= 1 ? 0.5 : i / (n - 1))
      const y = pad + (h - 2 * pad) * (1 - (pt.m - minV) / span)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
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
 */
function sparkPathD(row) {
  return sparklinePathD(seriesForRow(row))
}

/**
 * @param {unknown} row
 * @param {number} i
 */
function isBestPick(i, row) {
  if (i !== 0 || isClosedRow(row)) return false
  return Number.isFinite(travelMinutes(row))
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

function setDir(d) {
  direction.value = d
}

onMounted(() => {
  void load()
  intervalId = setInterval(() => {
    void load()
  }, POLL_MS)
})

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
})
</script>

<template>
  <div class="bridges-page">
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

    <ul
      v-else
      class="bridge-grid"
      aria-label="Bridges, fastest first"
    >
      <li
        v-for="(row, idx) in rankedRows"
        :key="rowKey(row)"
        class="bridge-tile"
        :class="{
          'is-closed': isClosedRow(row),
          'is-pick': isBestPick(idx, row),
        }"
      >
        <div class="bridge-tile-inner">
          <div class="bridge-tile-top">
            <div class="bridge-rank" aria-hidden="true">{{ idx + 1 }}</div>
            <div class="bridge-name-block">
              <h2 class="bridge-title">{{ displayTitle(row) }}</h2>
            </div>
            <div
              class="bridge-trend ico"
              :class="trendInfo(row).cls"
              :title="trendInfo(row).full"
            >{{ trendInfo(row).short }}</div>
          </div>
          <div class="bridge-mid">
            <div class="bridge-min-block">
              <span class="bridge-min-num">
                <template
                  v-if="row && typeof row === 'object' && (/** @type {any} */(row)).isCrossingClosed"
                >—</template>
                <template
                  v-else-if="row && typeof row === 'object' && (/** @type {any} */(row)).routeTravelTime != null"
                >{{ String((/** @type {any} */(row)).routeTravelTime) }}</template>
                <template v-else>—</template>
              </span>
              <span class="bridge-min-suf">min</span>
            </div>
            <div
              v-if="row && typeof row === 'object' && (/** @type {any} */(row)).routeSpeed != null"
              class="bridge-mph"
            >{{ (/** @type {any} */(row)).routeSpeed }}&nbsp;mph</div>
          </div>
          <div v-if="seriesForRow(row).length > 0" class="sparkline-wrap">
            <svg
              class="spark-svg"
              viewBox="0 0 100 22"
              preserveAspectRatio="none"
              width="100%"
              height="22"
              :aria-label="`Recent travel time for ${displayTitle(row)}`"
            >
              <line
                x1="0"
                y1="20"
                x2="100"
                y2="20"
                stroke="rgba(255,255,255,0.06)"
                stroke-width="1"
              />
              <path
                v-if="sparkPathD(row)"
                :d="sparkPathD(row)"
                fill="none"
                stroke="var(--b-spark, #9d7ed8)"
                stroke-width="2.25"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bridges-page {
  width: 100%;
  max-width: 1280px;
  margin-inline: auto;
  padding: 0.65rem min(1.25rem, 3.5vw) calc(var(--nav-height, 4rem) + 0.85rem);
  min-height: 100%;
  color: var(--color-text-primary, #f4f4f8);
  --b-spark: #a78bfa;
  --b-pick: rgba(52, 211, 153, 0.5);
  box-sizing: border-box;
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
  font-size: clamp(1.1rem, 2.2vw, 1.35rem);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0;
  color: #e8e0f4;
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

/* Responsive grid: one column on narrow phones, two from ~480px, three on large tablets/desktop */
.bridge-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.55rem;
  align-items: stretch;
}

@media (min-width: 480px) {
  .bridge-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
  }
}

@media (min-width: 900px) {
  .bridges-page {
    padding-inline: 1.5rem;
  }
  .bridge-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }
}

.bridge-tile {
  min-width: 0;
  border-radius: 14px;
  position: relative;
  background: linear-gradient(150deg, #181822 0%, #0b0b0f 100%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
}

.bridge-tile.is-pick {
  border-color: var(--b-pick);
  box-shadow: 0 0 0 1px var(--b-pick), 0 8px 24px rgba(0, 0, 0, 0.45);
}

.bridge-tile.is-closed {
  opacity: 0.7;
  border-color: rgba(248, 113, 113, 0.3);
}

.bridge-tile-inner {
  padding: 0.5rem 0.65rem 0.4rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.bridge-tile-top {
  display: grid;
  grid-template-columns: 1.35rem 1fr auto;
  grid-template-areas: 'rank name trend' 'bdg bdg bdg';
  align-items: start;
  column-gap: 0.4rem;
  row-gap: 0.1rem;
  min-height: 2.5rem;
  position: relative;
}

@media (min-width: 480px) {
  .bridge-tile-top {
    min-height: 2.6rem;
  }
}

.bridge-rank {
  grid-area: rank;
  font-size: 0.65rem;
  font-weight: 900;
  line-height: 1;
  color: #5c5c6c;
  padding-top: 0.15rem;
  text-align: center;
  width: 1.35rem;
  height: 1.35rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.bridge-tile.is-pick .bridge-rank {
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.35);
}

.bridge-name-block {
  grid-area: name;
  min-width: 0;
}

.bridge-title {
  margin: 0;
  font-size: clamp(0.78rem, 2.1vw, 0.92rem);
  font-weight: 800;
  line-height: 1.2;
  color: #f2eef9;
  letter-spacing: 0.01em;
  word-break: break-word;
  hyphens: auto;
}

.bridge-trend {
  grid-area: trend;
  width: 1.65rem;
  height: 1.65rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  line-height: 1;
  font-weight: 900;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #7a7a8c;
  background: rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
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

.bridge-mid {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  margin-top: 0.1rem;
  min-height: 2.4rem;
}

.bridge-min-block {
  display: flex;
  align-items: baseline;
  gap: 0.15rem;
  flex: 0 0 auto;
}

.bridge-min-num {
  font-size: clamp(1.8rem, 5.5vw, 2.35rem);
  font-weight: 900;
  line-height: 0.9;
  letter-spacing: -0.03em;
  color: #e9e4ff;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.5);
  font-variant-numeric: tabular-nums;
}

.bridge-tile.is-pick .bridge-min-num {
  color: #c4f4dd;
}

.bridge-min-suf {
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  color: #8a8a9a;
  letter-spacing: 0.06em;
}

.bridge-mph {
  font-size: 0.72rem;
  font-weight: 700;
  color: #6e6e80;
  font-variant-numeric: tabular-nums;
  text-align: right;
  line-height: 1.1;
  max-width: 4rem;
  flex-shrink: 0;
}

.sparkline-wrap {
  margin-top: 0.15rem;
  padding-top: 0.2rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  opacity: 0.9;
}
.spark-svg {
  display: block;
  max-width: 100%;
  min-height: 1.1rem;
}
</style>
