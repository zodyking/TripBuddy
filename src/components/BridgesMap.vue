<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/leaflet.markercluster-src.js'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

const DEFAULT_CENTER = Object.freeze([40.7128, -74.006])
const DEFAULT_ZOOM = 10

/**
 * @typedef {object} BridgeMapPin
 * @property {string} id
 * @property {number} lat
 * @property {number} lng
 * @property {string} title
 * @property {string} minutes
 * @property {string} trendKey
 * @property {string} trendIcon
 * @property {string} trendFull
 * @property {boolean} isPick
 * @property {boolean} isClosed
 * @property {number} rank
 */

const props = defineProps({
  /** @type {import('vue').PropType<BridgeMapPin[]>} */
  pins: { type: Array, required: true },
  highlightId: { type: String, default: '' },
  fillHeight: { type: Boolean, default: false },
  travelDirection: { type: String, default: 'ToNY' },
})

const emit = defineEmits(['select'])

const tomtomKey = (import.meta.env.VITE_TOMTOM_KEY || '').trim()
const canTraffic = computed(
  () => tomtomKey.length > 0,
)

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */ (null),
)
const geoTracking = ref(false)
const geoPending = ref(false)
const geoDenied = ref(false)
/** @type {number | null} */
let geoWatchId = null

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
/** @type {L.TileLayer | null} */
let trafficLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
const trafficOn = ref(false)
/** @type {import('leaflet').MarkerClusterGroup | null} */
let markerLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {L.CircleMarker | null} */
let userMarker = null
/** @type {L.Circle | null} */
let userAccuracyCircle = null
/** @type {Map<string, L.Marker>} */
const markersById = new Map()

/** Last structure (ids + positions + direction) — refit only when this changes */
const prevStructKey = ref('')

function structureKey() {
  return `${props.travelDirection}:${JSON.stringify(
    props.pins.map((p) => ({
      i: String(/** @type {BridgeMapPin} */(p).id),
      la: /** @type {BridgeMapPin} */(p).lat,
      ln: /** @type {BridgeMapPin} */(p).lng,
    })),
  )}`
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * @param {string} s
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {BridgeMapPin} p
 * @param {boolean} selected
 */
function buildPinIconHtml(p, selected) {
  const sel = selected ? ' is-selected' : ''
  const pick = p.isPick && !p.isClosed ? ' is-pick' : ''
  const closed = p.isClosed ? ' is-closed' : ''
  const tcls =
    p.trendKey === 'worse'
      ? 't-w'
      : p.trendKey === 'better'
        ? 't-b'
        : p.trendKey === 'neutral'
          ? 't-n'
          : 't-u'
  return `<div class="bridge-map-pin${sel}${pick}${closed}"><div class="bpi-top"><span class="bpi-rank" aria-hidden="true">${esc(
    String(p.rank),
  )}</span><span class="bpi-t">${esc(
    p.title,
  )}</span></div><div class="bpi-row"><span class="bpi-min">${esc(
    p.minutes,
  )}</span><span class="bpi-trend ${tcls}" title="${esc(
    p.trendFull,
  )}">${esc(
    p.trendIcon,
  )}</span></div></div><div class="bpi-stem" aria-hidden="true"></div>`
}

/**
 * @param {BridgeMapPin} p
 * @param {boolean} selected
 */
function makeBridgeIcon(p, selected) {
  return L.divIcon({
    className: 'bridge-map-div-icon',
    html: buildPinIconHtml(p, selected),
    iconSize: [100, 72],
    iconAnchor: [50, 80],
  })
}

function clusterCreate(cluster) {
  const n = cluster.getChildCount()
  return L.divIcon({
    html: `<div class="bclus-ico"><span>${n}</span></div>`,
    className: 'bclus-wrap',
    iconSize: [44, 44],
  })
}

function allBoundsLatLngs() {
  /** @type {L.LatLng[]} */
  const pts = []
  for (const p of props.pins) {
    const x = /** @type {BridgeMapPin} */(p)
    const la = Number(x.lat)
    const ln = Number(x.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    pts.push(L.latLng(la, ln))
  }
  const u = userFix.value
  if (u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
    pts.push(L.latLng(u.lat, u.lng))
  }
  return pts
}

/**
 * @param {boolean} pinsOrDirChanged
 */
function applyDefaultOrFitView(pinsOrDirChanged) {
  if (!map) return
  const motion = !prefersReducedMotion()
  const pts = allBoundsLatLngs()

  if (pts.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    return
  }
  if (pts.length === 1) {
    map.setView(pts[0], 12, { animate: pinsOrDirChanged && motion })
    return
  }
  const b = L.latLngBounds(pts)
  map.fitBounds(b, {
    padding: [40, 40],
    maxZoom: 12,
    animate: pinsOrDirChanged && motion,
  })
}

function syncUserOverlay() {
  if (!map || !userLayer) return
  const u = userFix.value
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) {
    if (userMarker) {
      userLayer.removeLayer(userMarker)
      userMarker = null
    }
    if (userAccuracyCircle) {
      userLayer.removeLayer(userAccuracyCircle)
      userAccuracyCircle = null
    }
    return
  }
  const ll = L.latLng(u.lat, u.lng)
  const acc = Number.isFinite(u.accuracyM) && u.accuracyM > 0 ? u.accuracyM : 40
  if (userAccuracyCircle) {
    userAccuracyCircle.setLatLng(ll)
    userAccuracyCircle.setRadius(acc)
  } else {
    userAccuracyCircle = L.circle(ll, {
      radius: acc,
      color: '#7c3aed',
      fillColor: '#7c3aed',
      fillOpacity: 0.1,
      weight: 1,
      opacity: 0.4,
    }).addTo(userLayer)
  }
  if (!userMarker) {
    userMarker = L.circleMarker(ll, {
      radius: 6,
      stroke: true,
      color: '#c4b5fd',
      weight: 2.5,
      fillColor: '#0c0a12',
      fillOpacity: 1,
    })
    userMarker.bindTooltip('Your location', { direction: 'top', offset: [0, -8] })
    userMarker.addTo(userLayer)
  } else {
    userMarker.setLatLng(ll)
  }
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean }} [opts]
 */
