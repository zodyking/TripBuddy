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
import { useMapCompassLongPress } from '../composables/useMapCompassLongPress.js'
import CompassCalibrationModal from './CompassCalibrationModal.vue'
import {
  syncMapNavigationGestures,
  applyUserTruckMarkerDomRotation,
} from '../composables/useMapFollowControls.js'

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
  /** Meters — from `GeolocationCoordinates.accuracy` when available */
  userLocationAccuracyM: { type: Number, default: null },
  userVehicleId: { type: String, default: '' },
  /**
   * Origin + destination terminal rows for the map overlay (double-tap to switch).
   * @type {import('vue').PropType<{
   *   origin: {
   *     locationId: string,
   *     name: string,
   *     phoneDisplay?: string,
   *     telHref?: string,
   *     loading?: boolean
   *   } | null,
   *   destination: {
   *     locationId: string,
   *     name: string,
   *     phoneDisplay?: string,
   *     telHref?: string,
   *     loading?: boolean
   *   } | null
   * } | null>}
   */
  terminalPair: { type: Object, default: null },
})

const containerRef = ref(null)

const {
  smoothHeading,
  showCompassToggle,
  permissionState: compassPermission,
  errorMessage: compassError,
  toggleTracking: toggleCompass,
} = useCompassOrientation()

const {
  calibrationModalOpen,
  openCompassCalibration,
  onCompassPointerDown,
  onCompassPointerUp,
  wrapCompassToggle,
} = useMapCompassLongPress()

const compassModeActive = ref(false)

/** Bottom-left cards: trailer # / seal toggle + copy */
const trailerBigNumMode = ref(/** @type {Record<string, 'trailer' | 'seal'>} */ ({}))
const DOUBLE_TAP_MS = 450
const SINGLE_COPY_DELAY_MS = 260
/** @type {Record<string, number>} */
const bigNumLastTapAt = {}
/** @type {Record<string, ReturnType<typeof setTimeout>>} */
const bigNumSingleCopyTimers = {}
const copyToast = ref('')
/** @type {ReturnType<typeof setTimeout> | null} */
let copyToastTimer = null

function clearBigNumSingleCopyTimer(orderKey) {
  const k = String(orderKey)
  const t = bigNumSingleCopyTimers[k]
  if (t) {
    clearTimeout(t)
    delete bigNumSingleCopyTimers[k]
  }
}

function modeForOrder(orderKey) {
  return trailerBigNumMode.value[String(orderKey)] === 'seal' ? 'seal' : 'trailer'
}

/**
 * @param {unknown} lbs
 */
function formatWeightLbsDisplay(lbs) {
  const n = typeof lbs === 'number' ? lbs : Number(lbs)
  if (!Number.isFinite(n) || n <= 0) return ''
  const rounded = Math.round(n)
  return `${rounded.toLocaleString(undefined)} lb`
}

/**
 * @param {{ orderKey: string, nbr: string, seal: string, slot: number }} row
 */
function bigNumDisplayValue(row) {
  if (modeForOrder(row.orderKey) === 'seal') {
    return row.seal || '—'
  }
  return row.nbr
}

/**
 * @param {{ orderKey: string, seal: string, slot: number }} row
 */
function bigNumLabel(row) {
  return modeForOrder(row.orderKey) === 'seal' ? 'Seal' : `Trailer ${row.slot}`
}

function toggleSealModeForOrder(row) {
  if (!row.seal) return
  const key = String(row.orderKey)
  clearBigNumSingleCopyTimer(key)
  bigNumLastTapAt[key] = 0
  const cur = modeForOrder(key)
  trailerBigNumMode.value = {
    ...trailerBigNumMode.value,
    [key]: cur === 'seal' ? 'trailer' : 'seal',
  }
}

/**
 * @param {{ orderKey: string, nbr: string, seal: string, slot: number }} row
 * @param {MouseEvent} [e]
 */
