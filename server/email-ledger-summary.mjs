import { shiftDateKeyForEventMs } from '../src/utils/shiftCalendar.js'
import { workWeekGroupMeta, workWeekKeyForDate } from '../src/utils/workWeekGroup.js'

const PAY_ROUND_BAND_MIN = 200
const PAY_ROUND_BAND_MAX = 210
const PAY_ROUND_TO_MI = 210

/**
 * @param {unknown} e
 */
function entryTs(e) {
  if (!e || typeof e !== 'object') return 0
  const o = /** @type {Record<string, unknown>} */ (e)
  const c = o.completedAt ?? o.outcomeTouchedAt ?? o.recordedAt ?? o.dispatchedAtMs
  if (typeof c === 'number' && Number.isFinite(c)) return c
  if (typeof c === 'string' && c.trim()) {
    const t = Date.parse(c)
    if (Number.isFinite(t)) return t
  }
  return typeof o.displayDate === 'number' ? o.displayDate : 0
}

/**
 * @param {unknown} e
 */
function tripPaidMiles(e) {
  const m = e?.tripDetails?.mileage
  if (!m || typeof m !== 'object') return null
  const total = String(/** @type {Record<string, unknown>} */ (m).totalMiles ?? '').trim()
  const n = Number(total)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {number | null} paidMi
 */
function billableMiles(paidMi) {
  if (!Number.isFinite(paidMi)) return 0
  if (paidMi >= PAY_ROUND_BAND_MIN && paidMi <= PAY_ROUND_BAND_MAX) return PAY_ROUND_TO_MI
  return paidMi
}

/**
 * @param {unknown} e
 */
function entryMiles(e) {
  return billableMiles(tripPaidMiles(e))
}

/**
 * @param {unknown} e
 */
function entryRoute(e) {
  const dh = e?.dispatchHeader
  if (!dh || typeof dh !== 'object') return '—'
  const o = String(dh.origin ?? '—').trim()
  const d = String(dh.destination ?? '—').trim()
  return `${o} → ${d}`
}

/**
 * @param {unknown} e
 */
function entryOutcome(e) {
  const dh = e?.dispatchHeader
  const out = dh && typeof dh === 'object' ? String(dh.historyOutcome ?? '').trim() : ''
  return out || '—'
}

/**
 * @param {number} ts
 */
function formatWhen(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * @param {unknown[]} ledger
 * @param {string} shiftDayKey
 * @param {{ shiftStartMins: number, shiftEndMins: number }} shift
 */
export function ledgerEntriesForShiftDay(ledger, shiftDayKey, shift) {
  if (!Array.isArray(ledger) || !shiftDayKey) return []
  return ledger.filter((e) => {
    const ts = entryTs(e)
    if (!ts) return false
    const key = shiftDateKeyForEventMs(ts, shift.shiftStartMins, shift.shiftEndMins)
    return key === shiftDayKey
  })
}

/**
 * @param {unknown[]} ledger
 * @param {string} shiftDayKey
 * @param {{ shiftStartMins: number, shiftEndMins: number }} shift
 */
export function buildDailyShiftSummary(ledger, shiftDayKey, shift) {
  const items = ledgerEntriesForShiftDay(ledger, shiftDayKey, shift).sort(
    (a, b) => entryTs(b) - entryTs(a),
  )
  let totalMiles = 0
  const rows = items.map((e) => {
    const mi = entryMiles(e)
    totalMiles += mi
    return [
      formatWhen(entryTs(e)),
      String(e?.dailyTripLegSequence ?? '—'),
      entryRoute(e),
      entryOutcome(e),
      mi ? `${mi}` : '—',
    ]
  })
  const d = shiftDayKey ? new Date(`${shiftDayKey}T12:00:00`) : new Date()
  const shiftLabel = d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return { shiftLabel, tripCount: items.length, totalMiles, rows }
}

/**
 * @param {unknown[]} ledger
 * @param {{ key: string, weekStartMs: number, weekEndMs: number, groupLabel: string }} week
 * @param {{ groupLabelMode?: 'default' | 'fedexPaySchedule', shiftStartMins: number, shiftEndMins: number }} opts
 */
export function ledgerEntriesForWeek(ledger, week, opts) {
  if (!Array.isArray(ledger) || !week?.key) return []
  return ledger.filter((e) => {
    const ts = entryTs(e)
    if (!ts) return false
    if (opts.groupLabelMode === 'fedexPaySchedule') {
      const d = new Date(ts)
      const meta = workWeekGroupMeta(ts, {
        workWeekStartDay: 0,
        workWeekEndDay: 6,
        shiftStartMins: 0,
        shiftEndMins: 1439,
        groupLabelMode: 'fedexPaySchedule',
      })
      return meta?.key === week.key
    }
    const meta = workWeekGroupMeta(ts, {
      workWeekStartDay: opts.workWeekStartDay ?? 0,
      workWeekEndDay: opts.workWeekEndDay ?? 6,
      shiftStartMins: opts.shiftStartMins ?? 0,
      shiftEndMins: opts.shiftEndMins ?? 1439,
    })
    return meta?.key === week.key
  })
}

/**
 * Build PDF options for getHistoryWeekTotalsPdfBuffer (simplified vs History UI).
 * @param {unknown[]} ledger
 * @param {{ key: string, weekStartMs: number, groupLabel: string, spanDays?: number }} week
 * @param {object} ctx
 */
export function buildWeekTotalsPdfOpts(ledger, week, ctx) {
  const entries = ledgerEntriesForWeek(ledger, week, ctx)
  const byDay = new Map()
  for (const e of entries) {
    const ts = entryTs(e)
    const dayKey = shiftDateKeyForEventMs(ts, ctx.shiftStartMins ?? 0, ctx.shiftEndMins ?? 1439)
    if (!byDay.has(dayKey)) byDay.set(dayKey, [])
    byDay.get(dayKey).push(e)
  }
  const days = []
  let sumBillable = 0
  const span = week.spanDays || 7
  for (let i = 0; i < span; i++) {
    const d = new Date(week.weekStartMs + i * 24 * 60 * 60 * 1000)
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const list = (byDay.get(dk) || []).sort((a, b) => entryTs(b) - entryTs(a))
    let daySum = 0
    const rows = list.map((e) => {
      const mi = entryMiles(e)
      daySum += mi
      const ts = entryTs(e)
      const dt = new Date(ts)
      return {
        od: entryRoute(e),
        when: formatWhen(ts),
        billableMi: mi,
        rounded: mi >= PAY_ROUND_BAND_MIN && mi <= PAY_ROUND_BAND_MAX,
        originId: '—',
        destId: '—',
        weekday: dt.toLocaleDateString('en-US', { weekday: 'long' }),
        dispatchDate: dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }),
        dispatchTime: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        legLabel: String(e?.dailyTripLegSequence ?? '—'),
        tractorNumber: ctx.tractorNumber || '—',
        dailyTripLegSequence: String(e?.dailyTripLegSequence ?? ''),
      }
    })
    sumBillable += daySum
    days.push({
      dayLabel: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      sumBillable: daySum,
      rows,
    })
  }
  const isPay = ctx.groupLabelMode === 'fedexPaySchedule'
  return {
    documentTitle: isPay ? 'FedEx Pay Week Mileage' : 'Work Week Mileage',
    driverBlock: ctx.driverBlock || 'Driver',
    truckBlock: ctx.truckBlock || 'Tractor —',
    weekRangeLabel: week.groupLabel,
    groupingModeLabel: isPay ? 'FedEx pay schedule (Sun–Sat)' : 'Work week',
    generatedAtMs: Date.now(),
    roundingBandMin: PAY_ROUND_BAND_MIN,
    roundingBandMax: PAY_ROUND_BAND_MAX,
    roundingToMi: PAY_ROUND_TO_MI,
    days,
    sumBillable,
  }
}

/**
 * @param {number} tsMs
 * @param {object} creds
 * @param {'default' | 'fedexPaySchedule'} mode
 */
export function weekMetaForTimestamp(tsMs, creds, mode = 'default') {
  return workWeekGroupMeta(tsMs, {
    workWeekStartDay: creds.workWeekStartDay ?? 0,
    workWeekEndDay: creds.workWeekEndDay ?? 6,
    shiftStartMins: creds.shiftStartMins ?? 0,
    shiftEndMins: creds.shiftEndMins ?? 1439,
    groupLabelMode: mode === 'fedexPaySchedule' ? 'fedexPaySchedule' : 'default',
  })
}

export { workWeekKeyForDate, shiftDateKeyForEventMs }
