<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CorridorFlowMap from '../components/CorridorFlowMap.vue'
import {
  getTrafficMonitoredRoutes,
  postTrafficMonitoredRouteCreate,
  postTrafficMonitoredRoutePreview,
  postTrafficMonitoredRouteRemove,
  postTrafficMonitoredRoutesSync,
} from '../api.js'
import { useMapVehicleId } from '../composables/useMapVehicleId.js'
import { getTomtomKeyEffective } from '../stores/trafficTileKey.js'

defineOptions({ name: 'TrafficCorridorsContent' })

const POLL_MS = 60 * 1000

/** @typedef {{ lat: number, lng: number }} LatLng */
/** @typedef {{
 *   localId: string,
 *   name: string,
 *   pathPoints: LatLng[],
 *   createdAt: number,
 *   tomtomRouteId: number,
 *   status: Record<string, unknown> | null,
 *   statusOk: boolean,
 *   statusError: string | null,
 * }} MonitoredRouteRow */

const mode = ref(/** @type {'list' | 'create'} */ ('list'))
const loading = ref(false)
const error = ref('')
const configError = ref('')
/** @type {import('vue').Ref<{ ok?: boolean, fetchedAt?: number, routes?: unknown[] } | null>} */
const syncPayload = ref(null)

const selectedLocalId = ref('')

/** @type {import('vue').Ref<LatLng[]>} */
const draftWaypoints = ref([])
const draftName = ref('')
/** @type {import('vue').Ref<LatLng[]>} */
const previewPolyline = ref([])
const previewBusy = ref(false)
const createBusy = ref(false)

/** @type {ReturnType<typeof setTimeout> | null} */
let previewTimer = null

const needsTomtomKey = computed(() =>
  /tomtom api key required/i.test(String(configError.value || '')),
)

const routesList = computed(() => {
  const arr = syncPayload.value?.routes
  return Array.isArray(arr) ? arr : []
})

const selectedRoute = computed(() => {
  const id = selectedLocalId.value
  if (!id) return null
  return (
    routesList.value.find(
      (r) => r && typeof r === 'object' && /** @type {any} */ (r).localId === id,
    ) || null
  )
})

watch(
  routesList,
  (list) => {
    if (!list.length) {
      selectedLocalId.value = ''
      return
    }
    if (!selectedLocalId.value || !list.some((r) => r?.localId === selectedLocalId.value)) {
      const first = list[0]
      if (first && typeof first === 'object' && 'localId' in first) {
        selectedLocalId.value = String(/** @type {any} */ (first).localId)
      }
    }
  },
  { immediate: true },
)

