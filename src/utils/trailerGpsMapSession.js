/** Session payload for the full-page trailer GPS map (see TrailerGpsMapView). */
export const TRAILER_GPS_SESSION_STORAGE_KEY = 'fedextool_trailer_gps_v1'

/** Same-tab updates after navigate (geolocation callbacks from home). */
export const TRAILER_GPS_USER_PATCH_EVENT = 'fedextool-trailer-gps-user'

/**
 * @param {Record<string, unknown>} patch
 */
export function dispatchTrailerGpsUserPatch(patch) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TRAILER_GPS_USER_PATCH_EVENT, { detail: patch }))
}

/**
 * @param {unknown} payload
 */
export function writeTrailerGpsSession(payload) {
  try {
    sessionStorage.setItem(TRAILER_GPS_SESSION_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

/**
 * @returns {unknown | null}
 */
export function readTrailerGpsSession() {
  try {
    const raw = sessionStorage.getItem(TRAILER_GPS_SESSION_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearTrailerGpsSession() {
  try {
    sessionStorage.removeItem(TRAILER_GPS_SESSION_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Merge fields into the stored session `map` object (same-tab).
 * @param {Record<string, unknown>} patch
 */
export function patchTrailerGpsSessionMap(patch) {
  try {
    const raw = sessionStorage.getItem(TRAILER_GPS_SESSION_STORAGE_KEY)
    if (!raw) return
    const s = /** @type {{ map?: Record<string, unknown> }} */ (JSON.parse(raw))
    if (!s.map || typeof s.map !== 'object') return
    Object.assign(s.map, patch)
    sessionStorage.setItem(TRAILER_GPS_SESSION_STORAGE_KEY, JSON.stringify(s))
    dispatchTrailerGpsUserPatch(patch)
  } catch {
    /* ignore */
  }
}
