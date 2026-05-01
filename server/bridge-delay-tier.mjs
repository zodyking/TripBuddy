/**
 * Delay tier for PANYNJ minutes (matches client bridgeDelayTier).
 * @param {number} minutes
 * @returns {'green' | 'orange' | 'red'}
 */
export function bridgeDelayTier(minutes) {
  const m = Number(minutes)
  if (!Number.isFinite(m)) return 'orange'
  if (m <= 3) return 'green'
  if (m < 10) return 'orange'
  return 'red'
}
