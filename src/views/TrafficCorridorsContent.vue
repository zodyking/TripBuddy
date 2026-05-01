<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import CorridorFlowMap from '../components/CorridorFlowMap.vue'
import { postTrafficCorridorStatus } from '../api.js'
import { useMapVehicleId } from '../composables/useMapVehicleId.js'

defineOptions({ name: 'TrafficCorridorsContent' })

const POLL_MS = 45 * 1000

/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const payload = ref(null)
const loading = ref(false)
const error = ref('')
const configError = ref('')

async function load() {
  loading.value = true
  error.value = ''
  configError.value = ''
  try {
    const r = await postTrafficCorridorStatus({})
    if (r && typeof r === 'object' && r.ok === false) {
      configError.value =
        typeof r.error === 'string' ? r.error : 'Corridor traffic unavailable'
      payload.value = null
      return
    }
    payload.value = /** @type {Record<string, unknown>} */ (r)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load corridor'
    payload.value = null
  } finally {
    loading.value = false
  }
}

/** @type {ReturnType<typeof setInterval> | null>} */
let intervalId = null

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

const { vehicleId: mapVehicleId } = useMapVehicleId()

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

function fmtSec(s) {
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 60) return `${Math.round(n)}s`
  const m = Math.floor(n / 60)
  const sec = Math.round(n % 60)
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`
}

function fmtMph(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n)}`
}

const polyline = computed(() => {
  const p = payload.value?.polyline
  return Array.isArray(p) ? p : []
})

const segments = computed(() => {
  const s = payload.value?.segments
  return Array.isArray(s) ? s : []
})

const summaryCards = computed(() => {
  const p = payload.value
  if (!p || p.ok !== true) return []
  const tt = p.totalTravelTimeSec
  const dl = p.totalDelaySec
  const cur = p.avgCurrentSpeedMph
  const ff = p.avgFreeFlowSpeedMph
  return [
    {
      key: 'tt',
      lab: 'Travel time (sum)',
      val: fmtSec(tt),
      sub: 'TomTom segment times',
    },
    {
      key: 'delay',
      lab: 'Delay vs free flow',
      val: fmtSec(dl),
      sub: 'Σ max(0, current − free)',
    },
    {
      key: 'spd',
      lab: 'Avg speed',
      val: `${fmtMph(cur)} / ${fmtMph(ff)} mph`,
      sub: 'Current · free flow',
    },
  ]
})

/**
 * @param {unknown} seg
 */
