/**
 * Bridge traffic → WhatsApp alert helpers (rate limit, messages, eligibility).
 */

/** @typedef {'highTraffic' | 'gridlock'} BridgeTrafficAlertKind */

const STORAGE_PREFIX = 'bridgeWaAlert:v3:'

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
  return v !== 'sent' && v !== 'dismissed' && v !== 'offered'
}

/**
 * Preview was shown this hour (avoid re-queueing every poll).
 * @param {string} routeId
 */
export function markBridgeTrafficAlertOffered(routeId) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const id = String(routeId ?? '').trim()
  if (!id) return
  const key = storageKey(id)
  const v = window.localStorage.getItem(key)
  if (v === 'sent' || v === 'dismissed') return
  window.localStorage.setItem(key, 'offered')
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
 * Short location label for alerts (e.g. "GWB upper level", "Goethals Bridge").
 * @param {string} displayTitle from crossings UI
 */
export function bridgeAlertLocationLabel(displayTitle) {
  const full = String(displayTitle ?? '').trim()
  if (!full) return 'the crossing'

  const deckMatch = full.match(/\s*[—–-]\s*(upper|lower)\s*$/i)
  const deck = deckMatch ? String(deckMatch[1]).toLowerCase() : ''
  const base = full.replace(/\s*[—–-]\s*(upper|lower)\s*$/i, '').trim() || full

  let short = base
  if (/george\s+washington/i.test(base)) short = 'GWB'
  else if (/bayonne/i.test(base) && !/bridge/i.test(base)) short = 'Bayonne Bridge'
  else if (/outerbridge/i.test(base) && !/crossing/i.test(base)) short = 'Outerbridge Crossing'

  if (deck) return `${short} ${deck} level`
  return short
}

/**
 * @param {unknown} travelDirection ToNY | ToNJ | row value
 */
export function bridgeAlertDirectionPhrase(travelDirection) {
  const raw = String(travelDirection ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (raw === 'TONY' || raw === 'TOWARDNY' || raw === 'TONYC') return 'heading towards NY'
  if (raw === 'TONJ' || raw === 'TOWARDNJ' || raw === 'TONJE') return 'heading towards NJ'
  if (raw.includes('NY') && !raw.includes('NJ')) return 'heading towards NY'
  if (raw.includes('NJ') && !raw.includes('NY')) return 'heading towards NJ'
  return ''
}

/** @deprecated use bridgeAlertLocationLabel */
export function casualBridgeNameForAlert(bridgeName) {
  return bridgeAlertLocationLabel(bridgeName)
}

/**
 * @param {string} bridgeName display title from crossings card
 * @param {BridgeTrafficAlertKind} kind
 * @param {{ crossingMin?: string, travelDirection?: unknown }} [opts]
 */
export function buildBridgeTrafficAlertMessage(bridgeName, kind, opts = {}) {
  const location = bridgeAlertLocationLabel(bridgeName)
  const dir = bridgeAlertDirectionPhrase(opts.travelDirection)
  const dirBit = dir ? ` ${dir}` : ''
  const min = String(opts.crossingMin ?? '').trim()
  const minBit = min && min !== '—' ? ` (${min} min)` : ''

  if (kind === 'gridlock') {
    return `Standstill traffic on ${location}${dirBit}${minBit}.`
  }
  return `Heavy traffic on ${location}${dirBit}${minBit}.`
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
