const ENABLED_KEY = 'fedextool-helpers-auto-arrive-nm-enabled'
const RADIUS_NM_KEY = 'fedextool-helpers-auto-arrive-radius-nm'

export const HELPERS_RADIUS_NM_MIN = 0.25
export const HELPERS_RADIUS_NM_MAX = 25
export const HELPERS_RADIUS_NM_DEFAULT = 2

/**
 * @returns {boolean}
 */
export function getHelpersAutoArriveNearDestEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    return window.localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

/** @param {boolean} on */
export function setHelpersAutoArriveNearDestEnabled(on) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    if (on) window.localStorage.setItem(ENABLED_KEY, '1')
    else window.localStorage.removeItem(ENABLED_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * @returns {number} nautical miles, clamped
 */
export function getHelpersAutoArriveRadiusNm() {
  if (typeof window === 'undefined' || !window.localStorage) return HELPERS_RADIUS_NM_DEFAULT
  try {
    const raw = window.localStorage.getItem(RADIUS_NM_KEY)
    const n = raw != null ? Number.parseFloat(String(raw)) : NaN
    if (!Number.isFinite(n)) return HELPERS_RADIUS_NM_DEFAULT
    return Math.min(HELPERS_RADIUS_NM_MAX, Math.max(HELPERS_RADIUS_NM_MIN, n))
  } catch {
    return HELPERS_RADIUS_NM_DEFAULT
  }
}

/** @param {number} nm */
export function setHelpersAutoArriveRadiusNm(nm) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const n = Number(nm)
  if (!Number.isFinite(n)) return
  const c = Math.min(HELPERS_RADIUS_NM_MAX, Math.max(HELPERS_RADIUS_NM_MIN, n))
  try {
    window.localStorage.setItem(RADIUS_NM_KEY, String(c))
  } catch {
    /* ignore */
  }
}

/** @returns {number} meters */
export function helpersTriggerRadiusMeters() {
  return getHelpersAutoArriveRadiusNm() * 1852
}
