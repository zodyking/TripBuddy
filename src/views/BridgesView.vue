<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getBridgesPanynj } from '../api.js'

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
 * @param {unknown} row
 * @param {string} d
 */
function matchDir(row, d) {
  if (row == null || typeof row !== 'object' || !('travelDirection' in row)) {
    return false
  }
  return String(/** @type {Record<string, unknown>} */(row).travelDirection) === d
}

const filteredRows = computed(() => {
  const live = payload.value?.live
  if (!Array.isArray(live)) return []
  const d = direction.value
  return live.filter((r) => matchDir(r, d))
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
  const name = typeof o.crossingDisplayName === 'string' ? o.crossingDisplayName : 'Crossing'
  const mod = typeof o.facilityModifier === 'string' ? o.facilityModifier.trim() : ''
  if (mod) return `${name} · ${mod}`
  return name
}

/**
 * @param {unknown} row
 */
function trendInfo(row) {
  const id = rowRouteId(row)
  if (!id || !payload.value?.byRoute) return { label: '—', cls: 't--unk' }
  const b = payload.value.byRoute[id]
  if (!b || !b.trend) return { label: '—', cls: 't--unk' }
  const t = b.trend
  if (t === 'worse') return { label: 'Worse', cls: 't--worse' }
  if (t === 'better') return { label: 'Better', cls: 't--better' }
  if (t === 'neutral') return { label: 'Steady', cls: 't--neutral' }
  return { label: '—', cls: 't--unk' }
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
 */
function sparklinePathD(points) {
  if (!Array.isArray(points) || points.length < 1) {
    return ''
  }
  const w = 200
  const h = 48
  const pad = 4
  const vals = points.map((p) => p.m)
  const minV = Math.min(...vals, 0)
  const maxV = Math.max(...vals, 1)
  const span = Math.max(maxV - minV, 0.1)
  const n = points.length
  return points
    .map((p, i) => {
      const x = pad + ((w - 2 * pad) * (n <= 1 ? 0.5 : i / (n - 1)))
      const y = pad + (h - 2 * pad) * (1 - (p.m - minV) / span)
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
  return [
    o.routeId,
    o.facilityModifier,
    o.cardinalDirection,
    o.travelDirection,
  ].join(':')
}

/**
 * Sanitized id for SVG gradient defs
 * @param {unknown} row
 */
function gradientId(row) {
  const k = rowKey(row)
  return `bf-${k.replace(/[^a-z0-9]/gi, 'x')}`
}

/**
 * @param {unknown} row
 */
function isClosedRow(row) {
  return (
    row != null &&
    typeof row === 'object' &&
    /** @type {any} */ (row).isCrossingClosed === true
  )
}

async function load() {
  error.value = ''
  const gen = ++tick
  if (!loading.value) {
    /* refresh */
  } else {
    loading.value = true
  }
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
    <div class="bridges-head">
      <h1 class="bridges-h1">Bridges</h1>
      <p v-if="payload?.fetchError" class="bridges-warn" role="status">
        Upstream: {{ payload.fetchError }}
      </p>
    </div>

    <div class="bridges-toggle" role="group" aria-label="Direction">
      <button
        type="button"
        class="dir-btn tap"
        :class="{ 'is-on': direction === 'ToNY' }"
        @click="setDir('ToNY')"
      >To NY</button>
      <button
        type="button"
        class="dir-btn tap"
        :class="{ 'is-on': direction === 'ToNJ' }"
        @click="setDir('ToNJ')"
      >To NJ</button>
    </div>

    <p v-if="error" class="bridges-err">{{ error }}</p>

    <div v-if="loading && !payload" class="bridges-skel" aria-busy="true">Loading…</div>

    <p v-else class="bridges-updated" role="status">
      Updated {{ fmtTime(payload?.fetchedAt) }} ·
      <span v-if="payload?.pollIntervalMs" class="bridges-poll"
      >refreshed every 5 min</span>
    </p>

    <ul class="bridge-list" aria-label="Port Authority crossings">
      <li
        v-for="row in filteredRows"
        :key="rowKey(row)"
        class="bridge-card"
        :class="{ 'is-closed': isClosedRow(row) }"
      >
        <div class="bridge-row1">
          <h2 class="bridge-title">{{ displayTitle(row) }}</h2>
          <span
            class="trend"
            :class="trendInfo(row).cls"
            :title="`vs prior sample: ${(trendInfo(row).label)}`"
          >{{ trendInfo(row).label }}</span>
        </div>
        <div class="bridge-row2">
          <div class="kpi">
            <span class="kpi-l">Time</span>
            <span class="kpi-v kpi-m">
              {{ row && typeof row === 'object' && row.routeTravelTime != null
                ? String((/** @type {any} */(row)).routeTravelTime)
                : '—' }}&nbsp;min
            </span>
          </div>
          <div class="kpi">
            <span class="kpi-l">Speed</span>
            <span class="kpi-v">
              {{ row && typeof row === 'object' && row.routeSpeed != null
                ? String((/** @type {any} */(row)).routeSpeed)
                : '—' }}&nbsp;mph
            </span>
          </div>
          <div class="kpi kpi--wide" v-if="row && typeof row === 'object' && row.infomationalText">
            <span class="kpi-l">Traffic</span>
            <span class="kpi-v kpi-txt">
              {{ String((/** @type {any} */(row)).infomationalText) }}
            </span>
          </div>
        </div>
        <div
          v-if="isClosedRow(row)"
          class="bridge-closed"
        >Closed</div>
        <div class="spark-wrap">
          <svg
            class="spark"
            viewBox="0 0 200 48"
            width="100%"
            height="48"
            role="img"
            :aria-label="`Travel time over time for ${displayTitle(row)}`"
          >
            <defs>
              <linearGradient
                :id="gradientId(row)"
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop
                  offset="0%"
                  style="stop-color: rgba(123, 77, 181, 0.35); stop-opacity:1"
                />
                <stop
                  offset="100%"
                  style="stop-color: rgba(123, 77, 181, 0); stop-opacity:1"
                />
              </linearGradient>
            </defs>
            <rect
              width="200"
              height="48"
              :fill="`url(#${gradientId(row)})`"
              stroke="rgba(255,255,255,0.05)"
              rx="6"
            />
            <path
              v-if="seriesForRow(row).length > 0"
              :d="sparklinePathD(seriesForRow(row))"
              fill="none"
              stroke="#a78bfa"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <line
              v-if="seriesForRow(row).length === 0"
              x1="8"
              y1="24"
              x2="192"
              y2="24"
              stroke="rgba(255,255,255,0.1)"
              stroke-width="1"
            />
            <text x="8" y="12" class="spark-hint" fill="rgba(255,255,255,0.35)">
              time (min)
            </text>
            <text
              v-if="seriesForRow(row).length < 2"
              x="8"
              y="45"
              class="spark-hint"
              fill="rgba(255,255,255,0.2)"
            >new points / 5 min</text>
          </svg>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bridges-page {
  max-width: var(--app-content-max, 40rem);
  margin-inline: auto;
  padding: 0.75rem max(0.75rem, env(safe-area-inset-left, 0))
    calc(var(--nav-height, 4rem) + 0.75rem) max(0.75rem, env(safe-area-inset-right, 0));
  min-height: 100%;
  color: var(--color-text-primary, #f4f4f8);
}

.bridges-h1 {
  font-size: clamp(1.1rem, 2.5vw, 1.25rem);
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin: 0 0 0.5rem;
  color: #e8e0f4;
}

.bridges-warn {
  font-size: 0.7rem;
  color: #fbbf24;
  margin: 0 0 0.5rem;
  line-height: 1.35;
}

.bridges-toggle {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.dir-btn {
  flex: 1;
  min-height: 2.5rem;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border-radius: 0.75rem;
  border: 1px solid rgba(123, 77, 181, 0.35);
  background: rgba(0, 0, 0, 0.35);
  color: #a8a8b8;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.dir-btn.is-on {
  background: linear-gradient(160deg, rgba(123, 77, 181, 0.5), rgba(90, 50, 150, 0.35));
  border-color: rgba(167, 139, 250, 0.6);
  color: #f4f4f8;
}

.bridges-err {
  color: #f87171;
  font-size: 0.8rem;
  margin: 0 0 0.5rem;
}

.bridges-skel {
  padding: 1rem 0;
  color: #9a9ab0;
  font-size: 0.85rem;
}

.bridges-updated {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6e6e7e;
  margin: 0 0 0.75rem;
}
.bridges-poll {
  color: #5b5b6a;
}

.bridge-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bridge-card {
  background: linear-gradient(165deg, #16161f 0%, #0e0e12 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 0.75rem 0.9rem 0.65rem;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  position: relative;
}
.bridge-card.is-closed {
  opacity: 0.7;
  border-color: rgba(248, 113, 113, 0.35);
}

.bridge-row1 {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.bridge-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.25;
  color: #f0edf7;
  flex: 1;
  min-width: 0;
}
.trend {
  flex-shrink: 0;
  font-size: 0.58rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.3);
  color: #8b8b9a;
}
.t--worse {
  border-color: rgba(248, 113, 113, 0.4);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
}
.t--better {
  border-color: rgba(52, 211, 153, 0.4);
  color: #a7f3d0;
  background: rgba(6, 78, 59, 0.35);
}
.t--neutral {
  border-color: rgba(250, 204, 21, 0.35);
  color: #fde68a;
  background: rgba(90, 75, 10, 0.35);
}
.t--unk {
  color: #6e6e7e;
}

.bridge-row2 {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
  margin-bottom: 0.45rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.kpi--wide {
  flex: 1 1 100%;
}
.kpi-l {
  font-size: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6e6e7e;
  font-weight: 800;
}
.kpi-v {
  font-size: 0.85rem;
  font-weight: 800;
  color: #e0dce8;
  font-variant-numeric: tabular-nums;
}
.kpi-m {
  font-size: 1rem;
  color: #c4b5fd;
}
.kpi-txt {
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  color: #a8a8b8;
}

.bridge-closed {
  position: absolute;
  right: 0.65rem;
  top: 0.45rem;
  font-size: 0.5rem;
  font-weight: 900;
  text-transform: uppercase;
  color: #fecaca;
  border: 1px solid #7f1d1d;
  background: #450a0a;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  pointer-events: none;
}
.spark-wrap {
  margin-top: 0.35rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 0.4rem;
}
.spark {
  display: block;
  max-width: 100%;
  height: auto;
}
.spark-hint {
  font-size: 5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
