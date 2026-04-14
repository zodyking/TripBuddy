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

/** 'requesting' | 'active' | 'denied' | 'unavailable' */
const userLocStatus = ref(
  typeof navigator !== 'undefined' && navigator.geolocation
    ? 'requesting'
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
/** @type {L.CircleMarker | null} */
let trailerMarker = null
/** @type {L.CircleMarker | null} */
let userMarker = null
/** @type {number | null} */
let geoWatchId = null
/** @type {ReturnType<typeof setTimeout> | null} */
let fitDebounce = null

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function trailerLatLng() {
  return L.latLng(props.lat, props.lng)
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
      const b = L.latLngBounds([t, userMarker.getLatLng()])
      map.fitBounds(b, { padding: [52, 52], maxZoom: 16, animate: motion })
    } else {
      map.setView(t, 15, { animate: motion })
    }
  }, 80)
}

function setUserPosition(lat, lng) {
  if (!map) return
  const ll = L.latLng(lat, lng)
  if (!userMarker) {
    userMarker = L.circleMarker(ll, {
      radius: 9,
      color: '#38bdf8',
      weight: 3,
      fillColor: '#0ea5e9',
      fillOpacity: 0.95,
    })
      .bindPopup('Your location')
      .addTo(map)
  } else {
    userMarker.setLatLng(ll)
  }
  userLocStatus.value = 'active'
  scheduleFitBounds()
}

function startGeolocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    userLocStatus.value = 'unavailable'
    return
  }
  userLocStatus.value = 'requesting'

  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      setUserPosition(pos.coords.latitude, pos.coords.longitude)
    },
    () => {
      userLocStatus.value = 'denied'
      scheduleFitBounds()
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 25_000,
    },
  )
}

function stopGeolocation() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

function syncTrailerMarker() {
  if (!map || !overlayLayer) return
  const ll = trailerLatLng()
  if (!Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return

  const label = props.trailerLabel.trim() || 'Trailer'
  if (!trailerMarker) {
    trailerMarker = L.circleMarker(ll, {
      radius: 11,
      color: '#fb923c',
      weight: 3,
      fillColor: '#ea580c',
      fillOpacity: 0.95,
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

  map = L.map(containerRef.value, {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: true,
  })

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
  startGeolocation()

  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 280)
  })
}

function destroyMap() {
  stopGeolocation()
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
        <span class="trailer-loc-dot is-you" />
        You
      </span>
    </div>
    <p
      v-if="userLocStatus === 'requesting'"
      class="trailer-loc-hint"
    >
      Requesting your location…
    </p>
    <p
      v-else-if="userLocStatus === 'denied'"
      class="trailer-loc-hint is-warn"
    >
      Location denied — showing trailer only. Enable location in the browser to see both.
    </p>
    <p
      v-else-if="userLocStatus === 'unavailable'"
      class="trailer-loc-hint is-warn"
    >
      Geolocation not available on this device.
    </p>
  </div>
</template>

<style scoped>
.trailer-loc-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 12rem;
  background: #0a0a0f;
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
  background: rgba(12, 12, 18, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
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
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.trailer-loc-dot.is-trailer {
  background: #ea580c;
}
.trailer-loc-dot.is-you {
  background: #0ea5e9;
}

.trailer-loc-hint {
  position: absolute;
  z-index: 1000;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.4rem 0.65rem;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--muted, #a8a8b8);
  background: linear-gradient(
    180deg,
    transparent,
    rgba(10, 10, 15, 0.92) 30%
  );
  pointer-events: none;
}

.trailer-loc-hint.is-warn {
  color: #fcd34d;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #0e0e12;
}

:deep(.leaflet-control-layers) {
  border-radius: 8px;
  background: rgba(18, 18, 26, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text, #e8e8ee);
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
  background: rgba(22, 22, 29, 0.92);
  color: var(--text, #e8e8ee);
  border-color: rgba(255, 255, 255, 0.12);
}

:deep(.leaflet-control-zoom a:hover) {
  background: rgba(40, 40, 52, 0.95);
}

:deep(.leaflet-popup-content-wrapper) {
  border-radius: 8px;
  background: #1c1c26;
  color: var(--text, #e8e8ee);
}

:deep(.leaflet-popup-tip) {
  background: #1c1c26;
}
</style>
