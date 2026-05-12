<script setup>
import {
  ref,
  computed,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-rotate'
import {
  trailer20ftTopIcon,
  trailer53ftTopIcon,
  trailerFallbackPinIcon,
  userLocationTruckIcon,
} from '../utils/mapMarkers.js'
import { useCompassOrientation } from '../composables/useCompassOrientation.js'

/**
 * @typedef {{
 *   lat: number,
 *   lng: number,
 *   order?: string,
 *   trlrNbr?: string,
 *   sealNumber?: string,
 *   size?: string,
 *   pkgWeightLbs?: number | null,
 *   highlightHeavy?: boolean
 * }} TrailerMapPin
 */

const props = defineProps({
  /** When set, show all pins on one map (preferred). */
  trailers: { type: Array, default: () => [] },
  /** `trlrOrder` of the trailer with highest pkg weight (or sole 53′ fallback). */
  heavyTrailerOrder: { type: String, default: '' },
  /** @deprecated Use `trailers` — single trailer fallback */
  lat: { type: Number, default: NaN },
  /** @deprecated */
  lng: { type: Number, default: NaN },
  /** '20ft' | '53ft' | '' — used only for legacy single-trailer props */
  trailerSize: { type: String, default: '' },
  trailerNumber: { type: String, default: '' },
  trailerLabel: { type: String, default: '' },
  userLat: { type: Number, default: null },
  userLng: { type: Number, default: null },
  userLocationPending: { type: Boolean, default: false },
  userLocationDenied: { type: Boolean, default: false },
  userVehicleId: { type: String, default: '' },
  /**
   * Trip destination terminal for overlay card (from Linehaul location + trip id).
   * @type {import('vue').PropType<{
   *   locationId: string,
   *   name: string,
   *   phoneDisplay?: string,
   *   telHref?: string,
   *   loading?: boolean
   * } | null>}
   */
  terminalCard: { type: Object, default: null },
})

const containerRef = ref(null)

const {
  smoothHeading,
  showCompassToggle,
  permissionState: compassPermission,
  errorMessage: compassError,
  toggleTracking: toggleCompass,
  getMarkerRotationTransform,
} = useCompassOrientation()

const compassModeActive = ref(false)

const userFix = ref(
  /** @type {{ lat: number, lng: number, accuracyM: number } | null} */ (null),
)

const hasUserFix = computed(() => {
  const u = userFix.value
  return u != null && Number.isFinite(u.lat) && Number.isFinite(u.lng)
})

/** Pins to draw: `trailers` prop or legacy lat/lng. */
const effectiveTrailers = computed(() => {
  const arr = props.trailers
  if (Array.isArray(arr) && arr.length > 0) {
    const heavy = String(props.heavyTrailerOrder ?? '').trim()
    return arr
      .map((raw, i) => {
        if (!raw || typeof raw !== 'object') return null
        const o = /** @type {Record<string, unknown>} */ (raw)
        const lat = Number(o.lat)
        const lng = Number(o.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
        const order = o.order != null ? String(o.order) : String(i + 1)
        const trlrNbr = o.trlrNbr != null ? String(o.trlrNbr) : ''
        const sealRaw = o.sealNumber != null ? String(o.sealNumber).trim() : ''
        const size = o.size != null ? String(o.size) : ''
        const pkgRaw = o.pkgWeightLbs
        const pkgWeightLbs =
          pkgRaw != null && Number.isFinite(Number(pkgRaw)) ? Number(pkgRaw) : null
        const highlightHeavy =
          Boolean(o.highlightHeavy) ||
          (heavy !== '' && order === heavy)
        return /** @type {TrailerMapPin} */ ({
          lat,
          lng,
          order,
          trlrNbr,
          sealNumber: sealRaw,
          size,
          pkgWeightLbs,
          highlightHeavy,
        })
      })
      .filter(Boolean)
  }
  const la = Number(props.lat)
  const ln = Number(props.lng)
  if (Number.isFinite(la) && Number.isFinite(ln)) {
    return [
      /** @type {TrailerMapPin} */ ({
        lat: la,
        lng: ln,
        order: '1',
        trlrNbr: String(props.trailerNumber ?? '').trim(),
        sealNumber: '',
        size: String(props.trailerSize ?? '').trim(),
        pkgWeightLbs: null,
        highlightHeavy: false,
      }),
    ]
  }
  return []
})

const terminalCardDisplay = computed(() => {
  const c = props.terminalCard
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  const o = /** @type {Record<string, unknown>} */ (c)
  const id = String(o.locationId ?? '').trim()
  if (!id) return null
  const name = String(o.name ?? '').trim() || `Terminal ${id}`
  const phoneDisplay = String(o.phoneDisplay ?? '').trim()
  const telHref = String(o.telHref ?? '').trim()
  return {
    locationId: id,
    name,
    phoneDisplay,
    telHref,
    loading: Boolean(o.loading),
  }
})

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
const activeBaseLayer = ref(/** @type {'street' | 'satellite'} */ ('street'))
/** @type {L.LayerGroup | null} */
let overlayLayer = null
/** @type {L.LayerGroup | null} */
let userLayer = null
/** @type {Map<string, L.Marker>} */
const trailerMarkers = new Map()
/** @type {L.Marker | null} */
let userMarker = null
/** @type {number | null} */
let geoWatchId = null
/** @type {ReturnType<typeof setTimeout> | null} */
let fitDebounce = null
let geoStopped = false
let watchStarted = false
let didFitWithUser = false

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}


/**
 * Create trailer icon — geo-scaled to real-world size when enabled.
 * @param {TrailerMapPin} trailer
 */
function makeTrailerIcon(trailer) {
  const sz = String(trailer?.size ?? '').trim().toLowerCase()
  const num = String(trailer?.trlrNbr ?? '').trim()
  const pulse = Boolean(trailer?.highlightHeavy)

  if (sz === '20ft' || sz === "20'") {
    return trailer20ftTopIcon(num, { pulseHeavy: pulse })
  }
  if (sz === '53ft' || sz === "53'") {
    return trailer53ftTopIcon(num, { pulseHeavy: pulse })
  }
  return trailerFallbackPinIcon()
}

/**
 * Create user truck icon — geo-scaled to real-world size when enabled.
 */
function makeUserTruckIcon() {
  return userLocationTruckIcon(props.userVehicleId || '')
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
}

function toggleSatellite() {
  setBaseLayer(activeBaseLayer.value === 'street' ? 'satellite' : 'street')
}

function scheduleFitBounds() {
  if (!map || !overlayLayer) return
  const pins = effectiveTrailers.value
  if (!pins.length) return
  if (fitDebounce) clearTimeout(fitDebounce)
  fitDebounce = setTimeout(() => {
    fitDebounce = null
    if (!map || !pins.length) return
    const motion = !prefersReducedMotion()
    let b = L.latLngBounds(pins.map((p) => [p.lat, p.lng]))
    if (userMarker && userFix.value) {
      b.extend(L.latLng(userFix.value.lat, userFix.value.lng))
    }
    const ne = b.getNorthEast()
    const sw = b.getSouthWest()
    const latSpan = Math.abs(ne.lat - sw.lat)
    const lngSpan = Math.abs(ne.lng - sw.lng)
    if (latSpan < 1e-8 && lngSpan < 1e-8) {
      b = b.pad(0.004)
    } else {
      b = b.pad(0.14)
    }
    map.fitBounds(b, {
      padding: [56, 56],
      maxZoom: 19,
      animate: motion,
    })
  }, 80)
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
      icon: makeUserTruckIcon(),
      zIndexOffset: 600,
      title: 'Your location',
      rotationAngle: 0,
      rotationOrigin: 'center center',
    })
    userMarker.addTo(userLayer)
  } else {
    userMarker.setLatLng(ll)
    userMarker.setIcon(makeUserTruckIcon())
  }

  applyUserMarkerRotation()
}

