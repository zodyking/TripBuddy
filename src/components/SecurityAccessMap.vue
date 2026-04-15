<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  /** @type {Array<{ id: string, latitude: number | null, longitude: number | null, ip: string }>} */
  points: {
    type: Array,
    default: () => [],
  },
})

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

/** @type {L.Map | null} */
let map = null
/** @type {L.LayerGroup | null} */
let layer = null
/** @type {L.CircleMarker[]} */
const markers = []

const DEFAULT_CENTER = [39.8283, -98.5795]
const DEFAULT_ZOOM = 4

const validPoints = computed(() => {
  const out = []
  for (const p of props.points) {
    const la = p.latitude
    const ln = p.longitude
    if (la == null || ln == null) continue
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    out.push({ ...p, lat: la, lng: ln })
  }
  return out
})

function sync() {
  if (!map || !layer) return
  for (const m of markers) {
    layer.removeLayer(m)
  }
  markers.length = 0

  const pts = validPoints.value
  if (pts.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    return
  }

  for (const p of pts) {
    const cm = L.circleMarker([p.lat, p.lng], {
      radius: 6,
      stroke: true,
      color: '#a78bfa',
      weight: 2,
      fillColor: '#7b4db5',
      fillOpacity: 0.85,
    })
    cm.bindTooltip(`${p.ip || '—'}`, { direction: 'top' })
    cm.addTo(layer)
    markers.push(cm)
  }

  if (pts.length === 1) {
    map.setView([pts[0].lat, pts[0].lng], 10, { animate: false })
  } else {
    const b = L.latLngBounds(pts.map((p) => [p.lat, p.lng]))
    map.fitBounds(b, { padding: [24, 24], maxZoom: 12, animate: false })
  }
}

function initMap() {
  if (!containerRef.value) return
  map = L.map(containerRef.value, {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: true,
  })
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; OSM &copy; CARTO',
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
}

function destroyMap() {
  markers.length = 0
  if (map) {
    map.remove()
    map = null
  }
  layer = null
}

onMounted(() => {
  nextTick(() => initMap())
})

onBeforeUnmount(() => {
  destroyMap()
})

watch(
  () => props.points,
  () => {
    sync()
    nextTick(() => map?.invalidateSize())
  },
  { deep: true },
)
</script>

<template>
  <div
    ref="containerRef"
    class="security-access-map"
    role="img"
    aria-label="Map of access locations with coordinates"
  />
</template>

<style scoped>
.security-access-map {
  width: 100%;
  height: min(18rem, 40vh);
  min-height: 14rem;
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: #0e0e12;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #0e0e12;
}

:deep(.leaflet-control-zoom a) {
  background: rgba(22, 22, 29, 0.92);
  color: var(--color-text-primary, #f4f4f8);
}
</style>
