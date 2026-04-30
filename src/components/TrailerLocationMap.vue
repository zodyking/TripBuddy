<script setup>
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { trailer20ftTopIcon, trailer53ftTopIcon, trailerFallbackPinIcon, userLocationTruckIcon } from '../utils/mapMarkers.js'

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  /** '20ft' | '53ft' | '' — top-down PNG + number chip when known */
  trailerSize: { type: String, default: '' },
  /** Trailer number for marker chip (e.g. trlrNbr) */
  trailerNumber: { type: String, default: '' },
  /** From parent: first fix after synchronous getCurrentPosition (WebKit gesture). */
  userLat: { type: Number, default: null },
  userLng: { type: Number, default: null },
  /** Parent still waiting on first geolocation callback */
  userLocationPending: { type: Boolean, default: false },
  /** Parent could not obtain a fix */
  userLocationDenied: { type: Boolean, default: false },
})

const containerRef = ref(null)

/** Latest user fix (from props + live watch); accuracy drives the circle only. */
const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */ (null),
)

const hasUserFix = computed(() => {
  const u = userFix.value
  return u != null && Number.isFinite(u.lat) && Number.isFinite(u.lng)
})

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
/** @type {L.LayerGroup | null} */
let overlayLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {L.Marker | null} */
let trailerMarker = null
/** @type {L.Marker | null} */
let userMarker = null
/** @type {L.Circle | null} */
let userAccuracyCircle = null
/** @type {number | null} */
let geoWatchId = null
/** @type {ReturnType<typeof setTimeout> | null} */
let fitDebounce = null
let geoStopped = false
let watchStarted = false
/** Fit map to trailer+user only once when user first appears (not every GPS tick). */
let didFitWithUser = false

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function trailerLatLng() {
  return L.latLng(props.lat, props.lng)
}

function makeTrailerIcon() {
  const sz = String(props.trailerSize ?? '').trim().toLowerCase()
  const num = String(props.trailerNumber ?? '').trim()
  if (sz === '20ft' || sz === "20'") {
    return trailer20ftTopIcon(num)
  }
  if (sz === '53ft' || sz === "53'") {
    return trailer53ftTopIcon(num)
  }
  return trailerFallbackPinIcon()
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

function scheduleFitBounds() {
  if (!map || !trailerMarker) return
  if (fitDebounce) clearTimeout(fitDebounce)
  fitDebounce = setTimeout(() => {
    fitDebounce = null
    if (!map || !trailerMarker) return
    const t = trailerMarker.getLatLng()
    const motion = !prefersReducedMotion()
    if (userMarker && userFix.value) {
      const u = L.latLng(userFix.value.lat, userFix.value.lng)
      let b = L.latLngBounds([t, u])
      const ne = b.getNorthEast()
      const sw = b.getSouthWest()
      const latSpan = Math.abs(ne.lat - sw.lat)
      const lngSpan = Math.abs(ne.lng - sw.lng)
      if (latSpan < 1e-8 && lngSpan < 1e-8) {
        b = b.pad(0.004)
      } else {
        b = b.pad(0.14)
      }
      map.fitBounds(b, {
        padding: [56, 56],
        maxZoom: 15,
        animate: motion,
      })
    } else {
      map.setView(t, 15, { animate: motion })
    }
  }, 80)
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
      color: '#0284c7',
      fillColor: '#0284c7',
      fillOpacity: 0.12,
      weight: 1,
      opacity: 0.45,
    }).addTo(userLayer)
  }

  if (!userMarker) {
    userMarker = L.marker(ll, {
      icon: userLocationTruckIcon(),
      zIndexOffset: 600,
    })
    userMarker.bindPopup('Your location')
    userMarker.addTo(userLayer)
  } else {
    userMarker.setLatLng(ll)
  }
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [accuracyM]
 * @param {boolean} [fitCamera]
 */
function setUserFixFromLatLng(lat, lng, accuracyM = 40, fitCamera = false) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = {
    lat,
    lng,
    accuracyM: Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 40,
  }
  syncUserOverlay()
  if (fitCamera && map && trailerMarker && !didFitWithUser) {
    didFitWithUser = true
    scheduleFitBounds()
  }
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean }} [opts]
 */
function applyUserGeolocation(pos, opts = {}) {
  const fitCamera = opts.fitCamera === true
  const lat = pos.coords.latitude
  const lng = pos.coords.longitude
  const acc = pos.coords.accuracy
  setUserFixFromLatLng(lat, lng, acc, fitCamera)
}

function stopWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
  watchStarted = false
}

function startWatchForLiveUpdates() {
  if (
    typeof navigator === 'undefined' ||
    !navigator.geolocation ||
    geoStopped ||
    watchStarted ||
    !hasUserFix.value
  ) {
    return
  }
  watchStarted = true
  let first = true
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      applyUserGeolocation(pos, { fitCamera: first })
      first = false
    },
    () => {
      /* keep last fix */
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    },
  )
}