function onBigNumClick(row, e) {
  e?.preventDefault?.()
  const key = String(row.orderKey)

  if (e && /** @type {MouseEvent} */ (e).detail === 2 && row.seal) {
    toggleSealModeForOrder(row)
    return
  }

  const now = Date.now()
  const prev = bigNumLastTapAt[key] || 0
  if (now - prev > 0 && now - prev < DOUBLE_TAP_MS) {
    clearBigNumSingleCopyTimer(key)
    bigNumLastTapAt[key] = 0
    if (row.seal) {
      toggleSealModeForOrder(row)
    }
    return
  }
  bigNumLastTapAt[key] = now
  clearBigNumSingleCopyTimer(key)
  bigNumSingleCopyTimers[key] = setTimeout(() => {
    delete bigNumSingleCopyTimers[key]
    const v = bigNumDisplayValue(row)
    if (!v || v === '—') return
    void copyToClipboard(v)
  }, SINGLE_COPY_DELAY_MS)
}

async function copyToClipboard(text) {
  const t = String(text ?? '').trim()
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    if (copyToastTimer) clearTimeout(copyToastTimer)
    copyToast.value = 'Copied'
    copyToastTimer = setTimeout(() => {
      copyToast.value = ''
      copyToastTimer = null
    }, 1200)
  } catch {
    /* clipboard may be denied */
  }
}

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

/** Bottom-left: one row per trailer (order), sorted for display. */
const trailerNumRows = computed(() => {
  const list = [...effectiveTrailers.value].sort((a, b) => {
    const na = Number(a.order)
    const nb = Number(b.order)
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
    return String(a.order).localeCompare(String(b.order), undefined, { numeric: true })
  })
  return list.map((t, i) => {
    const seal = String(t.sealNumber ?? '').trim()
    return {
      key: `${t.order}-${i}`,
      slot: i + 1,
      orderKey: String(t.order),
      nbr: String(t.trlrNbr ?? '').trim() || '—',
      seal: seal && seal !== '—' ? seal : '',
      heavy: Boolean(t.highlightHeavy),
      weightDisplay: formatWeightLbsDisplay(
        /** @type {TrailerMapPin} */ (t).pkgWeightLbs,
      ),
    }
  })
})

watch(
  () =>
    effectiveTrailers.value
      .map((x) => `${x.order}:${x.trlrNbr}:${x.sealNumber ?? ''}`)
      .join('|'),
  () => {
    trailerBigNumMode.value = {}
    for (const k of Object.keys(bigNumLastTapAt)) {
      delete bigNumLastTapAt[k]
    }
    for (const k of Object.keys(bigNumSingleCopyTimers)) {
      clearBigNumSingleCopyTimer(k)
    }
  },
)

/** Active leg for the terminal bar (default: trip origin). */
const activeTerminalLeg = ref(/** @type {'origin' | 'destination'} */ ('origin'))
/** @type {number} */
let terminalTapLast = 0

watch(
  () => props.terminalPair,
  () => {
    activeTerminalLeg.value = 'origin'
    terminalTapLast = 0
  },
  { deep: true },
)

/**
 * @param {unknown} raw
 */
function normTerminalSlot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const id = String(o.locationId ?? '').trim()
  if (!id) return null
  const name = String(o.name ?? '').trim() || `Location ${id}`
  const phoneDisplay = String(o.phoneDisplay ?? '').trim()
  const telHref = String(o.telHref ?? '').trim()
  return {
    locationId: id,
    name,
    phoneDisplay,
    telHref,
    loading: Boolean(o.loading),
  }
}

const canToggleTerminalLeg = computed(() => {
  const p = props.terminalPair
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = normTerminalSlot(/** @type {Record<string, unknown>} */ (p).origin)
  const d = normTerminalSlot(/** @type {Record<string, unknown>} */ (p).destination)
  return !!(o && d && o.locationId !== d.locationId)
})

function toggleTerminalLeg() {
  if (!canToggleTerminalLeg.value) return
  activeTerminalLeg.value =
    activeTerminalLeg.value === 'destination' ? 'origin' : 'destination'
}

/**
 * @param {MouseEvent | TouchEvent} e
 */
