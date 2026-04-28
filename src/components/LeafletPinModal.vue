<script setup>
import { ref, watch, onBeforeUnmount, nextTick, useId } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { mapPinPreviewIcon } from '../utils/mapMarkers.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: 'Location' },
  subtitle: { type: String, default: '' },
  /** @type {number | null} */
  lat: { type: Number, default: null },
  /** @type {number | null} */
  lng: { type: Number, default: null },
  zoom: { type: Number, default: 15 },
  /** Multiple pins (e.g. directory overview); when set, fits bounds instead of single zoom. */
  pins: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits(['close'])
const titleId = useId()

const elRef = ref(/** @type {HTMLElement | null} */ (null))
/** @type {L.Map | null} */
let map = null
/** @type {L.LayerGroup | null} */
let markerLayer = null

function destroyMap() {
  markerLayer = null
  if (map) {
    map.remove()
    map = null
  }
}

function pinIcon() {
  return mapPinPreviewIcon()
}

function sync() {
  if (!map) return
  if (markerLayer) {
    map.removeLayer(markerLayer)
    markerLayer = null
  }
  const multi =
    Array.isArray(props.pins) &&
    props.pins.length > 0 &&
    props.pins.some(
      (p) =>
        p &&
        Number.isFinite(Number(p.lat)) &&
        Number.isFinite(Number(p.lng)),
    )
  if (multi) {
    markerLayer = L.layerGroup().addTo(map)
    /** @type {L.LatLng[]} */
    const latlngs = []
    for (const p of props.pins) {
      if (!p) continue
      const la = Number(p.lat)
      const ln = Number(p.lng)
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
      const ll = L.latLng(la, ln)
      latlngs.push(ll)
      const label = typeof p.label === 'string' ? p.label.trim() : ''
      const mk = L.marker(ll, {
        icon: pinIcon(),
        title: label || '',
      })
      if (label) {
        mk.bindTooltip(label, { direction: 'top', offset: [0, -42], opacity: 0.95 })
      }
      mk.addTo(markerLayer)
    }
    if (latlngs.length === 1) {
      map.setView(latlngs[0], props.zoom, { animate: false })
    } else if (latlngs.length > 1) {
      map.fitBounds(L.latLngBounds(latlngs), {
        padding: [40, 40],
        maxZoom: 14,
        animate: false,
      })
    }
    return
  }
  if (props.lat == null || props.lng == null) return
  if (!Number.isFinite(props.lat) || !Number.isFinite(props.lng)) return
  const ll = L.latLng(props.lat, props.lng)
  markerLayer = L.layerGroup().addTo(map)
  L.marker(ll, { icon: pinIcon() }).addTo(markerLayer)
  map.setView(ll, props.zoom, { animate: false })
}

function initMap() {
  destroyMap()
  if (!elRef.value || !props.open) return
  map = L.map(elRef.value, {
    zoomControl: true,
    attributionControl: true,
  })
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
  () => [props.open, props.lat, props.lng, props.pins],
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
  { deep: true },
)

watch(
  () => [props.lat, props.lng, props.pins],
  () => {
    if (props.open && map) sync()
  },
  { deep: true },
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
      class="leaflet-pin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @click.self="onBackdrop"
      @keyup.escape="emit('close')"
    >
      <div class="leaflet-pin-modal" @click.stop>
        <header class="leaflet-pin-modal-head">
          <div class="leaflet-pin-modal-titles">
            <h2 :id="titleId" class="leaflet-pin-modal-title">{{ title }}</h2>
            <p v-if="subtitle" class="leaflet-pin-modal-sub">{{ subtitle }}</p>
          </div>
          <button type="button" class="leaflet-pin-modal-close tap" aria-label="Close map" @click="emit('close')">
            ×
          </button>
        </header>
        <div ref="elRef" class="leaflet-pin-modal-map" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.leaflet-pin-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(env(safe-area-inset-top), 1rem) max(env(safe-area-inset-right), 1rem)
    max(env(safe-area-inset-bottom), 1rem) max(env(safe-area-inset-left), 1rem);
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
}

.leaflet-pin-modal {
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

.leaflet-pin-modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: #1e1e26;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.leaflet-pin-modal-titles {
  min-width: 0;
}

.leaflet-pin-modal-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}

.leaflet-pin-modal-sub {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-secondary, #a8a8b8);
  word-break: break-word;
}

.leaflet-pin-modal-close {
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

.leaflet-pin-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.leaflet-pin-modal-map {
  flex: 1;
  min-height: 0;
  width: 100%;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #1a1a22;
}
</style>
