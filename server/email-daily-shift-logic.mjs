import {
  shiftDateKeyForEventMsInTimezone,
  zonedMinutesFromMidnight,
} from '../src/utils/shiftCalendar.js'

export const DAILY_TRIP_IDLE_MINS = 120

/**
 * Match History ledger `displayDate` bucketing.
 * @param {unknown} entry
 */
export function computeLedgerDisplayDate(entry) {
  if (!entry || typeof entry !== 'object') return 0
  const o = /** @type {Record<string, unknown>} */ (entry)
  const auditMs = o.historyAuditBucketMs
  if (typeof auditMs === 'number' && Number.isFinite(auditMs) && auditMs > 0) return auditMs
  const sourceStr = typeof o.source === 'string' ? o.source : 'complete'
  const comp =
    typeof o.completedAt === 'number' && Number.isFinite(o.completedAt) ? o.completedAt : 0
  const rec =
    typeof o.recordedAt === 'number' && Number.isFinite(o.recordedAt) ? o.recordedAt : 0
  if (sourceStr === 'linehaul' && rec > 0) return rec
  if (comp > 0) return comp
  if (rec > 0) return rec
  if (typeof o.displayDate === 'number' && Number.isFinite(o.displayDate)) return o.displayDate
  return 0
}

/**
 * Work-week shift day key (not FedEx pay Sun–Sat calendar day).
 * @param {unknown} entry
 * @param {{ shiftStartMins: number, shiftEndMins: number }} shift
 * @param {string} timeZone
 */
export function workShiftDayKeyForEntry(entry, shift, timeZone) {
  const ts = computeLedgerDisplayDate(entry)
  if (!ts) return ''
  return shiftDateKeyForEventMsInTimezone(
    ts,
    timeZone,
    shift.shiftStartMins,
    shift.shiftEndMins,
  )
}

/**
 * @param {unknown[]} ledger
 * @param {string} shiftDayKey
 * @param {{ shiftStartMins: number, shiftEndMins: number }} shift
 * @param {string} timeZone
 */
export function ledgerEntriesForWorkDay(ledger, shiftDayKey, shift, timeZone) {
  if (!Array.isArray(ledger) || !shiftDayKey) return []
  return ledger.filter(
    (e) => workShiftDayKeyForEntry(e, shift, timeZone) === shiftDayKey,
  )
}

/** @param {unknown} entry */
function entryOutcomeNormalized(entry) {
  if (!entry || typeof entry !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (entry)
  const raw =
    typeof o.outcome === 'string'
      ? o.outcome
      : o.dispatchHeader && typeof o.dispatchHeader === 'object'
        ? /** @type {Record<string, unknown>} */ (o.dispatchHeader).historyOutcome
        : ''
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

/** @param {unknown[]} ledger @param {string} seq */
function legHasTerminalOutcomeInLedger(ledger, seq) {
  for (const e of ledger) {
    if (!e || typeof e !== 'object') continue
    const leg = String(/** @type {Record<string, unknown>} */ (e).dailyTripLegSequence ?? '').trim()
    if (leg !== seq) continue
    const out = entryOutcomeNormalized(e)
    if (out === 'delivered' || out === 'removed' || out === 'rejected') return true
  }
  return false
}

/** @param {unknown} snap */
function legSeqFromSnapshot(snap) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return ''
  const s = String(/** @type {Record<string, unknown>} */ (snap).dailyTripLegSequence ?? '').trim()
  return /^\d+$/.test(s) ? s : ''
}

/**
 * True when Home still has an active trip that is not user-completed / terminal in history.
 * Covers manual “mark complete” from trip details (hidden leg sequences).
 * @param {object | null | undefined} assignment
 */
export function assignmentHasIncompleteActiveTrips(assignment) {
  if (!assignment || typeof assignment !== 'object') return false
  const a = /** @type {Record<string, unknown>} */ (assignment)
  const hidden = new Set(
    (Array.isArray(a.hiddenDailyTripLegSequences) ? a.hiddenDailyTripLegSequences : [])
      .map((s) => String(s).trim())
      .filter(Boolean),
  )
  const ledger = Array.isArray(a.tripHistoryLedger) ? a.tripHistoryLedger : []

  /** @param {string} seq */
  const incomplete = (seq) => {
    if (!seq) return false
    if (hidden.has(seq)) return false
    if (legHasTerminalOutcomeInLedger(ledger, seq)) return false
    return true
  }

  const activeSeq = legSeqFromSnapshot(a.persistedLinehaulTripSnapshot)
  if (incomplete(activeSeq)) return true

  const preplanSeq = legSeqFromSnapshot(a.persistedPrePlanTripSnapshot)
  if (incomplete(preplanSeq)) return true

  const cachedSeq = legSeqFromSnapshot(a.persistedCachedTripSnapshot)
  if (incomplete(cachedSeq)) return true

  return false
}

/**
 * Shift day to summarize when the current shift has ended — only the ended day, once per key.
 * @param {unknown[]} ledger
 * @param {{
 *   endedShiftDayKey: string,
 *   lastDailyShiftKey?: string,
 *   shiftStartMins: number,
 *   shiftEndMins: number,
 *   timeZone: string,
 * }} opts
 */
export function resolveDailyShiftSummaryDayKey(ledger, opts) {
  const endedKey = String(opts.endedShiftDayKey ?? '').trim()
  if (!endedKey) return ''
  const lastSent = String(opts.lastDailyShiftKey ?? '').trim()
  if (endedKey === lastSent) return ''

  const shift = {
    shiftStartMins: opts.shiftStartMins ?? 0,
    shiftEndMins: opts.shiftEndMins ?? 1439,
  }
  const timeZone = opts.timeZone || 'America/New_York'
  const entries = ledgerEntriesForWorkDay(ledger, endedKey, shift, timeZone)
  return entries.length > 0 ? endedKey : ''
}

/**
 * @param {number} nowMs
 * @param {string} timeZone
 * @param {number} shiftEndMins
 */
export function isAfterShiftEndWithDelay(nowMs, timeZone, shiftEndMins, dailyDelayMins = 30) {
  const mins = zonedMinutesFromMidnight(new Date(nowMs), timeZone)
  const triggerMins = (shiftEndMins + dailyDelayMins) % 1440
  return mins >= triggerMins
}
