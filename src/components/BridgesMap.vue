<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = Object.freeze([40.64, -74.18])
const DEFAULT_ZOOM = 9

const props = defineProps({
  /** @type {import('vue').PropType<Array<{
   *  id: string, lat: number, lng: number, title: string, minutes: string, trendIcon: string,
   *  trendKey: 'worse' | 'better' | 'neutral' | 'unk',
   *  trendFull: string, isPick: boolean, isClosed: boolean, rank: number
   * }>>} */
  pins: { type: Array, required: true },
  /** To NY vs To NJ — when this changes, map re-fits to the current direction’s bridges */
  travelDirection: {
    type: String,
    default: 'ToNY',
    /** @param {string} v */
    validator: (v) => v === 'ToNY' || v === 'ToNJ',
  },
  /** Selected routeId */
  highlightId: { type: String, default: '' },
  fillHeight: { type: Boolean, default: false },
})

const emit = defineEmits(['select'])

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
/**
 * Road traffic (Google map tiles) — not official API; may 403 in some regions; optional toggle.
 * @type {L.TileLayer | null}
 */
let trafficLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
const trafficOn = ref(true)
/** @type {L.LayerGroup | null} */
let markerLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {L.CircleMarker | null} */
let userMarker = null
/** @type {L.Circle | null} */
let userAccuracyCircle = null
/** @type {Map<string, L.Marker>} */
const markersById = new Map()

/** Sorted route id list — when this changes, we fit bounds to pins (e.g. To NY ↔ To NJ) */
let lastStructureKey = ''

const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */(null),
)
const geoTracking = ref(false)
const geoPending = ref(false)
const geoDenied = ref(false)
/** @type {number | null} */
let geoWatchId = null

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * @param {string} s
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {import('vue').UnwrapRef<typeof props>['pins'][0]} p
 * @param {boolean} selected
 */
function pinHtml(p, selected) {
  const tk = p.trendKey || 'unk'
  const cls = [
    'bridge-mrk',
    p.isPick ? 'bridge-mrk--best' : '',
    p.isClosed ? 'is-closed' : '',
    selected ? 'is-selected' : '',
    tk === 'worse' ? 't-worse' : tk === 'better' ? 't-better' : tk === 'neutral' ? 't-neut' : 't-unk',
  ]
    .filter(Boolean)
    .join(' ')
  return `<div class="${cls}">
  <div class="bridge-mrk__row1">
    <span class="bridge-mrk__rank" aria-hidden="true">${p.rank}</span>
    <span class="bridge-mrk__t" title="${esc(p.trendFull)}">${esc(p.trendIcon || '·')}</span>
  </div>
  <div class="bridge-mrk__time"><span class="bridge-mrk__min">${esc(p.minutes)}</span><span class="bridge-mrk__suf">m</span></div>
  <div class="bridge-mrk__name">${esc(p.title)}</div>
</div><div class="bridge-mrk__stem" aria-hidden="true"></div>`
}

function getStructureKey() {
  return props.pins
    .map((p) => String(p.id))
    .slice()
    .sort()
    .join('|')
}

function allBoundsLatLngs() {
  /** @type {L.LatLng[]} */
  const pts = []
  for (const p of props.pins) {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    pts.push(L.latLng(la, ln))
  }
  const u = userFix.value
  if (u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
    pts.push(L.latLng(u.lat, u.lng))
  }
  return pts
}

function applyFitToPins() {
  if (!map) return
  const motion = prefersReducedMotion()
  const pts = allBoundsLatLngs()
  if (pts.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    return
  }
  if (pts.length === 1) {
    map.setView(pts[0], 10, { animate: !motion })
    return
  }
  const bounds = L.latLngBounds(pts)
  map.fitBounds(bounds, {
    padding: [28, 28],
    maxZoom: 12,
    animate: !motion,
  })
}

function applyTrafficToMap() {
  if (!map || !trafficLayer || !streetLayer) return
  const on = trafficOn.value && activeBaseLayer.value === 'street'
  if (on) {
    if (!map.hasLayer(trafficLayer)) {
      map.addLayer(trafficLayer)
    }
  } else if (map.hasLayer(trafficLayer)) {
    map.removeLayer(trafficLayer)
  }
}

function setBaseLayer(mode) {
  if (!map || !streetLayer || !satelliteLayer) return
  activeBaseLayer.value = mode
  if (mode === 'satellite') {
    map.removeLayer(streetLayer)
    if (trafficLayer && map.hasLayer(trafficLayer)) {
      map.removeLayer(trafficLayer)
    }
    satelliteLayer.addTo(map)
  } else {
    map.removeLayer(satelliteLayer)
    streetLayer.addTo(map)
  }
  applyTrafficToMap()
}

