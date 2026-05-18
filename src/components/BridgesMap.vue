<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-rotate'
import { tomtomKeyEffective } from '../stores/trafficTileKey.js'
import { bridgesCrossingIcon, userLocationTruckIcon } from '../utils/mapMarkers.js'
import { useCompassOrientation } from '../composables/useCompassOrientation.js'
import { useMapCompassLongPress } from '../composables/useMapCompassLongPress.js'
import CompassCalibrationModal from './CompassCalibrationModal.vue'
import {
  syncMapNavigationGestures,
  centerMapOnLatLng,
  applyUserTruckMarkerDomRotation,
} from '../composables/useMapFollowControls.js'

const DEFAULT_CENTER = Object.freeze([40.64, -74.18])
const DEFAULT_ZOOM = 9

const hasTomtomTraffic = computed(() => tomtomKeyEffective.value.length > 0)

const props = defineProps({
  /** @type {import('vue').PropType<Array<{
   *  id: string, lat: number, lng: number, title: string, shortLabel?: string,
   *  delayTier?: 'green' | 'orange' | 'red',
   *  minutes: string, trendIcon: string,
   *  trendKey: 'worse' | 'better' | 'neutral' | 'unk',
   *  trendFull: string, isPick: boolean, isClosed: boolean, rank: number
   * }>>} */
  pins: { type: Array, required: true },
  /** To NY vs To NJ — when this changes, map re-fits to the current direction’s bridges */
  travelDirection: {
    type: String,
    default: 'ToNY',
    /** @param {string} v */
    validator: (v) => v === 'ToNY' || v === 'ToNJ',
  },
  /** Selected routeId */
  highlightId: { type: String, default: '' },
  fillHeight: { type: Boolean, default: false },
  /** Tractor / unit number chip under “my location” truck (optional). */
  vehicleId: { type: String, default: '' },
  /** Highway polylines to render on the map */
  highwayPolylines: { type: Array, default: () => [] },
  /** NY511 incident/event markers (lat/lng) when Traffic tab is on NY511 */
  ny511Markers: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])

const containerRef = ref(/** @type {HTMLElement | null} */ (null))

const {
  smoothHeading,
  showCompassToggle,
  permissionState: compassPermission,
  errorMessage: compassError,
  toggleTracking: toggleCompass,
  startTracking,
} = useCompassOrientation()

const {
  calibrationModalOpen,
  openCompassCalibration,
  onCompassPointerDown,
  onCompassPointerUp,
  wrapCompassToggle,
} = useMapCompassLongPress()

const compassModeActive = ref(false)

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
/**
 * TomTom Traffic raster flow (key from Settings, localStorage).
 * @type {L.TileLayer | null}
 */
let trafficLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
const trafficOn = ref(false)
/** @type {L.LayerGroup | null} plain layer — no clustering (matches directory map) */
let markerLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {L.Marker | null} */
let userMarker = null
/** @type {Map<string, L.Marker>} */
const markersById = new Map()

/** @type {L.LayerGroup | null} */
let highwayLayer = null
/** @type {Map<string, L.Polyline>} */
const highwaysById = new Map()
/** @type {Map<string, L.Marker>} */
const highwayLabelsById = new Map()

/** @type {L.LayerGroup | null} */
let ny511Layer = null
/** @type {Map<string, L.CircleMarker>} */
const ny511MarkersById = new Map()

/** Sorted route id list — when this changes, we fit bounds to pins (e.g. To NY ↔ To NJ) */
let lastStructureKey = ''

const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */(null),
)
const geoTracking = ref(false)
const geoPending = ref(false)
const geoDenied = ref(false)
/** @type {number | null} */
let geoWatchId = null
/** @type {null | (() => void)} */
let unbindTruckBearingSync = null

function syncNavigationGestures() {
  syncMapNavigationGestures(map, {
    follow: geoTracking.value,
    compass: compassModeActive.value,
  })
}

