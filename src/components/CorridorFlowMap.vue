<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { tomtomKeyEffective } from '../stores/trafficTileKey.js'
import { closestPointOnPolyline, pointDistanceM } from '../utils/polylineSnap.js'

const DEFAULT_CENTER = Object.freeze([40.661, -73.915])
const DEFAULT_ZOOM = 12

const hasTomtomTraffic = computed(() => tomtomKeyEffective.value.length > 0)

/**
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {{ ok?: boolean, currentSpeed?: number | null, freeFlowSpeed?: number | null, roadClosure?: boolean }} SegLike
 */

const props = defineProps({
  /** Full corridor path for baseline map fit */
  polyline: {
    type: Array,
    default: () => [],
  },
  /** Flow samples with lat/lon — used for colored legs (monitor mode) */
  segments: {
    type: Array,
    default: () => [],
  },
  /** When true, map adds / drags waypoints and shows preview geometry */
  editMode: { type: Boolean, default: false },
  /** Waypoints for route creation (lat/lng) */
  waypoints: {
    type: Array,
    default: () => [],
  },
  /** Optional preview polyline from TomTom Route Monitoring preview (lat/lng) */
  previewPolyline: {
    type: Array,
    default: () => [],
  },
  fillHeight: { type: Boolean, default: false },
  vehicleId: { type: String, default: '' },
})

const emit = defineEmits(['waypointsChange', 'removeWaypoint', 'addWaypoint'])

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

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
/** @type {L.LayerGroup | null} */
let routeLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {L.Marker | null} */
let userMarker = null

const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */ (null),
)
const geoTracking = ref(false)
const geoPending = ref(false)
const geoDenied = ref(false)
/** @type {number | null} */
let geoWatchId = null

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * @param {SegLike} s
 */
function segmentTier(s) {
  if (!s || s.ok === false) return /** @type {const} */ ('muted')
  if (s.roadClosure === true) return /** @type {const} */ ('red')
  const cur = Number(s.currentSpeed)
  const ff = Number(s.freeFlowSpeed)
  if (!Number.isFinite(cur) || !Number.isFinite(ff) || ff < 8) return /** @type {const} */ ('orange')
  const ratio = cur / ff
  if (ratio <= 0.55) return /** @type {const} */ ('red')
  if (ratio <= 0.85) return /** @type {const} */ ('orange')
  return /** @type {const} */ ('green')
}

const tierColor = {
  green: '#4ade80',
  orange: '#fb923c',
  red: '#f87171',
  muted: 'rgba(148,163,184,0.55)',
}

/**
 * @returns {L.LatLng[]}
 */
function polyLatLngs() {
  const arr = Array.isArray(props.polyline) ? props.polyline : []
  /** @type {L.LatLng[]} */
  const out = []
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue
    const lat = Number(p.lat)
    const lng = Number(p.lng ?? p.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    out.push(L.latLng(lat, lng))
  }
  return out
}

/** @type {L.LayerGroup | null} */
let editLayer = null
/** @type {(() => void) | null} */
let mapClickUnsub = null

function waypointLatLngs() {
  const arr = Array.isArray(props.waypoints) ? props.waypoints : []
  /** @type {L.LatLng[]} */
  const out = []
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue
    const lat = Number(p.lat)
    const lng = Number(p.lng ?? p.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    out.push(L.latLng(lat, lng))
  }
  return out
}

function previewLatLngs() {
  const arr = Array.isArray(props.previewPolyline) ? props.previewPolyline : []
  /** @type {L.LatLng[]} */
  const out = []
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue
    const lat = Number(p.lat ?? p.latitude)
    const lng = Number(p.lng ?? p.lon ?? p.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    out.push(L.latLng(lat, lng))
  }
  return out
}

function emitWaypointsFromLatLngs(pts) {
  const next = pts.map((ll) => ({ lat: ll.lat, lng: ll.lng }))
  emit('waypointsChange', next)
}

function previewPlainPoints() {
  const prev = previewLatLngs()
  return prev.map((ll) => ({ lat: ll.lat, lng: ll.lng }))
}

function waypointIcon(isFirst, showRemove) {
  const rm =
    showRemove ?
      `<button type="button" class="corridor-wp-rm tap" aria-label="Remove waypoint" data-wp-rm="1">×</button>`
    : ''
  return L.divIcon({
    className: 'corridor-wp-marker',
    html: `<div class="corridor-wp-wrap">
      <span class="corridor-wp-dot" data-first="${isFirst ? '1' : '0'}"></span>${rm}
    </div>`,
    iconSize: showRemove ? [28, 26] : [22, 22],
    iconAnchor: showRemove ? [14, 13] : [11, 11],
  })
}

