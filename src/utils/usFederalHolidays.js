/**
 * US federal holiday detection for mileage / pay helpers (America/New_York calendar).
 * Uses weekend-observed rules: Sat → prior Fri, Sun → following Mon (OPM-style).
 */

/** @param {number} ms */
function nyParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
  const o = { y: 0, m: 0, d: 0, weekday: '' }
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type === 'year') o.y = Number(p.value)
    if (p.type === 'month') o.m = Number(p.value)
    if (p.type === 'day') o.d = Number(p.value)
    if (p.type === 'weekday') o.weekday = p.value
  }
  return o
}

/**
 * Find a UTC instant whose NY calendar date is (y, m, d) near local noon.
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} d 1-31
 */
function utcMsForNyCalendarNoon(y, m, d) {
  const base = Date.UTC(y, m - 1, d, 17, 0, 0)
  for (let dh = -20; dh <= 20; dh++) {
    const ms = base + dh * 3600000
    const p = nyParts(ms)
    if (p.y === y && p.m === m && p.d === d) return ms
  }
  return base
}

/** @param {number} ms @returns {0-6 Sun-Sat} in America/New_York */
function nyWeekdaySun0(ms) {
  const w = nyParts(ms).weekday
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[w] ?? 0
}

/**
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} nth 1-based (1st Monday = 1)
 * @param {number} weekdaySun0
 */
function nthWeekdayOfMonthNy(y, m, nth, weekdaySun0) {
  let count = 0
  for (let d = 1; d <= 31; d++) {
    const ms = utcMsForNyCalendarNoon(y, m, d)
    const p = nyParts(ms)
    if (p.y !== y || p.m !== m || p.d !== d) continue
    if (nyWeekdaySun0(ms) === weekdaySun0) {
      count++
      if (count === nth) return ms
    }
  }
  return null
}

/**
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} weekdaySun0
 */
function lastWeekdayOfMonthNy(y, m, weekdaySun0) {
  for (let d = 31; d >= 1; d--) {
    const ms = utcMsForNyCalendarNoon(y, m, d)
    const p = nyParts(ms)
    if (p.y !== y || p.m !== m || p.d !== d) continue
    if (nyWeekdaySun0(ms) === weekdaySun0) return ms
  }
  return null
}

/**
 * @param {number} ms
 * @returns {{ name: string, key: string } | null} key is YYYY-MM-DD in NY for the observed day off
 */
export function usFederalHolidayObservedAmericaNewYork(ms) {
  if (!(typeof ms === 'number' && Number.isFinite(ms) && ms > 0)) return null
  const p = nyParts(ms)
  const y = p.y
  const m = p.m
  const d = p.d
  const wd = nyWeekdaySun0(ms)
  const key = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  /** @type {Array<{ name: string, ms: number | null }>} */
  const list = []

  const pushFixed = (month, day, name) => {
    const t = utcMsForNyCalendarNoon(y, month, day)
    const pp = nyParts(t)
    if (pp.y !== y) return
    let obs = t
    const w = nyWeekdaySun0(t)
    if (w === 6) obs = t - 86400000
    if (w === 0) obs = t + 86400000
    list.push({ name, ms: obs })
  }

  pushFixed(1, 1, "New Year's Day")
  list.push({ name: 'Martin Luther King Jr. Day', ms: nthWeekdayOfMonthNy(y, 1, 3, 1) })
  list.push({ name: "Presidents' Day", ms: nthWeekdayOfMonthNy(y, 2, 3, 1) })
  list.push({ name: 'Memorial Day', ms: lastWeekdayOfMonthNy(y, 5, 1) })
  pushFixed(6, 19, 'Juneteenth National Independence Day')
  pushFixed(7, 4, 'Independence Day')
  list.push({ name: 'Labor Day', ms: nthWeekdayOfMonthNy(y, 9, 1, 1) })
  list.push({ name: 'Columbus Day', ms: nthWeekdayOfMonthNy(y, 10, 2, 1) })
  pushFixed(11, 11, 'Veterans Day')
  list.push({ name: 'Thanksgiving Day', ms: nthWeekdayOfMonthNy(y, 11, 4, 4) })
  pushFixed(12, 25, 'Christmas Day')

  for (const h of list) {
    if (!h.ms) continue
    const ok = nyParts(h.ms)
    const obsKey = `${String(ok.y).padStart(4, '0')}-${String(ok.m).padStart(2, '0')}-${String(ok.d).padStart(2, '0')}`
    if (obsKey === key) return { name: h.name, key: obsKey }
  }
  return null
}

/**
 * @param {{ recordedAt?: unknown, dispatchedAtMs?: unknown, tripDetails?: unknown }} entry ledger row
 * @returns {{ apply: boolean, labels: string[], detail: string }}
 */
export function usFederalHolidayMileageMultiplierInfoFromLedgerEntry(entry) {
  const labels = /** @type {string[]} */ ([])
  const parts = /** @type {string[]} */ ([])

  const ts = []
  const ra = entry?.recordedAt
  if (typeof ra === 'number' && Number.isFinite(ra) && ra > 0) ts.push({ ms: ra, label: 'Assigned' })
  const dd = entry?.dispatchedAtMs
  if (typeof dd === 'number' && Number.isFinite(dd) && dd > 0) ts.push({ ms: dd, label: 'Dispatched' })
  const td = entry?.tripDetails && typeof entry.tripDetails === 'object' ? entry.tripDetails : {}
  const aa = /** @type {Record<string, unknown>} */ (td).appCapturedTripArrivalAtMs
  if (typeof aa === 'number' && Number.isFinite(aa) && aa > 0) ts.push({ ms: aa, label: 'Arrived' })

  for (const { ms, label } of ts) {
    const h = usFederalHolidayObservedAmericaNewYork(ms)
    if (h && !labels.includes(h.name)) {
      labels.push(h.name)
      parts.push(`${label} (${h.name})`)
    }
  }

  if (!labels.length) {
    return { apply: false, labels: [], detail: '' }
  }
  return {
    apply: true,
    labels,
    detail: `US federal holiday (America/New York observed calendar): ${parts.join('; ')}. Time-and-a-half mileage (1.5×) applied.`,
  }
}
