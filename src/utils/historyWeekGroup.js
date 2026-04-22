/**
 * Group timestamps into "January — Week 1 (Jan 1 – Jan 7, 2026)" buckets
 * (month split into 7-day rows from the 1st: days 1–7, 8–14, …, remainder last row).
 * @param {number} tsMs
 * @returns {{ key: string, year: number, month0: number, weekInMonth: number, endMs: number, groupLabel: string } | null}
 */
export function weekGroupMeta(tsMs) {
  if (typeof tsMs !== 'number' || !Number.isFinite(tsMs) || tsMs <= 0) return null
  const d = new Date(tsMs)
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m0 = d.getMonth()
  const dayOfMonth = d.getDate()
  const lastDom = new Date(y, m0 + 1, 0).getDate()
  const weekInMonth = Math.min(5, 1 + Math.floor((dayOfMonth - 1) / 7))
  const startDay = (weekInMonth - 1) * 7 + 1
  const endDay = Math.min(weekInMonth * 7, lastDom)
  const dStart = new Date(y, m0, startDay, 0, 0, 0, 0)
  const dEnd = new Date(y, m0, endDay, 23, 59, 59, 999)
  const endMs = dEnd.getTime()
  const monthName = d.toLocaleString('en-US', { month: 'long' })
  const fmt = (t) => t.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const groupLabel = `${monthName} — Week ${weekInMonth} (${fmt(dStart)} – ${fmt(dEnd)})`
  const key = `${y}-${String(m0 + 1).padStart(2, '0')}-w${weekInMonth}`

  return { key, year: y, month0: m0, weekInMonth, endMs, groupLabel }
}