function syncEditOverlay() {
  if (!map || !editLayer) return
  editLayer.clearLayers()
  if (!props.editMode) return

  const wps = waypointLatLngs()
  const prev = previewLatLngs()

  if (prev.length >= 2) {
    L.polyline(prev, {
      color: '#c4b5fd',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      bubblingMouseEvents: true,
    }).addTo(editLayer)
  } else if (wps.length >= 2) {
    L.polyline(wps, {
      color: 'rgba(167, 139, 250, 0.45)',
      weight: 3,
      dashArray: '6 8',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(editLayer)
  }

  const showRm = wps.length > 1
  wps.forEach((ll, i) => {
    const m = L.marker(ll, {
      draggable: true,
      icon: waypointIcon(i === 0, showRm),
      zIndexOffset: 800,
    })
    m.on('dragend', () => {
      let ll = m.getLatLng()
      const plain = previewPlainPoints()
      if (plain.length >= 2) {
        const p = { lat: ll.lat, lng: ll.lng }
        const snap = closestPointOnPolyline(p, plain)
        if (pointDistanceM(p, snap) <= 400) {
          ll = L.latLng(snap.lat, snap.lng)
          m.setLatLng(ll)
        }
      }
      const base = waypointLatLngs()
      const next = base.map((p, j) => (j === i ? ll : p))
      emitWaypointsFromLatLngs(next)
    })
    m.on('add', () => {
      const el = m.getElement()
      if (!el) return
      const btn = el.querySelector('[data-wp-rm="1"]')
      if (!(btn instanceof HTMLButtonElement)) return
      L.DomEvent.on(btn, 'click mousedown', L.DomEvent.stopPropagation)
      L.DomEvent.on(btn, 'click', (ev) => {
        L.DomEvent.stop(ev)
        emit('removeWaypoint', i)
      })
    })
    m.addTo(editLayer)
  })

  nextTick(() => map?.invalidateSize())
}

function onMapClickEdit(e) {
  if (!props.editMode || !map) return
  const ll = e.latlng
  const wps = waypointLatLngs()
  const plain = previewPlainPoints()

  /** @type {{ lat: number, lng: number }} */
  let p = { lat: ll.lat, lng: ll.lng }
  if (wps.length >= 2 && plain.length >= 2) {
    const snap = closestPointOnPolyline(p, plain)
    const d = pointDistanceM(p, snap)
    if (d <= 280) {
      p = { lat: snap.lat, lng: snap.lng }
    }
  }

  emit('addWaypoint', p)
}

function syncRouteOverlay() {
  if (!map || !routeLayer) return
  routeLayer.clearLayers()
  if (props.editMode) {
    nextTick(() => map?.invalidateSize())
    return
  }
  const base = polyLatLngs()
  if (base.length >= 2) {
    L.polyline(base, {
      color: 'rgba(148,163,184,0.35)',
      weight: 5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeLayer)
  }

  const segs = Array.isArray(props.segments) ? props.segments : []
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i]
    const b = segs[i + 1]
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') continue
    const la = Number(a.lat)
    const loa = Number(a.lon ?? a.lng)
    const lb = Number(b.lat)
    const lob = Number(b.lon ?? b.lng)
    if (
      !Number.isFinite(la) ||
      !Number.isFinite(loa) ||
      !Number.isFinite(lb) ||
      !Number.isFinite(lob)
    ) {
      continue
    }
    const t = segmentTier(/** @type {SegLike} */ (a))
    const col = tierColor[t] || tierColor.muted
    L.polyline(
      [
        [la, loa],
        [lb, lob],
      ],
      {
        color: col,
        weight: 6,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
      },
    ).addTo(routeLayer)
  }

  nextTick(() => map?.invalidateSize())
}

function fitCorridor() {
  if (!map) return
  const motion = prefersReducedMotion()
  if (props.editMode) {
    const prev = previewLatLngs()
    const wps = waypointLatLngs()
    const pts = prev.length >= 2 ? prev : wps.length >= 2 ? wps : []
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts), {
        padding: [36, 44],
        maxZoom: 14,
        animate: !motion,
      })
    } else if (wps.length === 1) {
      map.setView(wps[0], 13, { animate: !motion })
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: !motion })
    }
    return
  }
  const pts = polyLatLngs()
  if (pts.length >= 2) {
    map.fitBounds(L.latLngBounds(pts), {
      padding: [36, 44],
      maxZoom: 14,
      animate: !motion,
    })
  } else {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: !motion })
  }
}

function applyTrafficToMap() {
  if (!map || !trafficLayer) return
  if (trafficOn.value && activeBaseLayer.value === 'street') {
    trafficLayer.addTo(map)
  } else if (map.hasLayer(trafficLayer)) {
    map.removeLayer(trafficLayer)
  }
}