/** Sync initial fix from parent (getCurrentPosition in openTrailerGpsModal). */
function applyUserCoordsFromProps() {
  const la = props.userLat
  const ln = props.userLng
  if (
    la != null &&
    ln != null &&
    Number.isFinite(la) &&
    Number.isFinite(ln)
  ) {
    setUserFixFromLatLng(la, ln, 40, true)
    startWatchForLiveUpdates()
  } else if (!props.userLocationPending && props.userLocationDenied) {
    stopWatch()
    userFix.value = null
    syncUserOverlay()
    didFitWithUser = false
  }
}

function initMap() {
  if (!containerRef.value) return

  geoStopped = false
  didFitWithUser = false

  map = L.map(containerRef.value, {
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: true,
  })

  L.control.zoom({ position: 'topright' }).addTo(map)

  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
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

  streetLayer.addTo(map)
  activeBaseLayer.value = 'street'

  overlayLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)

  syncTrailerMarker()
  applyUserCoordsFromProps()

  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 320)
  })
}

function destroyMap() {
  geoStopped = true
  stopWatch()
  if (fitDebounce) {
    clearTimeout(fitDebounce)
    fitDebounce = null
  }
  trailerMarker = null
  userMarker = null
  userAccuracyCircle = null
  userFix.value = null
  overlayLayer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
  if (map) {
    map.remove()
    map = null
  }
}

function syncTrailerMarker() {
  if (!map || !overlayLayer) return
  const ll = trailerLatLng()
  if (!Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return

  const label = props.trailerLabel.trim() || 'Trailer'
  const icon = makeTrailerIcon()
  if (!trailerMarker) {
    trailerMarker = L.marker(ll, {
      icon,
      title: label,
    })
      .bindPopup(label)
      .addTo(overlayLayer)
  } else {
    trailerMarker.setLatLng(ll)
    trailerMarker.setIcon(icon)
    trailerMarker.setPopupContent(label)
  }
  /* Trailer moved — refit if we do not have user yet */
  if (!didFitWithUser) {
    scheduleFitBounds()
  }
}

onMounted(() => {
  nextTick(() => {
    initMap()
  })
})

onBeforeUnmount(() => {
  destroyMap()
})

watch(
  () => [props.lat, props.lng, props.trailerLabel, props.trailerSize, props.trailerNumber],
  () => {
    syncTrailerMarker()
    nextTick(() => map?.invalidateSize())
  },
)

watch(
  () => [props.userLat, props.userLng, props.userLocationPending, props.userLocationDenied],
  () => {
    applyUserCoordsFromProps()
  },
)
</script>

<template>
  <div class="trailer-loc-root" role="region" aria-label="Trailer and your location map">
    <div ref="containerRef" class="trailer-loc-el" />
    <div class="map-controls-stack trailer-loc-controls">
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
    </div>
    <div class="trailer-loc-legend" aria-hidden="true">
      <span class="trailer-loc-legend-item">
        <span class="trailer-loc-dot is-trailer" />
        Trailer
      </span>
      <span class="trailer-loc-legend-item">
        <span class="trailer-loc-dot is-user" />
        You
      </span>
    </div>
    <p
      v-if="userLocationPending && !hasUserFix"
      class="trailer-loc-hint"
    >
      Finding your location…
    </p>
    <p
      v-if="userLocationDenied && !hasUserFix && !userLocationPending"
      class="trailer-loc-hint is-muted"
    >
      Location unavailable — trailer only. Check site permission in browser settings.
    </p>
    <p
      v-if="hasUserFix"
      class="trailer-loc-hint is-live"
    >
      Live location updates while this map is open.
    </p>
  </div>
</template>

<style scoped>
.trailer-loc-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 12rem;
  background: #dfe6ee;
}

.trailer-loc-el {
  width: 100%;
  height: 100%;
  min-height: inherit;
}

.trailer-loc-controls {
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

.trailer-loc-legend {
  position: absolute;
  z-index: 1000;
  top: 0.5rem;
  left: 0.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  padding: 0.35rem 0.55rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  font-size: 0.7rem;
  font-weight: 600;
  color: #1e293b;
  pointer-events: none;
  max-width: calc(100% - 1rem);
}

.trailer-loc-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.trailer-loc-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}
.trailer-loc-dot.is-trailer {
  background: #ea580c;
}
.trailer-loc-dot.is-user {
  background: #0284c7;
}

.trailer-loc-hint {
  position: absolute;
  z-index: 999;
  bottom: 0.45rem;
  left: 0.65rem;
  right: 0.65rem;
  margin: 0;
  padding: 0.35rem 0.5rem;
  font-size: 0.68rem;
  line-height: 1.35;
  text-align: center;
  color: #475569;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  pointer-events: none;
}

.trailer-loc-hint.is-muted {
  color: #64748b;
}

.trailer-loc-hint.is-live {
  color: #0369a1;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #cbd5e1;
}

:deep(.leaflet-control-zoom a) {
  background: rgba(255, 255, 255, 0.95);
  color: #1e293b;
  border-color: rgba(0, 0, 0, 0.12);
}

:deep(.leaflet-control-zoom a:hover) {
  background: #f1f5f9;
}

:deep(.leaflet-popup-content-wrapper) {
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
}

:deep(.leaflet-popup-tip) {
  background: #fff;
}
</style>
