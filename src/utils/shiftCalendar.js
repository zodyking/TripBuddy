/**
 * "Shift day" for calendar bucketing: rolling windows [shiftStart, shiftStart) next day.
 * Example: shift 9pm → bucket `YYYY-MM-DD` of the **9pm you passed through most recently
 * and then stayed until the next 9pm**. 9pm Nov5 → 9pm Nov6 (exclusive of end) → all those
 * trips are assigned to **2026-11-05**; actual timestamps are unchanged, only the bucket key.
 *
 * @param {number} eventMs
 * @param {number} [shiftStartMins=0] minutes from local midnight; 0 = use calendar YYYY-MM-DD
 * @param {number} [_shiftEndMins=1439] legacy; not used (keep call sites compatible)
 */
export function shiftDateKeyForEventMs(
  eventMs,
  shiftStartMins = 0,
  _shiftEndMins = 1439,
) {
  if (typeof eventMs !== 'number' || !Number.isFinite(eventMs)) {
    return ''
  }
  const d = new Date(eventMs)
  if (isNaN(d.getTime())) return ''
  const s = Math.max(0, Math.min(1440, Math.floor(shiftStartMins)))
  if (s <= 0 || s >= 24 * 60) {
    return localYmd(d)
  }
  const mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  if (mins < s) {
    const p = new Date(d.getTime() - 24 * 60 * 60 * 1000)
    return localYmd(p)
  }
  return localYmd(d)
}

function localYmd(/** @type {Date} */ t) {
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/**
 * @param {string} [hms] "HH:MM" or "HH:MM:SS"
 * @param {number} [fallback=0]
 */
export function timeStringToMinutes(hms, fallback = 0) {
  if (hms == null || typeof hms !== 'string') return fallback
  const t = hms.trim()
  if (!t) return fallback
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return fallback
  let h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min)) return fallback
  h = ((h % 24) + 24) % 24
  const out = h * 60 + Math.min(59, Math.max(0, min))
  return Math.min(1439, out)
}

/**
 * @param {string} ymd YYYY-MM-DD
 * @returns {Date | null}
 */
export function parseYmdAtNoon(ymd) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0)
  return isNaN(dt.getTime()) ? null : dt
}
