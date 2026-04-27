const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
import { shiftDateKeyForEventMs } from './shiftCalendar.js'

const DOW3 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * @param {number} d 0-6
 */
function dayShort(d) {
  return DOW3[d] || ''
}

/**
 * @param {number} n
 */
function dayMod(n) {
  return ((n % 7) + 7) % 7
}

/**
 * Start of the work-week block (local) containing `d`, when weeks start on `startDay` (0=Sun..6=Sat).
 * @param {Date} d
 * @param {number} startDay
 */
function startOfWorkWeek(d, startDay) {
  const t = new Date(d.getTime())
  const w = t.getDay()
  const back = dayMod(w - startDay)
  t.setDate(t.getDate() - back)
  t.setHours(0, 0, 0, 0)
  return t
}

/**
 * @param {number} startDay
 * @param {number} endDay
 * @returns {string}
 */
function workWeekDowLabel(startDay, endDay) {
  const a = dayMod(startDay)
  const b = dayMod(endDay)
  if (a === b) return DAY[a]
  return `${DAY[a]} – ${DAY[b]}`
}

/**
 * Group by rolling 7-day windows that start on `workWeekStartDay` (0–6, default Sunday).
 * `workWeekEndDay` is used in the group title only.
 * @param {number} tsMs
 * @param {{
 *   workWeekStartDay: number,
 *   workWeekEndDay: number,
 *   shiftStartMins?: number,
 *   shiftEndMins?: number
 * }} [opts]
 * @returns {{ key: string, endMs: number, groupLabel: string, weekStart: number } | null}
 */
export function workWeekGroupMeta(
  tsMs,
  opts = { workWeekStartDay: 0, workWeekEndDay: 6, shiftStartMins: 0, shiftEndMins: 1439 },
) {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs) || tsMs <= 0) return null
  const d = new Date(tsMs)
  if (isNaN(d.getTime())) return null
  const st = Math.min(6, Math.max(0, Math.floor(Number(opts?.workWeekStartDay) || 0)))
  const en = Math.min(6, Math.max(0, Math.floor(Number(opts?.workWeekEndDay) || 6)))
  const sM = Math.max(0, Math.min(1439, Math.floor(Number(opts?.shiftStartMins) || 0)))
  const eM = Math.max(0, Math.min(1439, Math.floor(Number(opts?.shiftEndMins) || 1439)))
  const shiftYmd = shiftDateKeyForEventMs(tsMs, sM, eM)
  const dAnchor = (() => {
    if (shiftYmd) {
      const [yy, mo, day] = shiftYmd.split('-').map((x) => parseInt(x, 10))
      if (yy && mo && day) {
        const t2 = new Date(yy, mo - 1, day, 12, 0, 0, 0)
        if (!isNaN(t2.getTime())) return t2
      }
    }
    return d
  })()
  const wStart = startOfWorkWeek(dAnchor, st)
  const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
  const endMs = wEnd.getTime()
  const y = wStart.getFullYear()
  const fmt = (t) =>
    t.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const ymd = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  const key = `ww-${ymd(wStart)}`
  const dowL = workWeekDowLabel(st, en)
  const groupLabel = `Work week (${dowL}) — ${fmt(wStart)} – ${fmt(wEnd)}`

  return { key, endMs, groupLabel, weekStart: wStart.getTime() }
}

/**
 * @param {number} tsMs
 * @param {{ workWeekStartDay: number, workWeekEndDay: number, shiftStartMins?: number, shiftEndMins?: number }} [opts]
 */
export function workWeekKeyForDate(
  tsMs,
  opts = { workWeekStartDay: 0, workWeekEndDay: 6, shiftStartMins: 0, shiftEndMins: 1439 },
) {
  const w = workWeekGroupMeta(tsMs, opts)
  if (!w) return null
  const wStart = new Date(w.weekStart)
  const wEnd = new Date(w.weekStart + 7 * 24 * 60 * 60 * 1000 - 1)
  return { key: w.key, weekStartMs: w.weekStart, weekEndMs: wEnd.getTime(), groupLabel: w.groupLabel }
}

/**
 * Local YYYY-MM-DD
 * @param {number} ts
 */
export function localDateKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Day strip: Mon–Sun labels around a week
 * @param {number} weekStartMs
 */
export function dayStripForWeek(weekStartMs) {
  const a = new Date(weekStartMs)
  a.setHours(0, 0, 0, 0)
  const out = []
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(a.getTime() + i * 24 * 60 * 60 * 1000)
    out.push({
      key: localDateKey(d.getTime()),
      label: d.getDate().toString(),
      dowLabel: dayShort(d.getDay()),
      dow: d.getDay(),
      d,
    })
  }
  return out
}