function applyGeolocationPosition(pos, opts = {}) {
  const fitCamera = opts.fitCamera !== false
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = {
    lat,
    lng,
    accuracyM: Number.isFinite(/** @type {number} */(acc)) ? acc : 40,
  }
  geoDenied.value = false
  geoPending.value = false
  syncUserOverlay()
  if (!map || !fitCamera) return
  const motion = !prefersReducedMotion()
  const pinPts = []
  for (const p of props.pins) {
    const x = /** @type {BridgeMapPin} */(p)
    if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng)) continue
    pinPts.push(L.latLng(x.lat, x.lng))
  }
  const ull = L.latLng(lat, lng)
  const all = [...pinPts, ull]
  if (all.length === 1) {
    map.setView(ull, 14, { animate: !motion })
  } else {
    map.fitBounds(L.latLngBounds(all), {
      padding: [48, 48],
      maxZoom: 14,
      animate: !motion,
    })
  }
}

function clearGeoWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

function stopUserTracking() {
  clearGeoWatch()
  geoTracking.value = false
  geoPending.value = false
  userFix.value = null
  syncUserOverlay()
  applyDefaultOrFitView(true)
}

function toggleMyLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    geoDenied.value = true
    return
  }
  if (geoTracking.value) {
    stopUserTracking()
    return
  }
  geoDenied.value = false
  geoPending.value = true
  geoTracking.value = true
  const gopts = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      applyGeolocationPosition(pos, { fitCamera: true })
      geoWatchId = navigator.geolocation.watchPosition(
        (p) => applyGeolocationPosition(p, { fitCamera: false }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
      )
    },
    () => {
      geoPending.value = false
      geoDenied.value = true
      geoTracking.value = false
    },
    gopts,
  )
}

function setBaseLayer(mode) {
  if (!map || !streetLayer || !satelliteLayer) return
  activeBaseLayer.value = mode
  if (mode === 'satellite') {
    map.removeLayer(streetLayer)
    satelliteLayer.addTo(map)
  } else {
    map.removeLayer(satelliteLayer)
    streetLayer.addTo(map)
  }
  syncTrafficLayer()
}

