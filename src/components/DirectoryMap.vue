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

/**
 * @typedef {{ locationId: string, lat: number, lng: number }} MapPin
 */

const props = defineProps({
  /** @type {import('vue').PropType<MapPin[]>} */
  pins: {
    type: Array,
    required: true,
  },
  highlightId: {
    type: String,
    default: '',
  },
  /** Fill parent height (split-pane directory layout); disables fixed min-height clamp. */
  fillHeight: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['select'])

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

/** @type {L.Map | null} */
let map = null
/** @type {L.LayerGroup | null} */
let markerLayer = null
/** @type {Map<string, L.Marker>} */
const markersById = new Map()

/** Signature of pin positions only — changes when filter/pins change, not when highlight changes */
const prevPinsSig = ref('')

function pinsSignature() {
  return JSON.stringify(
    props.pins.map((p) => ({
      i: String(p.locationId),
      la: p.lat,
      ln: p.lng,
    })),
  )
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function pinHtml(locationId, selected) {
  const esc = String(locationId)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const sel = selected ? ' is-selected' : ''
  return `<div class="directory-map-marker-ui"><div class="directory-map-pin-inner${sel}"><span class="directory-map-pin-label">${esc}</span></div><div class="directory-map-pin-stem" aria-hidden="true"></div></div>`
}

function syncMarkers() {
  if (!map || !markerLayer) return

  const sig = pinsSignature()
  const pinsChanged = sig !== prevPinsSig.value

  markerLayer.clearLayers()
  markersById.clear()

  const latlngs = []
  for (const p of props.pins) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const id = String(p.locationId)
    const selected = props.highlightId === id
    const icon = L.divIcon({
      className: 'directory-map-div-icon',
      html: pinHtml(id, selected),
      iconSize: [88, 56],
      iconAnchor: [44, 56],
    })

    const marker = L.marker([lat, lng], {
      icon,
      title: `Location ${id}`,
    })
    marker.on('click', () => {
      emit('select', id)
    })
    marker.addTo(markerLayer)
    markersById.set(id, marker)
    latlngs.push([lat, lng])
  }

  if (latlngs.length === 0) {
    prevPinsSig.value = sig
    return
  }

  const motion = prefersReducedMotion()

  if (pinsChanged) {
    prevPinsSig.value = sig
    if (latlngs.length === 1) {
      const ll = latlngs[0]
      map.setView(ll, 11, { animate: false })
    } else {
      const bounds = L.latLngBounds(latlngs)
      map.fitBounds(bounds, {
        padding: [36, 36],
        maxZoom: 14,
        animate: !motion,
      })
    }
  } else if (props.highlightId) {
    const m = markersById.get(props.highlightId)
    if (m) {
      map.panTo(m.getLatLng(), { animate: !motion })
    }
  }
}

function initMap() {
  if (!containerRef.value) return

  map = L.map(containerRef.value, {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: true,
  })

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  ).addTo(map)

  markerLayer = L.layerGroup().addTo(map)

  syncMarkers()

  nextTick(() => {
    map?.invalidateSize()
  })
}

function destroyMap() {
  markersById.clear()
  if (map) {
    map.remove()
    map = null
  }
  markerLayer = null
}

/** @type {ResizeObserver | null} */
let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    initMap()
    if (props.fillHeight && containerRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => {
          map?.invalidateSize()
        })
      })
      resizeObserver.observe(containerRef.value)
    }
  })
})

onBeforeUnmount(() => {
  if (resizeObserver && containerRef.value) {
    resizeObserver.unobserve(containerRef.value)
  }
  resizeObserver = null
  destroyMap()
})

watch(
  () => [props.pins, props.highlightId, props.fillHeight],
  () => {
    syncMarkers()
    nextTick(() => {
      map?.invalidateSize()
    })
  },
  { deep: true },
)
</script>

<template>
  <div
    class="directory-map-root"
    :class="{ 'is-fill': fillHeight }"
    role="region"
    aria-label="Map of saved locations"
  >
    <div ref="containerRef" class="directory-map-el" />
  </div>
</template>

<style scoped>
.directory-map-root {
  width: 100%;
  border-radius: var(--radius-lg, 0.75rem);
  overflow: hidden;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.3));
  background: var(--color-bg-elevated, #12121a);
}

.directory-map-root.is-fill {
  height: 100%;
  min-height: 0;
  border-radius: 0;
  border-left: none;
  border-top: none;
  border-bottom: none;
  box-shadow: none;
}

.directory-map-el {
  width: 100%;
  min-height: clamp(16rem, 38vh, 22rem);
  height: clamp(16rem, 38vh, 22rem);
}

.directory-map-root.is-fill .directory-map-el {
  min-height: 0;
  height: 100%;
}

:deep(.leaflet-container) {
  font-family: inherit;
  background: #0e0e12;
}

:deep(.leaflet-control-zoom a) {
  background: rgba(22, 22, 29, 0.92);
  color: var(--color-text-primary, #f4f4f8);
  border-color: var(--color-border, rgba(255, 255, 255, 0.12));
}

:deep(.leaflet-control-zoom a:hover) {
  background: rgba(40, 40, 52, 0.95);
}

:deep(.leaflet-control-attribution) {
  font-size: 0.625rem;
  color: var(--color-text-tertiary, #6e6e7e);
  background: rgba(8, 8, 10, 0.75) !important;
  max-width: calc(100% - 1rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.leaflet-control-attribution a) {
  color: var(--color-accent-purple, #7b4db5);
}
</style>

<style>
/* Unscoped: Leaflet divIcon content lives outside Vue scope */
.directory-map-div-icon {
  background: transparent !important;
  border: none !important;
}

.directory-map-marker-ui {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 88px;
  height: 56px;
  pointer-events: auto;
}

.directory-map-pin-inner {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem 0.5rem;
  min-width: 2rem;
  border-radius: var(--radius-md, 0.5rem);
  background: linear-gradient(
    145deg,
    rgba(123, 77, 181, 0.95),
    rgba(90, 50, 140, 0.98)
  );
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  margin-bottom: 2px;
}

.directory-map-pin-inner.is-selected {
  border-color: rgba(255, 255, 255, 0.45);
  box-shadow:
    0 0 0 2px rgba(123, 77, 181, 0.5),
    0 4px 12px rgba(0, 0, 0, 0.5);
}

.directory-map-pin-label {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f4f4f8;
  line-height: 1.2;
  white-space: nowrap;
}

.directory-map-pin-stem {
  flex-shrink: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid rgba(90, 50, 140, 0.98);
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.35));
}

.leaflet-marker-icon.directory-map-div-icon {
  margin-left: 0 !important;
  margin-top: 0 !important;
}
</style>