function applyUserMarkerRotation() {
  if (!userMarker) return
  const outer = userMarker.getElement()
  if (!outer) return
  const inner = outer.querySelector('.map-marker-raster-root')
  if (!inner) return

  if (compassModeActive.value && smoothHeading.value !== null) {
    const mapBearing = map && typeof map.getBearing === 'function' ? map.getBearing() : 0
    const transform = getMarkerRotationTransform(smoothHeading.value, mapBearing)
    inner.style.transform = transform
    inner.style.transformOrigin = 'center center'
  } else {
    inner.style.transform = ''
    inner.style.transformOrigin = ''
  }
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
    return
  }

  const started = await toggleCompass()
  if (started) {
    compassModeActive.value = true
  }
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [accuracyM]
 * @param {boolean} [fitCamera]
 */
function setUserFixFromLatLng(lat, lng, accuracyM = 40, fitCamera = false) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  userFix.value = {
    lat,
    lng,
    accuracyM: Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 40,
  }
  syncUserOverlay()
  if (fitCamera && map && effectiveTrailers.value.length && !didFitWithUser) {
    didFitWithUser = true
    scheduleFitBounds()
  }
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean }} [opts]
 */
function applyUserGeolocation(pos, opts = {}) {
  const fitCamera = opts.fitCamera === true
  const lat = pos.coords.latitude
  const lng = pos.coords.longitude
  const acc = pos.coords.accuracy
  setUserFixFromLatLng(lat, lng, acc, fitCamera)
}

function stopWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
  watchStarted = false
}

function startWatchForLiveUpdates() {
  if (
    typeof navigator === 'undefined' ||
    !navigator.geolocation ||
    geoStopped ||
    watchStarted ||
    !hasUserFix.value
  ) {
    return
  }
  watchStarted = true
  let first = true
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      applyUserGeolocation(pos, { fitCamera: first })
      first = false
    },
    () => {
      /* keep last fix */
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10_000,
    },
  )
}

function applyUserCoordsFromProps() {
  const la = props.userLat
  const ln = props.userLng
  if (
    la != null &&
    ln != null &&
    Number.isFinite(la) &&
    Number.isFinite(ln)
  ) {
    setUserFixFromLatLng(la, ln, 40, true)
    startWatchForLiveUpdates()
  } else if (!props.userLocationPending && props.userLocationDenied) {
    stopWatch()
    userFix.value = null
    syncUserOverlay()
    didFitWithUser = false
  }
}

function syncTrailerMarkers() {
  if (!map || !overlayLayer) return
  const pins = effectiveTrailers.value
  const nextKeys = new Set(pins.map((p) => String(p.order)))

  for (const [k, m] of trailerMarkers) {
    if (!nextKeys.has(k)) {
      overlayLayer.removeLayer(m)
      trailerMarkers.delete(k)
    }
  }

  for (const t of pins) {
    const key = String(t.order)
    const ll = L.latLng(t.lat, t.lng)
    const label =
      props.trailerLabel.trim() ||
      `Trailer ${key}${t.trlrNbr ? ` · #${t.trlrNbr}` : ''}`
    const icon = makeTrailerIcon(t)
    let mk = trailerMarkers.get(key)
    if (!mk) {
      mk = L.marker(ll, {
        icon,
        title: label,
        zIndexOffset: t.highlightHeavy ? 450 : 400,
      })
        .bindPopup(label)
        .addTo(overlayLayer)
      trailerMarkers.set(key, mk)
    } else {
      mk.setLatLng(ll)
      mk.setIcon(icon)
      mk.setPopupContent(label)
      mk.setZIndexOffset(t.highlightHeavy ? 450 : 400)
    }
  }

  if (!didFitWithUser) {
    scheduleFitBounds()
  } else if (pins.length && userFix.value) {
    scheduleFitBounds()
  }
}