function bindTruckBearingSync() {
  if (!map || unbindTruckBearingSync) return
  const fn = () => {
    applyUserMarkerRotation()
  }
  map.on('rotate', fn)
  map.on('zoomend', fn)
  unbindTruckBearingSync = () => {
    map?.off('rotate', fn)
    map?.off('zoomend', fn)
    unbindTruckBearingSync = null
  }
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
 * @param {import('vue').UnwrapRef<typeof props>['pins'][0]} p
 */
function bridgePopupHtml(p) {
  const tk = p.trendKey || 'unk'
  const trendCls =
    tk === 'worse' ? 'is-worse' : tk === 'better' ? 'is-better' : tk === 'neutral' ? 'is-neut' : 'is-unk'
  const rank = esc(String(p.rank ?? ''))
  const trendIcon = esc(p.trendIcon || '·')
  const trendFull = esc(p.trendFull || '')
  const minutes = esc(p.minutes ?? '—')
  const title = esc(p.title ?? '')
  const cls = ['bridge-popup']
  if (p.isPick) cls.push('bridge-popup--best')
  if (p.isClosed) cls.push('bridge-popup--closed')
  cls.push(trendCls)
  return `<div class="${cls.join(' ')}">
  <div class="bridge-popup__row">
    <span class="bridge-popup__rank">#${rank}</span>
    <span class="bridge-popup__trend" title="${trendFull}">${trendIcon}</span>
  </div>
  <div class="bridge-popup__time"><span class="bridge-popup__min">${minutes}</span><span class="bridge-popup__suf">m</span></div>
  <div class="bridge-popup__name">${title}</div>
</div>`
}

function getStructureKey() {
  return props.pins
    .map((p) => String(p.id))
    .slice()
    .sort()
    .join('|')
}

function allBoundsLatLngs() {
  /** @type {L.LatLng[]} */
  const pts = []
  for (const p of props.pins) {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    pts.push(L.latLng(la, ln))
  }
  const u = userFix.value
  if (u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
    pts.push(L.latLng(u.lat, u.lng))
  }
  return pts
}

function applyFitToPins() {
  if (!map) return
  const motion = prefersReducedMotion()
  const pts = allBoundsLatLngs()
  if (pts.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false })
    return
  }
  if (pts.length === 1) {
    map.setView(pts[0], 10, { animate: !motion })
    return
  }
  const bounds = L.latLngBounds(pts)
  map.fitBounds(bounds, {
    padding: [44, 52],
    maxZoom: 10,
    animate: !motion,
  })
}

function applyTrafficToMap() {
  if (!map || !streetLayer) return
  if (!trafficLayer) return
  const on = trafficOn.value && activeBaseLayer.value === 'street'
  if (on) {
    if (!map.hasLayer(trafficLayer)) {
      map.addLayer(trafficLayer)
    }
  } else if (map.hasLayer(trafficLayer)) {
    map.removeLayer(trafficLayer)
  }
}

function setBaseLayer(mode) {
  if (!map || !streetLayer || !satelliteLayer) return
  activeBaseLayer.value = mode
  if (mode === 'satellite') {
    map.removeLayer(streetLayer)
    if (trafficLayer && map.hasLayer(trafficLayer)) {
      map.removeLayer(trafficLayer)
    }
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
  applyUserMarkerRotation()
}

function applyUserMarkerRotation() {
  if (!userMarker || !map) return
  const heading =
    compassModeActive.value && smoothHeading.value !== null
      ? smoothHeading.value
      : null
  applyUserTruckMarkerDomRotation(userMarker, map, heading)
}

function applyMapCompassRotation() {
  if (!map || !compassModeActive.value || smoothHeading.value === null) return
  if (typeof map.setBearing === 'function') {
    map.setBearing(smoothHeading.value)
  }
}

async function handleCompassToggle() {
  if (compassModeActive.value) {
    compassModeActive.value = false
    await toggleCompass()
    applyUserMarkerRotation()
    if (map && typeof map.setBearing === 'function') {
      map.setBearing(0)
    }
    syncNavigationGestures()
    return
  }

  const started = await toggleCompass()
  if (started) {
    compassModeActive.value = true
  }
  syncNavigationGestures()
}

function onCompassPressStart() {
  if (compassPermission.value === 'denied') return
  onCompassPointerDown()
}

const onCompassButtonClick = wrapCompassToggle(handleCompassToggle)

function onCalibrationControlClick() {
  calibrationModalOpen.value = true
  void Promise.resolve(startTracking()).catch(() => {})
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean }} [o]
 */
