<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-rotate'
import { userLocationTruckIcon } from '../utils/mapMarkers.js'
import {
  syncMapNavigationGestures,
  centerMapOnLatLng,
  applyUserTruckMarkerDomRotation,
} from '../composables/useMapFollowControls.js'

const DEFAULT_CENTER = [40.7128, -74.006]
const DEFAULT_ZOOM = 11

const props = defineProps({
  /** @type {number | null} */
  lat: { type: Number, default: null },
  /** @type {number | null} */
  lng: { type: Number, default: null },
  /** @type {number | null} */
  accuracyM: { type: Number, default: null },
  /** No fix yet — map stays on default NYC */
  pending: { type: Boolean, default: true },
  /** After first center, pan to new positions (live GPS) instead of resetting zoom each tick */
  smoothFollow: { type: Boolean, default: false },
  /** Tractor / unit number chip under truck marker (optional). */
  vehicleId: { type: String, default: '' },
})

/** First fix uses setView; later updates center at current zoom when smoothFollow is on */
const userViewInitialized = ref(false)

/** @type {null | (() => void)} */
let unbindTruckBearingSync = null

function bindTruckBearingSync() {
  if (!map || unbindTruckBearingSync) return
  const onRotate = () => applyDotRotation()
  const onZoomEnd = () => applyDotRotation()
  map.on('rotate', onRotate)
  map.on('zoomend', onZoomEnd)
  unbindTruckBearingSync = () => {
    map.off('rotate', onRotate)
    map.off('zoomend', onZoomEnd)
    unbindTruckBearingSync = null
  }
}

function applyDotRotation() {
  if (!dot || !map) return
  applyUserTruckMarkerDomRotation(dot, map, null)
}

const rootRef = ref(/** @type {HTMLElement | null} */ (null))

/** @type {L.Map | null} */
let map = null
/** @type {L.LayerGroup | null} */
let layer = null
/** @type {L.Marker | null} */
let dot = null

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function sync() {
  if (!map || !layer) return

  const la = props.lat
  const ln = props.lng
  const hasFix =
    la != null &&
    ln != null &&
    Number.isFinite(la) &&
    Number.isFinite(ln)

  if (!hasFix || props.pending) {
    userViewInitialized.value = false
    if (dot) {
      layer.removeLayer(dot)
      dot = null
    }
    syncMapNavigationGestures(map, { follow: false, compass: false })
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    return
  }

  const ll = L.latLng(la, ln)

  if (!dot) {
    dot = L.marker(ll, {
      icon: userLocationTruckIcon(props.vehicleId || ''),
      zIndexOffset: 500,
      title: 'Your location',
    }).addTo(layer)
  } else {
    dot.setLatLng(ll)
    dot.setIcon(userLocationTruckIcon(props.vehicleId || ''))
  }

  applyDotRotation()

  const motion = !prefersReducedMotion()
  const follow = props.smoothFollow && hasFix && !props.pending
  syncMapNavigationGestures(map, { follow, compass: false })
  if (follow) {
    if (props.smoothFollow && userViewInitialized.value) {
      centerMapOnLatLng(map, ll, { animate: motion })
    } else {
      map.setView(ll, 14, { animate: motion })
      userViewInitialized.value = true
    }
  } else {
    map.setView(ll, 14, { animate: motion })
    userViewInitialized.value = true
  }
}

function initMap() {
  if (!rootRef.value) return
  map = L.map(rootRef.value, {
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: true,
    rotate: true,
    bearing: 0,
    touchRotate: true,
  })
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.control.zoom({ position: 'topright' }).addTo(map)
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  ).addTo(map)
  layer = L.layerGroup().addTo(map)
  sync()
  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 200)
  })
  bindTruckBearingSync()
}

function destroyMap() {
  unbindTruckBearingSync?.()
  if (map) {
    map.remove()
    map = null
  }
  layer = null
  dot = null
}

onMounted(() => {
  nextTick(() => initMap())
})

onBeforeUnmount(() => {
  destroyMap()
})

watch(
  () => [props.lat, props.lng, props.accuracyM, props.pending, props.smoothFollow, props.vehicleId],
  () => {
    sync()
    nextTick(() => map?.invalidateSize())
  },
)
</script>

<template>
  <div ref="rootRef" class="login-ack-map" role="img" aria-label="Map preview for your approximate location" />
</template>

<style scoped>
.login-ack-map {
  width: 100%;
  height: min(12rem, 28vh);
  min-height: 10rem;
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  border: 1px solid rgba(123, 77, 181, 0.35);
  background: #0e0e12;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #0e0e12;
}

:deep(.leaflet-control-zoom a) {
  background: rgba(22, 22, 29, 0.92);
  color: var(--color-text-primary, #f4f4f8);
  border-color: rgba(255, 255, 255, 0.12);
}

:deep(.leaflet-control-attribution) {
  font-size: 0.55rem;
  color: #6e6e7e;
  background: rgba(8, 8, 10, 0.8) !important;
}
</style>
