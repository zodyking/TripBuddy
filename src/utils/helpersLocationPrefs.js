import { ref } from 'vue'

const ENABLED_KEY = 'fedextool-helpers-auto-arrive-nm-enabled'
const RADIUS_NM_KEY = 'fedextool-helpers-auto-arrive-radius-nm'

export const HELPERS_RADIUS_NM_MIN = 0.25
export const HELPERS_RADIUS_NM_MAX = 25
export const HELPERS_RADIUS_NM_DEFAULT = 2

/** Mirrors localStorage for Vue watchers (e.g. proximity auto arrive). */
export const helpersAutoArriveNearDestEnabledRef = ref(false)
export const helpersAutoArriveRadiusNmRef = ref(HELPERS_RADIUS_NM_DEFAULT)

/** While > 0, ignore server credential merges for helpers prefs (avoids stale GET overwriting a PUT in flight). */
let applyFromCredentialsPaused = 0

/** Call before saving helpers prefs to the server; pair with `resumeApplyHelpersLocationPrefsFromCredentials`. */
export function pauseApplyHelpersLocationPrefsFromCredentials() {
  applyFromCredentialsPaused += 1
}

/** Call in `finally` after {@link pauseApplyHelpersLocationPrefsFromCredentials}. */
export function resumeApplyHelpersLocationPrefsFromCredentials() {
  applyFromCredentialsPaused = Math.max(0, applyFromCredentialsPaused - 1)
}

function syncRefsFromStorage() {
  if (typeof window === 'undefined') return
  helpersAutoArriveNearDestEnabledRef.value = getHelpersAutoArriveNearDestEnabled()
  helpersAutoArriveRadiusNmRef.value = getHelpersAutoArriveRadiusNm()
}

function coerceRadiusNm(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number.parseFloat(raw.trim())
    if (Number.isFinite(n)) return n
  }
  return NaN
}

/**
 * Apply values returned from `GET /api/settings/credentials` (PostgreSQL-backed).
 * @param {unknown} meta
 */
export function applyHelpersLocationPrefsFromCredentials(meta) {
  if (applyFromCredentialsPaused > 0) return

  if (!meta || typeof meta !== 'object') {
    syncRefsFromStorage()
    return
  }
  const m = /** @type {Record<string, unknown>} */ (meta)
  const hasEnabledKey = Object.prototype.hasOwnProperty.call(m, 'helpersAutoArriveNearDestEnabled')
  const hasRadiusKey = Object.prototype.hasOwnProperty.call(m, 'helpersAutoArriveRadiusNm')

  if (!hasEnabledKey && !hasRadiusKey) {
    syncRefsFromStorage()
    return
  }

  if (hasEnabledKey && typeof m.helpersAutoArriveNearDestEnabled === 'boolean') {
    setHelpersAutoArriveNearDestEnabled(m.helpersAutoArriveNearDestEnabled)
  }

  const radParsed = coerceRadiusNm(m.helpersAutoArriveRadiusNm)
  if (hasRadiusKey && Number.isFinite(radParsed)) {
    setHelpersAutoArriveRadiusNm(radParsed)
  }
}

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
  syncRefsFromStorage()
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
  syncRefsFromStorage()
}

/** @returns {number} meters */
export function helpersTriggerRadiusMeters() {
  return helpersAutoArriveRadiusNmRef.value * 1852
}

syncRefsFromStorage()