function syncTrafficLayer() {
  if (!map || !trafficLayer) return
  if (
    !canTraffic.value ||
    activeBaseLayer.value === 'satellite' ||
    !trafficOn.value
  ) {
    if (map.hasLayer(trafficLayer)) map.removeLayer(trafficLayer)
    return
  }
  if (!map.hasLayer(trafficLayer)) trafficLayer.addTo(map)
}

function toggleSatellite() {
  setBaseLayer(activeBaseLayer.value === 'street' ? 'satellite' : 'street')
}

function toggleTraffic() {
  if (!canTraffic.value || activeBaseLayer.value === 'satellite') return
  trafficOn.value = !trafficOn.value
  syncTrafficLayer()
}

const lastPannedHighlightId = ref('')

/**
 * Pan to the currently highlighted marker (e.g. after list pick). Does not run on
 * silent poll refreshes when the same crossing stays selected.
 */
function panToCurrentHighlight() {
  if (!map || !markerLayer || !props.highlightId) return
  const m = markersById.get(props.highlightId)
  if (!m) return
  const motion = !prefersReducedMotion()
  const clusterGroup = /** @type {L.MarkerClusterGroup} */(markerLayer)
  const doPan = () => {
    if (!map) return
    map.panTo(m.getLatLng(), { animate: !motion })
  }
  if (clusterGroup.zoomToShowLayer) {
    clusterGroup.zoomToShowLayer(m, doPan)
  } else {
    doPan()
  }
}