function onTerminalPairTap(e) {
  if (!canToggleTerminalLeg.value) return
  const t = /** @type {unknown} */ (e.target)
  if (t && typeof t === 'object' && 'closest' in t && typeof t.closest === 'function') {
    if (/** @type {Element} */ (t).closest('a.trailer-loc-unified-call')) return
  }
  if (e && 'detail' in e && /** @type {MouseEvent} */ (e).detail === 2) {
    toggleTerminalLeg()
    terminalTapLast = 0
    return
  }
  const now = Date.now()
  if (terminalTapLast > 0 && now - terminalTapLast < DOUBLE_TAP_MS) {
    toggleTerminalLeg()
    terminalTapLast = 0
  } else {
    terminalTapLast = now
  }
}

const terminalCardDisplay = computed(() => {
  const p = props.terminalPair
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const po = /** @type {Record<string, unknown>} */ (p)
  const o = normTerminalSlot(po.origin)
  const d = normTerminalSlot(po.destination)
  if (!o && !d) return null
  const both = o && d && o.locationId !== d.locationId
  const wantDest = activeTerminalLeg.value === 'destination'
  let leg = wantDest ? d : o
  let legLabel = wantDest ? 'Destination' : 'Origin'
  if (!leg) {
    leg = o || d
    legLabel = leg === o ? 'Origin' : 'Destination'
  } else if (!both) {
    legLabel = leg === o ? 'Origin' : 'Destination'
  }
  if (!leg) return null
  return {
    ...leg,
    legLabel,
  }
})

/** Columns in the unified bottom bar (trailers + location), capped at 3. */
const unifiedColCount = computed(() => {
  const n = trailerNumRows.value.length
  const loc = terminalCardDisplay.value != null ? 1 : 0
  const sum = n + loc
  return sum < 1 ? 1 : Math.min(3, sum)
})

/** @type {L.Map | null} */
let map = null
/** @type {L.TileLayer | null} */
let darkLayer = null
/** @type {L.TileLayer | null} */
let streetLayer = null
/** @type {L.TileLayer | null} */
let satelliteLayer = null
const activeBaseLayer = ref(/** @type {'dark' | 'street' | 'satellite'} */ ('dark'))
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
/** Browser geolocation watch active — map follows user (center, no pan). */
const trailerGeoFollowActive = ref(false)
let didFitWithUser = false
/** @type {null | (() => void)} */
let unbindTruckBearingSync = null
/** @type {ResizeObserver | null} */
let mapResizeObserver = null
/** @type {ReturnType<typeof setTimeout> | null} */
let layoutRetryTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let followFitDebounce = null
/** Debounced fitBounds while live GPS follow is on — keeps trailers + truck in view (centering on user alone hid trailer pins). */
const FOLLOW_FIT_DEBOUNCE_MS = 700

/**
 * @param {number} aLat
 * @param {number} aLng
 * @param {number} bLat
 * @param {number} bLng
 * @returns {number} distance in meters
 */
function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6_371_000
  const toR = (d) => (d * Math.PI) / 180
  const dLat = toR(bLat - aLat)
  const dLng = toR(bLng - aLng)
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const q = s1 * s1 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * s2 * s2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)))
}

