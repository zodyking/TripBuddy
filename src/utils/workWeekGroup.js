const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
 * @param {{ workWeekStartDay: number, workWeekEndDay: number }} [opts]
 * @returns {{ key: string, endMs: number, groupLabel: string } | null}
 */
export function workWeekGroupMeta(
  tsMs,
  opts = { workWeekStartDay: 0, workWeekEndDay: 6 },
) {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs) || tsMs <= 0) return null
  const d = new Date(tsMs)
  if (isNaN(d.getTime())) return null
  const st = Math.min(6, Math.max(0, Math.floor(Number(opts?.workWeekStartDay) || 0)))
  const en = Math.min(6, Math.max(0, Math.floor(Number(opts?.workWeekEndDay) || 6)))
  const wStart = startOfWorkWeek(d, st)
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
