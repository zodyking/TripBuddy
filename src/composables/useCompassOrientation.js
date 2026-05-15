/**
 * Composable for device compass/orientation integration with Leaflet maps.
 * Provides navigation-app-style map rotation and marker heading tracking.
 *
 * Features:
 * - Device compass heading via DeviceOrientationEvent
 * - iOS 13+ permission handling (requires user gesture)
 * - Map rotation using leaflet-rotate plugin
 * - Marker rotation to show heading direction
 * - Graceful degradation on unsupported devices
 */
import { ref, computed, onBeforeUnmount } from 'vue'

/** Whether the device/browser supports compass orientation. */
const isSupported = ref(/** @type {boolean | null} */ (null))

/** Current compass heading in degrees (0 = North, 90 = East, etc.). */
const heading = ref(/** @type {number | null} */ (null))

/** Permission state: 'prompt' | 'granted' | 'denied' | 'unavailable'. */
const permissionState = ref(/** @type {'prompt' | 'granted' | 'denied' | 'unavailable'} */ ('prompt'))

/** Whether compass tracking is currently active. */
const isTracking = ref(false)

/** Error message if something went wrong. */
const errorMessage = ref(/** @type {string | null} */ (null))

/** Smooth heading with low-pass filter to reduce jitter. */
const smoothHeading = ref(/** @type {number | null} */ (null))

/** User-configurable heading offset in degrees (calibration). */
const headingOffsetDeg = ref(0)

const COMPASS_OFFSET_STORAGE_KEY = 'compass_heading_offset'

/**
 * Set the compass heading offset for calibration (degrees, any numeric; normalized 0–359).
 * Persists a signed -180…180 value to localStorage for compatibility with existing settings.
 * @param {number} deg
 */
export function setCompassHeadingOffset(deg) {
  headingOffsetDeg.value = ((Number(deg) || 0) % 360 + 360) % 360
  let signed = headingOffsetDeg.value
  if (signed > 180) signed -= 360
  try {
    localStorage.setItem(COMPASS_OFFSET_STORAGE_KEY, String(Math.round(signed)))
  } catch {
    /* ignore */
  }
}

function hydrateCompassHeadingOffsetFromStorage() {
  try {
    const raw = Number(localStorage.getItem(COMPASS_OFFSET_STORAGE_KEY))
    if (!Number.isFinite(raw)) return
    headingOffsetDeg.value = ((raw % 360) + 360) % 360
  } catch {
    /* ignore */
  }
}

hydrateCompassHeadingOffsetFromStorage()

const SMOOTHING_FACTOR = 0.15

/**
 * Detect if device orientation is available.
 */
function detectSupport() {
  if (typeof window === 'undefined') {
    isSupported.value = false
    permissionState.value = 'unavailable'
    return false
  }

  const hasEvent =
    'DeviceOrientationEvent' in window ||
    'ondeviceorientation' in window

  if (!hasEvent) {
    isSupported.value = false
    permissionState.value = 'unavailable'
    return false
  }

  isSupported.value = true
  return true
}

/**
 * Screen / viewport twist in degrees (same idea as deprecated `window.orientation`).
 * Used so map bearing stays correct in landscape, upside-down, etc.
 * @returns {number}
 */
function getViewportOrientationDegrees() {
  if (typeof window === 'undefined') return 0
  const o = window.orientation
  if (typeof o === 'number' && !Number.isNaN(o)) return o
  const a = window.screen?.orientation?.angle
  if (typeof a === 'number' && !Number.isNaN(a)) return a
  return 0
}

/**
 * Map bearing (degrees, 0–360) for “heading up” — aligned with leaflet-rotate’s
 * built-in `L.Map.CompassBearing` math so rotation matches device + screen layout.
 *
 * @see node_modules/leaflet-rotate/src/map/handler/CompassBearing.js
 * @param {DeviceOrientationEvent} event
 * @returns {number | null}
 */
function getMapBearingFromDeviceOrientation(event) {
  const hasWebkit =
    'webkitCompassHeading' in event &&
    typeof event.webkitCompassHeading === 'number' &&
    Number.isFinite(event.webkitCompassHeading)

  let angle = null
  if (hasWebkit) {
    angle = Number(event.webkitCompassHeading)
  } else if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    angle = Number(event.alpha)
  }

  if (angle == null) return null

  // Safari / WebKit: same rule as leaflet-rotate CompassBearing
  if (!event.absolute && hasWebkit) {
    angle = 360 - angle
  }

  let deviceOrientation = 0
  if (!event.absolute) {
    deviceOrientation = getViewportOrientationDegrees()
  }

  let bearing = angle - deviceOrientation + headingOffsetDeg.value
  bearing = ((bearing % 360) + 360) % 360
  return bearing
}

/**
 * Apply low-pass filter for smoother heading updates.
 * @param {number} newHeading
 */
function applySmoothHeading(newHeading) {
  if (smoothHeading.value === null) {
    smoothHeading.value = newHeading
    return
  }

  let diff = newHeading - smoothHeading.value
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360

  smoothHeading.value = (smoothHeading.value + diff * SMOOTHING_FACTOR + 360) % 360
}

/** @type {((event: DeviceOrientationEvent) => void) | null} */
let orientationHandler = null
/** @type {string | null} */
let orientationEventName = null

/**
 * Handle device orientation events.
 * @param {DeviceOrientationEvent} event
 */
function handleOrientation(event) {
  const bearing = getMapBearingFromDeviceOrientation(event)
  if (bearing !== null) {
    heading.value = bearing
    applySmoothHeading(bearing)
    errorMessage.value = null
  }
}