function syncNavigationGestures() {
  syncMapNavigationGestures(map, {
    follow: trailerGeoFollowActive.value,
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
 * Create trailer icon — geo-scaled to real-world size when enabled.
 * @param {TrailerMapPin} trailer
 */
function makeTrailerIcon(trailer) {
  const sz = String(trailer?.size ?? '').trim().toLowerCase()
  const pulse = Boolean(trailer?.highlightHeavy)

  if (sz === '20ft' || sz === "20'") {
    return trailer20ftTopIcon('', { pulseHeavy: pulse })
  }
  if (sz === '53ft' || sz === "53'") {
    return trailer53ftTopIcon('', { pulseHeavy: pulse })
  }
  return trailerFallbackPinIcon()
}

function makeUserTruckIcon() {
  return userLocationTruckIcon('')
}


function setBaseLayer(mode) {
  if (!map || !darkLayer || !streetLayer || !satelliteLayer) return
  activeBaseLayer.value = mode
  map.removeLayer(darkLayer)
  map.removeLayer(streetLayer)
  map.removeLayer(satelliteLayer)
  /** @type {L.TileLayer} */
  let active = darkLayer
  if (mode === 'satellite') {
    satelliteLayer.addTo(map)
    active = satelliteLayer
  } else if (mode === 'street') {
    streetLayer.addTo(map)
    active = streetLayer
  } else {
    darkLayer.addTo(map)
    active = darkLayer
  }
  try {
    map.invalidateSize({ animate: false })
  } catch {
    /* ignore */
  }
  if (typeof active.redraw === 'function') active.redraw()
}

function cycleBaseLayer() {
  const order = /** @type {const} */ (['dark', 'street', 'satellite'])
  const idx = order.indexOf(activeBaseLayer.value)
  setBaseLayer(order[(idx + 1) % order.length])
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
    // fitBounds resets bearing on leaflet-rotate; restore heading-up mode
    if (compassModeActive.value) {
      applyMapCompassRotation()
      applyUserMarkerRotation()
    }
  }, 80)
}

function scheduleFollowFitDebounced() {
  if (!map || compassModeActive.value || !trailerGeoFollowActive.value) return
  if (!effectiveTrailers.value.length) return
  if (followFitDebounce) clearTimeout(followFitDebounce)
  followFitDebounce = setTimeout(() => {
    followFitDebounce = null
    scheduleFitBounds()
  }, FOLLOW_FIT_DEBOUNCE_MS)
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
    relayoutMapSurface()
    syncNavigationGestures()
    return
  }

  const started = await toggleCompass()
  if (started) {
    compassModeActive.value = true
    relayoutMapSurface()
  }
  syncNavigationGestures()
}

function onCompassPressStart() {
  if (compassPermission.value === 'denied') return
  onCompassPointerDown()
}

const onCompassButtonClick = wrapCompassToggle(handleCompassToggle)

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [accuracyM]
 * @param {boolean} [fitCamera]
 * @param {{ minMoveM?: number }} [opts] When set, ignore updates that move less than this many meters (reduces GPS jitter).
 */
function setUserFixFromLatLng(lat, lng, accuracyM = 40, fitCamera = false, opts = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const prev = userFix.value
  const minMove = opts.minMoveM
  if (
    prev &&
    Number.isFinite(prev.lat) &&
    Number.isFinite(prev.lng) &&
    Number.isFinite(minMove) &&
    minMove > 0 &&
    !fitCamera &&
    haversineMeters(prev.lat, prev.lng, lat, lng) < minMove
  ) {
    return
  }
  userFix.value = {
    lat,
    lng,
    accuracyM: Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 40,
  }
  syncUserOverlay()
  if (trailerGeoFollowActive.value && map && userFix.value) {
    scheduleFollowFitDebounced()
  }
  if (fitCamera && map && effectiveTrailers.value.length && !didFitWithUser) {
    didFitWithUser = true
    scheduleFitBounds()
  }
}

/**
 * @param {GeolocationPosition} pos
 * @param {{ fitCamera?: boolean, skipMicroJitter?: boolean }} [opts]
 */
function applyUserGeolocation(pos, opts = {}) {
  const fitCamera = opts.fitCamera === true
  const lat = pos.coords.latitude
  const lng = pos.coords.longitude
  const acc = pos.coords.accuracy
  setUserFixFromLatLng(lat, lng, acc, fitCamera, {
    minMoveM: opts.skipMicroJitter === true ? 14 : undefined,
  })
}

function stopWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
  trailerGeoFollowActive.value = false
  syncNavigationGestures()
}

function startWatchForLiveUpdates() {
  if (
    typeof navigator === 'undefined' ||
    !navigator.geolocation ||
    geoStopped ||
    geoWatchId != null ||
    !hasUserFix.value
  ) {
    return
  }
  let first = true
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      applyUserGeolocation(pos, { fitCamera: first, skipMicroJitter: !first })
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
  trailerGeoFollowActive.value = true
  syncNavigationGestures()
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
    const accRaw = props.userLocationAccuracyM
    const acc =
      accRaw != null && Number.isFinite(Number(accRaw)) && Number(accRaw) > 0
        ? Number(accRaw)
        : 40
    setUserFixFromLatLng(la, ln, acc, true)
    startWatchForLiveUpdates()
  } else if (!props.userLocationPending && props.userLocationDenied) {
    stopWatch()
    userFix.value = null
    syncUserOverlay()
    didFitWithUser = false
  }
}