function toggleTraffic() {
  trafficOn.value = !trafficOn.value
  applyTrafficToMap()
}

function syncUserOverlay() {
  if (!map || !userLayer) return
  const u = userFix.value
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) {
    if (userMarker) {
      userLayer.removeLayer(userMarker)
      userMarker = null
    }
    if (userAccuracyCircle) {
      userLayer.removeLayer(userAccuracyCircle)
      userAccuracyCircle = null
    }
    return
  }
  const ll = L.latLng(u.lat, u.lng)
  const acc =
    Number.isFinite(u.accuracyM) && u.accuracyM > 0 ? u.accuracyM : 40
  if (userAccuracyCircle) {
    userAccuracyCircle.setLatLng(ll)
    userAccuracyCircle.setRadius(acc)
  } else {
    userAccuracyCircle = L.circle(ll, {
      radius: acc,
      color: '#34d399',
      fillColor: '#34d399',
      fillOpacity: 0.1,
      weight: 1,
      opacity: 0.4,
    }).addTo(userLayer)
  }
  if (!userMarker) {
    userMarker = L.circleMarker(ll, {
      radius: 6,
      stroke: true,
      color: '#34d399',
      weight: 2.5,
      fillColor: '#fff',
      fillOpacity: 1,
    })
    userMarker.bindTooltip('You', { direction: 'top' })
    userMarker.addTo(userLayer)
  } else {
    userMarker.setLatLng(ll)
  }
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean }} [o]
 */
function applyGeo(pos, o = {}) {
  const fitCamera = o.fitCamera !== false
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = { lat, lng, accuracyM: Number.isFinite(acc) ? acc : 40 }
  geoDenied.value = false
  geoPending.value = false
  syncUserOverlay()
  if (map && fitCamera) {
    const motion = prefersReducedMotion()
    const pts = allBoundsLatLngs()
    if (pts.length < 1) return
    if (pts.length === 1) {
      map.setView(pts[0], 10, { animate: !motion })
    } else {
      map.fitBounds(L.latLngBounds(pts), {
        padding: [40, 40],
        maxZoom: 12,
        animate: !motion,
      })
    }
  }
}

function clearGeoWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

function stopTracking() {
  clearGeoWatch()
  geoTracking.value = false
  geoPending.value = false
  userFix.value = null
  syncUserOverlay()
}

function toggleMyLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    geoDenied.value = true
    return
  }
  if (geoTracking.value) {
    stopTracking()
    return
  }
  geoPending.value = true
  geoDenied.value = false
  geoTracking.value = true
  navigator.geolocation.getCurrentPosition(
    (p) => {
      applyGeo(p, { fitCamera: true })
      if (typeof navigator === 'undefined' || !navigator.geolocation) return
      geoWatchId = navigator.geolocation.watchPosition(
        (x) => applyGeo(x, { fitCamera: false }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
      )
    },
    () => {
      geoPending.value = false
      geoDenied.value = true
      geoTracking.value = false
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  )
}

/**
 * @param {import('vue').UnwrapRef<typeof props>['pins'][0]} p
 * @param {boolean} selected
 */
function makeIcon(p, selected) {
  return L.divIcon({
    className: 'bridge-map-div-icon',
    html: pinHtml(p, selected),
    iconSize: [100, 72],
    iconAnchor: [50, 80],
  })
}

function syncMarkers() {
  if (!map || !markerLayer) return

  const sk = `${getStructureKey()}::${String(props.travelDirection)}`
  const structChanged = sk !== lastStructureKey

  const wantIds = new Set(props.pins.map((p) => String(p.id)))
  const motion = prefersReducedMotion()

  for (const p of props.pins) {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    const id = String(p.id)
    const selected = props.highlightId === id
    const ll = L.latLng(la, ln)
    const icon = makeIcon(/** @type {any} */(p), selected)
    const existing = markersById.get(id)
    if (existing) {
      if (existing.getLatLng().lat !== la || existing.getLatLng().lng !== ln) {
        existing.setLatLng(ll)
      }
      existing.setIcon(icon)
    } else {
      const marker = L.marker(ll, { icon, title: p.title })
      marker.on('click', () => emit('select', id))
      marker.addTo(markerLayer)
      markersById.set(id, marker)
    }
  }

  for (const [id, mk] of [...markersById]) {
    if (wantIds.has(id)) continue
    markerLayer.removeLayer(mk)
    markersById.delete(id)
  }

  lastStructureKey = sk

  if (structChanged) {
    applyFitToPins()
  } else if (props.highlightId) {
    const m = markersById.get(props.highlightId)
    if (m) map.panTo(m.getLatLng(), { animate: !motion })
  }

  nextTick(() => {
    map?.invalidateSize()
  })
}

function initMap() {
  if (!containerRef.value) return
  map = L.map(containerRef.value, { zoomControl: true, scrollWheelZoom: true })
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  )
  /** Road traffic color overlay (Google-style raster). Not a licensed API. */
  trafficLayer = L.tileLayer(
    'https://{s}.google.com/vt/lyrs=traffic&x={x}&y={y}&z={z}&hl=en',
    {
      subdomains: 'mt0 mt1 mt2 mt3',
      maxZoom: 20,
      opacity: 0.8,
    },
  )
  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri, Maxar', maxZoom: 19 },
  )
  activeBaseLayer.value = 'street'
  streetLayer.addTo(map)
  applyTrafficToMap()
  markerLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)
  lastStructureKey = ''
  syncMarkers()
  nextTick(() => {
    map?.invalidateSize()
  })
}

