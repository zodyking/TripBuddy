/**
 * Map marker / accent colors from current crossing delay (minutes).
 * Bands: ≤3 min green (good), <10 min orange (slow), ≥10 min red (heavy).
 * @param {number} minutes routeTravelTime (finite minutes)
 * @returns {'green' | 'orange' | 'red'}
 */
export function bridgeDelayTier(minutes) {
  const m = Number(minutes)
  if (!Number.isFinite(m)) return 'orange'
  if (m <= 3) return 'green'
  if (m < 10) return 'orange'
  return 'red'
}