function syncMarkers() {
  if (!map || !markerLayer) return

  const st = structureKey()
  const structureChanged = st !== prevStructKey.value
  if (structureChanged) {
    prevStructKey.value = st
  }

  if (structureChanged) {
    markerLayer.clearLayers()
    markersById.clear()
    for (const raw of props.pins) {
      const p = /** @type {BridgeMapPin} */(raw)
      const la = Number(p.lat)
      const ln = Number(p.lng)
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
      const id = String(p.id)
      const selected = props.highlightId === id
      const m = L.marker([la, ln], { icon: makeBridgeIcon(p, selected) })
      m.on('click', () => emit('select', id))
      m.addTo(markerLayer)
      markersById.set(id, m)
    }
    if (/** @type {L.MarkerClusterGroup} */(markerLayer).refreshClusters) {
      /** @type {L.MarkerClusterGroup} */(markerLayer).refreshClusters()
    }
    applyDefaultOrFitView(true)
    if (props.highlightId) {
      setTimeout(() => {
        if (!props.highlightId) return
        lastPannedHighlightId.value = props.highlightId
        panToCurrentHighlight()
      }, 100)
    } else {
      lastPannedHighlightId.value = ''
    }
  } else {
    const want = new Set(
      props.pins
        .map((x) => {
          const p = /** @type {BridgeMapPin} */(x)
          const la = Number(p.lat)
          const ln = Number(p.lng)
          if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
          return String(p.id)
        })
        .filter((x) => x != null),
    )
    for (const [id, m] of markersById) {
      if (!want.has(id)) {
        markerLayer.removeLayer(m)
        markersById.delete(id)
      }
    }
    for (const raw of props.pins) {
      const p = /** @type {BridgeMapPin} */(raw)
      const la = Number(p.lat)
      const ln = Number(p.lng)
      if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
      const id = String(p.id)
      const selected = props.highlightId === id
      const existing = markersById.get(id)
      if (existing) {
        const nextIcon = makeBridgeIcon(p, selected)
        if (existing.getIcon() !== nextIcon) {
          existing.setIcon(nextIcon)
        }
        const cur = existing.getLatLng()
        if (cur.lat !== la || cur.lng !== ln) {
          existing.setLatLng([la, ln])
        }
      } else {
        const m = L.marker([la, ln], { icon: makeBridgeIcon(p, selected) })
        m.on('click', () => emit('select', id))
        m.addTo(markerLayer)
        markersById.set(id, m)
      }
    }
    if (/** @type {L.MarkerClusterGroup} */(markerLayer).refreshClusters) {
      /** @type {L.MarkerClusterGroup} */(markerLayer).refreshClusters()
    }
    if (!props.highlightId) {
      lastPannedHighlightId.value = ''
    } else if (props.highlightId !== lastPannedHighlightId.value) {
      lastPannedHighlightId.value = props.highlightId
      setTimeout(() => {
        if (props.highlightId === lastPannedHighlightId.value) {
          panToCurrentHighlight()
        }
      }, 40)
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
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)

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
  if (canTraffic.value) {
    trafficLayer = L.tileLayer(
      `https://{s}.api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(
        tomtomKey,
      )}`,
      {
        subdomains: ['1', '2', '3', '4'],
        maxZoom: 22,
        opacity: 0.7,
        zIndex: 400,
      },
    )
  } else {
    trafficLayer = null
  }

  activeBaseLayer.value = 'street'
  streetLayer.addTo(map)
  /* @ts-ignore — added by plugin */
  markerLayer = L.markerClusterGroup({
    maxClusterRadius: 52,
    disableClusteringAtZoom: 15,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: clusterCreate,
  })
  markerLayer.addTo(map)
  userLayer = L.layerGroup().addTo(map)
  if (trafficOn.value && canTraffic.value) {
    syncTrafficLayer()
  }

  syncMarkers()
  syncUserOverlay()
  nextTick(() => {
    map?.invalidateSize()
  })
}

function destroyMap() {
  clearGeoWatch()
  markersById.clear()
  userMarker = null
  userAccuracyCircle = null
  if (map) {
    map.remove()
    map = null
  }
  markerLayer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
  trafficLayer = null
  prevStructKey.value = ''
  lastPannedHighlightId.value = ''
}

/** @type {ResizeObserver | null} */
let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    initMap()
    if (props.fillHeight && containerRef.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        nextTick(() => map?.invalidateSize())
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
  () => [props.pins, props.highlightId, props.travelDirection, props.fillHeight],
  () => {
    syncMarkers()
    syncUserOverlay()
    nextTick(() => map?.invalidateSize())
  },
  { deep: true },
)
</script>

<template>
  <div
    class="bmap bmap-root"
    :class="{ 'bmap-root--fill': fillHeight }"
    role="region"
    aria-label="Bridge crossing map"
  >
    <div ref="containerRef" class="bmap-el" />
    <div class="bmap-toolbar">
      <button
        type="button"
        class="bmap-btn tap"
        :class="{ 'is-on': activeBaseLayer === 'satellite' }"
        :aria-pressed="activeBaseLayer === 'satellite'"
        title="Satellite imagery"
        @click="toggleSatellite"
      >Sat</button>
      <button
        v-if="canTraffic"
        type="button"
        class="bmap-btn tap"
        :class="{
          'is-on': trafficOn && activeBaseLayer === 'street',
          'is-off': !trafficOn,
          'is-dim': activeBaseLayer === 'satellite',
        }"
        :aria-pressed="trafficOn && activeBaseLayer === 'street'"
        :disabled="activeBaseLayer === 'satellite'"
        :title="activeBaseLayer === 'satellite' ? 'Traffic (street only)' : 'Toggle traffic layer'"
        @click="toggleTraffic"
      >Traff</button>
      <p v-else class="bmap-hint" title="Set VITE_TOMTOM_KEY in .env for live traffic on the map.">
        No traffic key
      </p>
      <button
        type="button"
        class="bmap-btn tap"
        :class="{ 'is-on': geoTracking, 'is-warn': geoDenied }"
        :aria-pressed="geoTracking"
        :title="geoDenied ? 'Location denied' : (geoPending ? 'Getting location…' : 'Show my location')"
        :disabled="geoPending"
        @click="toggleMyLocation"
      >My loc</button>
    </div>
  </div>
</template>

