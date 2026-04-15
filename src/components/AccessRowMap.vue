<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  /** @type {number | null} */
  lat: { type: Number, default: null },
  /** @type {number | null} */
  lng: { type: Number, default: null },
})

const elRef = ref(/** @type {HTMLElement | null} */ (null))
/** @type {L.Map | null} */
let map = null
/** @type {L.CircleMarker | null} */
let marker = null

function sync() {
  if (!map) return
  const la = props.lat
  const ln = props.lng
  if (
    la == null ||
    ln == null ||
    !Number.isFinite(la) ||
    !Number.isFinite(ln)
  ) {
    return
  }
  const ll = L.latLng(la, ln)
  if (!marker) {
    marker = L.circleMarker(ll, {
      radius: 5,
      stroke: true,
      color: '#a78bfa',
      weight: 2,
      fillColor: '#7b4db5',
      fillOpacity: 0.9,
    }).addTo(map)
  } else {
    marker.setLatLng(ll)
  }
  map.setView(ll, 13, { animate: false })
}

function init() {
  if (!elRef.value) return
  map = L.map(elRef.value, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
    dragging: true,
  })
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '© OSM © CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  ).addTo(map)
  sync()
  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 120)
  })
}

function destroy() {
  marker = null
  if (map) {
    map.remove()
    map = null
  }
}

onMounted(() => {
  nextTick(() => init())
})

onBeforeUnmount(() => {
  destroy()
})

watch(
  () => [props.lat, props.lng],
  () => {
    sync()
    nextTick(() => map?.invalidateSize())
  },
)
</script>

<template>
  <div ref="elRef" class="access-row-map" role="img" :aria-label="'Map at ' + lat + ',' + lng" />
</template>

<style scoped>
.access-row-map {
  width: 100%;
  min-width: 7rem;
  height: 5.5rem;
  border-radius: var(--radius-md, 0.5rem);
  overflow: hidden;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: #0e0e12;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #0e0e12;
  font-size: 9px;
}

:deep(.leaflet-control-zoom) {
  border: none;
}

:deep(.leaflet-control-zoom a) {
  width: 22px;
  height: 22px;
  line-height: 22px;
  font-size: 14px;
  background: rgba(22, 22, 29, 0.92);
  color: var(--color-text-primary, #f4f4f8);
}

:deep(.leaflet-control-attribution) {
  font-size: 8px;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(8, 8, 10, 0.75) !important;
}
</style>
