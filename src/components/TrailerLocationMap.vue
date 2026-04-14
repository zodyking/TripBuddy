<script setup>
import {
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  /** Shown in marker popup, e.g. "Trailer 1" */
  trailerLabel: { type: String, default: '' },
})

const containerRef = ref(null)

/**
 * idle — before first attempt
 * requesting — automatic attempt in progress
 * active — have a fix (watch may still run)
 * denied — permission or hard failure (show tap button on iOS / Chrome)
 * unavailable — no API
 */
const userLocStatus = ref(
  typeof navigator !== 'undefined' && navigator.geolocation
    ? 'idle'
    : 'unavailable',
)

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
/** @type {L.LayerGroup | null} */
let overlayLayer = null
/** @type {L.Marker | null} */
let trailerMarker = null
/** @type {L.Marker | null} */
let userMarker = null
/** @type {number | null} */
let geoWatchId = null
/** @type {ReturnType<typeof setTimeout> | null} */
let fitDebounce = null
let geoStopped = false

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function trailerLatLng() {
  return L.latLng(props.lat, props.lng)
}

function makeTrailerIcon() {
  return L.divIcon({
    className: 'trailer-loc-div-icon',
    html: '<div class="trailer-loc-pin-inner is-trailer" aria-hidden="true"></div>',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -36],
  })
}

function makeUserIcon() {
  return L.divIcon({
    className: 'trailer-loc-div-icon',
    html: '<div class="trailer-loc-pin-inner is-user" aria-hidden="true"></div>',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -36],
  })
}

function scheduleFitBounds() {
  if (!map || !trailerMarker) return
  if (fitDebounce) clearTimeout(fitDebounce)
  fitDebounce = setTimeout(() => {
    fitDebounce = null
    if (!map || !trailerMarker) return
    const t = trailerMarker.getLatLng()
    const motion = !prefersReducedMotion()
    if (userMarker) {
      const u = userMarker.getLatLng()
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

function setUserPosition(lat, lng) {
  if (!map) return
  const ll = L.latLng(lat, lng)
  if (!userMarker) {
    userMarker = L.marker(ll, {
      icon: makeUserIcon(),
      title: 'Your location',
    })
      .bindPopup('Your location')
      .addTo(map)
  } else {
    userMarker.setLatLng(ll)
  }
  userLocStatus.value = 'active'
  scheduleFitBounds()
}

function stopWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

function startWatch() {
  if (
    typeof navigator === 'undefined' ||
    !navigator.geolocation ||
    geoStopped
  ) {
    return
  }
  stopWatch()
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      setUserPosition(pos.coords.latitude, pos.coords.longitude)
    },
    (err) => {
      if (userMarker) return
      if (err && err.code === 1) userLocStatus.value = 'denied'
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 30_000,
    },
  )
}

/**
 * iOS (incl. Chrome) often requires a direct user gesture for the first fix.
 * getCurrentPosition tends to work more reliably than watchPosition alone.
 */
function requestUserLocationFromBrowser(isUserGesture = false) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    userLocStatus.value = 'unavailable'
    return Promise.resolve()
  }
  if (!userMarker) userLocStatus.value = 'requesting'

  const tryGet = (highAccuracy) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        (err) => reject(err),
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: highAccuracy ? 0 : 60_000,
          timeout: highAccuracy ? 25_000 : 20_000,
        },
      )
    })

  return tryGet(true)
    .then((pos) => {
      setUserPosition(pos.coords.latitude, pos.coords.longitude)
      startWatch()
    })
    .catch(() =>
      tryGet(false).then((pos) => {
        setUserPosition(pos.coords.latitude, pos.coords.longitude)
        startWatch()
      }),
    )
    .catch((err) => {
      if (err && err.code === 1) {
        userLocStatus.value = 'denied'
      } else if (!userMarker) {
        userLocStatus.value = isUserGesture ? 'denied' : 'idle'
      } else {
        userLocStatus.value = 'active'
      }
    })
}