/**
 * Request permission for device orientation (required on iOS 13+).
 * Must be called from a user gesture (click/tap handler).
 * @returns {Promise<boolean>}
 */
async function requestPermission() {
  if (!detectSupport()) {
    return false
  }

  errorMessage.value = null

  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    // @ts-ignore - requestPermission is iOS-specific
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    try {
      // @ts-ignore
      const permission = await DeviceOrientationEvent.requestPermission()
      if (permission === 'granted') {
        permissionState.value = 'granted'
        return true
      } else {
        permissionState.value = 'denied'
        errorMessage.value = 'Compass permission denied. Enable in Settings > Safari > Motion & Orientation.'
        return false
      }
    } catch (err) {
      permissionState.value = 'denied'
      errorMessage.value = 'Failed to request compass permission.'
      return false
    }
  }

  permissionState.value = 'granted'
  return true
}

/**
 * Start listening to device orientation events.
 * On iOS 13+, call requestPermission() first from a user gesture.
 * @returns {Promise<boolean>}
 */
async function startTracking() {
  if (isTracking.value) return true

  if (!detectSupport()) {
    errorMessage.value = 'Compass not supported on this device.'
    return false
  }

  if (permissionState.value !== 'granted') {
    const granted = await requestPermission()
    if (!granted) return false
  }

  orientationHandler = handleOrientation
  // One event source only (same as leaflet-rotate CompassBearing) — avoids double
  // updates and mixed alpha vs absolute conventions.
  const useAbsolute = 'ondeviceorientationabsolute' in window
  const evt = useAbsolute ? 'deviceorientationabsolute' : 'deviceorientation'
  window.addEventListener(evt, orientationHandler, true)
  orientationEventName = evt

  isTracking.value = true
  return true
}

/**
 * Stop listening to device orientation events.
 */
function stopTracking() {
  if (!isTracking.value || !orientationHandler) return

  if (orientationEventName) {
    window.removeEventListener(orientationEventName, orientationHandler, true)
  }

  orientationHandler = null
  orientationEventName = null
  isTracking.value = false
  heading.value = null
  smoothHeading.value = null
}

/**
 * Toggle compass tracking on/off.
 * @returns {Promise<boolean>} whether tracking is now active
 */
async function toggleTracking() {
  if (isTracking.value) {
    stopTracking()
    return false
  }
  return await startTracking()
}

/**
 * Apply compass rotation to a Leaflet map (requires leaflet-rotate).
 * Call this in your animation/watch loop.
 * @param {import('leaflet').Map | null} map
 * @param {boolean} [followHeading=true] - rotate map to match heading
 */
function applyMapRotation(map, followHeading = true) {
  if (!map || smoothHeading.value === null || !followHeading) return

  if (typeof map.setBearing === 'function') {
    map.setBearing(smoothHeading.value)
  }
}

/**
 * Get CSS transform for rotating a marker element to face heading.
 * @param {number | null} headingDeg - compass heading in degrees
 * @param {number} [mapBearing=0] - current map rotation (if map rotates, marker needs counter-rotation)
 * @returns {string} CSS transform value
 */
function getMarkerRotationTransform(headingDeg, mapBearing = 0) {
  if (headingDeg === null) return ''
  const rotation = (headingDeg - mapBearing + 360) % 360
  return `rotate(${rotation}deg)`
}

/**
 * Rotation for the user-location truck raster: when `headingDeg` is null, keep the cab
 * visually north-aligned on the map while leaflet-rotate changes map bearing. When
 * heading is set (compass + heading-up), same as {@link getMarkerRotationTransform}.
 *
 * @param {number | null} headingDeg
 * @param {number} [mapBearing=0]
 * @returns {string} CSS transform or '' for default
 */
export function getUserTruckMarkerTransform(headingDeg, mapBearing = 0) {
  const b = (((Number(mapBearing) || 0) % 360) + 360) % 360
  if (
    headingDeg === null ||
    headingDeg === undefined ||
    !Number.isFinite(Number(headingDeg))
  ) {
    if (b === 0) return ''
    return `rotate(${-b}deg)`
  }
  const h = Number(headingDeg)
  const rotation = ((h - b) % 360 + 360) % 360
  if (rotation === 0) return ''
  return `rotate(${rotation}deg)`
}

/**
 * Whether compass mode should show UI toggle (device may support it).
 */
const showCompassToggle = computed(() => {
  if (isSupported.value === null) {
    detectSupport()
  }
  return isSupported.value === true
})

/**
 * Compass mode requires HTTPS on most browsers.
 */
const requiresSecureContext = computed(() => {
  if (typeof window === 'undefined') return false
  return window.isSecureContext === false
})

/**
 * Composable for device compass orientation.
 *
 * @example
 * ```js
 * const { heading, isTracking, toggleTracking, applyMapRotation } = useCompassOrientation()
 *
 * // In template: button to toggle compass mode
 * // <button @click="toggleTracking">Compass</button>
 *
 * // In watch/effect: apply rotation to map
 * watch(heading, () => applyMapRotation(map))
 * ```
 */
export function useCompassOrientation() {
  detectSupport()

  onBeforeUnmount(() => {
    stopTracking()
  })

  return {
    isSupported,
    heading,
    smoothHeading,
    headingOffsetDeg,
    permissionState,
    isTracking,
    errorMessage,
    showCompassToggle,
    requiresSecureContext,

    requestPermission,
    startTracking,
    stopTracking,
    toggleTracking,
    applyMapRotation,
    getMarkerRotationTransform,
    getUserTruckMarkerTransform,
    detectSupport,
  }
}

export default useCompassOrientation
