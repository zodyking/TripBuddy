<script setup>
import {
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
  computed,
} from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-rotate'
import { directoryBuildingIcon, userLocationTruckIcon } from '../utils/mapMarkers.js'
import { useCompassOrientation } from '../composables/useCompassOrientation.js'
import { useMapCompassLongPress } from '../composables/useMapCompassLongPress.js'
import CompassCalibrationModal from './CompassCalibrationModal.vue'
import {
  syncMapNavigationGestures,
  centerMapOnLatLng,
  applyUserTruckMarkerDomRotation,
} from '../composables/useMapFollowControls.js'

/** Default view when there are no directory pins (Manhattan). */
const DEFAULT_CENTER = Object.freeze([40.7128, -74.006])
const DEFAULT_ZOOM = 11

/**
 * @typedef {{ locationId: string, lat: number, lng: number }} MapPin
 */

const props = defineProps({
  /** @type {import('vue').PropType<MapPin[]>} */
  pins: {
    type: Array,
    required: true,
  },
  highlightId: {
    type: String,
    default: '',
  },
  /** Fill parent height (split-pane directory layout); disables fixed min-height clamp. */
  fillHeight: {
    type: Boolean,
    default: false,
  },
  /** Tractor / unit number chip under “my location” truck (optional). */
  vehicleId: { type: String, default: '' },
})

const emit = defineEmits(['select'])

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

const {
  smoothHeading,
  showCompassToggle,
  permissionState: compassPermission,
  errorMessage: compassError,
  toggleTracking: toggleCompass,
  startTracking,
} = useCompassOrientation()

const {
  calibrationModalOpen,
  openCompassCalibration,
  onCompassPointerDown,
  onCompassPointerUp,
  wrapCompassToggle,
} = useMapCompassLongPress()

const compassModeActive = ref(false)

/** Live user fix from Geolocation API (updated by watchPosition). */
const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */ (null),
)
const geoTracking = ref(false)
const geoPending = ref(false)
const geoDenied = ref(false)
/** @type {number | null} */
let geoWatchId = null
/** @type {null | (() => void)} */
let unbindTruckBearingSync = null

function syncNavigationGestures() {
  syncMapNavigationGestures(map, {
    follow: geoTracking.value,
    compass: compassModeActive.value,
  })
}

function bindTruckBearingSync() {
  if (!map || unbindTruckBearingSync) return
  const fn = () => {
    applyUserMarkerRotation()
  }
  map.on('rotate', fn)
  map.on('zoomend', fn)
  unbindTruckBearingSync = () => {
    map?.off('rotate', fn)
    map?.off('zoomend', fn)
    unbindTruckBearingSync = null
  }
}

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
/** @type {L.LayerGroup | null} */
let markerLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {L.Marker | null} */
let userMarker = null
/** @type {Map<string, L.Marker>} */
const markersById = new Map()

/** Signature of pin positions only — changes when filter/pins change, not when highlight changes */
const prevPinsSig = ref('')
const prevHadPins = ref(/** @type {boolean | null} */ (null))

function pinsSignature() {
  return JSON.stringify(
    props.pins.map((p) => ({
      i: String(p.locationId),
      la: p.lat,
      ln: p.lng,
    })),
  )
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const hasUserFix = computed(() => {
  const u = userFix.value
  return (
    u != null &&
    Number.isFinite(u.lat) &&
    Number.isFinite(u.lng)
  )
})

function allBoundsLatLngs() {
  /** @type {L.LatLng[]} */
  const pts = []
  for (const p of props.pins) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    pts.push(L.latLng(lat, lng))
  }
  const u = userFix.value
  if (
    u &&
    Number.isFinite(u.lat) &&
    Number.isFinite(u.lng)
  ) {
    pts.push(L.latLng(u.lat, u.lng))
  }
  return pts
}

function applyDefaultOrFitView(pinsChanged) {
  if (!map) return
  const motion = prefersReducedMotion()
  const pts = allBoundsLatLngs()

  if (pts.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    return
  }

  if (pts.length === 1) {
    map.setView(pts[0], 13, { animate: pinsChanged && !motion })
    return
  }

  const bounds = L.latLngBounds(pts)
  map.fitBounds(bounds, {
    padding: [40, 40],
    maxZoom: 14,
    animate: pinsChanged && !motion,
  })
}

