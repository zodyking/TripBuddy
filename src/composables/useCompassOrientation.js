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
 * Get compass heading from DeviceOrientationEvent.
 * Handles differences between iOS (webkitCompassHeading) and Android (alpha).
 * @param {DeviceOrientationEvent} event
 * @returns {number | null}
 */
function getCompassHeading(event) {
  let compassHeading = null

  if (
    'webkitCompassHeading' in event &&
    typeof event.webkitCompassHeading === 'number' &&
    Number.isFinite(event.webkitCompassHeading)
  ) {
    compassHeading = event.webkitCompassHeading

    if (typeof window !== 'undefined' && 'orientation' in window) {
      const screenOrientation = Number(window.orientation) || 0
      compassHeading = (compassHeading + screenOrientation + 360) % 360
    }
  } else if (
    event.absolute === true &&
    typeof event.alpha === 'number' &&
    Number.isFinite(event.alpha)
  ) {
    compassHeading = (360 - event.alpha) % 360
  } else if (
    typeof event.alpha === 'number' &&
    Number.isFinite(event.alpha)
  ) {
    compassHeading = (360 - event.alpha) % 360
  }

  return compassHeading
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

/**
 * Handle device orientation events.
 * @param {DeviceOrientationEvent} event
 */
function handleOrientation(event) {
  const compassHeading = getCompassHeading(event)
  if (compassHeading !== null) {
    heading.value = compassHeading
    applySmoothHeading(compassHeading)
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
  window.addEventListener('deviceorientation', orientationHandler, true)

  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener(
      'deviceorientationabsolute',
      /** @type {EventListener} */ (orientationHandler),
      true,
    )
  }

  isTracking.value = true
  return true
}

/**
 * Stop listening to device orientation events.
 */
function stopTracking() {
  if (!isTracking.value || !orientationHandler) return

  window.removeEventListener('deviceorientation', orientationHandler, true)
  if ('ondeviceorientationabsolute' in window) {
    window.removeEventListener(
      'deviceorientationabsolute',
      /** @type {EventListener} */ (orientationHandler),
      true,
    )
  }

  orientationHandler = null
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
    detectSupport,
  }
}

export default useCompassOrientation