function destroyMap() {
  clearGeoWatch()
  markersById.clear()
  userMarker = null
  userAccuracyCircle = null
  if (map) {
    map.remove()
    map = null
  }
  markerLayer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
  trafficLayer = null
  lastStructureKey = ''
}

let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    initMap()
    if (props.fillHeight && containerRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => map?.invalidateSize())
      })
      resizeObserver.observe(containerRef.value)
    }
  })
})

onBeforeUnmount(() => {
  if (resizeObserver && containerRef.value) {
    resizeObserver.unobserve(containerRef.value)
  }
  resizeObserver = null
  destroyMap()
})

watch(
  () => [props.pins, props.highlightId, props.travelDirection, props.fillHeight],
  () => {
    syncMarkers()
    syncUserOverlay()
  },
  { deep: true },
)
</script>

<template>
  <div
    class="bridge-map-root"
    :class="{ 'is-fill': fillHeight }"
    role="region"
    aria-label="Bridge times map"
  >
    <div ref="containerRef" class="bridge-map-el" />
    <div class="bridge-map-controls">
      <button
        type="button"
        class="bridge-map-traffic tap"
        :class="{ 'is-on': trafficOn }"
        :aria-pressed="trafficOn"
        :disabled="activeBaseLayer === 'satellite'"
        :title="activeBaseLayer === 'satellite' ? 'Traffic (street only)' : 'Live traffic (roads)'"
        @click="toggleTraffic"
      >Traff</button>
      <button
        type="button"
        class="bridge-map-layer tap"
        :class="{ 'is-sat': activeBaseLayer === 'satellite' }"
        :aria-pressed="activeBaseLayer === 'satellite'"
        title="Satellite"
        @click="setBaseLayer(activeBaseLayer === 'satellite' ? 'street' : 'satellite')"
      >Sat</button>
      <button
        type="button"
        class="bridge-map-loc tap"
        :class="{ 'is-on': geoTracking }"
        :aria-pressed="geoTracking"
        title="My location"
        @click="toggleMyLocation"
      >
        <svg
          class="ico"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
    <p v-if="activeBaseLayer === 'satellite' && trafficOn" class="bridge-map-footnote" role="note"
    >Traffic hidden on Sat — switch to map</p>
    <p v-if="geoPending" class="bridge-map-hint">Location…</p>
    <p v-else-if="geoDenied" class="bridge-map-hint is-warn">Location denied</p>
  </div>
</template>

<style scoped>
.bridge-map-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: min(45vh, 20rem);
  border-radius: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: #0a0a0f;
}

.bridge-map-root.is-fill {
  min-height: 0;
  flex: 1;
  height: 100%;
}

.bridge-map-el {
  flex: 1;
  min-height: min(45vh, 20rem);
  width: 100%;
  z-index: 0;
}

.is-fill .bridge-map-el {
  min-height: 0;
  height: 100%;
}