function initMap() {
  if (!containerRef.value) return

  geoStopped = false
  didFitWithUser = false

  map = L.map(containerRef.value, {
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: true,
    rotate: true,
    bearing: 0,
    touchRotate: true,
  })

  L.control.zoom({ position: 'topright' }).addTo(map)

  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
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

  streetLayer.addTo(map)
  activeBaseLayer.value = 'street'

  overlayLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)

  syncTrailerMarkers()
  applyUserCoordsFromProps()

  nextTick(() => {
    map?.invalidateSize()
    setTimeout(() => map?.invalidateSize(), 320)
  })
}

function destroyMap() {
  geoStopped = true
  stopWatch()
  if (fitDebounce) {
    clearTimeout(fitDebounce)
    fitDebounce = null
  }
  trailerMarkers.clear()
  userMarker = null
  userFix.value = null
  overlayLayer = null
  userLayer = null
  streetLayer = null
  satelliteLayer = null
  if (map) {
    map.remove()
    map = null
  }
}

onMounted(() => {
  nextTick(() => {
    initMap()
  })
})

onBeforeUnmount(() => {
  destroyMap()
})

watch(
  () => [
    props.trailers,
    props.heavyTrailerOrder,
    props.lat,
    props.lng,
    props.trailerLabel,
    props.trailerSize,
    props.trailerNumber,
  ],
  () => {
    syncTrailerMarkers()
    nextTick(() => map?.invalidateSize())
  },
  { deep: true },
)

watch(
  () => [
    props.userLat,
    props.userLng,
    props.userLocationPending,
    props.userLocationDenied,
    props.userVehicleId,
  ],
  () => {
    applyUserCoordsFromProps()
  },
)

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
</script>

<template>
  <div
    class="trailer-loc-root"
    :class="{ 'has-terminal-card': !!terminalCardDisplay }"
    role="region"
    aria-label="Trailers and your location map"
  >
    <div ref="containerRef" class="trailer-loc-el" />
    <div class="map-controls-stack trailer-loc-controls">
      <button
        type="button"
        class="map-control-btn map-control-btn--sat tap"
        :class="{ 'is-on': activeBaseLayer === 'satellite' }"
        :aria-pressed="activeBaseLayer === 'satellite'"
        title="Satellite imagery"
        @click="toggleSatellite"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="9" ry="4" />
          <path d="M3 12h18" />
        </svg>
        <span class="sr-only">Toggle satellite view</span>
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
              : 'Compass mode (rotate map to heading)'
        "
        @click="handleCompassToggle"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,2 14,10 12,8 10,10" fill="currentColor" stroke="none" />
          <polygon points="12,22 10,14 12,16 14,14" fill="currentColor" stroke="none" opacity="0.4" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        <span class="sr-only">
          {{ compassModeActive ? 'Exit compass mode' : 'Compass mode' }}
        </span>
      </button>
    </div>
    <div
      v-if="terminalCardDisplay"
      class="trailer-loc-terminal-card"
      role="region"
      aria-label="Trip destination terminal"
    >
      <div class="trailer-loc-terminal-kicker">Destination terminal</div>
      <div class="trailer-loc-terminal-name">{{ terminalCardDisplay.name }}</div>
      <div class="trailer-loc-terminal-id">ID {{ terminalCardDisplay.locationId }}</div>
      <div class="trailer-loc-terminal-phone-row">
        <span class="trailer-loc-terminal-phone">{{
          terminalCardDisplay.phoneDisplay || '—'
        }}</span>
        <a
          v-if="terminalCardDisplay.telHref"
          :href="terminalCardDisplay.telHref"
          class="trailer-loc-call-btn tap"
          rel="noopener"
        >Call</a>
      </div>
      <p v-if="terminalCardDisplay.loading" class="trailer-loc-terminal-loading">Loading details…</p>
    </div>
    <p
      v-if="userLocationPending && !hasUserFix"
      class="trailer-loc-hint"
    >
      Finding your location…
    </p>
    <p
      v-if="userLocationDenied && !hasUserFix && !userLocationPending"
      class="trailer-loc-hint is-muted"
    >
      Location unavailable — trailers only. Check site permission in browser settings.
    </p>
    <p
      v-if="compassError"
      class="trailer-loc-hint is-warn"
    >
      {{ compassError }}
    </p>
  </div>