function applyTrailerMarkersToMap() {
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
}

function syncTrailerMarkers() {
  applyTrailerMarkersToMap()
  const pins = effectiveTrailers.value
  if (!didFitWithUser) {
    scheduleFitBounds()
  } else if (pins.length && userFix.value) {
    scheduleFitBounds()
  }
}

/**
 * Leaflet often needs `invalidateSize` after the map container gets a real flex height
 * (mobile modals) or after rotation. Does not change the camera framing.
 */
function relayoutMapSurface() {
  if (!map || !overlayLayer) return
  try {
    map.invalidateSize({ animate: false })
  } catch {
    /* ignore */
  }
  applyTrailerMarkersToMap()
  syncUserOverlay()
  try {
    darkLayer?.redraw?.()
    streetLayer?.redraw?.()
    satelliteLayer?.redraw?.()
  } catch {
    /* ignore */
  }
}

function initMap() {
  if (!containerRef.value) return

  geoStopped = false
  didFitWithUser = false
  if (mapResizeObserver) {
    mapResizeObserver.disconnect()
    mapResizeObserver = null
  }
  if (layoutRetryTimer) {
    clearTimeout(layoutRetryTimer)
    layoutRetryTimer = null
  }

  map = L.map(containerRef.value, {
    zoomControl: false,
    scrollWheelZoom: true,
    attributionControl: true,
    rotate: true,
    bearing: 0,
    touchRotate: true,
  })

  L.control.zoom({ position: 'topright' }).addTo(map)

  darkLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
      detectRetina: false,
    },
  )

  streetLayer = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
      detectRetina: false,
    },
  )

  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    },
  )

  darkLayer.addTo(map)
  activeBaseLayer.value = 'dark'

  overlayLayer = L.layerGroup().addTo(map)
  userLayer = L.layerGroup().addTo(map)

  applyTrailerMarkersToMap()
  applyUserCoordsFromProps()

  const el = containerRef.value
  if (el && typeof ResizeObserver !== 'undefined') {
    let roTimer = null
    mapResizeObserver = new ResizeObserver(() => {
      if (!map) return
      if (roTimer) clearTimeout(roTimer)
      roTimer = setTimeout(() => {
        roTimer = null
        relayoutMapSurface()
      }, 48)
    })
    mapResizeObserver.observe(el)
  }

  map.whenReady(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        relayoutMapSurface()
        if (effectiveTrailers.value.length) {
          scheduleFitBounds()
        }
      })
    })
    layoutRetryTimer = setTimeout(() => {
      layoutRetryTimer = null
      relayoutMapSurface()
      if (effectiveTrailers.value.length) {
        scheduleFitBounds()
      }
    }, 420)
  })

  nextTick(() => {
    relayoutMapSurface()
    setTimeout(() => relayoutMapSurface(), 120)
    setTimeout(() => relayoutMapSurface(), 360)
  })
  bindTruckBearingSync()
  syncNavigationGestures()
}

function destroyMap() {
  unbindTruckBearingSync?.()
  geoStopped = true
  stopWatch()
  if (mapResizeObserver) {
    mapResizeObserver.disconnect()
    mapResizeObserver = null
  }
  if (layoutRetryTimer) {
    clearTimeout(layoutRetryTimer)
    layoutRetryTimer = null
  }
  if (fitDebounce) {
    clearTimeout(fitDebounce)
    fitDebounce = null
  }
  if (followFitDebounce) {
    clearTimeout(followFitDebounce)
    followFitDebounce = null
  }
  trailerMarkers.clear()
  userMarker = null
  userFix.value = null
  overlayLayer = null
  userLayer = null
  darkLayer = null
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
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
    copyToastTimer = null
  }
  for (const k of Object.keys(bigNumSingleCopyTimers)) {
    clearBigNumSingleCopyTimer(k)
  }
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
    nextTick(() => {
      relayoutMapSurface()
      if (effectiveTrailers.value.length) {
        scheduleFitBounds()
      }
    })
  },
  { deep: true },
)