function syncMarkers() {
  if (!map || !markerLayer) return

  const sig = pinsSignature()
  const pinsChanged = sig !== prevPinsSig.value
  const hadPins = props.pins.some((p) => {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    return Number.isFinite(la) && Number.isFinite(ln)
  })
  const hadPinsChanged =
    prevHadPins.value !== null && prevHadPins.value !== hadPins

  markerLayer.clearLayers()
  markersById.clear()

  for (const p of props.pins) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const id = String(p.locationId)
    const selected = props.highlightId === id
    const icon = directoryBuildingIcon(selected, id)

    const marker = L.marker([lat, lng], {
      icon,
      title: `Location ${id}`,
    })
    marker.bindTooltip(`Location ${id}`, { direction: 'top', offset: [0, -46] })
    marker.on('click', () => {
      emit('select', id)
    })
    marker.addTo(markerLayer)
    markersById.set(id, marker)
  }

  if (pinsChanged) {
    prevPinsSig.value = sig
  }
  prevHadPins.value = hadPins

  const motion = prefersReducedMotion()

  if (pinsChanged || hadPinsChanged) {
    applyDefaultOrFitView(true)
  } else if (props.highlightId) {
    const m = markersById.get(props.highlightId)
    if (m) {
      map.panTo(m.getLatLng(), { animate: !motion })
    }
  }
}

/**
 * Update “my location” truck marker (does not re-zoom on every tick).
 */
function syncUserOverlay() {
  if (!map || !userLayer) return

  const u = userFix.value
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) {
    if (userMarker) {
      userLayer.removeLayer(userMarker)
      userMarker = null
    }
    return
  }

  const ll = L.latLng(u.lat, u.lng)

  if (!userMarker) {
    userMarker = L.marker(ll, {
      icon: userLocationTruckIcon(props.vehicleId || ''),
      zIndexOffset: 600,
      title: 'Your location',
    })
    userMarker.addTo(userLayer)
  } else {
    userMarker.setLatLng(ll)
    userMarker.setIcon(userLocationTruckIcon(props.vehicleId || ''))
  }
  applyUserMarkerRotation()
}

function applyUserMarkerRotation() {
  if (!userMarker || !map) return
  const heading =
    compassModeActive.value && smoothHeading.value !== null
      ? smoothHeading.value
      : null
  applyUserTruckMarkerDomRotation(userMarker, map, heading)
}

function applyMapCompassRotation() {
  if (!map || !compassModeActive.value || smoothHeading.value === null) return
  if (typeof map.setBearing === 'function') {
    map.setBearing(smoothHeading.value)
  }
}

async function handleCompassToggle() {
  if (compassModeActive.value) {
    compassModeActive.value = false
    await toggleCompass()
    applyUserMarkerRotation()
    if (map && typeof map.setBearing === 'function') {
      map.setBearing(0)
    }
    syncNavigationGestures()
    return
  }

  const started = await toggleCompass()
  if (started) {
    compassModeActive.value = true
  }
  syncNavigationGestures()
}

function onCompassPressStart() {
  if (compassPermission.value === 'denied') return
  onCompassPointerDown()
}

const onCompassButtonClick = wrapCompassToggle(handleCompassToggle)

function onCalibrationControlClick() {
  calibrationModalOpen.value = true
  void Promise.resolve(startTracking()).catch(() => {})
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean }} [opts]
 */
function applyGeolocationPosition(pos, opts = {}) {
  const fitCamera = opts.fitCamera !== false
  const lat = pos.coords.latitude
  const lng = pos.coords.longitude
  const acc = pos.coords.accuracy
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = {
    lat,
    lng,
    accuracyM: Number.isFinite(acc) ? acc : 40,
  }
  geoDenied.value = false
  geoPending.value = false
  syncUserOverlay()

  if (geoTracking.value && map && userFix.value && !fitCamera) {
    const motion = prefersReducedMotion()
    centerMapOnLatLng(map, L.latLng(userFix.value.lat, userFix.value.lng), {
      animate: !motion,
    })
  }

  if (!map || !fitCamera) return
  const motion = prefersReducedMotion()
  const pinPts = []
  for (const p of props.pins) {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    pinPts.push(L.latLng(la, ln))
  }
  const ull = L.latLng(lat, lng)
  const pts = [...pinPts, ull]
  if (pts.length === 1) {
    map.setView(ull, 15, { animate: !motion })
  } else {
    const b = L.latLngBounds(pts)
    map.fitBounds(b, {
      padding: [48, 48],
      maxZoom: 15,
      animate: !motion,
    })
  }
}

function clearGeoWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

function stopUserTracking() {
  clearGeoWatch()
  geoTracking.value = false
  geoPending.value = false
  userFix.value = null
  syncUserOverlay()
  syncNavigationGestures()
  applyDefaultOrFitView(true)
}

function toggleMyLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    geoDenied.value = true
    return
  }
  if (geoTracking.value) {
    stopUserTracking()
    return
  }
  geoDenied.value = false
  geoPending.value = true
  geoTracking.value = true
  syncNavigationGestures()

  const opts = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15_000,
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      applyGeolocationPosition(pos, { fitCamera: true })
      syncNavigationGestures()
      geoWatchId = navigator.geolocation.watchPosition(
        (p) => applyGeolocationPosition(p, { fitCamera: false }),
        () => {
          /* keep last fix; transient errors are common */
        },
        /** Fresh fixes only (no 2s cache); short timeout so updates retry quickly while moving. */
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10_000,
        },
      )
    },
    () => {
      geoPending.value = false
      geoDenied.value = true
      geoTracking.value = false
      syncNavigationGestures()
    },
    opts,
  )
}

function setBaseLayer(mode) {
  if (!map || !streetLayer || !satelliteLayer) return
  activeBaseLayer.value = mode
  if (mode === 'satellite') {
    map.removeLayer(streetLayer)
    satelliteLayer.addTo(map)
  } else {
    map.removeLayer(satelliteLayer)
    streetLayer.addTo(map)
  }
}

function toggleSatellite() {
  setBaseLayer(activeBaseLayer.value === 'street' ? 'satellite' : 'street')
}

function initMap() {
  if (!containerRef.value) return

  map = L.map(containerRef.value, {
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: true,
    rotate: true,
    bearing: 0,
    touchRotate: true,
  })

  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.control.zoom({ position: 'topright' }).addTo(map)

  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  )

  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    },
  )

  activeBaseLayer.value = 'street'
  streetLayer.addTo(map)

  markerLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)

  syncMarkers()
  syncUserOverlay()

  nextTick(() => {
    map?.invalidateSize()
  })
  bindTruckBearingSync()
  syncNavigationGestures()
}

function destroyMap() {
  unbindTruckBearingSync?.()
  clearGeoWatch()
  markersById.clear()
  userMarker = null
  if (map) {
    map.remove()
    map = null
  }
  markerLayer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
}

/** @type {ResizeObserver | null} */
let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    initMap()
    if (props.fillHeight && containerRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => {
          map?.invalidateSize()
        })
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
  () => [props.pins, props.highlightId, props.fillHeight, props.vehicleId],
  () => {
    syncMarkers()
    syncUserOverlay()
    nextTick(() => {
      map?.invalidateSize()
    })
  },
  { deep: true },
)

watch(smoothHeading, () => {
  if (compassModeActive.value) {
    applyMapCompassRotation()
    applyUserMarkerRotation()
  }
})

watch(compassModeActive, (active) => {
  if (!active && map && typeof map.setBearing === 'function') {
    map.setBearing(0)
  }
})

watch([geoTracking, compassModeActive], () => {
  syncNavigationGestures()
})
</script>

