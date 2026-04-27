<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { getBridgesPanynj } from '../api.js'
import { getAnchorByKey } from '../bridges/bridgeRouteAnchors.js'
import BridgesMap from '../components/BridgesMap.vue'

defineOptions({ name: 'BridgesView' })

const POLL_MS = 5 * 60 * 1000
const MAX_SPARK = 20

/** @typedef {'ToNY' | 'ToNJ'} D */
/** @type {import('vue').Ref<D>} */
const direction = ref('ToNY')

const loading = ref(true)
const error = ref('')
/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const payload = ref(null)
const highlightKey = ref('')

let tick = 0
/** @type {ReturnType<typeof setInterval> | null} */
let intervalId = null

const isSplit = ref(false)
let mql = /** @type {MediaQueryList | null} */(null)
function updateSplit() {
  if (typeof window === 'undefined') return
  isSplit.value = window.matchMedia('(min-width: 900px) and (orientation: landscape)').matches
}
function onMql() {
  updateSplit()
}

/**
 * @param {unknown} v
 */
function normDir(v) {
  const s = String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (s === 'TONY' || s === 'TOWARDNY' || s.includes('TONY')) return 'ToNY'
  if (s === 'TONJ' || s === 'TOWARDNJ' || s.includes('TONJ')) return 'ToNJ'
  return ''
}

/**
 * @param {unknown} row
 * @param {D} d
 */
function matchDir(row, d) {
  if (!row || typeof row !== 'object' || !('travelDirection' in row)) return false
  return normDir(/** @type {Record<string, unknown>} */(row).travelDirection) === d
}

function isTunnelName(n) {
  return /\btunnel\b/i.test(String(n || ''))
}

/**
 * GWB: single card — use upper vs lower (by route) for the chosen direction, keep both times in sublabel.
 * @param {Record<string, unknown>[]} live
 * @param {D} d
 */
function gwbRowsOf(live, d) {
  const gwb = live.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      /george washington bridge/i.test(
        String(/** @type {Record<string, unknown>} */(r).crossingDisplayName || ''),
      ),
  )
  const upperRid = d === 'ToNY' ? 211 : 12
  const lowerRid = d === 'ToNY' ? 212 : 11
  const upper = gwb.find((r) => {
    const o = /** @type {Record<string, unknown>} */(r)
    return Number(o.routeId) === upperRid && matchDir(r, d)
  })
  const lower = gwb.find((r) => {
    const o = /** @type {Record<string, unknown>} */(r)
    return Number(o.routeId) === lowerRid && matchDir(r, d)
  })
  return { upper, lower, upperRid, lowerRid }
}

/**
 * @param {unknown} row
 */
