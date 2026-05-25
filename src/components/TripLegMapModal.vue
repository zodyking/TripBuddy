<script setup>
import { ref, watch, onBeforeUnmount, nextTick, useId } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { mapPinPreviewIcon, userLocationTruckIcon } from '../utils/mapMarkers.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  originLat: { type: Number, default: null },
  originLng: { type: Number, default: null },
  destLat: { type: Number, default: null },
  destLng: { type: Number, default: null },
  originLabel: { type: String, default: 'Origin' },
  destLabel: { type: String, default: 'Destination' },
  truckLat: { type: Number, default: null },
  truckLng: { type: Number, default: null },
  tractorNumber: { type: String, default: '' },
  zIndex: { type: Number, default: 2147483003 },
})

const emit = defineEmits(['close'])
const titleId = useId()

const elRef = ref(null)
/** @type {L.Map | null} */
let map = null
/** @type {L.LayerGroup | null} */
let overlayLayer = null

function destroyMap() {
  overlayLayer = null
  if (map) {
    map.remove()
    map = null
  }
}

function validCoord(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  )
}

function sync() {
  if (!map) return
  if (overlayLayer) {
    map.removeLayer(overlayLayer)
    overlayLayer = null
  }
  const oOk = validCoord(props.originLat, props.originLng)
  const dOk = validCoord(props.destLat, props.destLng)
  if (!oOk || !dOk) return

  overlayLayer = L.layerGroup().addTo(map)
  const oll = L.latLng(props.originLat, props.originLng)
  const dll = L.latLng(props.destLat, props.destLng)
  const boundsPts = [oll, dll]

  L.polyline([oll, dll], {
    color: '#a855f7',
    weight: 5,
    opacity: 0.92,
    lineJoin: 'round',
    lineCap: 'round',
  }).addTo(overlayLayer)

  const oLabel = String(props.originLabel ?? '').trim() || 'Origin'
  const dLabel = String(props.destLabel ?? '').trim() || 'Destination'

  const mkO = L.marker(oll, { icon: mapPinPreviewIcon(), title: oLabel })
  mkO.bindTooltip(oLabel, { direction: 'top', offset: [0, -44], opacity: 0.95 })
  mkO.addTo(overlayLayer)

  const mkD = L.marker(dll, { icon: mapPinPreviewIcon(), title: dLabel })
  mkD.bindTooltip(dLabel, { direction: 'top', offset: [0, -44], opacity: 0.95 })
  mkD.addTo(overlayLayer)

  if (validCoord(props.truckLat, props.truckLng)) {
    const tll = L.latLng(props.truckLat, props.truckLng)
    boundsPts.push(tll)
    const raw = String(props.tractorNumber ?? '').trim()
    const mkT = L.marker(tll, { icon: userLocationTruckIcon(raw), title: 'Your position' })
    mkT.bindTooltip('Your position', { direction: 'top', offset: [0, -48], opacity: 0.95 })
    mkT.addTo(overlayLayer)
  }

  map.fitBounds(L.latLngBounds(boundsPts), {
    padding: [52, 52],
    maxZoom: 14,
    animate: false,
  })
}

function initMap() {
  destroyMap()
  if (!elRef.value || !props.open) return
  map = L.map(elRef.value, {
    zoomControl: false,
    attributionControl: true,
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
  sync()
  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => {
      map?.invalidateSize()
      sync()
    }, 200)
  })
}

watch(
  () => [
    props.open,
    props.originLat,
    props.originLng,
    props.destLat,
    props.destLng,
    props.truckLat,
    props.truckLng,
    props.tractorNumber,
  ],
  () => {
    if (!props.open) {
      destroyMap()
      return
    }
    nextTick(() => {
      if (!map) initMap()
      else sync()
    })
  },
)

watch(
  () => [props.originLat, props.originLng, props.destLat, props.destLng, props.truckLat, props.truckLng],
  () => {
    if (props.open && map) sync()
  },
)

onBeforeUnmount(() => {
  destroyMap()
})

function onBackdrop() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="trip-leg-map-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :style="{ zIndex: props.zIndex }"
      tabindex="-1"
      @click.self="onBackdrop"
      @keydown.escape.prevent="emit('close')"
    >
      <div class="trip-leg-map-modal" @click.stop>
        <header class="trip-leg-map-head">
          <div class="trip-leg-map-titles">
            <h2 :id="titleId" class="trip-leg-map-title">Leg map</h2>
            <p class="trip-leg-map-sub">Origin, destination, and your GPS when available</p>
          </div>
          <button type="button" class="trip-leg-map-close tap" aria-label="Close map" @click="emit('close')">
            ×
          </button>
        </header>
        <div ref="elRef" class="trip-leg-map-canvas" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.trip-leg-map-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(env(safe-area-inset-top), 1rem) max(env(safe-area-inset-right), 1rem)
    max(env(safe-area-inset-bottom), 1rem) max(env(safe-area-inset-left), 1rem);
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}

.trip-leg-map-modal {
  width: min(96vw, 52rem);
  height: min(85vh, 40rem);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl, 1rem);
  overflow: hidden;
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.1));
  background: #16161e;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}

.trip-leg-map-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: #1e1e26;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.trip-leg-map-titles {
  min-width: 0;
}

.trip-leg-map-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}

.trip-leg-map-sub {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-secondary, #a8a8b8);
  word-break: break-word;
}

.trip-leg-map-close {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary, #f4f4f8);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.trip-leg-map-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.trip-leg-map-canvas {
  flex: 1;
  min-height: 0;
  width: 100%;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #1a1a22;
}
</style>