.bridge-map-controls {
  position: absolute;
  right: 0.5rem;
  top: 0.5rem;
  z-index: 700;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  pointer-events: none;
}
.bridge-map-traffic,
.bridge-map-layer,
.bridge-map-loc {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  min-height: 2.1rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(59, 130, 246, 0.45);
  background: rgba(8, 8, 12, 0.85);
  color: #93c5fd;
  font-size: 0.48rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1.1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.bridge-map-traffic:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.bridge-map-traffic.is-on {
  background: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.4);
  color: #bfdbfe;
}
.bridge-map-layer,
.bridge-map-loc {
  border: 1px solid rgba(123, 77, 181, 0.45);
  color: #c4b5fd;
  font-size: 0.5rem;
  font-weight: 800;
  min-height: 2.25rem;
}
.bridge-map-loc {
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.45);
}
.bridge-map-layer.is-sat,
.bridge-map-loc.is-on {
  background: rgba(123, 77, 181, 0.3);
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.3);
}
.bridge-map-loc .ico {
  width: 1.1rem;
  height: 1.1rem;
}
.bridge-map-hint,
.bridge-map-footnote {
  position: absolute;
  left: 0.5rem;
  bottom: 0.4rem;
  z-index: 700;
  margin: 0;
  font-size: 0.55rem;
  color: #6e6e80;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.55);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  max-width: 85%;
  line-height: 1.2;
  pointer-events: none;
}
.bridge-map-footnote {
  bottom: 1.75rem;
  color: #94a3b8;
  font-size: 0.52rem;
}
.bridge-map-hint.is-warn {
  color: #fb923c;
}
:deep(.leaflet-control-zoom a) {
  color: #e0e0ec !important;
  background: rgba(0, 0, 0, 0.55) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}
:deep(.leaflet-control-attribution) {
  color: #5a5a6a;
  background: rgba(0, 0, 0, 0.45) !important;
  font-size: 0.55rem;
  max-width: 60%;
}
:deep(.leaflet-container) {
  font-family: inherit;
  background: #0a0a0f;
}
:deep(.leaflet-marker-icon.bridge-map-div-icon) {
  z-index: 1 !important;
  border: none;
  background: none;
  margin: 0 !important;
  transform-origin: center bottom;
}
:deep(.bridge-mrk) {
  width: 100px;
  padding: 0.2rem 0.35rem 0.1rem;
  text-align: center;
  color: #f0eef7;
  border-radius: 0.5rem 0.5rem 0.1rem 0.5rem;
  background: linear-gradient(150deg, rgba(28, 22, 44, 0.96) 0%, rgba(8, 8, 12, 0.96) 100%);
  border: 1px solid rgba(167, 139, 250, 0.4);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset,
    0 0 20px rgba(123, 77, 181, 0.15);
  line-height: 1.1;
  transition: transform 0.12s;
}
:deep(.bridge-mrk--best) {
  border-color: rgba(52, 211, 153, 0.65);
  box-shadow:
    0 4px 18px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(52, 211, 153, 0.3),
    0 0 22px rgba(16, 185, 129, 0.35);
}
:deep(.bridge-mrk.t-worse) {
  border-color: rgba(248, 113, 113, 0.45);
}
:deep(.bridge-mrk.t-better) {
  border-color: rgba(52, 211, 153, 0.4);
}
:deep(.bridge-mrk.is-closed) {
  opacity: 0.6;
  filter: grayscale(0.5);
}
:deep(.bridge-mrk.is-selected) {
  z-index: 2;
  transform: scale(1.06);
}
:deep(.bridge-mrk__row1) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.1rem;
}
:deep(.bridge-mrk__rank) {
  font-size: 0.45rem;
  font-weight: 900;
  color: #6e6e80;
  min-width: 0.7rem;
}
:deep(.bridge-mrk--best .bridge-mrk__rank) {
  color: #6ee7b7;
}
:deep(.bridge-mrk__t) {
  font-size: 0.6rem;
  line-height: 1;
  font-weight: 900;
}
:deep(.bridge-mrk__time) {
  font-size: 1.35rem;
  font-weight: 900;
  line-height: 0.95;
  letter-spacing: -0.03em;
  color: #e8e2ff;
  text-shadow: 0 0 20px rgba(123, 77, 181, 0.45);
  font-variant-numeric: tabular-nums;
}
:deep(.bridge-mrk--best .bridge-mrk__time) {
  color: #c4f4dd;
  text-shadow: 0 0 18px rgba(52, 211, 129, 0.4);
}
:deep(.bridge-mrk__suf) {
  font-size: 0.55rem;
  font-weight: 800;
  color: #8a8a9a;
  margin-left: 0.05rem;
  vertical-align: 0.15em;
}
:deep(.bridge-mrk__name) {
  font-size: 0.5rem;
  font-weight: 800;
  color: #9a9aac;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 6.2rem;
  margin: 0.05rem auto 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
:deep(.bridge-mrk__stem) {
  width: 0;
  height: 0;
  margin: -0.1rem auto 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 9px solid rgba(167, 139, 250, 0.4);
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.4));
}
@media (prefers-reduced-motion: reduce) {
  :deep(.bridge-mrk.is-selected) {
    transform: none;
  }
}
</style>