function travelMin(row) {
  if (!row || typeof row !== 'object') return null
  const t = /** @type {Record<string, unknown>} */(row).routeTravelTime
  if (typeof t === 'number' && Number.isFinite(t)) return t
  if (t != null && t !== '') {
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * @param {D} d
 */
function buildCrossingsForDirection(d) {
  const rawLive = Array.isArray(payload.value?.live) ? payload.value?.live : []
  const live = /** @type {Record<string, unknown>[]} */ (rawLive)
  /** @type {Array<{
   *  k: string, title: string, routeId: string, sublabel?: string, liveRow: unknown
   * }>} */
  const out = []
  if (!live.length) return out

  for (const r of live) {
    if (!r || typeof r !== 'object' || isTunnelName((/** @type {any} */(r).crossingDisplayName))) {
      continue
    }
    if (!matchDir(r, d)) continue
    if (/george washington bridge/i.test(String(/** @type {any} */(r).crossingDisplayName))) {
      continue
    }
    const o = /** @type {Record<string, unknown>} */(r)
    out.push({
      k: `r${o.routeId}`,
      title: (() => {
        const n = String(o.crossingDisplayName || 'Crossing')
        const mod = String(o.facilityModifier || '').trim()
        return mod ? `${n} — ${mod}` : n
      })(),
      routeId: o.routeId != null ? String(o.routeId) : '',
      liveRow: r,
    })
  }

  const g = gwbRowsOf(live, d)
  if (g.upper || g.lower) {
    const uM = g.upper != null ? travelMin(g.upper) : null
    const lM = g.lower != null ? travelMin(g.lower) : null
    const parts = []
    if (uM != null) parts.push(`U ${uM}`)
    if (lM != null) parts.push(`L ${lM}`)
    out.push({
      k: 'gwb',
      title: 'George Washington Bridge',
      routeId: '',
      sublabel: parts.length ? parts.join(' · ') : undefined,
      liveRow: (() => {
        const candidates = [g.upper, g.lower].filter(Boolean)
        let best = /** @type {unknown} */(null)
        let bestM = Number.POSITIVE_INFINITY
        for (const c of candidates) {
          const m = travelMin(c)
          if (m == null) continue
          if (m < bestM) {
            bestM = m
            best = c
          }
        }
        return best
      })(),
    })
  }

  out.sort((a, b) => {
    const cA = a.liveRow && /** @type {any} */(a.liveRow).isCrossingClosed === true
    const cB = b.liveRow && /** @type {any} */(b.liveRow).isCrossingClosed === true
    if (cA !== cB) return cA ? 1 : -1
    const mA = travelMin(a.liveRow) ?? 9999
    const mB = travelMin(b.liveRow) ?? 9999
    return mA - mB
  })
  return out
}

const crossings = computed(() => {
  if (!payload.value) return []
  return buildCrossingsForDirection(direction.value)
})

const mapPins = computed(() => {
  const p = payload.value
  if (!p?.byRoute) return []
  const list = crossings.value
  const pins = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const key = it.k
    let pos = null
    if (key === 'gwb') pos = getAnchorByKey('gwb')
    else {
      const rid = it.routeId
      const num = Number(rid)
      if (num === 217) pos = getAnchorByKey('bay217')
      else if (num === 222) pos = getAnchorByKey('bay222')
      else if (num === 87) pos = getAnchorByKey('goe87')
      else if (num === 86) pos = getAnchorByKey('goe86')
      else if (num === 260) pos = getAnchorByKey('out260')
      else if (num === 2520) pos = getAnchorByKey('out2520')
    }
    if (!pos) continue
    const r = it.liveRow
    const tmin = r ? travelMin(r) : null
    const mStr = tmin == null || (r && /** @type {any} */(r).isCrossingClosed) ? '—' : String(Math.round(tmin))
    const ridForTrend = r && /** @type {any} */(r).routeId != null ? String(/** @type {any} */(r).routeId) : it.routeId
    const tr = ridForTrend && p.byRoute?.[ridForTrend]?.trend
    const trendKey =
      tr === 'worse' ? 'worse' : tr === 'better' ? 'better' : tr === 'neutral' ? 'neutral' : 'unk'
    const trendIcon = trendKey === 'worse' ? '▲' : trendKey === 'better' ? '▼' : trendKey === 'neutral' ? '—' : '·'
    const trendFull = 'vs prior 5 min sample'
    pins.push({
      id: key,
      lat: pos[0],
      lng: pos[1],
      title: (it.sublabel ? `${it.title}` : it.title).slice(0, 32),
      minutes: mStr,
      trendKey,
      trendIcon,
      trendFull,
      isPick: i === 0,
      isClosed: !!(r && /** @type {any} */(r).isCrossingClosed),
      rank: i + 1,
    })
  }
  return pins
})

/**
 * @param {unknown} row
 */
function seriesFor(row) {
  if (!row || typeof row !== 'object' || !payload.value?.byRoute) return []
  const id = String(/** @type {any} */(row).routeId)
  if (!id) return []
  const s = /** @type {any} */(payload.value).byRoute[id]?.series
  return Array.isArray(s) ? s : []
}

/**
 * @param {Array<{ m: number }>} points
 */
function sparkPathD(points) {
  if (!Array.isArray(points) || points.length < 1) return ''
  const n0 = points.length
  const maxN = Math.min(MAX_SPARK, n0)
  const p = []
  for (let k = 0; k < maxN; k++) {
    p.push(
      points[Math.min(n0 - 1, Math.round((k * (n0 - 1)) / Math.max(1, maxN - 1)))],
    )
  }
  const w = 100
  const h = 20
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

async function load() {
  const gen = ++tick
  error.value = ''
  if (!payload.value) loading.value = true
  try {
    const data = await getBridgesPanynj()
    if (gen === tick) payload.value = data
  } catch (e) {
    if (gen === tick) {
      error.value = e instanceof Error ? e.message : 'Failed to load'
    }
  } finally {
    if (gen === tick) loading.value = false
  }
}

/**
 * @param {string} id
 */
function onMapPick(id) {
  highlightKey.value = id
  void nextTick(() => {
    document.getElementById(`bx-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

watch(direction, () => {
  highlightKey.value = ''
})
watch(
  () => highlightKey.value,
  (h) => {
    if (h && !mapPins.value.some((p) => p.id === h)) highlightKey.value = ''
  },
)

onMounted(() => {
  updateSplit()
  if (typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia('(min-width: 900px) and (orientation: landscape)')
    mql.addEventListener('change', onMql)
  }
  void load()
  intervalId = setInterval(() => {
    void load()
  }, POLL_MS)
})
onUnmounted(() => {
  if (mql) mql.removeEventListener('change', onMql)
  if (intervalId) clearInterval(intervalId)
})
</script>

<template>
  <div class="bpg" :class="{ 'bpg--split': isSplit }">
    <section v-if="!isSplit" class="bpg-map" aria-label="Map">
      <BridgesMap
        v-if="payload"
        :pins="mapPins"
        :highlight-id="highlightKey"
        :fill-height="false"
        :travel-direction="direction"
        @select="onMapPick"
      />
      <div v-else class="bpg-map-ph">Loading map…</div>
    </section>
    <div class="bpg-main">
      <header class="bpg-head">
        <h1 class="bpg-title">Bridges</h1>
        <p v-if="payload?.fetchError" class="bpg-warn" role="status">{{ payload.fetchError }}</p>
        <p v-else class="bpg-sub">
          <span>Fastest first</span>
          <span v-if="payload?.fetchedAt" class="bpg-sub-muted"> · {{ fmtTime(payload.fetchedAt) }}</span>
        </p>
        <div class="bpg-tog" role="group" aria-label="Direction">
          <button
            type="button"
            class="bpg-btn tap"
            :class="{ 'bpg-btn--on': direction === 'ToNY' }"
            @click="direction = 'ToNY'"
          >To NY</button>
          <button
            type="button"
            class="bpg-btn tap"
            :class="{ 'bpg-btn--on': direction === 'ToNJ' }"
            @click="direction = 'ToNJ'"
          >To NJ</button>
        </div>
      </header>
      <p v-if="error" class="bpg-err">{{ error }}</p>
      <div v-if="loading && !payload" class="bpg-skel" aria-busy="true">Loading…</div>
      <div v-else class="bpg-panel">
        <h2 v-if="crossings.length" class="bpg-h2">Crossings</h2>
        <p v-else class="bpg-empty">No crossings</p>
        <ul class="bpg-list" aria-label="Bridge times">
          <li
            v-for="(it, idx) in crossings"
            :id="`bx-${it.k}`"
            :key="it.k"
            class="bpg-card"
            :class="{
              'bpg-card--hi': highlightKey === it.k,
              'bpg-card--best': idx === 0,
            }"
            @click="onMapPick(it.k)"
          >
            <div class="bpg-card-t">
              <span class="bpg-rank" aria-hidden="true">{{ idx + 1 }}</span>
              <div class="bpg-titles">
                <h3 class="bpg-h3">{{ it.title }}</h3>
                <p v-if="it.sublabel" class="bpg-sublab">{{ it.sublabel }} min (upper / lower)</p>
              </div>
            </div>
            <div class="bpg-card-m">
              <span v-if="it.liveRow && /** @type {any} */(it.liveRow).isCrossingClosed" class="bpg-mins bpg-mins--na">—</span>
              <span v-else class="bpg-mins">
                {{ travelMin(it.liveRow) != null ? String(Math.round(/** @type {number} */(travelMin(it.liveRow)))) : '—' }}
                <span class="bpg-mu">min</span>
              </span>
              <span
                v-if="it.liveRow && /** @type {any} */(it.liveRow).routeSpeed != null"
                class="bpg-mph"
              >{{ (/** @type {any} */(it.liveRow)).routeSpeed }} mph</span>
            </div>
            <div v-if="it.liveRow && seriesFor(it.liveRow).length" class="bpg-spark">
              <svg
                class="bpg-spark-svg"
                viewBox="0 0 100 20"
                width="100%"
                height="20"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  v-if="sparkPathD(seriesFor(it.liveRow))"
                  :d="sparkPathD(seriesFor(it.liveRow))"
                  fill="none"
                  stroke="rgba(167,139,250,0.55)"
                  stroke-width="1.5"
                />
              </svg>
            </div>
          </li>
        </ul>
      </div>
    </div>
    <section v-if="isSplit" class="bpg-map bpg-map--right" aria-label="Map">
      <BridgesMap
        v-if="payload"
        :pins="mapPins"
        :highlight-id="highlightKey"
        :fill-height="true"
        :travel-direction="direction"
        @select="onMapPick"
      />
      <div v-else class="bpg-map-ph">Loading map…</div>
    </section>
  </div>
</template>

<style scoped>
.bpg {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  color: #f0eef7;
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0));
  box-sizing: border-box;
}
.bpg--split {
  flex-direction: row;
  align-items: stretch;
}
.bpg--split .bpg-main {
  flex: 1 1 24rem;
  min-width: 0;
  max-width: 28rem;
  overflow-y: auto;
  border-right: 1px solid #26262e;
}
.bpg--split .bpg-map--right {
  flex: 1.2 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bpg-map :deep(.bmap) {
  min-height: min(38vh, 16rem);
  flex: 0 0 auto;
}
.bpg--split .bpg-map--right :deep(.bmap) {
  min-height: 0;
  flex: 1;
  height: 100%;
}
.bpg-map-ph {
  min-height: 11rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0e;
  color: #6e6e7e;
  font-size: 0.9rem;
}
.bpg:not(.bpg--split) {
  padding-left: max(0.5rem, env(safe-area-inset-left));
  padding-right: max(0.5rem, env(safe-area-inset-right));
  padding-top: 0.5rem;
}
.bpg-main {
  max-width: 40rem;
  width: 100%;
  margin-inline: auto;
  box-sizing: border-box;
  padding: 0 0.65rem 0.75rem;
  flex: 0 0 auto;
}
.bpg-head {
  margin-bottom: 0.5rem;
}
.bpg-title {
  margin: 0 0 0.2rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #f4f4f8;
}
.bpg-warn {
  color: #fbbf24;
  font-size: 0.7rem;
  margin: 0 0 0.25rem;
}
.bpg-sub {
  margin: 0 0 0.4rem;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #7a7a8c;
  font-weight: 700;
}
.bpg-sub-muted {
  color: #5a5a6a;
  font-weight: 600;
}
.bpg-tog {
  display: flex;
  gap: 0.4rem;
}
.bpg-btn {
  flex: 1;
  min-height: 2.6rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(123, 77, 181, 0.4);
  background: rgba(0, 0, 0, 0.4);
  color: #8e8e9c;
  font-size: 0.85rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.bpg-btn--on {
  background: linear-gradient(160deg, rgba(123, 77, 181, 0.5), rgba(50, 30, 100, 0.45));
  color: #faf5ff;
  border-color: rgba(199, 168, 255, 0.5);
}
.bpg-err {
  color: #f87171;
  font-size: 0.8rem;
  margin: 0 0 0.4rem;
}
.bpg-skel {
  color: #8b8b9a;
  padding: 0.5rem 0;
}
.bpg-panel {
  border: 1px solid #26262e;
  border-radius: 14px;
  background: #0c0c10;
  padding: 0.5rem 0.45rem 0.6rem;
}
.bpg-h2 {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #6e6e7e;
  margin: 0 0 0.4rem 0.2rem;
  font-weight: 800;
}
.bpg-empty {
  color: #6e6e7e;
  font-size: 0.8rem;
  margin: 0.25rem 0.2rem 0.15rem;
}
.bpg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.bpg-card {
  border-radius: 10px;
  border: 1px solid #2a2a32;
  background: linear-gradient(180deg, #12121a, #0d0d11);
  padding: 0.5rem 0.55rem;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.bpg-card--best {
  border-color: rgba(52, 211, 153, 0.4);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.1);
}
.bpg-card--hi {
  border-color: rgba(167, 139, 250, 0.5);
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.2);
}
.bpg-card-t {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}
.bpg-rank {
  min-width: 1.1rem;
  text-align: center;
  font-size: 0.6rem;
  font-weight: 800;
  color: #5c5c6c;
  background: #18181e;
  border: 1px solid #2e2e36;
  border-radius: 4px;
  line-height: 1.2;
  padding: 0.1rem 0.15rem;
}
.bpg-card--best .bpg-rank {
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.3);
}
.bpg-titles {
  min-width: 0;
  flex: 1;
}
.bpg-h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 800;
  line-height: 1.25;
  color: #ebe6f2;
  word-wrap: break-word;
}
.bpg-sublab {
  margin: 0.1rem 0 0 0;
  font-size: 0.6rem;
  color: #8a8a9a;
  line-height: 1.2;
  font-weight: 600;
}
.bpg-card-m {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.05rem;
}
.bpg-mins {
  font-size: 1.65rem;
  font-weight: 900;
  color: #e0d8f8;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.bpg-mins--na {
  color: #6b6b78;
}
.bpg-card--best .bpg-mins:not(.bpg-mins--na) {
  color: #c4f4dd;
}
.bpg-mu {
  font-size: 0.5rem;
  text-transform: uppercase;
  color: #7a7a88;
  margin-left: 0.15rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  vertical-align: 0.15em;
}
.bpg-mph {
  font-size: 0.65rem;
  color: #5e5e6e;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.bpg-spark {
  margin-top: 0.25rem;
  opacity: 0.9;
  border-top: 1px solid #1e1e25;
  padding-top: 0.2rem;
}
.bpg-spark-svg {
  display: block;
  max-width: 100%;
}
</style>
