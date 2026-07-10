/** Paid miles in this band count as {@link PAY_ROUND_TO_MI} for pay estimate / totals. */
export const PAY_ROUND_BAND_MIN = 34
/** Inclusive upper bound (49 mi rounds up; 50+ unchanged). */
export const PAY_ROUND_BAND_MAX = 49
export const PAY_ROUND_TO_MI = 50

/**
 * Billable miles for the pay estimate ($1 / mi rule).
 * 34–49 mi paid → 50 mi; below 34 and 50+ unchanged.
 * @param {number} paidMi
 */
export function billableMilesForPayEstimate(paidMi) {
  if (!Number.isFinite(paidMi)) return 0
  if (paidMi >= PAY_ROUND_BAND_MIN && paidMi <= PAY_ROUND_BAND_MAX) return PAY_ROUND_TO_MI
  return paidMi
}

/**
 * @param {number} paidMi
 * @returns {boolean}
 */
export function isPayMileageRounded(paidMi) {
  return (
    Number.isFinite(paidMi) &&
    paidMi >= PAY_ROUND_BAND_MIN &&
    paidMi <= PAY_ROUND_BAND_MAX
  )
}
