<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { tomtomKeyEffective } from '../stores/trafficTileKey.js'
import { bridgesCrossingIcon } from '../utils/mapMarkers.js'

const DEFAULT_CENTER = Object.freeze([40.64, -74.18])
const DEFAULT_ZOOM = 9

const hasTomtomTraffic = computed(() => tomtomKeyEffective.value.length > 0)

const props = defineProps({
  /** @type {import('vue').PropType<Array<{
   *  id: string, lat: number, lng: number, title: string, shortLabel?: string, minutes: string, trendIcon: string,
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
 * TomTom Traffic raster flow (needs `VITE_TOMTOM_KEY` at build time).
 * @type {L.TileLayer | null}
 */
let trafficLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
const trafficOn = ref(false)
/** @type {L.LayerGroup | null} plain layer — no clustering (matches directory map) */
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
 */
function bridgePopupHtml(p) {
  const tk = p.trendKey || 'unk'
  const trendCls =
    tk === 'worse' ? 'is-worse' : tk === 'better' ? 'is-better' : tk === 'neutral' ? 'is-neut' : 'is-unk'
  const rank = esc(String(p.rank ?? ''))
  const trendIcon = esc(p.trendIcon || '·')
  const trendFull = esc(p.trendFull || '')
  const minutes = esc(p.minutes ?? '—')
  const title = esc(p.title ?? '')
  const cls = ['bridge-popup']
  if (p.isPick) cls.push('bridge-popup--best')
  if (p.isClosed) cls.push('bridge-popup--closed')
  cls.push(trendCls)
  return `<div class="${cls.join(' ')}">
  <div class="bridge-popup__row">
    <span class="bridge-popup__rank">#${rank}</span>
    <span class="bridge-popup__trend" title="${trendFull}">${trendIcon}</span>
  </div>
  <div class="bridge-popup__time"><span class="bridge-popup__min">${minutes}</span><span class="bridge-popup__suf">m</span></div>
  <div class="bridge-popup__name">${title}</div>
</div>`
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
    padding: [44, 52],
    maxZoom: 10,
    animate: !motion,
  })
}

function applyTrafficToMap() {
  if (!map || !streetLayer) return
  if (!trafficLayer) return
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
  if (!hasTomtomTraffic.value) return
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
        padding: [44, 52],
        maxZoom: 10,
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
  return bridgesCrossingIcon({
    trendKey: /** @type {'worse' | 'better' | 'neutral' | 'unk'} */(p.trendKey || 'unk'),
    isPick: !!p.isPick,
    isClosed: !!p.isClosed,
    selected,
    shortLabel: typeof p.shortLabel === 'string' ? p.shortLabel : '',
  })
}

function syncMarkers() {
  if (!map || !markerLayer) return

  const sk = `${getStructureKey()}::${String(props.travelDirection)}`
  const structChanged = sk !== lastStructureKey

  const wantIds = new Set(props.pins.map((p) => String(p.id)))
  const motion = prefersReducedMotion()

  if (structChanged) {
    markerLayer.clearLayers()
    markersById.clear()
  }

  for (const p of props.pins) {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    const id = String(p.id)
    const selected = props.highlightId === id
    const ll = L.latLng(la, ln)
    const icon = makeIcon(/** @type {any} */(p), selected)
    const existing = markersById.get(id)
    if (structChanged) {
      const marker = L.marker(ll, { icon, title: p.title })
      marker.bindPopup(bridgePopupHtml(/** @type {any} */(p)), {
        maxWidth: 280,
        className: 'bridge-map-popup',
      })
      marker.on('click', () => emit('select', id))
      marker.addTo(markerLayer)
      markersById.set(id, marker)
    } else if (existing) {
      if (existing.getLatLng().lat !== la || existing.getLatLng().lng !== ln) {
        existing.setLatLng(ll)
      }
      existing.setIcon(icon)
      existing.setPopupContent(bridgePopupHtml(/** @type {any} */(p)))
    } else {
      const marker = L.marker(ll, { icon, title: p.title })
      marker.bindPopup(bridgePopupHtml(/** @type {any} */(p)), {
        maxWidth: 280,
        className: 'bridge-map-popup',
      })
      marker.on('click', () => emit('select', id))
      marker.addTo(markerLayer)
      markersById.set(id, marker)
    }
  }

  if (!structChanged) {
    for (const [id, mk] of [...markersById]) {
      if (wantIds.has(id)) continue
      markerLayer.removeLayer(mk)
      markersById.delete(id)
    }
  }

  lastStructureKey = sk

  if (structChanged) {
    applyFitToPins()
  } else if (props.highlightId) {
    const m = markersById.get(props.highlightId)
    if (m) {
      map?.panTo(m.getLatLng(), { animate: !motion })
    }
  }

  nextTick(() => {
    map?.invalidateSize()
  })
}

function getTomtomKeyStr() {
  return String(tomtomKeyEffective.value || '').trim()
}

function setTrafficLayerFromKey() {
  if (!map) return
  const k = getTomtomKeyStr()
  if (trafficLayer && map.hasLayer(trafficLayer)) {
    map.removeLayer(trafficLayer)
  }
  trafficLayer = null
  if (k) {
    trafficLayer = L.tileLayer(
      `https://api.tomtom.com/traffic/map/4/tile/flow/absolute/{z}/{x}/{y}.png?key=${encodeURIComponent(
        k,
      )}&tileSize=256`,
      { maxZoom: 22, opacity: 0.28, zIndex: 400 },
    )
  }
}

