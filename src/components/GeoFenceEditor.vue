<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'

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
/** @type {L.Polygon | null} */
let fencePolygon = null

function ringFromModel(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return []
  return pts
    .filter(
      (p) =>
        p &&
        Number.isFinite(Number(p.lat)) &&
        Number.isFinite(Number(p.lng)),
    )
    .map((p) => L.latLng(Number(p.lat), Number(p.lng)))
}

function emitFromLayer(layer) {
  const latlngs = layer.getLatLngs()
  const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs
  if (!Array.isArray(ring) || ring.length < 3) return
  const next = ring.map((ll) => ({
    lat: ll.lat,
    lng: ll.lng,
  }))
  emit('update:modelValue', next)
}

function removeFenceLayer() {
  if (fencePolygon && map) {
    try {
      map.removeLayer(fencePolygon)
    } catch {
      /* ignore */
    }
  }
  fencePolygon = null
}

function applyModelToMap(pts) {
  if (!map) return
  removeFenceLayer()
  const ring = ringFromModel(pts)
  if (ring.length < 3) return
  fencePolygon = L.polygon(ring, {
    color: '#a78bfa',
    weight: 2,
    fillColor: '#7b4db5',
    fillOpacity: 0.22,
  }).addTo(map)
  /** @type {any} */ (fencePolygon).pm?.enable()
  fencePolygon.on('pm:update', (e) => {
    const layer = /** @type {L.Polygon} */ (e.target)
    emitFromLayer(layer)
  })
  fencePolygon.on('pm:drag', (e) => {
    const layer = /** @type {L.Polygon} */ (e.target)
    emitFromLayer(layer)
  })
  map.fitBounds(fencePolygon.getBounds(), { padding: [28, 28], maxZoom: 14 })
}

function onPmCreate(e) {
  const layer = /** @type {L.Layer} */ (e.layer)
  removeFenceLayer()
  if (layer instanceof L.Polygon) {
    fencePolygon = layer
    layer.on('pm:update', (ev) => emitFromLayer(/** @type {L.Polygon} */ (ev.target)))
    emitFromLayer(layer)
  }
}

function init() {
  if (!elRef.value) return
  map = L.map(elRef.value, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
    tap: true,
  })
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution: '© OSM © CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  ).addTo(map)
  map.setView([40.7128, -74.006], 11, { animate: false })

  // Geoman adds .pm to L.Map
  const m = /** @type {any} */ (map)
  m.pm.setLang('en')
  m.pm.addControls({
    position: 'topleft',
    drawPolygon: true,
    drawMarker: false,
    drawPolyline: false,
    drawRectangle: false,
    drawCircle: false,
    drawCircleMarker: false,
    editMode: true,
    dragMode: true,
    cutPolygon: false,
    removalMode: true,
    rotateMode: false,
    oneBlock: true,
  })
  m.pm.setGlobalOptions({
    pathOptions: {
      color: '#a78bfa',
      fillColor: '#7b4db5',
      fillOpacity: 0.22,
    },
    snappable: true,
    snapDistance: 24,
  })

  map.on('pm:create', onPmCreate)
  applyModelToMap(props.modelValue)
  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 200)
  })
}

function destroy() {
  if (map) {
    map.off('pm:create', onPmCreate)
    map.remove()
    map = null
  }
  fencePolygon = null
}

watch(
  () => props.modelValue,
  (v) => {
    if (!map) return
    const ring = ringFromModel(Array.isArray(v) ? v : [])
    const raw = fencePolygon ? fencePolygon.getLatLngs() : null
    const outer = Array.isArray(raw?.[0]) ? raw[0] : raw
    const cur = Array.isArray(outer) ? outer : null
    const same =
      cur &&
      ring.length === cur.length &&
      ring.every(
        (ll, i) =>
          Math.abs(ll.lat - cur[i].lat) < 1e-8 &&
          Math.abs(ll.lng - cur[i].lng) < 1e-8,
      )
    if (!same) applyModelToMap(Array.isArray(v) ? v : [])
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
      aria-label="Draw allowed area on map"
    />
    <p class="geo-fence-hint">
      <strong>Draw</strong> the allowed region with the polygon tool (touch-friendly). Drag corners to
      adjust, or use remove to start over. At least three corners are required. Visitors outside this
      area can be redirected when auto redirect is enabled.
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
  height: min(460px, 62vh);
  min-height: 280px;
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.08));
  touch-action: none;
}

.geo-fence-hint {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.45;
  color: var(--color-text-secondary, #a8a8b8);
}

.geo-fence-hint strong {
  font-weight: 600;
  color: var(--color-text-primary, #e4e4eb);
}

/* Geoman toolbar: slightly larger tap targets on small screens */
:deep(.leaflet-pm-toolbar a) {
  min-width: 34px;
  min-height: 34px;
}
</style>
