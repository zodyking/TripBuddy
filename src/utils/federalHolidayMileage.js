import { isUsFederalHolidayTimestamp } from './usFederalHolidays.js'

export const FEDERAL_HOLIDAY_MILEAGE_MULTIPLIER = 1.5
export const FEDERAL_HOLIDAY_PDF_NOTE = 'federal holiday 1.5x multiplier'

/**
 * @param {number} n
 */
export function roundMilesTenth(n) {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

/**
 * @param {number} paidMi
 * @param {boolean} approved15x
 */
export function billableMilesWithFederalHoliday(paidMi, approved15x) {
  const base =
    typeof paidMi === 'number' && Number.isFinite(paidMi) ? paidMi : 0
  if (!approved15x) return base
  return roundMilesTenth(base * FEDERAL_HOLIDAY_MILEAGE_MULTIPLIER)
}

/**
 * Ledger row shape used for eligibility (History + PDF).
 * @typedef {{
 *   recordedAt?: number,
 *   ledgerEventMs?: number,
 *   dispatchedAtMs?: number,
 *   tripDetails?: Record<string, unknown>,
 *   dispatchHeader?: Record<string, unknown>,
 *   outcomeTouchedAt?: number,
 * }} TripHolidayEligibilityInput
 */

/**
 * @param {TripHolidayEligibilityInput} e
 * @param {{
 *   assignedAtMs?: (e: TripHolidayEligibilityInput) => number | null,
 *   dispatchedAtMs?: (e: TripHolidayEligibilityInput) => number | null,
 *   arrivedAtMs?: (e: TripHolidayEligibilityInput) => number | null,
 * }} hooks
 * @returns {boolean}
 */
export function tripTouchesFederalHoliday(e, hooks) {
  if (!e || typeof e !== 'object') return false
  const stamps = [
    hooks.assignedAtMs?.(e),
    hooks.dispatchedAtMs?.(e),
    hooks.arrivedAtMs?.(e),
  ]
  for (const ms of stamps) {
    if (isUsFederalHolidayTimestamp(ms)) return true
  }
  return false
}
