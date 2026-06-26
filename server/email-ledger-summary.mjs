import { shiftDateKeyForEventMs } from '../src/utils/shiftCalendar.js'
import { workWeekGroupMeta, workWeekGroupMetaForCreds, workWeekKeyForDate } from '../src/utils/workWeekGroup.js'
import { buildEmailTripContextFromLedgerEntry, dailyTripTableRow, weeklyTripTableRow } from './email-trip-details.mjs'
import { ledgerEntriesForWorkDay, computeLedgerDisplayDate } from './email-daily-shift-logic.mjs'
import { formatTripEquipmentPdfBlock } from '../src/utils/tripDetailsDisplay.js'
import {
  billableMilesWithFederalHoliday,
  FEDERAL_HOLIDAY_PDF_NOTE,
} from '../src/utils/federalHolidayMileage.js'

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
  const paid = tripPaidMiles(e)
  const base = billableMiles(paid)
  const approved =
    e && typeof e === 'object'
      ? /** @type {Record<string, unknown>} */ (e).federalHolidayMileage15xApproved === true
      : false
  return billableMilesWithFederalHoliday(base, approved)
}

/** @param {unknown} v */
function leadingLocationId(v) {
  const s = String(v ?? '').trim()
  const m = s.match(/^\s*(\d+)/)
  return m ? m[1] : ''
}

/** @param {unknown} e */
function ledgerAssignedAtMs(e) {
  if (!e || typeof e !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (e)
  const ra =
    typeof o.recordedAt === 'number' && Number.isFinite(o.recordedAt) && o.recordedAt > 0
      ? o.recordedAt
      : null
  if (ra != null) return ra
  const le =
    typeof o.ledgerEventMs === 'number' && Number.isFinite(o.ledgerEventMs) && o.ledgerEventMs > 0
      ? o.ledgerEventMs
      : null
  return le
}

/** @param {unknown} e */
function ledgerDispatchedAtMsForPay(e) {
  if (!e || typeof e !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (e)
  const d = o.dispatchedAtMs
  if (!(typeof d === 'number' && Number.isFinite(d) && d > 0)) return null
  const rec =
    typeof o.recordedAt === 'number' && Number.isFinite(o.recordedAt) && o.recordedAt > 0
      ? o.recordedAt
      : null
  if (rec != null && d <= rec) return null
  return d
}

/** @param {unknown} e */
function ledgerArrivedAtMs(e) {
  if (!e || typeof e !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (e)
  const td =
    o.tripDetails && typeof o.tripDetails === 'object'
      ? /** @type {Record<string, unknown>} */ (o.tripDetails)
      : {}
  const appMs = td.appCapturedTripArrivalAtMs
  if (typeof appMs === 'number' && Number.isFinite(appMs) && appMs > 0) return appMs
  const touched =
    typeof o.outcomeTouchedAt === 'number' &&
    Number.isFinite(o.outcomeTouchedAt) &&
    o.outcomeTouchedAt > 0
  if (!touched) return null
  const dh = o.dispatchHeader
  if (!dh || typeof dh !== 'object') return null
  const hdr = /** @type {Record<string, unknown>} */ (dh)
  const out = String(hdr.historyOutcome ?? '')
    .trim()
    .toLowerCase()
  if (out !== 'delivered') return null
  const at = hdr.historyOutcomeAt
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null
}

/** @param {number | null | undefined} ms */
function formatPayClockOrNa(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'n/a'
  const d = new Date(ms)
  if (isNaN(d.getTime())) return 'n/a'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** @param {unknown} e */
function tripPdfDispatchColumns(e) {
  const ts = entryTs(e)
  const seq =
    e && typeof e === 'object'
      ? String(/** @type {Record<string, unknown>} */ (e).dailyTripLegSequence ?? '').trim()
      : ''
  const legLabel = /^\d+$/.test(seq) ? seq : '-'
  if (!ts) {
    return { weekday: '-', dispatchDate: '-', dispatchTime: '-', legLabel }
  }
  const d = new Date(ts)
  if (isNaN(d.getTime())) {
    return { weekday: '-', dispatchDate: '-', dispatchTime: '-', legLabel }
  }
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    dispatchDate: d.toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    }),
    dispatchTime: d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }),
    legLabel,
  }
}

