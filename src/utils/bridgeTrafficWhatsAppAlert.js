/**
 * Bridge traffic → WhatsApp alert helpers (rate limit, messages, eligibility).
 */

/** @typedef {'highTraffic' | 'gridlock'} BridgeTrafficAlertKind */

const STORAGE_PREFIX = 'bridgeWaAlert:v1:'

/**
 * Clock-hour bucket key (local timezone).
 * @param {number} [nowMs]
 */
export function bridgeAlertClockHourKey(nowMs = Date.now()) {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  return `${y}-${mo}-${da}T${h}`
}

/**
 * @param {string} routeId
 * @param {number} [nowMs]
 */
function storageKey(routeId, nowMs) {
  return `${STORAGE_PREFIX}${String(routeId).trim()}:${bridgeAlertClockHourKey(nowMs)}`
}

/**
 * @param {string} routeId
 */
export function canOfferBridgeTrafficAlert(routeId) {
  if (typeof window === 'undefined' || !window.localStorage) return true
  const id = String(routeId ?? '').trim()
  if (!id) return false
  const key = storageKey(id)
  const v = window.localStorage.getItem(key)
  return v !== 'sent' && v !== 'dismissed'
}

/**
 * @param {string} routeId
 */
export function markBridgeTrafficAlertSent(routeId) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const id = String(routeId ?? '').trim()
  if (!id) return
  window.localStorage.setItem(storageKey(id), 'sent')
}

/**
 * @param {string} routeId
 */
export function markBridgeTrafficAlertDismissed(routeId) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const id = String(routeId ?? '').trim()
  if (!id) return
  window.localStorage.setItem(storageKey(id), 'dismissed')
}

/**
 * @param {string} bridgeName
 * @param {BridgeTrafficAlertKind} kind
 */
export function buildBridgeTrafficAlertMessage(bridgeName, kind) {
  const name = String(bridgeName ?? '').trim() || 'this crossing'
  if (kind === 'gridlock') {
    return `Gridlock warning — standstill traffic on ${name}.`
  }
  return `High traffic warning on ${name}.`
}

/**
 * Red UI = heavy (high). Purple UI = standstill.
 * @param {string} level
 * @param {string} tier
 * @returns {BridgeTrafficAlertKind | null}
 */
export function bridgeAlertKindForTraffic(level, tier) {
  const lv = String(level ?? '').toLowerCase()
  if (lv === 'standstill') return 'gridlock'
  if (lv === 'high' && tier === 'red') return 'highTraffic'
  return null
}