function segmentTierClass(seg) {
  if (!seg || typeof seg !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (seg)
  if (o.ok === false) return 'corridor-seg--muted'
  if (o.roadClosure === true) return 'corridor-seg--red'
  const cur = Number(o.currentSpeed)
  const ff = Number(o.freeFlowSpeed)
  if (!Number.isFinite(cur) || !Number.isFinite(ff) || ff < 8) return 'corridor-seg--orange'
  const ratio = cur / ff
  if (ratio <= 0.55) return 'corridor-seg--red'
  if (ratio <= 0.85) return 'corridor-seg--orange'
  return 'corridor-seg--green'
}
</script>

<template>
  <div class="corridor-page">
    <div class="corridor-map-column">
      <div class="corridor-map-shell">
        <CorridorFlowMap
          :polyline="polyline"
          :segments="segments"
          :vehicle-id="mapVehicleId"
          fill-height
        />
      </div>
    </div>

    <div class="corridor-list-column">
      <div class="corridor-list-inner">
        <div class="corridor-bar">
          <h1 class="corridor-h1">Corridor</h1>
          <p class="corridor-sub">
            Caton Ave → Linden Blvd → S Conduit Ave · TomTom Flow (not routing)
          </p>
          <p v-if="payload?.fetchedAt" class="corridor-time">
            Updated {{ fmtTime(payload.fetchedAt) }}
            <span v-if="payload.cacheTtlMs" class="corridor-cache"
            >· cache {{ Math.round(Number(payload.cacheTtlMs) / 1000) }}s</span>
          </p>
        </div>

        <p v-if="configError" class="corridor-warn" role="status">{{ configError }}</p>
        <p v-else-if="error" class="corridor-err" role="alert">{{ error }}</p>
        <p v-else-if="loading && !payload" class="corridor-skel" aria-busy="true">Loading…</p>

        <ul v-if="summaryCards.length" class="corridor-summary-grid" aria-label="Corridor summary">
          <li v-for="c in summaryCards" :key="c.key" class="corridor-card corridor-card--summary">
            <span class="corridor-card-lab">{{ c.lab }}</span>
            <span class="corridor-card-val">{{ c.val }}</span>
            <span class="corridor-card-sub">{{ c.sub }}</span>
          </li>
        </ul>

        <h2 class="corridor-h2">Segments</h2>
        <p class="corridor-hint">Sampled ~every 400 m along path · speeds mph</p>
        <ul class="corridor-seg-list" aria-label="Flow segments">
          <li
            v-for="(seg, si) in segments"
            :key="`seg-${si}`"
            class="corridor-card corridor-seg"
            :class="segmentTierClass(seg)"
          >
            <template v-if="seg && typeof seg === 'object'">
              <div class="corridor-seg-head">
                <span class="corridor-seg-idx">#{{ si + 1 }}</span>
                <span v-if="seg.ok === false" class="corridor-seg-err">{{ seg.error || 'No data' }}</span>
                <span v-else-if="seg.roadClosure" class="corridor-seg-err">Closed</span>
              </div>
              <template v-if="seg.ok !== false && !seg.roadClosure">
                <div class="corridor-seg-metrics">
                  <div class="corridor-kpi">
                    <span class="corridor-kpi-lab">Travel</span>
                    <span class="corridor-kpi-num">{{ fmtSec(seg.currentTravelTime) }}</span>
                  </div>
                  <div class="corridor-kpi">
                    <span class="corridor-kpi-lab">Free flow</span>
                    <span class="corridor-kpi-num corridor-kpi-num--muted">{{ fmtSec(seg.freeFlowTravelTime) }}</span>
                  </div>
                  <div class="corridor-kpi">
                    <span class="corridor-kpi-lab">Speed</span>
                    <span class="corridor-kpi-num">{{ fmtMph(seg.currentSpeed) }}</span>
                    <span class="corridor-kpi-unit">mph</span>
                  </div>
                  <div class="corridor-kpi">
                    <span class="corridor-kpi-lab">Free</span>
                    <span class="corridor-kpi-num corridor-kpi-num--muted">{{ fmtMph(seg.freeFlowSpeed) }}</span>
                    <span class="corridor-kpi-unit">mph</span>
                  </div>
                </div>
              </template>
            </template>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.corridor-page {
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

.corridor-map-column {
  flex-shrink: 0;
  min-height: min(38vh, 17rem);
}

.corridor-map-shell {
  min-height: min(38vh, 17rem);
  height: min(38vh, 17rem);
  display: flex;
  flex-direction: column;
}

.corridor-list-column {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.corridor-list-inner {
  padding: 0.55rem var(--space-2, 0.5rem) 1rem;
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.corridor-bar {
  margin-bottom: 0.65rem;
}

.corridor-h1 {
  margin: 0;
  font-size: var(--text-sm, 0.875rem);
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #c4b5fd;
}

.corridor-sub {
  margin: 0.25rem 0 0;
  font-size: 0.68rem;
  color: var(--color-text-tertiary, #8b8b9c);
  line-height: 1.35;
}

.corridor-time {
  margin: 0.35rem 0 0;
  font-size: 0.62rem;
  color: #6e6e80;
  font-variant-numeric: tabular-nums;
}

.corridor-cache {
  opacity: 0.85;
}

.corridor-warn {
  margin: 0 0 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.35);
  color: #fcd34d;
  font-size: 0.75rem;
}

.corridor-err {
  margin: 0 0 0.5rem;
  color: #fca5a5;
  font-size: 0.8rem;
}

.corridor-skel {
  margin: 0 0 0.5rem;
  color: #9ca3af;
  font-size: 0.85rem;
}

.corridor-summary-grid {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
  gap: 0.45rem;
}

.corridor-card {
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 26, 0.92);
  padding: 0.5rem 0.55rem;
  box-sizing: border-box;
}

.corridor-card--summary {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.corridor-card-lab {
  font-size: 0.5rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8b8b9c;
}

.corridor-card-val {
  font-size: clamp(1rem, 4vw, 1.25rem);
  font-weight: 700;
  color: #ebe8f7;
  font-variant-numeric: tabular-nums;
}

.corridor-card-sub {
  font-size: 0.55rem;
  color: #6b6b78;
}

.corridor-h2 {
  margin: 0.5rem 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #a8a8b8;
}

.corridor-hint {
  margin: 0 0 0.45rem;
  font-size: 0.58rem;
  color: #5c5c6a;
}

.corridor-seg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.corridor-seg {
  border-left: 3px solid rgba(148, 163, 184, 0.4);
}

.corridor-seg--green {
  border-left-color: #4ade80;
}

.corridor-seg--orange {
  border-left-color: #fb923c;
}

.corridor-seg--red {
  border-left-color: #f87171;
}

.corridor-seg--muted {
  border-left-color: rgba(148, 163, 184, 0.35);
  opacity: 0.85;
}

.corridor-seg-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
}

.corridor-seg-idx {
  font-size: 0.58rem;
  font-weight: 800;
  color: #7b7b8c;
  font-variant-numeric: tabular-nums;
}

.corridor-seg-err {
  font-size: 0.62rem;
  color: #fca5a5;
}

.corridor-seg-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem 0.65rem;
}

.corridor-kpi {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem 0.35rem;
}

.corridor-kpi-lab {
  font-size: 0.48rem;
  font-weight: 750;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #6e6e80;
  width: 100%;
}

.corridor-kpi-num {
  font-size: 0.95rem;
  font-weight: 700;
  color: #ebe8f7;
  font-variant-numeric: tabular-nums;
}

.corridor-kpi-num--muted {
  color: #9ca3af;
  font-weight: 650;
}

.corridor-kpi-unit {
  font-size: 0.55rem;
  color: #6b7280;
  font-weight: 650;
}

@media (orientation: landscape) and (min-width: 700px) {
  .corridor-page {
    flex-direction: row;
    align-items: stretch;
    padding-left: 0;
    padding-right: 0;
    padding-top: 0;
  }

  .corridor-map-column {
    flex: 1.15 1 0;
    min-height: 0;
    border-right: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  }

  .corridor-map-shell {
    height: 100%;
    min-height: 0;
    flex: 1;
  }

  .corridor-list-column {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
  }

  .corridor-list-inner {
    overflow-y: auto;
    padding-top: 0.55rem;
    padding-left: var(--space-3, 0.75rem);
    padding-right: max(env(safe-area-inset-right, 0px), var(--space-3, 0.75rem));
  }
}
</style>