function setBaseLayer(which) {
  if (!map || !streetLayer || !satelliteLayer) return
  activeBaseLayer.value = which
  if (which === 'satellite') {
    map.removeLayer(streetLayer)
    satelliteLayer.addTo(map)
  } else {
    map.removeLayer(satelliteLayer)
    streetLayer.addTo(map)
  }
  applyTrafficToMap()
}

function toggleTraffic() {
  if (!hasTomtomTraffic.value) return
  trafficOn.value = !trafficOn.value
  applyTrafficToMap()
}

function syncUserOverlay() {
  if (!map || !userLayer) return
  const u = userFix.value
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) {
    if (userMarker) {
      userLayer.removeLayer(userMarker)
      userMarker = null
    }
    return
  }
  const ll = L.latLng(u.lat, u.lng)
  if (!userMarker) {
    userMarker = L.marker(ll, {
      icon: userLocationTruckIcon(props.vehicleId || ''),
      zIndexOffset: 600,
      title: 'Your location',
    })
    userMarker.addTo(userLayer)
  } else {
    userMarker.setLatLng(ll)
    userMarker.setIcon(userLocationTruckIcon(props.vehicleId || ''))
  }
}

/**
 * @param {GeolocationPosition} pos
 */
function applyGeo(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = { lat, lng, accuracyM: Number.isFinite(acc) ? acc : 40 }
  geoDenied.value = false
  geoPending.value = false
  syncUserOverlay()
}

function clearGeoWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

function stopTracking() {
  clearGeoWatch()
  geoTracking.value = false
  geoPending.value = false
  userFix.value = null
  syncUserOverlay()
}

function toggleMyLocation() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    geoDenied.value = true
    return
  }
  if (geoTracking.value) {
    stopTracking()
    return
  }
  geoPending.value = true
  geoDenied.value = false
  geoTracking.value = true
  navigator.geolocation.getCurrentPosition(
    (p) => {
      applyGeo(p)
      if (typeof navigator === 'undefined' || !navigator.geolocation) return
      geoWatchId = navigator.geolocation.watchPosition(
        (x) => applyGeo(x),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
      )
    },
    () => {
      geoPending.value = false
      geoDenied.value = true
      geoTracking.value = false
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  )
}

function getTomtomKeyStr() {
  return String(tomtomKeyEffective.value || '').trim()
}

function setTrafficLayerFromKey() {
  if (!map) return
  const k = getTomtomKeyStr()
  if (trafficLayer && map.hasLayer(trafficLayer)) {
    map.removeLayer(trafficLayer)
  }
  trafficLayer = null
  if (k) {
    trafficLayer = L.tileLayer(
      `https://api.tomtom.com/traffic/map/4/tile/flow/absolute/{z}/{x}/{y}.png?key=${encodeURIComponent(
        k,
      )}&tileSize=256`,
      { maxZoom: 22, opacity: 0.28, zIndex: 400 },
    )
  }
}

function initMap() {
  if (!containerRef.value) return
  map = L.map(containerRef.value, { zoomControl: false, scrollWheelZoom: true })
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    },
  )
  setTrafficLayerFromKey()
  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri, Maxar', maxZoom: 19 },
  )
  activeBaseLayer.value = 'street'
  streetLayer.addTo(map)
  applyTrafficToMap()
  routeLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)
  editLayer = L.layerGroup().addTo(map)
  syncRouteOverlay()
  syncEditOverlay()
  fitCorridor()
  syncUserOverlay()
  map.on('click', onMapClickEdit)
  mapClickUnsub = () => {
    map?.off('click', onMapClickEdit)
  }
  nextTick(() => map?.invalidateSize())
}

function destroyMap() {
  clearGeoWatch()
  mapClickUnsub?.()
  mapClickUnsub = null
  if (routeLayer) routeLayer.clearLayers()
  if (editLayer) editLayer.clearLayers()
  userMarker = null
  if (map) {
    map.remove()
    map = null
  }
  routeLayer = null
  editLayer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
  trafficLayer = null
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
  () => [
    props.polyline,
    props.segments,
    props.fillHeight,
    props.vehicleId,
    props.editMode,
    props.waypoints,
    props.previewPolyline,
  ],
  () => {
    syncRouteOverlay()
    syncEditOverlay()
    fitCorridor()
    syncUserOverlay()
  },
  { deep: true },
)

watch(tomtomKeyEffective, () => {
  if (map) {
    setTrafficLayerFromKey()
    applyTrafficToMap()
  }
})
</script>