function applyGeo(pos, o = {}) {
  const fitCamera = o.fitCamera !== false
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = { lat, lng, accuracyM: Number.isFinite(acc) ? acc : 40 }
  geoDenied.value = false
  geoPending.value = false
  syncUserOverlay()
  if (geoTracking.value && map && userFix.value) {
    const motion = !prefersReducedMotion()
    centerMapOnLatLng(map, L.latLng(userFix.value.lat, userFix.value.lng), {
      animate: motion,
    })
  }
  if (map && fitCamera) {
    const motion = prefersReducedMotion()
    const pts = allBoundsLatLngs()
    if (pts.length < 1) return
    if (pts.length === 1) {
      map.setView(pts[0], 10, { animate: !motion })
    } else {
      map.fitBounds(L.latLngBounds(pts), {
        padding: [44, 52],
        maxZoom: 10,
        animate: !motion,
      })
    }
  }
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
  syncNavigationGestures()
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
  syncNavigationGestures()
  navigator.geolocation.getCurrentPosition(
    (p) => {
      applyGeo(p, { fitCamera: true })
      syncNavigationGestures()
      if (typeof navigator === 'undefined' || !navigator.geolocation) return
      geoWatchId = navigator.geolocation.watchPosition(
        (x) => applyGeo(x, { fitCamera: false }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
      )
    },
    () => {
      geoPending.value = false
      geoDenied.value = true
      geoTracking.value = false
      syncNavigationGestures()
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  )
}

/**
 * @param {import('vue').UnwrapRef<typeof props>['pins'][0]} p
 * @param {boolean} selected
 */
function makeIcon(p, selected) {
  const tier = p.delayTier
  const delayTier =
    tier === 'green' || tier === 'orange' || tier === 'red' ? tier : undefined
  return bridgesCrossingIcon({
    trendKey: /** @type {'worse' | 'better' | 'neutral' | 'unk'} */(p.trendKey || 'unk'),
    isPick: !!p.isPick,
    isClosed: !!p.isClosed,
    selected,
    shortLabel: typeof p.shortLabel === 'string' ? p.shortLabel : '',
    delayTier,
  })
}

function syncMarkers() {
  if (!map || !markerLayer) return

  const sk = `${getStructureKey()}::${String(props.travelDirection)}`
  const structChanged = sk !== lastStructureKey

  const wantIds = new Set(props.pins.map((p) => String(p.id)))
  const motion = prefersReducedMotion()

  if (structChanged) {
    markerLayer.clearLayers()
    markersById.clear()
  }

  for (const p of props.pins) {
    const la = Number(p.lat)
    const ln = Number(p.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue
    const id = String(p.id)
    const selected = props.highlightId === id
    const ll = L.latLng(la, ln)
    const icon = makeIcon(/** @type {any} */(p), selected)
    const existing = markersById.get(id)
    if (structChanged) {
      const marker = L.marker(ll, { icon, title: p.title })
      marker.bindPopup(bridgePopupHtml(/** @type {any} */(p)), {
        maxWidth: 280,
        className: 'bridge-map-popup',
      })
      marker.on('click', () => emit('select', id))
      marker.addTo(markerLayer)
      markersById.set(id, marker)
    } else if (existing) {
      if (existing.getLatLng().lat !== la || existing.getLatLng().lng !== ln) {
        existing.setLatLng(ll)
      }
      existing.setIcon(icon)
      existing.setPopupContent(bridgePopupHtml(/** @type {any} */(p)))
    } else {
      const marker = L.marker(ll, { icon, title: p.title })
      marker.bindPopup(bridgePopupHtml(/** @type {any} */(p)), {
        maxWidth: 280,
        className: 'bridge-map-popup',
      })
      marker.on('click', () => emit('select', id))
      marker.addTo(markerLayer)
      markersById.set(id, marker)
    }
  }

  if (!structChanged) {
    for (const [id, mk] of [...markersById]) {
      if (wantIds.has(id)) continue
      markerLayer.removeLayer(mk)
      markersById.delete(id)
    }
  }

  lastStructureKey = sk

  if (structChanged) {
    applyFitToPins()
  } else if (props.highlightId) {
    const m = markersById.get(props.highlightId)
    if (m) {
      map?.panTo(m.getLatLng(), { animate: !motion })
    }
  }

  nextTick(() => {
    map?.invalidateSize()
  })
}

/**
 * Color for highway polyline based on delay tier.
 * @param {'green' | 'orange' | 'red' | undefined} tier
 */
function highwayPolylineColor(tier) {
  if (tier === 'green') return '#4ade80'
  if (tier === 'red') return '#f87171'
  return '#fb923c'
}

/**
 * Create a DivIcon for highway label.
 * @param {string} shortName
 * @param {'green' | 'orange' | 'red' | undefined} tier
 */
function highwayLabelIcon(shortName, tier) {
  const color = highwayPolylineColor(tier)
  const bgColor = tier === 'green' ? 'rgba(22, 101, 52, 0.85)' 
    : tier === 'red' ? 'rgba(127, 29, 29, 0.85)' 
    : 'rgba(154, 52, 18, 0.85)'
  return L.divIcon({
    className: 'hw-label-icon',
    html: `<div class="hw-label" style="background:${bgColor};border-color:${color}">${esc(shortName)}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function syncHighwayPolylines() {
  if (!map || !highwayLayer) return

  const polylines = props.highwayPolylines || []
  const wantIds = new Set(polylines.map((p) => String(p.id)))

  for (const [id, pl] of [...highwaysById]) {
    if (wantIds.has(id)) continue
    highwayLayer.removeLayer(pl)
    highwaysById.delete(id)
    const label = highwayLabelsById.get(id)
    if (label) {
      highwayLayer.removeLayer(label)
      highwayLabelsById.delete(id)
    }
  }

  for (const hw of polylines) {
    const id = String(hw.id)
    const waypoints = Array.isArray(hw.waypoints) ? hw.waypoints : []
    if (waypoints.length < 2) continue

    const latlngs = waypoints
      .map((w) => {
        const la = Number(w.lat)
        const ln = Number(w.lng)
        if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
        return L.latLng(la, ln)
      })
      .filter((ll) => ll !== null)

    if (latlngs.length < 2) continue

    const color = highwayPolylineColor(hw.delayTier)
    const existing = highwaysById.get(id)

    if (existing) {
      existing.setLatLngs(latlngs)
      existing.setStyle({ color })
    } else {
      const polyline = L.polyline(latlngs, {
        color,
        weight: 4,
        opacity: 0.7,
        lineCap: 'round',
        lineJoin: 'round',
      })
      polyline.addTo(highwayLayer)
      highwaysById.set(id, polyline)
    }

    const midIdx = Math.floor(latlngs.length / 2)
    const midPoint = latlngs[midIdx]
    const existingLabel = highwayLabelsById.get(id)

    if (existingLabel) {
      existingLabel.setLatLng(midPoint)
      existingLabel.setIcon(highwayLabelIcon(hw.shortName || id, hw.delayTier))
    } else {
      const labelMarker = L.marker(midPoint, {
        icon: highwayLabelIcon(hw.shortName || id, hw.delayTier),
        interactive: false,
        zIndexOffset: 300,
      })
      labelMarker.addTo(highwayLayer)
      highwayLabelsById.set(id, labelMarker)
    }
  }
}

/**
 * @param {unknown} sev
 */
function ny511SeverityColor(sev) {
  const s = String(sev || '').toLowerCase()
  if (s.includes('severe') || s.includes('major') || s.includes('high') || s.includes('critical')) {
    return '#f87171'
  }
  if (s.includes('moderate') || s.includes('medium')) return '#fb923c'
  if (s.includes('low') || s.includes('minor') || s.includes('light')) return '#4ade80'
  return '#a78bfa'
}

/**
 * @param {{ eventTypeKey?: string, severity?: string }} m
 */
function ny511MarkerFill(m) {
  const k = String(m.eventTypeKey || '').toLowerCase()
  if (k === 'accidentsandincidents') return '#f87171'
  if (k === 'roadwork') return '#fb923c'
  if (k === 'closures') return '#fcd34d'
  if (k === 'winterdrivingindex') return '#22d3ee'
  return ny511SeverityColor(m.severity)
}

function syncNy511Markers() {
  if (!map || !ny511Layer) return

  const markers = props.ny511Markers || []
  const wantIds = new Set(markers.map((m) => String(m.id)))

  for (const [id, cm] of [...ny511MarkersById]) {
    if (wantIds.has(id)) continue
    ny511Layer.removeLayer(cm)
    ny511MarkersById.delete(id)
  }

  for (const m of markers) {
    const id = String(m.id)
    const la = Number(m.lat)
    const ln = Number(m.lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue

    const color = ny511MarkerFill(m)
    const title = esc(String(m.title || id))
    const kind = esc(String(m.kindLabel || m.kind || ''))
    const detailRaw = String(m.impactSummary || '').trim()
    const sevRaw = String(m.severity || '').trim()
    const secondLine =
      detailRaw && !/^unknown$/i.test(detailRaw)
        ? esc(detailRaw)
        : sevRaw && !/^unknown$/i.test(sevRaw)
          ? esc(sevRaw)
          : ''
    const road0 = Array.isArray(m.roads) && m.roads[0] != null ? esc(String(m.roads[0])) : ''
    const meta = [kind, secondLine].filter(Boolean).join(' · ')
    const roadLine = road0
      ? `<div class="ny511-leaflet-popup__road">${road0}</div>`
      : ''
    const popupHtml =
      `<div class="ny511-leaflet-popup">` +
      `<div class="ny511-leaflet-popup__meta">${esc(meta || '511NY')}</div>` +
      `<div class="ny511-leaflet-popup__title">${title}</div>` +
      roadLine +
      `</div>`
    const popOpts = { className: 'ny511-map-popup', maxWidth: 280, closeButton: true }

    const existing = ny511MarkersById.get(id)
    if (existing) {
      existing.setLatLng([la, ln])
      existing.setStyle({ color: '#0f0f14', weight: 2.5, fillColor: color, fillOpacity: 0.92 })
      const pop = existing.getPopup()
      if (pop) {
        pop.setContent(popupHtml)
        pop.update()
      } else existing.bindPopup(popupHtml, popOpts)
    } else {
      const cm = L.circleMarker([la, ln], {
        radius: 9,
        color: '#1a1520',
        weight: 2.5,
        fillColor: color,
        fillOpacity: 0.92,
      })
      cm.bindPopup(popupHtml, popOpts)
      cm.addTo(ny511Layer)
      ny511MarkersById.set(id, cm)
    }
  }
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
  map = L.map(containerRef.value, {
    zoomControl: false,
    scrollWheelZoom: true,
    rotate: true,
    bearing: 0,
    touchRotate: true,
  })
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
  highwayLayer = L.layerGroup().addTo(map)
  ny511Layer = L.layerGroup().addTo(map)
  markerLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)
  lastStructureKey = ''
  syncMarkers()
  syncHighwayPolylines()
  syncNy511Markers()
  nextTick(() => {
    map?.invalidateSize()
  })
  bindTruckBearingSync()
  syncNavigationGestures()
}

function destroyMap() {
  unbindTruckBearingSync?.()
  clearGeoWatch()
  if (markerLayer) {
    markerLayer.clearLayers()
  }
  if (highwayLayer) {
    highwayLayer.clearLayers()
  }
  if (ny511Layer) {
    ny511Layer.clearLayers()
  }
  ny511MarkersById.clear()
  markersById.clear()
  highwaysById.clear()
  highwayLabelsById.clear()
  userMarker = null
  if (map) {
    map.remove()
    map = null
  }
  markerLayer = null
  highwayLayer = null
  ny511Layer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
  trafficLayer = null
  lastStructureKey = ''
}

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
  () => [props.pins, props.highlightId, props.travelDirection, props.fillHeight, props.vehicleId],
  () => {
    syncMarkers()
    syncUserOverlay()
  },
  { deep: true },
)

watch(
  () => props.highwayPolylines,
  () => {
    syncHighwayPolylines()
  },
  { deep: true },
)

watch(
  () => props.ny511Markers,
  () => {
    syncNy511Markers()
  },
  { deep: true },
)

watch(tomtomKeyEffective, () => {
  if (map) {
    setTrafficLayerFromKey()
    applyTrafficToMap()
  }
})

watch(smoothHeading, () => {
  if (compassModeActive.value) {
    applyMapCompassRotation()
    applyUserMarkerRotation()
  }
})

watch(compassModeActive, (active) => {
  if (!active && map && typeof map.setBearing === 'function') {
    map.setBearing(0)
  }
})

watch([geoTracking, compassModeActive], () => {
  syncNavigationGestures()
})
</script>

<template>
  <div
    class="bridge-map-root"
    :class="{ 'is-fill': fillHeight }"
    role="region"
    aria-label="Bridge times map"
  >
    <div class="bridge-map-stage">
      <div ref="containerRef" class="bridge-map-el" />
      <p v-if="!hasTomtomTraffic" class="bridge-map-footnote" role="note"
      >Traffic: set TomTom key in Settings (free developer tier)</p>
      <p v-else-if="activeBaseLayer === 'satellite' && trafficOn" class="bridge-map-footnote" role="note"
      >Traffic hidden on Sat — switch to map</p>
      <p v-if="geoPending" class="bridge-map-hint">Location…</p>
      <p v-else-if="geoDenied" class="bridge-map-hint is-warn">Location denied</p>
      <p v-if="compassError" class="bridge-map-hint is-warn">{{ compassError }}</p>
    </div>
    <div class="bridge-map-toolbar" role="toolbar" aria-label="Map display">
      <button
        type="button"
        class="map-control-btn map-control-btn--traffic map-control-btn--pill tap"
        :class="{ 'is-on': trafficOn, 'is-missing': !hasTomtomTraffic }"
        :aria-pressed="trafficOn"
        :disabled="activeBaseLayer === 'satellite' || !hasTomtomTraffic"
        :title="!hasTomtomTraffic
          ? 'Add TomTom key in Settings (free developer tier)'
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
        :title="
          geoDenied
            ? 'Location blocked — enable location in browser settings'
            : geoTracking
              ? 'Stop showing my location'
              : 'Show my live location'
        "
        @click="toggleMyLocation"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <span class="sr-only">My location</span>
      </button>
      <button
        v-if="showCompassToggle"
        type="button"
        class="map-control-btn map-control-btn--compass tap"
        :class="{
          'is-on': compassModeActive,
          'is-denied': compassPermission === 'denied',
        }"
        :aria-pressed="compassModeActive"
        :title="
          compassPermission === 'denied'
            ? 'Compass blocked — enable in device settings'
            : compassModeActive
              ? 'Exit compass mode'
              : 'Compass mode — rotate map to heading'
        "
        @contextmenu.prevent
        @pointerdown="onCompassPressStart"
        @pointerup="onCompassPointerUp"
        @pointerleave="onCompassPointerUp"
        @pointercancel="onCompassPointerUp"
        @click="onCompassButtonClick"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,2 14,10 12,8 10,10" fill="currentColor" stroke="none" />
          <polygon points="12,22 10,14 12,16 14,14" fill="currentColor" stroke="none" opacity="0.4" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        <span class="sr-only">
          {{
            compassModeActive
              ? 'Exit compass mode. Heading offset: tap the sliders button below.'
              : 'Compass mode. Heading offset: tap the sliders button below.'
          }}
        </span>
      </button>
      <button
        v-if="showCompassToggle"
        type="button"
        class="map-control-btn map-control-btn--compass-cal tap"
        title="Heading offset / calibration"
        aria-label="Heading offset and calibration"
        @contextmenu.prevent
        @click.stop.prevent="onCalibrationControlClick"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        <span class="sr-only">Open heading offset and calibration</span>
      </button>
    </div>
    <CompassCalibrationModal
      v-model="calibrationModalOpen"
      :map-compass-mode-active="compassModeActive"
    />
  </div>
</template>

<style scoped>
.bridge-map-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: min(45vh, 20rem);
  border-radius: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: #0a0a0f;
}

.bridge-map-root.is-fill {
  min-height: 0;
  flex: 1;
  height: 100%;
}

.bridge-map-stage {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: min(45vh, 20rem);
}

.is-fill .bridge-map-stage {
  min-height: 0;
}

.bridge-map-el {
  flex: 1;
  min-height: min(42vh, 17rem);
  width: 100%;
  z-index: 0;
}

.is-fill .bridge-map-el {
  min-height: 0;
  height: 100%;
}

.bridge-map-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.45rem 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(10, 10, 15, 0.96);
  pointer-events: auto;
}

.bridge-map-toolbar .map-control-btn {
  position: relative;
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

.bridge-map-hint,
.bridge-map-footnote {
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
.bmk {
  font-size: 0.9em;
  background: rgba(0, 0, 0, 0.35);
  padding: 0.05em 0.2em;
  border-radius: 2px;
  line-height: 1.2;
  pointer-events: none;
}
.bridge-map-footnote {
  bottom: 2.15rem;
  color: #94a3b8;
  font-size: 0.52rem;
}
.bridge-map-hint.is-warn {
  color: #fb923c;
}

.map-control-btn--compass {
  position: relative;
}

.map-control-btn--compass.is-on {
  background: linear-gradient(145deg, #8b5cf6, #6d28d9);
  border-color: rgba(139, 92, 246, 0.65);
  color: #faf5ff;
  box-shadow:
    0 0 0 2px rgba(139, 92, 246, 0.25),
    0 2px 6px rgba(139, 92, 246, 0.35);
}

.map-control-btn--compass.is-on svg {
  animation: compass-pulse 2s ease-in-out infinite;
}

.map-control-btn--compass.is-denied {
  opacity: 0.55;
}

@keyframes compass-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

:deep(.leaflet-container .leaflet-bottom.leaflet-right) {
  bottom: 0.35rem;
  right: 0.35rem;
}

:deep(.leaflet-control-zoom) {
  margin-bottom: 0 !important;
  margin-right: 0 !important;
}

:deep(.leaflet-control-zoom a) {
  color: #e0e0ec !important;
  background: rgba(0, 0, 0, 0.55) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}
:deep(.leaflet-control-attribution) {
  color: #5a5a6a;
  background: rgba(0, 0, 0, 0.45) !important;
  font-size: 0.55rem;
  max-width: 60%;
}
:deep(.leaflet-container) {
  font-family: inherit;
  background: #0a0a0f;
}
:deep(.leaflet-popup-content-wrapper.bridge-map-popup) {
  border-radius: 10px;
  border: 1px solid rgba(167, 139, 250, 0.35);
  background: rgba(14, 14, 20, 0.96);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
}
:deep(.leaflet-popup-tip.bridge-map-popup) {
  background: rgba(14, 14, 20, 0.96);
  border: 1px solid rgba(167, 139, 250, 0.25);
}
:deep(.leaflet-popup-content-wrapper.bridge-map-popup .leaflet-popup-content) {
  margin: 0.45rem 0.55rem;
  line-height: 1.2;
}
:deep(.bridge-popup) {
  color: #e8e2ff;
  text-align: center;
  min-width: 7.5rem;
}
:deep(.bridge-popup--best) {
  filter: none;
}
:deep(.bridge-popup--closed) {
  opacity: 0.75;
}
:deep(.bridge-popup__row) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.15rem;
  font-size: 0.65rem;
  font-weight: 800;
}
:deep(.bridge-popup__rank) {
  color: #8a8a9a;
  font-variant-numeric: tabular-nums;
}
:deep(.bridge-popup--best .bridge-popup__rank) {
  color: #6ee7b7;
}
:deep(.bridge-popup__trend) {
  font-size: 0.75rem;
}
:deep(.bridge-popup.is-worse .bridge-popup__trend) {
  color: #fca5a5;
}
:deep(.bridge-popup.is-better .bridge-popup__trend) {
  color: #86efac;
}
:deep(.bridge-popup.is-neut .bridge-popup__trend) {
  color: #fde68a;
}
:deep(.bridge-popup__time) {
  font-size: 1.35rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: #ddd6fe;
  line-height: 1;
}
:deep(.bridge-popup--best .bridge-popup__time) {
  color: #a7f3d0;
}
:deep(.bridge-popup__suf) {
  font-size: 0.55rem;
  font-weight: 800;
  color: #8a8a9a;
  margin-left: 0.06rem;
}
:deep(.bridge-popup__name) {
  margin-top: 0.15rem;
  font-size: 0.55rem;
  font-weight: 800;
  color: #9a9aac;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 11rem;
}

:deep(.hw-label-icon) {
  overflow: visible !important;
}

:deep(.hw-label) {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 0.2rem 0.4rem;
  border-radius: 5px;
  font-size: 0.55rem;
  font-weight: 800;
  color: #fff;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

:deep(.ny511-leaflet-popup) {
  text-align: left;
}
:deep(.ny511-leaflet-popup__meta) {
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #c4b5fd;
  margin-bottom: 0.35rem;
}
:deep(.ny511-leaflet-popup__title) {
  font-size: 0.78rem;
  font-weight: 650;
  line-height: 1.35;
  color: #f4f4fb;
  margin: 0;
}
:deep(.ny511-leaflet-popup__road) {
  margin-top: 0.35rem;
  font-size: 0.65rem;
  color: #a8a8bc;
  line-height: 1.35;
}
</style>

<style>
/* NY511: `bindPopup({ className })` is on `.leaflet-popup`, not the content wrapper */
.leaflet-container .leaflet-popup.ny511-map-popup .leaflet-popup-content-wrapper {
  background: #16161f;
  color: #ececf4;
  border-radius: 12px;
  border: 1px solid rgba(167, 139, 250, 0.45);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
  padding: 0;
}
.leaflet-container .leaflet-popup.ny511-map-popup .leaflet-popup-content {
  margin: 10px 12px 12px;
  min-width: 0;
  max-width: 16rem;
}
.leaflet-container .leaflet-popup.ny511-map-popup .leaflet-popup-tip {
  background: #16161f;
  border: 1px solid rgba(167, 139, 250, 0.45);
  box-shadow: none;
}
.leaflet-container .leaflet-popup.ny511-map-popup a.leaflet-popup-close-button {
  color: #d4d4e8;
  font-weight: 700;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0.35rem 0.35rem 0 0;
}
.leaflet-container .leaflet-popup.ny511-map-popup a.leaflet-popup-close-button:hover {
  color: #fff;
}
</style>
