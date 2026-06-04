/**
 * US federal holidays (observed calendar days in the user's local timezone).
 * Used to suggest manual 1.5× mileage approval on History trips.
 */

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {number} day
 * @returns {string} YYYY-MM-DD
 */
function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Fixed-date holidays: observed weekday plus actual calendar day when it falls on a weekend.
 * @param {number} year
 * @param {number} month 1–12
 * @param {number} day
 * @returns {string[]}
 */
function fixedHolidayDateKeys(year, month, day) {
  const d = new Date(year, month - 1, day, 12, 0, 0, 0)
  const dow = d.getDay()
  const nominal = isoDate(year, month, day)
  if (dow === 6) return [isoDate(year, month, day - 1), nominal]
  if (dow === 0) return [isoDate(year, month, day + 1), nominal]
  return [nominal]
}

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {number} weekday 0=Sun..6=Sat
 * @param {number} n 1=first, 2=second, …; -1=last
 * @returns {string}
 */
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(year, month - 1, 1, 12, 0, 0, 0)
    let offset = (weekday - first.getDay() + 7) % 7
    offset += (n - 1) * 7
    const d = new Date(year, month - 1, 1 + offset, 12, 0, 0, 0)
    return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
  }
  const lastDay = new Date(year, month, 0, 12, 0, 0, 0).getDate()
  const last = new Date(year, month - 1, lastDay, 12, 0, 0, 0)
  let offset = (last.getDay() - weekday + 7) % 7
  const d = new Date(year, month - 1, lastDay - offset, 12, 0, 0, 0)
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/**
 * @param {number} year
 * @returns {Set<string>}
 */
export function federalHolidayDateKeysForYear(year) {
  const y = Math.floor(year)
  /** @type {string[]} */
  const keys = [
    ...fixedHolidayDateKeys(y, 1, 1),
    nthWeekdayOfMonth(y, 1, 1, 3),
    nthWeekdayOfMonth(y, 2, 1, 3),
    nthWeekdayOfMonth(y, 5, 1, -1),
    ...fixedHolidayDateKeys(y, 6, 19),
    ...fixedHolidayDateKeys(y, 7, 4),
    nthWeekdayOfMonth(y, 9, 1, 1),
    nthWeekdayOfMonth(y, 10, 1, 2),
    ...fixedHolidayDateKeys(y, 11, 11),
    nthWeekdayOfMonth(y, 11, 4, 4),
    ...fixedHolidayDateKeys(y, 12, 25),
  ]
  return new Set(keys)
}

/** @type {Map<number, Set<string>>} */
const cacheByYear = new Map()

/**
 * @param {number} ms
 * @returns {string}
 */
export function localDateKeyFromMs(ms) {
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/**
 * @param {number} ms
 * @returns {boolean}
 */
export function isUsFederalHolidayMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return false
  const d = new Date(ms)
  if (isNaN(d.getTime())) return false
  const y = d.getFullYear()
  let set = cacheByYear.get(y)
  if (!set) {
    set = federalHolidayDateKeysForYear(y)
    cacheByYear.set(y, set)
  }
  return set.has(localDateKeyFromMs(ms))
}

/**
 * @param {number | null | undefined} ms
 * @returns {boolean}
 */
export function isUsFederalHolidayTimestamp(ms) {
  return isUsFederalHolidayMs(/** @type {number} */ (ms))
}
