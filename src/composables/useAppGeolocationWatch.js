import { ref } from 'vue'

/** @type {import('vue').Ref<number | null>} */
export const appGeoLat = ref(null)
/** @type {import('vue').Ref<number | null>} */
export const appGeoLng = ref(null)
/** @type {import('vue').Ref<number | null>} */
export const appGeoAccuracyM = ref(null)
/**
 * Browser / Permissions API state for Helpers UI.
 * @type {import('vue').Ref<'unknown' | 'unsupported' | 'prompt' | 'granted' | 'denied'>}
 */
export const appGeoPermission = ref('unknown')
/** @type {import('vue').Ref<string>} */
export const appGeoError = ref('')

/** @type {number | null} */
let watchId = null
let started = false
/** @type {(() => void) | null} */
let visibilityHandler = null

/** Current profile: 'idle' saves battery, 'activeTrip' is realtime for ENRT. */
let currentProfile = /** @type {'idle' | 'activeTrip'} */ ('idle')

async function syncPermissionLabel() {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' })
    const apply = () => {
      const s = p.state
      if (s === 'granted') appGeoPermission.value = 'granted'
      else if (s === 'denied') appGeoPermission.value = 'denied'
      else appGeoPermission.value = 'prompt'
    }
    apply()
    p.addEventListener('change', apply)
  } catch {
    /* Permissions API may reject "geolocation" name in some browsers */
  }
}

/**
 * Get watch options based on current profile.
 */
function getWatchOptions() {
  if (currentProfile === 'activeTrip') {
    return { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
  }
  return { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 }
}

/**
 * Internal: restart the watch with current profile options.
 */
function restartWatch() {
  if (watchId != null && navigator.geolocation?.clearWatch) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  if (!navigator.geolocation?.watchPosition) return
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      appGeoLat.value = pos.coords.latitude
      appGeoLng.value = pos.coords.longitude
      appGeoAccuracyM.value =
        pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy)
          ? pos.coords.accuracy
          : null
      appGeoPermission.value = 'granted'
      appGeoError.value = ''
    },
    (err) => {
      if (err && /** @type {GeolocationPositionError} */ (err).code === 1) {
        appGeoPermission.value = 'denied'
      }
      appGeoError.value = err?.message ? String(err.message) : 'Geolocation error'
    },
    getWatchOptions(),
  )
}

/**
 * Single shared watch for the authenticated app shell (Home, Settings, etc.).
 * Idempotent: safe to call multiple times.
 */
export function startAppGeolocationWatch() {
  if (typeof window === 'undefined') return
  if (started) return
  if (!navigator.geolocation?.watchPosition) {
    appGeoPermission.value = 'unsupported'
    return
  }
  started = true
  void syncPermissionLabel()

  restartWatch()

  if (typeof document !== 'undefined' && !visibilityHandler) {
    visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return
      if (!navigator.geolocation?.getCurrentPosition) return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          appGeoLat.value = pos.coords.latitude
          appGeoLng.value = pos.coords.longitude
          appGeoAccuracyM.value =
            pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy)
              ? pos.coords.accuracy
              : null
          appGeoPermission.value = 'granted'
          appGeoError.value = ''
        },
        () => {
          /* keep last watch fix; tab wake can fail transiently */
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 25_000 },
      )
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }
}

export function stopAppGeolocationWatch() {
  if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation?.clearWatch) {
    navigator.geolocation.clearWatch(watchId)
  }
  watchId = null
  started = false
  if (typeof document !== 'undefined' && visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
}

/**
 * Request a one-shot fix (call from a click handler on iOS if permission is still prompt).
 * @returns {Promise<boolean>} true if coordinates were obtained
 */
export function requestAppGeolocationOnceFromGesture() {
  return new Promise((resolve) => {
    if (!navigator.geolocation?.getCurrentPosition) {
      resolve(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        appGeoLat.value = pos.coords.latitude
        appGeoLng.value = pos.coords.longitude
        appGeoAccuracyM.value =
          pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null
        appGeoPermission.value = 'granted'
        appGeoError.value = ''
        resolve(true)
      },
      () => resolve(false),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 25_000 },
    )
  })
}

/**
 * Switch geolocation watch profile.
 * - 'idle': default battery-saving mode (maximumAge 5s)
 * - 'activeTrip': realtime mode for ENRT progress (maximumAge 0, faster timeout)
 * @param {'idle' | 'activeTrip'} profile
 */
export function setAppGeoWatchProfile(profile) {
  if (profile !== 'idle' && profile !== 'activeTrip') return
  if (currentProfile === profile) return
  currentProfile = profile
  if (started) {
    restartWatch()
  }
}
