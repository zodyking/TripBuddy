<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps({
  /** @type {import('vue').PropType<Array<{ lat: number, lng: number }>>} */
  modelValue: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['update:modelValue'])

const elRef = ref(/** @type {HTMLElement | null} */ (null))

/** @type {L.Map | null} */
let map = null
/** @type {L.Layer | null} */
let polyLayer = null

let applyingFromParent = false

function toLatLngs(pts) {
  return pts
    .filter(
      (p) =>
        p &&
        Number.isFinite(Number(p.lat)) &&
        Number.isFinite(Number(p.lng)),
    )
    .map((p) => L.latLng(Number(p.lat), Number(p.lng)))
}

function syncPolygon(pts) {
  if (!map) return
  const latlngs = toLatLngs(pts)
  if (polyLayer) {
    map.removeLayer(polyLayer)
    polyLayer = null
  }
  if (latlngs.length >= 3) {
    polyLayer = L.polygon(latlngs, {
      color: '#a78bfa',
      weight: 2,
      fillColor: '#7b4db5',
      fillOpacity: 0.2,
    }).addTo(map)
  } else if (latlngs.length === 2) {
    polyLayer = L.polyline(latlngs, {
      color: '#a78bfa',
      weight: 2,
    }).addTo(map)
  }
  if (latlngs.length >= 3) {
    map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24], maxZoom: 14 })
  } else if (latlngs.length > 0) {
    map.setView(latlngs[latlngs.length - 1], 12, { animate: false })
  }
}

function onMapClick(e) {
  if (applyingFromParent) return
  const next = [
    ...props.modelValue.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
    })),
    { lat: e.latlng.lat, lng: e.latlng.lng },
  ]
  emit('update:modelValue', next)
}

function init() {
  if (!elRef.value) return
  map = L.map(elRef.value, {
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: true,
    preferCanvas: true,
  })
  L.control.zoom({ position: 'topright' }).addTo(map)
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution: '© OSM © CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  ).addTo(map)
  map.setView([40.7128, -74.006], 11, { animate: false })
  map.on('click', onMapClick)
  applyingFromParent = true
  syncPolygon(props.modelValue)
  applyingFromParent = false
  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 200)
  })
}

function destroy() {
  if (map) {
    map.off('click', onMapClick)
    map.remove()
    map = null
  }
  polyLayer = null
}

watch(
  () => props.modelValue,
  (v) => {
    applyingFromParent = true
    syncPolygon(Array.isArray(v) ? v : [])
    applyingFromParent = false
  },
  { deep: true },
)

onMounted(() => {
  nextTick(() => init())
})

onBeforeUnmount(() => {
  destroy()
})

defineExpose({
  invalidateSize() {
    nextTick(() => {
      map?.invalidateSize()
      setTimeout(() => map?.invalidateSize(), 120)
    })
  },
})
</script>

<template>
  <div class="geo-fence-map-wrap">
    <div
      ref="elRef"
      class="geo-fence-map"
      role="application"
      aria-label="Tap map to add corners of allowed area"
    />
    <p class="geo-fence-hint">
      Tap the map to add corner points (at least three). Pinch to zoom, drag to pan. Use the Undo / Clear
      buttons in Settings below this map. Visitors outside this area can be redirected when auto redirect is
      enabled.
    </p>
  </div>
</template>

<style scoped>
.geo-fence-map-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
}

.geo-fence-map {
  width: 100%;
  height: min(420px, 55vh);
  min-height: 240px;
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.08));
  touch-action: manipulation;
}

.geo-fence-hint {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.45;
  color: var(--color-text-secondary, #a8a8b8);
}
</style>
