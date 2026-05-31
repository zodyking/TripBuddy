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
 * Shorter name for chat (drops deck suffix when present).
 * @param {string} bridgeName
 */
export function casualBridgeNameForAlert(bridgeName) {
  const full = String(bridgeName ?? '').trim()
  if (!full) return 'the bridge'
  return full.replace(/\s*[—–-]\s*(upper|lower)\s*$/i, '').trim() || full
}

/**
 * @param {string} bridgeName
 * @param {BridgeTrafficAlertKind} kind
 * @param {{ crossingMin?: string }} [opts]
 */
export function buildBridgeTrafficAlertMessage(bridgeName, kind, opts = {}) {
  const name = casualBridgeNameForAlert(bridgeName)
  const min = String(opts.crossingMin ?? '').trim()
  const minBit = min && min !== '—' ? ` (${min} min right now)` : ''

  if (kind === 'gridlock') {
    return `${name} is basically at a standstill${minBit}.`
  }
  return `Traffic's really heavy on ${name}${minBit}.`
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