function onTapShareLocation() {
  void requestUserLocationFromBrowser(true)
}

function initGeolocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    userLocStatus.value = 'unavailable'
    return
  }
  void requestUserLocationFromBrowser(false)
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
  overlayLayer = null
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
  if (!trailerMarker) {
    trailerMarker = L.marker(ll, {
      icon: makeTrailerIcon(),
      title: label,
    })
      .bindPopup(label)
      .addTo(overlayLayer)
  } else {
    trailerMarker.setLatLng(ll)
    trailerMarker.setPopupContent(label)
  }
  scheduleFitBounds()
}

function initMap() {
  if (!containerRef.value) return

  geoStopped = false

  map = L.map(containerRef.value, {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: true,
  })

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

  L.control
    .layers(
      {
        Street: streetLayer,
        Satellite: satelliteLayer,
      },
      null,
      { collapsed: true },
    )
    .addTo(map)

  overlayLayer = L.layerGroup().addTo(map)

  syncTrailerMarker()
  initGeolocation()

  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 320)
  })
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
  () => [props.lat, props.lng, props.trailerLabel],
  () => {
    syncTrailerMarker()
    nextTick(() => map?.invalidateSize())
  },
)
</script>

<template>
  <div class="trailer-loc-root" role="region" aria-label="Trailer and your location map">
    <div ref="containerRef" class="trailer-loc-el" />
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
    <div
      v-if="userLocStatus === 'idle' || userLocStatus === 'denied'"
      class="trailer-loc-actions"
    >
      <button
        type="button"
        class="trailer-loc-share-btn tap"
        @click="onTapShareLocation"
      >
        {{ userLocStatus === 'denied' ? 'Tap to allow location' : 'Show my location on map' }}
      </button>
      <p
        v-if="userLocStatus === 'denied'"
        class="trailer-loc-ios-hint"
      >
        On iPhone: Settings → Chrome → Location → While Using, then tap the button above.
      </p>
    </div>
    <p
      v-if="userLocStatus === 'requesting'"
      class="trailer-loc-hint"
    >
      Finding your location…
    </p>
    <p
      v-if="userLocStatus === 'unavailable'"
      class="trailer-loc-hint is-muted"
    >
      This browser cannot access device location.
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

.trailer-loc-actions {
  position: absolute;
  z-index: 1000;
  bottom: 0.45rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(92%, 22rem);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
  pointer-events: auto;
}

.trailer-loc-share-btn {
  width: 100%;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%);
  color: #f8fafc;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.trailer-loc-share-btn:active {
  transform: scale(0.98);
}

.trailer-loc-ios-hint {
  margin: 0;
  padding: 0.35rem 0.5rem;
  font-size: 0.65rem;
  line-height: 1.35;
  text-align: center;
  color: #334155;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.trailer-loc-hint {
  position: absolute;
  z-index: 999;
  bottom: 3.5rem;
  left: 0;
  right: 0;
  margin: 0 auto;
  max-width: 90%;
  padding: 0.3rem 0.5rem;
  font-size: 0.68rem;
  line-height: 1.35;
  text-align: center;
  color: #475569;
  pointer-events: none;
}

.trailer-loc-hint.is-muted {
  bottom: 0.5rem;
  color: #64748b;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #cbd5e1;
}

:deep(.trailer-loc-div-icon) {
  background: transparent;
  border: none;
}

:deep(.trailer-loc-pin-inner) {
  width: 28px;
  height: 28px;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  border: 3px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  margin: 2px 0 0 2px;
}

:deep(.trailer-loc-pin-inner.is-trailer) {
  background: #ea580c;
}

:deep(.trailer-loc-pin-inner.is-user) {
  background: #0284c7;
}

:deep(.leaflet-control-layers) {
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 0, 0, 0.1);
  color: #1e293b;
}

:deep(.leaflet-control-layers-list) {
  font-size: 0.8rem;
}

:deep(.leaflet-control-layers-base label) {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.2rem 0;
  cursor: pointer;
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