</template>

<style scoped>
.trailer-loc-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #0f172a;
}

.trailer-loc-el {
  width: 100%;
  height: 100%;
  min-height: inherit;
}

.trailer-loc-controls {
  max-width: min(14rem, calc(100% - 1.5rem));
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

.trailer-loc-terminal-card {
  position: absolute;
  z-index: 1001;
  right: max(0.45rem, env(safe-area-inset-right, 0px));
  bottom: max(0.45rem, env(safe-area-inset-bottom, 0px));
  width: min(12.5rem, calc(100vw - 5rem));
  min-height: 4.75rem;
  padding: 0.55rem 0.65rem 0.6rem;
  border-radius: var(--radius-lg, 0.75rem);
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.06) 0%,
    rgba(255, 255, 255, 0.025) 100%
  );
  border: 1px solid rgba(123, 77, 181, 0.45);
  box-shadow:
    0 4px 18px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
}

.trailer-loc-terminal-kicker {
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(196, 181, 253, 0.95);
  margin-bottom: 0.2rem;
}

.trailer-loc-terminal-name {
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.25;
  color: #f8fafc;
  margin-bottom: 0.15rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.trailer-loc-terminal-id {
  font-size: 0.6875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgba(226, 232, 240, 0.72);
  margin-bottom: 0.35rem;
}

.trailer-loc-terminal-phone-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.75rem;
}

.trailer-loc-terminal-phone {
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #e2e8f0;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trailer-loc-call-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.65rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-decoration: none;
  color: #0f172a;
  background: linear-gradient(145deg, #4ade80, #22c55e);
  border: 1px solid rgba(34, 197, 94, 0.65);
  border-radius: var(--radius-md, 0.5rem);
  box-shadow: 0 1px 4px rgba(34, 197, 94, 0.35);
}

.trailer-loc-call-btn:hover {
  filter: brightness(1.06);
}

.trailer-loc-terminal-loading {
  margin: 0.35rem 0 0;
  font-size: 0.625rem;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.95);
}

.trailer-loc-hint {
  position: absolute;
  z-index: 999;
  bottom: 0.45rem;
  left: 0.65rem;
  right: 0.65rem;
  margin: 0;
  padding: 0.4rem 0.6rem;
  font-size: 0.68rem;
  line-height: 1.35;
  text-align: center;
  color: #cbd5e1;
  background: rgba(15, 15, 20, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: none;
}

.trailer-loc-root.has-terminal-card .trailer-loc-hint {
  right: auto;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(20rem, calc(100% - 13.5rem));
}

.trailer-loc-hint.is-muted {
  color: #94a3b8;
}

.trailer-loc-hint.is-warn {
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

:deep(.leaflet-container) {
  font-family: inherit;
  background: #1e293b;
}


:deep(.leaflet-control-zoom a) {
  background: rgba(255, 255, 255, 0.95);
  color: #1e293b;
  border-color: rgba(0, 0, 0, 0.12);
}

:deep(.leaflet-control-zoom a:hover) {
  background: #f1f5f9;
}

:deep(.leaflet-popup-content-wrapper) {
  border-radius: 8px;
  background: #fff;
  color: #0f172a;
}

:deep(.leaflet-popup-tip) {
  background: #fff;
}
</style>