const CAL_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * 6-week Sunday-start grid; each cell is a calendar day. `inWorkWeek` is true for days
 * in the rolling 7-day work block starting at `workWeekStartMs` (local midnight).
 * @param {number} workWeekStartMs
 * @param {Record<string, number>} [tripCounts] keys: shift-based YYYY-MM-DD
 * @param {{ shiftStartMins?: number, shiftEndMins?: number }} [shift]
 */
export function monthGridForWorkWeek(
  workWeekStartMs,
  tripCounts = {},
  shift = { shiftStartMins: 0, shiftEndMins: 1439 },
) {
  if (typeof workWeekStartMs !== 'number' || !Number.isFinite(workWeekStartMs)) {
    return { headers: CAL_HEADERS, cells: [] }
  }
  const sM = Math.max(0, Math.min(1439, Math.floor(Number(shift?.shiftStartMins) || 0)))
  const eM = Math.max(0, Math.min(1439, Math.floor(Number(shift?.shiftEndMins) || 1439)))
  const todayK = localDateKey(Date.now())
  const ws = new Date(workWeekStartMs)
  ws.setHours(0, 0, 0, 0)
  const wEndT = new Date(ws.getTime() + 6 * 24 * 60 * 60 * 1000)
  const wStartK = localDateKey(ws.getTime())
  const wEndK = localDateKey(wEndT.getTime())
  const grid0 = new Date(ws.getTime())
  const dow0 = grid0.getDay()
  grid0.setDate(grid0.getDate() - dow0)
  grid0.setHours(0, 0, 0, 0)
  /** @type {{ key: string, dayNum: number, inWorkWeek: boolean, tripCount: number, isToday: boolean }[]} */
  const cells = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(grid0.getTime() + i * 24 * 60 * 60 * 1000)
    const k = localDateKey(d.getTime())
    const inWw = k >= wStartK && k <= wEndK
    const tripCount = typeof tripCounts[k] === 'number' ? tripCounts[k] : 0
    cells.push({
      key: k,
      dayNum: d.getDate(),
      inWorkWeek: inWw,
      tripCount,
      isToday: k === todayK,
    })
  }
  return { headers: CAL_HEADERS, cells }
}

/**
 * Full calendar month (42 cells, Sunday start). `inMonth` marks days in the target month; others are padding.
 * @param {number} year
 * @param {number} monthIndex0 0–11
 * @param {Record<string, number>} [tripCounts] keys: shift YYYY-MM-DD
 * @param {{ shiftStartMins?: number, shiftEndMins?: number }} [shift]
 * @returns {{ year: number, monthIndex0: number, monthLabel: string, headers: string[], cells: { key: string, dayNum: number, inMonth: boolean, tripCount: number, isToday: boolean }[]}}
 */
export function monthGridForCalendarMonth(
  year,
  monthIndex0,
  tripCounts = {},
  _shift = { shiftStartMins: 0, shiftEndMins: 1439 },
) {
  const y = Math.floor(year)
  const m0 = Math.max(0, Math.min(11, Math.floor(monthIndex0)))
  const first = new Date(y, m0, 1, 0, 0, 0, 0)
  if (isNaN(first.getTime())) {
    return {
      year: y,
      monthIndex0: m0,
      monthLabel: '—',
      headers: CAL_HEADERS,
      cells: [],
    }
  }
  const monthLabel = first.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const startDow = first.getDay()
  const grid0 = new Date(y, m0, 1 - startDow, 0, 0, 0, 0)
  const cells = []
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(grid0.getTime() + i * 24 * 60 * 60 * 1000)
    /** One bucket per *calendar* day: shift starting `shiftStart` on this date (see shiftCalendar). */
    const k = localDateKey(d.getTime())
    const inMonth = d.getFullYear() === y && d.getMonth() === m0
    const tripCount = typeof tripCounts[k] === 'number' ? tripCounts[k] : 0
    cells.push({
      key: k,
      dayNum: d.getDate(),
      inMonth,
      tripCount,
      isToday: k === localDateKey(Date.now()),
    })
  }
  return { year: y, monthIndex0: m0, monthLabel, headers: CAL_HEADERS, cells }
}

/**
 * @param {number} year
 * @param {number} monthIndex0
 */
export function dayStripForMonth(year, monthIndex0) {
  const y = Math.floor(year)
  const m0 = Math.max(0, Math.min(11, Math.floor(monthIndex0)))
  const last = new Date(y, m0 + 1, 0, 0, 0, 0, 0)
  const n = last.getDate()
  const out = []
  for (let day = 1; day <= n; day += 1) {
    const d = new Date(y, m0, day, 12, 0, 0, 0)
    out.push({
      key: localDateKey(d.getTime()),
      label: String(day),
      dowLabel: dayShort(d.getDay()),
      dow: d.getDay(),
    })
  }
  return out
}