watch(
  () => [
    props.userLat,
    props.userLng,
    props.userLocationPending,
    props.userLocationDenied,
    props.userLocationAccuracyM,
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
    try {
      map?.invalidateSize({ animate: false })
    } catch {
      /* ignore */
    }
  }
})

watch(compassModeActive, (active) => {
  if (!active && map && typeof map.setBearing === 'function') {
    map.setBearing(0)
  }
  if (active && followFitDebounce) {
    clearTimeout(followFitDebounce)
    followFitDebounce = null
  }
  nextTick(() => {
    relayoutMapSurface()
    if (active === false && effectiveTrailers.value.length) {
      scheduleFitBounds()
    }
  })
})

watch([trailerGeoFollowActive, compassModeActive], () => {
  syncNavigationGestures()
})

watch(
  () => [trailerNumRows.value.length, terminalCardDisplay.value != null],
  () => {
    nextTick(() => {
      relayoutMapSurface()
      setTimeout(() => relayoutMapSurface(), 200)
    })
  },
)
</script>

<template>
  <div
    class="trailer-loc-root"
    :class="{
      'has-terminal-card': !!terminalCardDisplay,
      'has-trailer-ledger': trailerNumRows.length > 0 || !!terminalCardDisplay,
    }"
    role="region"
    aria-label="Trailers and your location map"
  >
    <div class="trailer-loc-map-stage">
      <div ref="containerRef" class="trailer-loc-el" />
      <div class="map-controls-stack trailer-loc-controls">
        <button
          type="button"
          class="map-control-btn map-control-btn--layer tap"
          :class="{ 'is-on': activeBaseLayer !== 'dark' }"
          :title="`Map: ${activeBaseLayer} — tap to cycle`"
          @click="cycleBaseLayer"
        >
          <span class="map-layer-label">{{ activeBaseLayer === 'dark' ? 'DK' : activeBaseLayer === 'street' ? 'ST' : 'SAT' }}</span>
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
        @click="openCompassCalibration"
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
    <p
      v-if="copyToast"
      class="trailer-loc-copy-toast"
      role="status"
      aria-live="polite"
    >
      {{ copyToast }}
    </p>
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
    <div
      v-if="trailerNumRows.length || terminalCardDisplay"
      class="trailer-loc-unified-bar"
      aria-label="Trailers, seals, and terminal"
    >
      <div
        class="trailer-loc-unified-grid"
        :style="{ '--unified-cols': unifiedColCount }"
      >
        <button
          v-for="row in trailerNumRows"
          :key="row.key"
          type="button"
          class="trailer-loc-unified-cell trailer-loc-big-num-row tap"
          :class="{ 'is-heavy': row.heavy, 'is-seal': modeForOrder(row.orderKey) === 'seal' }"
          :title="
            row.seal
              ? 'Tap to copy · double-tap to switch trailer / seal'
              : 'Tap to copy trailer number'
          "
          @click="onBigNumClick(row, $event)"
        >
          <span class="trailer-loc-big-num-label">
            <template v-if="modeForOrder(row.orderKey) === 'seal'">
              Seal<span
                v-if="row.nbr && row.nbr !== '—'"
                class="trailer-loc-big-num-label-trailer"
              >&nbsp;{{ row.nbr }}</span>
            </template>
            <template v-else>
              {{ bigNumLabel(row)
              }}<span v-if="row.weightDisplay" class="trailer-loc-big-num-weight-inline">
                &nbsp;{{ row.weightDisplay }}</span>
            </template>
          </span>
          <span class="trailer-loc-big-num-val">{{ bigNumDisplayValue(row) }}</span>
        </button>
        <div
          v-if="terminalCardDisplay"
          class="trailer-loc-unified-cell trailer-loc-unified-location"
          :class="{ 'is-toggleable': canToggleTerminalLeg }"
          role="region"
          :aria-label="`${terminalCardDisplay.legLabel}: ${terminalCardDisplay.locationId}, ${terminalCardDisplay.name}`"
          :title="
            canToggleTerminalLeg
              ? `${terminalCardDisplay.legLabel} — double-tap to switch origin / destination`
              : undefined
          "
          @click="onTerminalPairTap($event)"
        >
          <div class="trailer-loc-unified-loc-body">
            <p class="trailer-loc-unified-loc-title">
              {{ terminalCardDisplay.locationId }} - {{ terminalCardDisplay.name }}
            </p>
            <p
              class="trailer-loc-unified-loc-phone"
              :title="terminalCardDisplay.phoneDisplay || undefined"
            >
              <template v-if="terminalCardDisplay.loading">Loading…</template>
              <template v-else>{{ terminalCardDisplay.phoneDisplay || '—' }}</template>
            </p>
          </div>
          <a
            v-if="terminalCardDisplay.telHref"
            :href="terminalCardDisplay.telHref"
            class="trailer-loc-unified-call tap"
            rel="noopener"
            aria-label="Call terminal phone"
            @click.stop
            @dblclick.stop
          >
            <svg
              class="trailer-loc-call-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.15"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
              />
            </svg>
          </a>
        </div>
      </div>
    </div>
    <CompassCalibrationModal
      v-model="calibrationModalOpen"
      :map-compass-mode-active="compassModeActive"
    />
  </div>
