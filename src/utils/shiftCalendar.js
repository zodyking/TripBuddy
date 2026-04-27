/**
 * "Shift day" for overnight shifts (e.g. 7pm–7am): a trip at 1am Tuesday belongs to
 * the shift that **started** Monday evening, so the calendar key is the Monday date.
 * For non-overnight shifts, the shift's calendar day is the local date of the event.
 * Times are minutes from midnight (0–1439).
 * @param {number} eventMs
 * @param {number} [shiftStartMins=0] default full calendar day
 * @param {number} [shiftEndMins=1439]
 */
export function shiftDateKeyForEventMs(
  eventMs,
  shiftStartMins = 0,
  shiftEndMins = 1439,
) {
  if (typeof eventMs !== 'number' || !Number.isFinite(eventMs)) {
    return ''
  }
  const d = new Date(eventMs)
  if (isNaN(d.getTime())) return ''
  const s = Math.max(0, Math.min(1439, Math.floor(shiftStartMins)))
  const e = Math.max(0, Math.min(1439, Math.floor(shiftEndMins)))
  const mins = d.getHours() * 60 + d.getMinutes()
  const overnight = s > e

  if (overnight) {
    if (mins >= s) {
      return localYmd(d)
    }
    if (mins < e) {
      const p = new Date(d.getTime() - 24 * 60 * 60 * 1000)
      return localYmd(p)
    }
    return localYmd(d)
  }

  if (mins >= s && mins < e) {
    return localYmd(d)
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