<style scoped>
.bmap-root {
  position: relative;
  width: 100%;
  min-height: min(38vh, 16rem);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #26262e;
  background: #08080a;
  flex: 0 0 auto;
}
.bmap-root--fill {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  border-radius: 0;
  border: 0;
}
.bmap-el {
  width: 100%;
  height: 100%;
  min-height: min(38vh, 16rem);
}
.bmap-root--fill .bmap-el {
  min-height: 0;
  flex: 1;
  height: 100%;
}
.bmap-toolbar {
  position: absolute;
  right: 0.4rem;
  top: 0.4rem;
  z-index: 600;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  align-items: flex-end;
  pointer-events: auto;
}
.bmap-btn {
  min-width: 3.1rem;
  min-height: 1.8rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(199, 168, 255, 0.35);
  background: rgba(8, 8, 10, 0.82);
  color: #a8a8b8;
  font-size: 0.6rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  -webkit-tap-highlight-color: transparent;
}
.bmap-btn.is-on {
  border-color: rgba(123, 77, 181, 0.65);
  color: #ede9fe;
  background: linear-gradient(160deg, rgba(80, 50, 120, 0.55), rgba(20, 10, 40, 0.5));
}
.bmap-btn.is-warn {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.4);
}
.bmap-btn:disabled {
  opacity: 0.55;
}
.bmap-hint {
  margin: 0;
  max-width: 4.2rem;
  text-align: right;
  font-size: 0.5rem;
  line-height: 1.2;
  color: #5c5c6a;
  font-weight: 700;
}
:deep(.leaflet-container) {
  font-family: var(--font-sans, system-ui, sans-serif);
  background: #0a0a0e;
}
:deep(.leaflet-control-zoom a) {
  background: rgba(12, 12, 18, 0.92) !important;
  color: #b8b8c8 !important;
  border-color: #2a2a32 !important;
  line-height: 26px;
}
:deep(.leaflet-control-attribution) {
  background: rgba(8, 8, 12, 0.6) !important;
  color: #6a6a78 !important;
  font-size: 9px;
  max-width: 50%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
:deep(.bclus-wrap) {
  background: none;
  border: 0;
}
:deep(.bclus-ico) {
  min-width: 2.2rem;
  min-height: 2.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: linear-gradient(145deg, rgba(100, 60, 150, 0.95), rgba(40, 20, 70, 0.9));
  border: 2px solid rgba(199, 168, 255, 0.5);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  color: #faf5ff;
  font-size: 0.75rem;
  font-weight: 900;
}
:deep(.bridge-map-div-icon) {
  background: none;
  border: 0;
}
:deep(.bridge-map-pin) {
  width: 5.2rem;
  min-height: 2.6rem;
  background: linear-gradient(180deg, #16161e, #0e0e12);
  border: 1px solid #34343e;
  border-radius: 8px;
  padding: 0.2rem 0.28rem 0.25rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  box-sizing: border-box;
  font-size: 0.55rem;
  line-height: 1.15;
}
:deep(.bridge-map-pin.is-pick) {
  border-color: rgba(52, 211, 153, 0.5);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.1), 0 2px 10px rgba(0, 0, 0, 0.4);
}
:deep(.bridge-map-pin.is-closed) {
  opacity: 0.6;
  filter: grayscale(0.35);
}
:deep(.bridge-map-pin.is-selected) {
  border-color: rgba(167, 139, 250, 0.6);
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.2), 0 2px 10px rgba(0, 0, 0, 0.45);
}
:deep(.bpi-top) {
  display: flex;
  align-items: flex-start;
  gap: 0.2rem;
  margin-bottom: 0.1rem;
}
:deep(.bpi-rank) {
  font-size: 0.5rem;
  font-weight: 800;
  color: #5c5c6c;
  min-width: 0.7rem;
  text-align: center;
}
:deep(.bpi-t) {
  color: #e8e2f0;
  font-weight: 800;
  max-height: 2.2em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
:deep(.bpi-row) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem;
  padding-top: 0.05rem;
  border-top: 1px solid #22222a;
  margin-top: 0.08rem;
}
:deep(.bpi-min) {
  font-size: 0.95rem;
  font-weight: 900;
  color: #ddd6f0;
  font-variant-numeric: tabular-nums;
}
:deep(.bpi-trend) {
  font-size: 0.65rem;
  font-weight: 800;
  opacity: 0.9;
}
:deep(.bpi-trend.t-w) {
  color: #f87171;
}
:deep(.bpi-trend.t-b) {
  color: #4ade80;
}
:deep(.bpi-trend.t-n) {
  color: #9ca3af;
}
:deep(.bpi-trend.t-u) {
  color: #6b7280;
}
:deep(.bpi-stem) {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid #2a2a32;
  margin: 0.05rem auto 0;
}
</style>