</template>

<style scoped>
.trailer-loc-root {
  --trailer-loc-ledger-radius: 0.45rem;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #0f172a;
}

.trailer-loc-map-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.trailer-loc-el {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
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

.trailer-loc-unified-bar {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  padding-bottom: max(0, env(safe-area-inset-bottom, 0px));
  border-radius: 0;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(10, 10, 15, 0.98);
  box-shadow: none;
  pointer-events: auto;
}

.trailer-loc-unified-grid {
  display: grid;
  width: 100%;
  gap: 0;
  grid-template-columns: repeat(var(--unified-cols, 1), minmax(0, 1fr));
  align-items: stretch;
  min-height: clamp(4.1rem, 14vw, 5.25rem);
}

@media (max-width: 560px) {
  .trailer-loc-unified-grid {
    grid-template-columns: 1fr;
  }
}

.trailer-loc-unified-cell {
  min-width: 0;
}

.trailer-loc-unified-cell + .trailer-loc-unified-cell {
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

@media (max-width: 560px) {
  .trailer-loc-unified-cell + .trailer-loc-unified-cell {
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
}

.trailer-loc-unified-location {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  min-width: 0;
  padding: 0;
  border-top: 2px solid var(--color-accent-purple, #7b4db5);
  box-shadow: inset 0 2px 12px rgba(123, 77, 181, 0.14);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.trailer-loc-unified-location.is-toggleable {
  cursor: pointer;
}

.trailer-loc-unified-location:active {
  opacity: 0.94;
}

.trailer-loc-unified-loc-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(0.1rem, 0.8vw, 0.2rem);
  padding: clamp(0.35rem, 2vw, 0.5rem) clamp(0.4rem, 2.2vw, 0.6rem);
}

.trailer-loc-unified-loc-title {
  margin: 0;
  font-size: clamp(0.82rem, 2.8vw + 0.35vh, 1.35rem);
  font-weight: 800;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: #f8fafc;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.trailer-loc-unified-loc-phone {
  margin: 0;
  font-size: clamp(0.65rem, 2vw + 0.2vh, 0.82rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  letter-spacing: 0.03em;
  color: rgba(226, 232, 240, 0.9);
  white-space: normal;
  overflow-wrap: anywhere;
}

.trailer-loc-unified-call {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: clamp(3.35rem, 11vw, 4.75rem);
  min-width: clamp(3.35rem, 11vw, 4.75rem);
  align-self: stretch;
  text-decoration: none;
  color: var(--color-text-inverse, #08080a);
  background: linear-gradient(
    180deg,
    var(--color-accent-purple-light, #9d6fd7),
    var(--color-accent-purple, #7b4db5)
  );
  border: none;
  border-left: 1px solid rgba(0, 0, 0, 0.22);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    0 0 0 1px rgba(92, 45, 145, 0.35);
}

.trailer-loc-unified-call:hover {
  filter: brightness(1.07);
}

.trailer-loc-call-icon {
  width: clamp(1.2rem, 4.5vw, 1.55rem);
  height: clamp(1.2rem, 4.5vw, 1.55rem);
  flex-shrink: 0;
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
  max-width: min(22rem, calc(100% - 1rem));
}

.trailer-loc-root.has-trailer-ledger .trailer-loc-hint {
  bottom: 0.5rem;
}

.trailer-loc-root.has-trailer-ledger .trailer-loc-copy-toast {
  bottom: 3.75rem;
}

.trailer-loc-big-num-row {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  margin: 0;
  padding: clamp(0.32rem, 1.8vw, 0.48rem) clamp(0.45rem, 2.2vw, 0.65rem);
  border-radius: 0;
  background: transparent;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.trailer-loc-big-num-row:active {
  opacity: 0.92;
}

.trailer-loc-big-num-row.is-heavy {
  border-top: 2px solid rgba(239, 68, 68, 0.7);
  box-shadow: inset 0 2px 12px rgba(239, 68, 68, 0.2);
  animation: heavy-card-pulse 1.8s ease-in-out infinite;
}

.trailer-loc-big-num-row:not(.is-heavy) {
  border-top: 2px solid rgba(34, 197, 94, 0.5);
  box-shadow: inset 0 2px 12px rgba(34, 197, 94, 0.15);
  animation: light-card-pulse 2s ease-in-out infinite;
}

@keyframes heavy-card-pulse {
  0%,
  100% {
    box-shadow: inset 0 2px 12px rgba(239, 68, 68, 0.2);
  }
  50% {
    box-shadow: inset 0 2px 20px rgba(239, 68, 68, 0.4);
  }
}

@keyframes light-card-pulse {
  0%,
  100% {
    box-shadow: inset 0 2px 12px rgba(34, 197, 94, 0.15);
  }
  50% {
    box-shadow: inset 0 2px 18px rgba(34, 197, 94, 0.3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .trailer-loc-big-num-row.is-heavy,
  .trailer-loc-big-num-row:not(.is-heavy) {
    animation: none;
  }
}

.trailer-loc-big-num-label {
  display: block;
  font-size: clamp(0.56rem, 2vw + 0.1vh, 0.72rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(226, 232, 240, 0.85);
  margin-bottom: 0.12rem;
  white-space: normal;
  overflow-wrap: anywhere;
}

.trailer-loc-big-num-label-trailer {
  color: #ef4444;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: none;
}

.trailer-loc-big-num-weight-inline {
  font-weight: 700;
  color: #ef4444;
}

.trailer-loc-big-num-val {
  display: block;
  font-size: clamp(1rem, 3.8vw + 0.5vh, 1.75rem);
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: #f8fafc;
  letter-spacing: 0.02em;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.trailer-loc-big-num-row.is-heavy .trailer-loc-big-num-val {
  color: #fecaca;
}

.trailer-loc-big-num-row:not(.is-heavy) .trailer-loc-big-num-val {
  color: #bbf7d0;
}

.trailer-loc-big-num-row.is-seal .trailer-loc-big-num-val {
  color: #fde68a;
}

.trailer-loc-copy-toast {
  position: absolute;
  z-index: 1002;
  left: 50%;
  bottom: 5.5rem;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.35rem 0.75rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: #f8fafc;
  background: rgba(15, 15, 20, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.trailer-loc-hint.is-muted {
  color: #94a3b8;
}

.trailer-loc-hint.is-warn {
  color: #fb923c;
}

.map-layer-label {
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  line-height: 1;
}

.map-control-btn--layer.is-on {
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.55);
  background: rgba(123, 77, 181, 0.28);
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
  /* Match dark basemap average so pre-tile paint is not a flat “gray sheet” */
  background: #0d1117;
  outline: none;
}

:deep(.leaflet-tile-pane) {
  opacity: 1;
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
