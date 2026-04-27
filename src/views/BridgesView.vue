<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { getBridgesPanynj } from '../api.js'
import { getBridgeAnchorForRouteId } from '../bridges/bridgeRouteAnchors.js'
import BridgesMap from '../components/BridgesMap.vue'

defineOptions({ name: 'BridgesView' })

const POLL_MS = 5 * 60 * 1000
const MAX_SPARK_POINTS = 48

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
 * Rich mini-chart: area fill, grid, min/max + last point.
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function sparklinePathD(points) {
  if (!Array.isArray(points) || points.length < 1) return ''
  const p = downsampleTimeSeries(points, MAX_SPARK_POINTS)
  if (p.length < 1) return ''
  const w = 100
  const h = 32
  const padX = 4
  const padY = 6
  const vals = p.map((x) => x.m)
  const minV = Math.min(...vals, 0)
  const maxV = Math.max(...vals, 1)
  const span = Math.max(maxV - minV, 0.1)
  const n = p.length
  return p
    .map((pt, i) => {
      const x = padX + (w - 2 * padX) * (n <= 1 ? 0.5 : i / (n - 1))
      const y = padY + (h - 2 * padY) * (1 - (pt.m - minV) / span)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function sparkAreaPathD(points) {
  if (!Array.isArray(points) || points.length < 1) return ''
  const p = downsampleTimeSeries(points, MAX_SPARK_POINTS)
  if (p.length < 1) return ''
  const w = 100
  const h = 32
  const padX = 4
  const padY = 6
  const vals = p.map((x) => x.m)
  const minV = Math.min(...vals, 0)
  const maxV = Math.max(...vals, 1)
  const span = Math.max(maxV - minV, 0.1)
  const n = p.length
  const pts = p.map((pt, i) => {
    const x = padX + (w - 2 * padX) * (n <= 1 ? 0.5 : i / (n - 1))
    const y = padY + (h - 2 * padY) * (1 - (pt.m - minV) / span)
    return { x, y }
  })
  const yBase = h - 2
  return `M${pts[0].x.toFixed(1)},${yBase.toFixed(1)}${pts
    .map((o) => `L${o.x.toFixed(1)},${o.y.toFixed(1)}`)
    .join('')}L${pts[pts.length - 1].x.toFixed(1)},${yBase.toFixed(1)}Z`
}

/**
 * @param {unknown} row
 */
/**
 * @param {unknown} row
 */
function sparkMeta(row) {
  const s = seriesForRow(row)
  if (!s.length) return { min: 0, max: 0 }
  const p = downsampleTimeSeries(s, MAX_SPARK_POINTS)
  const vals = p.map((x) => x.m)
  return {
    min: Math.min(...vals, 0),
    max: Math.max(...vals, 1),
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
 */
function sparkPathD(row) {
  return sparklinePathD(seriesForRow(row))
}
function sparkAreaD(row) {
  return sparkAreaPathD(seriesForRow(row))
}
function sparkLastPoint(row) {
  const s = seriesForRow(row)
  const p = downsampleTimeSeries(s, MAX_SPARK_POINTS)
  if (p.length < 1) return { x: 50, y: 16 }
  const w = 100
  const h = 32
  const padX = 4
  const padY = 6
  const vals = p.map((x) => x.m)
  const minV = Math.min(...vals, 0)
  const maxV = Math.max(...vals, 1)
  const span = Math.max(maxV - minV, 0.1)
  const n = p.length
  const last = p[n - 1]
  const i = n - 1
  const x = padX + (w - 2 * padX) * (n <= 1 ? 0.5 : i / (n - 1))
  const y = padY + (h - 2 * padY) * (1 - (last.m - minV) / span)
  return { x, y, m: last.m }
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
    out.push({
      id,
      lat: pos[0],
      lng: pos[1],
      title: displayTitleShort(row),
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
              }"
              @click="onListTileClick(row)"
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
                  <div class="spark-head">
                    <span class="spark-lab">Recent (min)</span>
                    <span
                      v-if="sparkMeta(row).max > 0"
                      class="spark-range"
                    >{{ Math.round(sparkMeta(row).min) }}–{{ Math.round(sparkMeta(row).max) }}</span>
                  </div>
                  <svg
                    class="spark-svg"
                    viewBox="0 0 100 32"
                    preserveAspectRatio="none"
                    width="100%"
                    height="32"
                    :aria-label="`Recent travel time for ${displayTitle(row)}`"
                  >
                    <defs>
                      <linearGradient
                        :id="`spg-r${rowRouteId(row)}`"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stop-color="rgba(167,139,250,0.35)" />
                        <stop offset="100%" stop-color="rgba(167,139,250,0.02)" />
                      </linearGradient>
                    </defs>
                    <line
                      x1="4"
                      y1="8"
                      x2="96"
                      y2="8"
                      class="spark-grid"
                    />
                    <line
                      x1="4"
                      y1="16"
                      x2="96"
                      y2="16"
                      class="spark-grid"
                    />
                    <line
                      x1="4"
                      y1="24"
                      x2="96"
                      y2="24"
                      class="spark-grid"
                    />
                    <path
                      v-if="sparkAreaD(row)"
                      :d="sparkAreaD(row)"
                      :fill="`url(#spg-r${rowRouteId(row)})`"
                    />
                    <path
                      v-if="sparkPathD(row)"
                      :d="sparkPathD(row)"
                      fill="none"
                      stroke="var(--b-spark, #c4b5fd)"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <circle
                      v-if="seriesForRow(row).length"
                      :cx="sparkLastPoint(row).x"
                      :cy="sparkLastPoint(row).y"
                      r="2.2"
                      class="spark-dot"
                    />
                  </svg>
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
  gap: 0.6rem;
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
  background: linear-gradient(150deg, #1a1a24 0%, #0c0c12 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.1s;
}
.bridge-tile:active {
  transform: scale(0.998);
}

.bridge-tile.is-hi {
  border-color: rgba(199, 168, 255, 0.55);
  box-shadow: 0 0 0 1px rgba(199, 168, 255, 0.25);
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
  margin-top: 0.25rem;
  padding-top: 0.3rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.spark-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.2rem;
  padding: 0 0.1rem;
}
.spark-lab {
  font-size: 0.55rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #6b6b78;
}
.spark-range {
  font-size: 0.6rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #9a9aac;
}
.spark-grid {
  stroke: rgba(255, 255, 255, 0.04);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.spark-dot {
  fill: #e9d5ff;
  stroke: #7c3aed;
  stroke-width: 1.2;
}
.spark-svg {
  display: block;
  max-width: 100%;
  min-height: 1.5rem;
}
</style>
