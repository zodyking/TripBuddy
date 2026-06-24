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
 * @param {Date} date
 * @param {string} [timeZone]
 */
export function zonedYmd(date, timeZone = 'UTC') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date)
}

/**
 * @param {Date} date
 * @param {string} [timeZone]
 */
export function zonedMinutesFromMidnight(date, timeZone = 'UTC') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(date)
  /** @type {Record<string, string>} */
  const m = {}
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  const hour = Number(m.hour)
  const minute = Number(m.minute)
  return hour * 60 + minute
}

/**
 * @param {string} ymd
 * @param {number} days
 */
export function ymdMinusDays(ymd, days) {
  const dt = parseYmdAtNoon(ymd)
  if (!dt) return ''
  dt.setDate(dt.getDate() - days)
  return localYmd(dt)
}

/**
 * Same rules as shiftDateKeyForEventMs, but in the user's timezone.
 * @param {number} eventMs
 * @param {string} [timeZone]
 * @param {number} [shiftStartMins=0]
 * @param {number} [shiftEndMins=1439]
 */
export function shiftDateKeyForEventMsInTimezone(
  eventMs,
  timeZone = 'UTC',
  shiftStartMins = 0,
  shiftEndMins = 1439,
) {
  if (typeof eventMs !== 'number' || !Number.isFinite(eventMs)) return ''
  const d = new Date(eventMs)
  if (isNaN(d.getTime())) return ''
  const s = Math.max(0, Math.min(1439, Math.floor(shiftStartMins)))
  const e = Math.max(0, Math.min(1439, Math.floor(shiftEndMins)))
  const mins = zonedMinutesFromMidnight(d, timeZone)
  const overnight = s > e
  const ymd = zonedYmd(d, timeZone)

  if (overnight) {
    if (mins >= s) return ymd
    if (mins < e) return ymdMinusDays(ymd, 1)
    return ymd
  }

  if (mins >= s && mins < e) return ymd
  return ymd
}

/**
 * Decide whether the daily shift summary should send now and which shift day to summarize.
 * @param {{ nowMs: number, timeZone: string, shiftStartMins?: number, shiftEndMins?: number, dailyDelayMins?: number }} opts
 */
export function computeDailyShiftEmailDecision(opts) {
  const timeZone = opts.timeZone || 'America/New_York'
  const shiftStart = opts.shiftStartMins ?? 0
  const shiftEnd = opts.shiftEndMins ?? 1439
  const dailyDelay = opts.dailyDelayMins ?? 30
  const now = new Date(opts.nowMs)
  const mins = zonedMinutesFromMidnight(now, timeZone)
  const rawTrigger = shiftEnd + dailyDelay
  const triggerMins = rawTrigger % 1440

  if (mins < triggerMins) {
    return { shouldSend: false, shiftDayKey: '' }
  }

  const refMs = opts.nowMs - (dailyDelay + 1) * 60 * 1000
  const shiftDayKey = shiftDateKeyForEventMsInTimezone(
    refMs,
    timeZone,
    shiftStart,
    shiftEnd,
  )
  return { shouldSend: Boolean(shiftDayKey), shiftDayKey }
}

/**
 * @param {{ nowMs: number, timeZone: string }} opts
 */
export function computeWeeklyEmailDecision(opts) {
  const timeZone = opts.timeZone || 'America/New_York'
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(opts.nowMs))
  /** @type {Record<string, string>} */
  const m = {}
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  const weekday = m.weekday
  const hour = Number(m.hour)
  const minute = Number(m.minute)
  const mins = hour * 60 + minute
  const shouldSend = weekday === 'Mon' && mins >= 360 && mins < 420
  return {
    shouldSend,
    referenceMs: shouldSend ? opts.nowMs - 24 * 60 * 60 * 1000 : 0,
  }
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
