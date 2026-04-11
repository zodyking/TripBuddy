/** Matches server `checkInFlow.mjs` DRIVER_LOCATION_MISMATCH_SNIPPET (fallback if API omits flag). */
export const DRIVER_LOCATION_MISMATCH_SNIPPET =
  'Driver ID is currently not located where the tractor is trying to dispatch from'

/**
 * @param {string} text
 */
function normalizeFedexBannerTextForMatch(text) {
  let s = String(text).normalize('NFKC')
  s = s.replace(/[\u2018\u2019\u201c\u201d]/g, "'")
  s = s.replace(/\u00a0/g, ' ')
  s = s.replace(/\s+/g, ' ')
  return s.trim().toLowerCase()
}

/**
 * @param {string | undefined | null} text
 */
export function isCheckInLocationMismatchMessage(text) {
  if (!text || typeof text !== 'string') return false
  const n = normalizeFedexBannerTextForMatch(text)
  const snippet = normalizeFedexBannerTextForMatch(DRIVER_LOCATION_MISMATCH_SNIPPET)
  if (n.includes(snippet)) return true
  if (n.includes('linehaul office') && n.includes('not located')) return true
  return false
}