<template>
  <div
    class="directory-map-root"
    :class="{ 'is-fill': fillHeight }"
    role="region"
    aria-label="Map of saved locations"
  >
    <div ref="containerRef" class="directory-map-el" />
    <div class="map-controls-stack directory-map-controls">
      <button
        type="button"
        class="map-control-btn map-control-btn--sat tap"
        :class="{ 'is-on': activeBaseLayer === 'satellite' }"
        :aria-pressed="activeBaseLayer === 'satellite'"
        title="Satellite imagery"
        @click="toggleSatellite"
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
        <span class="sr-only">
          {{
            geoDenied
              ? 'Location unavailable'
              : geoTracking
                ? 'Stop my location'
                : 'My location'
          }}
        </span>
      </button>
      <button
        v-if="showCompassToggle"
        type="button"
        class="map-control-btn map-control-btn--compass tap"
        :class="{
          'is-on': compassModeActive,
          'is-denied': compassPermission === 'denied',
        }"
        :aria-pressed="compassModeActive"
        :title="
          compassPermission === 'denied'
            ? 'Compass blocked — enable in device settings'
            : compassModeActive
              ? 'Exit compass mode'
              : 'Compass mode — rotate map to heading'
        "
        @contextmenu.prevent
        @pointerdown="onCompassPressStart"
        @pointerup="onCompassPointerUp"
        @pointerleave="onCompassPointerUp"
        @pointercancel="onCompassPointerUp"
        @click="onCompassButtonClick"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,2 14,10 12,8 10,10" fill="currentColor" stroke="none" />
          <polygon points="12,22 10,14 12,16 14,14" fill="currentColor" stroke="none" opacity="0.4" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        <span class="sr-only">
          {{
            compassModeActive
              ? 'Exit compass mode. Heading offset: tap the sliders button below.'
              : 'Compass mode. Heading offset: tap the sliders button below.'
          }}
        </span>
      </button>
      <button
        v-if="showCompassToggle"
        type="button"
        class="map-control-btn map-control-btn--compass-cal tap"
        title="Heading offset / calibration"
        aria-label="Heading offset and calibration"
        @contextmenu.prevent
        @click.stop.prevent="onCalibrationControlClick"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        <span class="sr-only">Open heading offset and calibration</span>
      </button>
      <p v-if="geoPending" class="directory-map-locate-hint">Getting location…</p>
      <p v-else-if="geoDenied" class="directory-map-locate-hint is-warn">
        Enable location in your browser settings, then try again.
      </p>
      <p v-if="compassError" class="directory-map-locate-hint is-warn">{{ compassError }}</p>
    </div>
    <CompassCalibrationModal
      v-model="calibrationModalOpen"
      :map-compass-mode-active="compassModeActive"
    />
  </div>
</template>

<style scoped>
.directory-map-root {
  position: relative;
  width: 100%;
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.3));
  background: var(--color-bg-elevated, #12121a);
}

.directory-map-root.is-fill {
  height: 100%;
  min-height: 0;
  border-radius: 0;
  border-left: none;
  border-top: none;
  border-bottom: none;
  box-shadow: none;
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

.directory-map-controls {
  max-width: min(14rem, calc(100% - 1.5rem));
}

.directory-map-locate-hint {
  margin: 0;
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.75rem);
  line-height: 1.35;
  color: var(--color-text-tertiary, #6e6e7e);
  text-align: right;
  background: rgba(8, 8, 10, 0.82);
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.directory-map-locate-hint.is-warn {
  color: #fca5a5;
}

.map-control-btn--compass {
  position: relative;
}

.map-control-btn--compass.is-on {
  background: linear-gradient(145deg, #8b5cf6, #6d28d9);
  border-color: rgba(139, 92, 246, 0.65);
  color: #faf5ff;
  box-shadow:
    0 0 0 2px rgba(139, 92, 246, 0.25),
    0 2px 6px rgba(139, 92, 246, 0.35);
}

.map-control-btn--compass.is-on svg {
  animation: compass-pulse 2s ease-in-out infinite;
}

.map-control-btn--compass.is-denied {
  opacity: 0.55;
}

@keyframes compass-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

.directory-map-el {
  width: 100%;
  min-height: clamp(16rem, 38vh, 22rem);
  height: clamp(16rem, 38vh, 22rem);
}

.directory-map-root.is-fill .directory-map-el {
  min-height: 0;
  height: 100%;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #0e0e12;
}

:deep(.leaflet-control-zoom a) {
  background: rgba(22, 22, 29, 0.92);
  color: var(--color-text-primary, #f4f4f8);
  border-color: var(--color-border, rgba(255, 255, 255, 0.12));
}

:deep(.leaflet-control-zoom a:hover) {
  background: rgba(40, 40, 52, 0.95);
}

:deep(.leaflet-control-attribution) {
  font-size: 0.625rem;
  color: var(--color-text-tertiary, #6e6e7e);
  background: rgba(8, 8, 10, 0.75) !important;
  max-width: calc(100% - 1rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.leaflet-control-attribution a) {
  color: var(--color-accent-purple, #7b4db5);
}
</style>