const mapPolyline = computed(() => {
  const sel = selectedRoute.value
  if (!sel || typeof sel !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (sel)
  const st = o.status && typeof o.status === 'object' ? /** @type {Record<string, unknown>} */ (o.status) : null
  const rp = st?.routePathPoints
  if (Array.isArray(rp) && rp.length >= 2) {
    return rp
      .map((p) => {
        if (!p || typeof p !== 'object') return null
        const q = /** @type {Record<string, unknown>} */ (p)
        const lat = Number(q.latitude ?? q.lat)
        const lng = Number(q.longitude ?? q.lng ?? q.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return { lat, lng }
      })
      .filter(Boolean)
  }
  const pp = o.pathPoints
  if (Array.isArray(pp) && pp.length >= 2) {
    return pp
      .map((p) => {
        if (!p || typeof p !== 'object') return null
        const q = /** @type {Record<string, unknown>} */ (p)
        const lat = Number(q.lat)
        const lng = Number(q.lng ?? q.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return { lat, lng }
      })
      .filter(Boolean)
  }
  return []
})

async function loadRoutes() {
  loading.value = true
  error.value = ''
  configError.value = ''
  try {
    const r = await getTrafficMonitoredRoutes()
    if (r && typeof r === 'object' && r.ok === false) {
      configError.value =
        typeof r.error === 'string' ? r.error : 'Route monitoring unavailable'
      syncPayload.value = null
      return
    }
    syncPayload.value = /** @type {Record<string, unknown>} */ (r)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load routes'
    error.value = msg
    syncPayload.value = null
  } finally {
    loading.value = false
  }
}

async function pollSync() {
  if (getTomtomKeyEffective().trim().length === 0) return
  if (!routesList.value.length) return
  try {
    const r = await postTrafficMonitoredRoutesSync()
    if (r && typeof r === 'object' && r.ok !== false) {
      syncPayload.value = /** @type {Record<string, unknown>} */ (r)
    }
  } catch {
    /* non-fatal poll */
  }
}

/** @type {ReturnType<typeof setInterval> | null>} */
let intervalId = null

onMounted(() => {
  void loadRoutes()
  intervalId = setInterval(() => void pollSync(), POLL_MS)
})

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
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

function fmtMeters(m) {
  const n = Number(m)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`
  return `${Math.round(n)} m`
}

/**
 * @param {unknown} row
 */
function routeStatusLabel(row) {
  if (!row || typeof row !== 'object') return '—'
  const st = /** @type {Record<string, unknown>} */ (row).status
  if (!st || typeof st !== 'object') return '—'
  const s = st.routeStatus
  return typeof s === 'string' ? s : '—'
}

/**
 * @param {unknown} row
 */
function routeSummaryCards(row) {
  if (!row || typeof row !== 'object') return []
  const st = /** @type {Record<string, unknown>} */ (row).status
  if (!st || typeof st !== 'object') return []
  const tt = st.travelTime
  const delay = st.delayTime
  const typical = st.typicalTravelTime
  const len = st.routeLength
  const complete = st.completeness
  const pass = st.passable
  const cards = [
    {
      key: 'tt',
      lab: 'Travel time',
      val: fmtSec(tt),
      sub: 'Current (Route Monitoring)',
    },
    {
      key: 'delay',
      lab: 'Delay',
      val: fmtSec(delay),
      sub: 'vs free-flow traffic',
    },
    {
      key: 'typ',
      lab: 'Typical time',
      val: fmtSec(typical),
      sub: 'Speed profiles / typical',
    },
    {
      key: 'len',
      lab: 'Route length',
      val: fmtMeters(len),
      sub: 'Along monitored path',
    },
  ]
  if (Number.isFinite(Number(complete))) {
    cards.push({
      key: 'cov',
      lab: 'Live coverage',
      val: `${Math.round(Number(complete))}%`,
      sub: 'Traffic data completeness',
    })
  }
  if (typeof pass === 'boolean') {
    cards.push({
      key: 'pass',
      lab: 'Passable',
      val: pass ? 'Yes' : 'No',
      sub: 'TomTom route status',
    })
  }
  return cards
}

/**
 * @param {unknown} data
 * @returns {LatLng[]}
 */
function polylineFromTomTomPreview(data) {
  if (!data || typeof data !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (data)
  const candidates = [o.routedPathPoints, o.pathPoints, o.routePathPoints]
  for (const c of candidates) {
    if (!Array.isArray(c) || c.length < 2) continue
    const out = []
    for (const p of c) {
      if (!p || typeof p !== 'object') continue
      const q = /** @type {Record<string, unknown>} */ (p)
      const lat = Number(q.latitude ?? q.lat)
      const lng = Number(q.longitude ?? q.lng ?? q.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      out.push({ lat, lng })
    }
    if (out.length >= 2) return out
  }
  return []
}

/**
 * @param {LatLng[]} pts
 */
function schedulePreview(pts) {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => void runPreview(pts), 450)
}

async function runPreview(pts) {
  if (pts.length < 2) {
    previewPolyline.value = []
    return
  }
  if (getTomtomKeyEffective().trim().length === 0) return
  previewBusy.value = true
  try {
    const r = await postTrafficMonitoredRoutePreview({ pathPoints: pts })
    if (r && typeof r === 'object' && r.ok === true && r.preview) {
      previewPolyline.value = polylineFromTomTomPreview(r.preview)
    } else {
      previewPolyline.value = []
    }
  } catch {
    previewPolyline.value = []
  } finally {
    previewBusy.value = false
  }
}

/**
 * @param {LatLng[]} next
 */
function onWaypointsChange(next) {
  draftWaypoints.value = Array.isArray(next) ? next : []
}

watch(
  () => draftWaypoints.value,
  (pts) => {
    if (mode.value !== 'create') return
    schedulePreview(pts)
  },
  { deep: true },
)

function startCreate() {
  mode.value = 'create'
  draftWaypoints.value = []
  draftName.value = ''
  previewPolyline.value = []
}

function cancelCreate() {
  mode.value = 'list'
  draftWaypoints.value = []
  previewPolyline.value = []
}

function clearDraftPoints() {
  draftWaypoints.value = []
  previewPolyline.value = []
}

async function submitCreate() {
  const pts = draftWaypoints.value
  if (pts.length < 2) {
    error.value = 'Add at least two points on the map (tap to add, drag to adjust).'
    return
  }
  const name = draftName.value.trim() || 'Monitored route'
  createBusy.value = true
  error.value = ''
  try {
    const r = await postTrafficMonitoredRouteCreate({ name, pathPoints: pts })
    if (r && typeof r === 'object' && r.ok === true) {
      cancelCreate()
      await loadRoutes()
      const route = r.route && typeof r.route === 'object' ? /** @type {any} */ (r.route) : null
      if (route?.localId) selectedLocalId.value = String(route.localId)
    } else {
      error.value =
        r && typeof r === 'object' && typeof r.error === 'string'
          ? r.error
          : 'Could not create route'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create route'
  } finally {
    createBusy.value = false
  }
}

async function removeSelected() {
  const sel = selectedRoute.value
  if (!sel || typeof sel !== 'object') return
  const id = String(/** @type {any} */ (sel).localId || '')
  if (!id) return
  if (typeof window !== 'undefined' && !window.confirm('Remove this monitored route from TomTom and this account?')) {
    return
  }
  try {
    await postTrafficMonitoredRouteRemove(id)
    selectedLocalId.value = ''
    await loadRoutes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Remove failed'
  }
}
</script>

<template>
  <div class="corridor-page">
    <div class="corridor-map-column">
      <div class="corridor-map-shell">
        <CorridorFlowMap
          v-if="mode === 'list'"
          :polyline="mapPolyline"
          :segments="[]"
          :vehicle-id="mapVehicleId"
          fill-height
        />
        <CorridorFlowMap
          v-else
          edit-mode
          :waypoints="draftWaypoints"
          :preview-polyline="previewPolyline"
          :vehicle-id="mapVehicleId"
          fill-height
          @waypoints-change="onWaypointsChange"
        />
      </div>
    </div>

    <div class="corridor-list-column">
      <div class="corridor-list-inner">
        <div class="corridor-bar">
          <h1 class="corridor-h1">Route monitoring</h1>
          <p class="corridor-sub">
            TomTom Route Monitoring — create routes from waypoints, then poll live travel time and delay
            (<a
              class="corridor-doc-link"
              href="https://developer.tomtom.com/route-monitoring/documentation/routes-service/routes"
              target="_blank"
              rel="noopener noreferrer"
            >API docs</a>).
          </p>
          <p v-if="syncPayload?.fetchedAt" class="corridor-time">
            Updated {{ fmtTime(syncPayload.fetchedAt) }}
          </p>
        </div>

        <div class="corridor-mode-row" role="tablist" aria-label="Corridor mode">
          <button
            type="button"
            class="corridor-mode-btn tap"
            :class="{ 'is-on': mode === 'list' }"
            @click="mode = 'list'"
          >My routes</button>
          <button
            type="button"
            class="corridor-mode-btn tap"
            :class="{ 'is-on': mode === 'create' }"
            @click="startCreate"
          >New route</button>
        </div>

        <p v-if="configError" class="corridor-warn" role="status">{{ configError }}</p>
        <p v-if="needsTomtomKey" class="corridor-setup-hint">
          <RouterLink class="corridor-setup-link tap" :to="{ name: 'settings', hash: '#tomtom' }">
            Open Settings → TomTom key
          </RouterLink>
          <span class="corridor-setup-sub">Route Monitoring and map tiles use the same key.</span>
        </p>
        <p v-else-if="error" class="corridor-err" role="alert">{{ error }}</p>

        <template v-if="mode === 'create'">
          <div class="corridor-create-panel">
            <label class="corridor-lbl" for="mr-name">Route name</label>
            <input
              id="mr-name"
              v-model="draftName"
              class="corridor-inp tap"
              type="text"
              maxlength="120"
              placeholder="e.g. Caton → Conduit"
              autocomplete="off"
            />
            <p class="corridor-hint">
              Tap the map to drop waypoints (start green). Drag pins to adjust. Preview updates after you pause.
              <span v-if="previewBusy" class="corridor-inline-status">Preview…</span>
            </p>
            <div class="corridor-create-actions">
              <button type="button" class="corridor-btn tap" :disabled="createBusy" @click="clearDraftPoints">
                Clear points
              </button>
              <button type="button" class="corridor-btn tap" :disabled="createBusy" @click="cancelCreate">
                Cancel
              </button>
              <button
                type="button"
                class="corridor-btn corridor-btn--primary tap"
                :disabled="createBusy || draftWaypoints.length < 2"
                @click="submitCreate"
              >
                {{ createBusy ? 'Creating…' : 'Create monitored route' }}
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <p v-if="loading && !syncPayload" class="corridor-skel" aria-busy="true">Loading…</p>
          <template v-else-if="!routesList.length">
            <p class="corridor-empty">No monitored routes yet. Use <strong>New route</strong> to draw one.</p>
          </template>
          <template v-else>
            <h2 class="corridor-h2">Your routes</h2>
            <ul class="corridor-route-pick" aria-label="Select route">
              <li v-for="r in routesList" :key="String(r?.localId)">
                <button
                  v-if="r && typeof r === 'object'"
                  type="button"
                  class="corridor-route-pill tap"
                  :class="{ 'is-sel': r.localId === selectedLocalId }"
                  @click="selectedLocalId = String(r.localId)"
                >
                  <span class="corridor-route-pill-name">{{ r.name || 'Route' }}</span>
                  <span class="corridor-route-pill-meta">{{ routeStatusLabel(r) }}</span>
                </button>
              </li>
            </ul>

            <div v-if="selectedRoute && typeof selectedRoute === 'object'" class="corridor-detail">
              <div class="corridor-detail-head">
                <h2 class="corridor-h2">{{ selectedRoute.name || 'Route' }}</h2>
                <button type="button" class="corridor-btn corridor-btn--danger tap" @click="removeSelected">
                  Remove
                </button>
              </div>
              <p v-if="selectedRoute.statusError" class="corridor-status-err" role="status">
                {{ selectedRoute.statusError }}
              </p>
              <p v-else-if="selectedRoute.statusOk === false" class="corridor-status-err" role="status">
                No live status yet (route may be NEW or processing).
              </p>

              <ul
                v-if="routeSummaryCards(selectedRoute).length"
                class="corridor-summary-grid"
                aria-label="Route summary"
              >
                <li
                  v-for="c in routeSummaryCards(selectedRoute)"
                  :key="c.key"
                  class="corridor-card corridor-card--summary"
                >
                  <span class="corridor-card-lab">{{ c.lab }}</span>
                  <span class="corridor-card-val">{{ c.val }}</span>
                  <span class="corridor-card-sub">{{ c.sub }}</span>
                </li>
              </ul>
            </div>
          </template>
        </template>
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

.corridor-doc-link {
  color: #a78bfa;
}

.corridor-time {
  margin: 0.35rem 0 0;
  font-size: 0.62rem;
  color: #6e6e80;
  font-variant-numeric: tabular-nums;
}

.corridor-mode-row {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
}

.corridor-mode-btn {
  flex: 1;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.35);
  color: #9a9ab0;
  font-size: 0.65rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}

.corridor-mode-btn.is-on {
  color: #f4f4f8;
  border-color: rgba(167, 139, 250, 0.45);
  background: rgba(123, 77, 181, 0.28);
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

.corridor-setup-hint {
  margin: 0 0 0.65rem;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--color-text-secondary, #c4c4d4);
}

.corridor-setup-link {
  display: inline-block;
  margin-right: 0.35rem;
  font-weight: 650;
  color: var(--color-accent-purple, #a78bfa);
  text-decoration: none;
}

.corridor-setup-link:hover {
  text-decoration: underline;
}

.corridor-setup-sub {
  display: block;
  margin-top: 0.25rem;
  color: var(--color-text-tertiary, #8b8b9c);
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

.corridor-empty {
  margin: 0.25rem 0 0.75rem;
  font-size: 0.78rem;
  color: #8b8b9c;
  line-height: 1.4;
}

.corridor-create-panel {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.corridor-lbl {
  font-size: 0.55rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7a7a8c;
}

.corridor-inp {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.35);
  color: #f4f4f8;
  font-size: 0.85rem;
}

.corridor-hint {
  margin: 0;
  font-size: 0.58rem;
  color: #5c5c6a;
  line-height: 1.45;
}

.corridor-inline-status {
  margin-left: 0.35rem;
  color: #a78bfa;
  font-weight: 650;
}

.corridor-create-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.25rem;
}

.corridor-btn {
  padding: 0.42rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #e4e4f0;
  font-size: 0.72rem;
  font-weight: 650;
  cursor: pointer;
}

.corridor-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.corridor-btn--primary {
  border-color: rgba(167, 139, 250, 0.5);
  background: rgba(123, 77, 181, 0.35);
}

.corridor-btn--danger {
  border-color: rgba(248, 113, 113, 0.35);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.25);
}

.corridor-h2 {
  margin: 0.5rem 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #a8a8b8;
}

.corridor-route-pick {
  list-style: none;
  margin: 0 0 0.65rem;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.corridor-route-pill {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.08rem;
  padding: 0.4rem 0.55rem;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 26, 0.9);
  color: #e8e8f0;
  cursor: pointer;
  text-align: left;
  max-width: 100%;
}

.corridor-route-pill.is-sel {
  border-color: rgba(167, 139, 250, 0.55);
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.2);
}

.corridor-route-pill-name {
  font-size: 0.75rem;
  font-weight: 650;
}

.corridor-route-pill-meta {
  font-size: 0.55rem;
  color: #8b8b9c;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.corridor-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.corridor-detail-head .corridor-h2 {
  margin: 0;
}

.corridor-status-err {
  margin: 0 0 0.5rem;
  font-size: 0.72rem;
  color: #fca5a5;
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