function initMap() {
  if (!containerRef.value) return
  map = L.map(containerRef.value, { zoomControl: false, scrollWheelZoom: true })
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.control.zoom({ position: 'topright' }).addTo(map)
  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  )
  setTrafficLayerFromKey()
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
  if (markerLayer) {
    markerLayer.clearLayers()
  }
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

watch(tomtomKeyEffective, () => {
  if (map) {
    setTrafficLayerFromKey()
    applyTrafficToMap()
  }
})
</script>

<template>
  <div
    class="bridge-map-root"
    :class="{ 'is-fill': fillHeight }"
    role="region"
    aria-label="Bridge times map"
  >
    <div ref="containerRef" class="bridge-map-el" />
    <div class="map-controls-stack bridge-map-controls">
      <button
        type="button"
        class="map-control-btn map-control-btn--traffic map-control-btn--pill tap"
        :class="{ 'is-on': trafficOn, 'is-missing': !hasTomtomTraffic }"
        :aria-pressed="trafficOn"
        :disabled="activeBaseLayer === 'satellite' || !hasTomtomTraffic"
        :title="!hasTomtomTraffic
          ? 'Add TomTom key in Settings (free developer tier) or VITE_TOMTOM_KEY in .env'
          : (activeBaseLayer === 'satellite' ? 'Traffic (street only)' : 'Live traffic (TomTom)')"
        @click="toggleTraffic"
      >
        Traff
      </button>
      <button
        type="button"
        class="map-control-btn map-control-btn--sat tap"
        :class="{ 'is-on': activeBaseLayer === 'satellite' }"
        :aria-pressed="activeBaseLayer === 'satellite'"
        title="Satellite imagery"
        @click="setBaseLayer(activeBaseLayer === 'satellite' ? 'street' : 'satellite')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="9" ry="4" />
          <path d="M3 12h18" />
        </svg>
        <span class="sr-only">Toggle satellite view</span>
      </button>
      <button
        type="button"
        class="map-control-btn map-control-btn--loc tap"
        :class="{ 'is-on': geoTracking, 'is-denied': geoDenied }"
        :aria-pressed="geoTracking"
        :title="
          geoDenied
            ? 'Location blocked — enable location in browser settings'
            : geoTracking
              ? 'Stop showing my location'
              : 'Show my live location'
        "
        @click="toggleMyLocation"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <span class="sr-only">My location</span>
      </button>
    </div>
    <p v-if="!hasTomtomTraffic" class="bridge-map-footnote" role="note"
    >Traffic: set TomTom key in Settings, or <code class="bmk">VITE_TOMTOM_KEY</code> in <code class="bmk">.env</code> (free tier)</p>
    <p v-else-if="activeBaseLayer === 'satellite' && trafficOn" class="bridge-map-footnote" role="note"
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
  max-width: min(14rem, calc(100% - 1.5rem));
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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
}
.bmk {
  font-size: 0.9em;
  background: rgba(0, 0, 0, 0.35);
  padding: 0.05em 0.2em;
  border-radius: 2px;
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
:deep(.leaflet-popup-content-wrapper.bridge-map-popup) {
  border-radius: 10px;
  border: 1px solid rgba(167, 139, 250, 0.35);
  background: rgba(14, 14, 20, 0.96);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
}
:deep(.leaflet-popup-tip.bridge-map-popup) {
  background: rgba(14, 14, 20, 0.96);
  border: 1px solid rgba(167, 139, 250, 0.25);
}
:deep(.leaflet-popup-content-wrapper.bridge-map-popup .leaflet-popup-content) {
  margin: 0.45rem 0.55rem;
  line-height: 1.2;
}
:deep(.bridge-popup) {
  color: #e8e2ff;
  text-align: center;
  min-width: 7.5rem;
}
:deep(.bridge-popup--best) {
  filter: none;
}
:deep(.bridge-popup--closed) {
  opacity: 0.75;
}
:deep(.bridge-popup__row) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.15rem;
  font-size: 0.65rem;
  font-weight: 800;
}
:deep(.bridge-popup__rank) {
  color: #8a8a9a;
  font-variant-numeric: tabular-nums;
}
:deep(.bridge-popup--best .bridge-popup__rank) {
  color: #6ee7b7;
}
:deep(.bridge-popup__trend) {
  font-size: 0.75rem;
}
:deep(.bridge-popup.is-worse .bridge-popup__trend) {
  color: #fca5a5;
}
:deep(.bridge-popup.is-better .bridge-popup__trend) {
  color: #86efac;
}
:deep(.bridge-popup.is-neut .bridge-popup__trend) {
  color: #fde68a;
}
:deep(.bridge-popup__time) {
  font-size: 1.35rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: #ddd6fe;
  line-height: 1;
}
:deep(.bridge-popup--best .bridge-popup__time) {
  color: #a7f3d0;
}
:deep(.bridge-popup__suf) {
  font-size: 0.55rem;
  font-weight: 800;
  color: #8a8a9a;
  margin-left: 0.06rem;
}
:deep(.bridge-popup__name) {
  margin-top: 0.15rem;
  font-size: 0.55rem;
  font-weight: 800;
  color: #9a9aac;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 11rem;
}
</style>