<template>
  <div
    class="corridor-map-root"
    :class="{ 'is-fill': fillHeight }"
    role="region"
    aria-label="Corridor traffic map"
  >
    <div class="corridor-map-stage">
      <div ref="containerRef" class="corridor-map-el" />
      <p v-if="editMode" class="corridor-map-foot corridor-map-foot--edit" role="note"
      >Tap map to add points · drag to adjust</p>
      <p v-else-if="!hasTomtomTraffic" class="corridor-map-foot" role="note">TomTom key in Settings for traffic tiles</p>
      <p v-else-if="activeBaseLayer === 'satellite' && trafficOn" class="corridor-map-foot" role="note">Traffic hidden on satellite</p>
      <p v-if="geoPending" class="corridor-map-hint">Location…</p>
      <p v-else-if="geoDenied" class="corridor-map-hint is-warn">Location denied</p>
    </div>
    <div class="corridor-map-toolbar" role="toolbar" aria-label="Map display">
      <button
        type="button"
        class="map-control-btn map-control-btn--traffic map-control-btn--pill tap"
        :class="{ 'is-on': trafficOn, 'is-missing': !hasTomtomTraffic }"
        :aria-pressed="trafficOn"
        :disabled="activeBaseLayer === 'satellite' || !hasTomtomTraffic"
        :title="!hasTomtomTraffic
          ? 'Add TomTom key in Settings'
          : (activeBaseLayer === 'satellite' ? 'Traffic (street only)' : 'Live traffic (TomTom)')"
        @click="toggleTraffic"
      >
        Traffic
      </button>
      <button
        type="button"
        class="map-control-btn map-control-btn--sat tap"
        :class="{ 'is-on': activeBaseLayer === 'satellite' }"
        :aria-pressed="activeBaseLayer === 'satellite'"
        title="Satellite imagery"
        @click="setBaseLayer(activeBaseLayer === 'satellite' ? 'street' : 'satellite')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="9" ry="4" />
          <path d="M3 12h18" />
        </svg>
        <span class="sr-only">Toggle satellite view</span>
      </button>
      <button
        type="button"
        class="map-control-btn map-control-btn--loc tap"
        :class="{ 'is-on': geoTracking, 'is-denied': geoDenied }"
        :aria-pressed="geoTracking"
        :title="geoDenied ? 'Location blocked' : geoTracking ? 'Stop my location' : 'My location'"
        @click="toggleMyLocation"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <span class="sr-only">My location</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.corridor-map-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: min(45vh, 20rem);
  border-radius: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: #0a0a0f;
}

.corridor-map-root.is-fill {
  min-height: 0;
  flex: 1;
  height: 100%;
}

.corridor-map-stage {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: min(45vh, 20rem);
}

.is-fill .corridor-map-stage {
  min-height: 0;
}

.corridor-map-el {
  flex: 1;
  min-height: min(42vh, 17rem);
  width: 100%;
  z-index: 0;
}

.is-fill .corridor-map-el {
  min-height: 0;
  height: 100%;
}

.corridor-map-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.45rem 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(10, 10, 15, 0.96);
}

.corridor-map-toolbar .map-control-btn {
  flex-shrink: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.corridor-map-hint,
.corridor-map-foot {
  position: absolute;
  left: 0.5rem;
  bottom: 0.4rem;
  z-index: 700;
  margin: 0;
  font-size: 0.55rem;
  color: #6e6e80;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.55);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  max-width: 85%;
}

.corridor-map-foot--edit {
  color: #c4b5fd;
  border: 1px solid rgba(167, 139, 250, 0.35);
}

:deep(.corridor-wp-wrap) {
  display: flex;
  align-items: center;
  gap: 2px;
}

:deep(.corridor-wp-rm) {
  margin: 0;
  padding: 0 3px;
  min-width: 18px;
  height: 18px;
  line-height: 16px;
  font-size: 12px;
  font-weight: 800;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(30, 30, 38, 0.95);
  color: #fca5a5;
  cursor: pointer;
  pointer-events: auto;
}

:deep(.corridor-wp-rm:hover) {
  background: rgba(127, 29, 29, 0.45);
  color: #fff;
}

:deep(.corridor-wp-dot) {
  display: block;
  width: 14px;
  height: 14px;
  margin: 4px;
  border-radius: 50%;
  background: linear-gradient(145deg, #ddd6fe, #7b4db5);
  border: 2px solid rgba(15, 15, 20, 0.9);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
}

:deep(.corridor-wp-dot[data-first='1']) {
  background: linear-gradient(145deg, #6ee7b7, #059669);
}

.corridor-map-hint.is-warn {
  color: #fca5a5;
}

:deep(.leaflet-container .leaflet-bottom.leaflet-right) {
  bottom: 0.35rem;
  right: 0.35rem;
}

:deep(.leaflet-control-zoom) {
  margin-bottom: 0 !important;
  margin-right: 0 !important;
}
</style>