/** @param {unknown} e */
function tripPdfTractor(e) {
  if (!e || typeof e !== 'object') return '-'
  const td =
    /** @type {Record<string, unknown>} */ (e).tripDetails &&
    typeof /** @type {Record<string, unknown>} */ (e).tripDetails === 'object'
      ? /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (e).tripDetails)
      : {}
  const t = td.tractorNumber
  const s = t != null ? String(t).trim() : ''
  return s || '-'
}

/** @param {unknown} e */
function outcomePdfReasonLine(e) {
  if (!e || typeof e !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (e)
  const raw =
    (typeof o.outcome === 'string' ? o.outcome.trim().toLowerCase() : '') ||
    (o.dispatchHeader &&
    typeof o.dispatchHeader === 'object' &&
    typeof /** @type {Record<string, unknown>} */ (o.dispatchHeader).historyOutcome === 'string'
      ? String(/** @type {Record<string, unknown>} */ (o.dispatchHeader).historyOutcome)
          .trim()
          .toLowerCase()
      : '')
  if (raw !== 'rejected' && raw !== 'removed') return ''
  const dh = o.dispatchHeader
  if (!dh || typeof dh !== 'object') return ''
  return String(/** @type {Record<string, unknown>} */ (dh).historyOutcomeReason ?? '').trim()
}

/** @param {unknown} e */
function federalHolidayPdfNoteForEntry(e) {
  if (!e || typeof e !== 'object') return ''
  return /** @type {Record<string, unknown>} */ (e).federalHolidayMileage15xApproved === true
    ? FEDERAL_HOLIDAY_PDF_NOTE
    : ''
}

/** @param {unknown} e @param {number} mi */
function buildPdfRowFromLedgerEntry(e, mi) {
  const dispatchCols = tripPdfDispatchColumns(e)
  const originId = leadingLocationId(
    e && typeof e === 'object' ? /** @type {Record<string, unknown>} */ (e).dispatchHeader?.origin : '',
  ) || '-'
  const destId = leadingLocationId(
    e && typeof e === 'object'
      ? /** @type {Record<string, unknown>} */ (e).dispatchHeader?.destination
      : '',
  ) || '-'
  const td =
    e && typeof e === 'object' && e.tripDetails && typeof e.tripDetails === 'object'
      ? e.tripDetails
      : {}
  const paid = tripPaidMiles(e)
  const base = paid ?? 0
  return {
    od: `${originId} → ${destId}`,
    when: formatWhen(entryTs(e)),
    billableMi: mi,
    rounded: base >= PAY_ROUND_BAND_MIN && base <= PAY_ROUND_BAND_MAX,
    originId,
    destId,
    routeOd: `${originId} → ${destId}`,
    weekday: dispatchCols.weekday,
    dispatchDate: dispatchCols.dispatchDate,
    dispatchTime: dispatchCols.dispatchTime,
    assignedTime: formatPayClockOrNa(ledgerAssignedAtMs(e)),
    dispatchedTime: formatPayClockOrNa(ledgerDispatchedAtMsForPay(e)),
    arrivedTime: formatPayClockOrNa(ledgerArrivedAtMs(e)),
    legLabel: dispatchCols.legLabel,
    tractorNumber: tripPdfTractor(e),
    equipmentBlock: formatTripEquipmentPdfBlock(td),
    outcomeReasonRight: outcomePdfReasonLine(e),
    pdfNotesRight: federalHolidayPdfNoteForEntry(e),
    dailyTripLegSequence:
      e && typeof e === 'object'
        ? String(/** @type {Record<string, unknown>} */ (e).dailyTripLegSequence ?? '')
        : '',
  }
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
 * @param {{ shiftStartMins: number, shiftEndMins: number, timeZone?: string }} shift
 */
export function buildDailyShiftSummary(ledger, shiftDayKey, shift) {
  const timeZone = shift.timeZone || 'America/New_York'
  const items = ledgerEntriesForWorkDay(ledger, shiftDayKey, shift, timeZone).sort(
    (a, b) => computeLedgerDisplayDate(b) - computeLedgerDisplayDate(a),
  )
  let totalMiles = 0
  const trips = items.map((e) => {
    const mi = entryMiles(e)
    totalMiles += mi
    const ctx = buildEmailTripContextFromLedgerEntry(e)
    const ts = computeLedgerDisplayDate(e) || entryTs(e)
    ctx.completedAt = formatWhen(ts)
    if (mi) ctx.miles = `${mi} mi`
    return ctx
  })
  const tableRows = trips.map((t) => dailyTripTableRow(t))
  const d = shiftDayKey ? new Date(`${shiftDayKey}T12:00:00`) : new Date()
  const shiftLabel = d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  return { shiftLabel, tripCount: items.length, totalMiles, trips, tableRows }
}

/**
 * @param {unknown[]} ledger
 * @param {{ key: string }} week
 * @param {object} opts
 */
export function buildWeeklyTripContexts(ledger, week, opts) {
  const items = ledgerEntriesForWeek(ledger, week, opts).sort(
    (a, b) => entryTs(a) - entryTs(b),
  )
  let totalMiles = 0
  /** @type {Set<string>} */
  const tractorsUsed = new Set()
  if (opts?.tractorNumber) {
    const t = String(opts.tractorNumber).trim()
    if (t) tractorsUsed.add(t)
  }
  const trips = items.map((e) => {
    const mi = entryMiles(e)
    totalMiles += mi
    const ctx = buildEmailTripContextFromLedgerEntry(e)
    ctx.completedAt = formatWhen(entryTs(e))
    if (mi) ctx.miles = `${mi} mi`
    if (ctx.tractorNumber) tractorsUsed.add(ctx.tractorNumber)
    return ctx
  })
  const tableRows = trips.map((t) => weeklyTripTableRow(t))
  return {
    tripCount: items.length,
    totalMiles,
    trips,
    tableRows,
    tractorsUsed: [...tractorsUsed].sort(),
  }
}

/**
 * @param {unknown[]} ledger
 * @param {{ key: string, weekStartMs: number, weekEndMs: number, groupLabel: string }} week
 * @param {{ groupLabelMode?: 'default' | 'fedexPaySchedule', shiftStartMins: number, shiftEndMins: number }} opts
 */
export function ledgerEntriesForWeek(ledger, week, opts) {
  if (!Array.isArray(ledger) || !week?.key) return []
  const creds = {
    workWeekStartDay: opts.workWeekStartDay ?? 0,
    workWeekEndDay: opts.workWeekEndDay ?? 6,
    workWeekScheduleHistory: opts.workWeekScheduleHistory,
    shiftStartMins: opts.shiftStartMins ?? 0,
    shiftEndMins: opts.shiftEndMins ?? 1439,
  }
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
    const meta = workWeekGroupMetaForCreds(ts, creds)
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
    const rows = list.map((e) => buildPdfRowFromLedgerEntry(e, entryMiles(e)))
    let daySum = 0
    for (const row of rows) {
      daySum += row.billableMi
    }
    sumBillable += daySum
    days.push({
      dayLabel: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      sumBillable: daySum,
      rows,
    })
  }
  const isPay = ctx.groupLabelMode === 'fedexPaySchedule'
  return {
    documentTitle: isPay ? 'FedEx Pay Week Mileage' : 'Weekly Mileage',
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
  return workWeekGroupMetaForCreds(tsMs, creds, {
    groupLabelMode: mode === 'fedexPaySchedule' ? 'fedexPaySchedule' : 'default',
  })
}

export { workWeekKeyForDate, shiftDateKeyForEventMs }
