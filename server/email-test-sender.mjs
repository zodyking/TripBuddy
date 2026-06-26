import { runWithCredentialAccountKey } from './request-context.mjs'
import { readAssignmentForAccount } from './assignment-store.mjs'
import { getCredentialsMeta, getLinehaulDriverId } from './credentials-store.mjs'
import { getSmtpPrefsForAccount } from './user-profile-pg.mjs'
import { sendEmailForAccount, sendSmtpTestEmail } from './smtp-mail.mjs'
import {
  newTripEmail,
  preplanTripEmail,
  tripStatusEmail,
  dispatchInstructionsEmail,
  driverMismatchEmail,
  dailyShiftEmail,
  weeklySummaryEmail,
} from './email-templates.mjs'
import {
  buildDailyShiftSummary,
  buildWeekTotalsPdfOpts,
  buildWeeklyTripContexts,
  weekMetaForTimestamp,
} from './email-ledger-summary.mjs'
import {
  resolveLatestLedgerWorkDayKey,
} from './email-daily-shift-logic.mjs'
import {
  buildEmailTripContextFromBody,
  buildEmailTripContextFromLedgerEntry,
  resolveActiveEmailTripContext,
} from './email-trip-details.mjs'
import { getHistoryWeekTotalsPdfBuffer } from '../src/utils/historyWeekTotalsPdf.js'

/** @typedef {(typeof EMAIL_TEST_KINDS)[number]['id']} EmailTestKind */

export const EMAIL_TEST_KINDS = [
  { id: 'smtp', label: 'SMTP connection test' },
  { id: 'new_trip', label: 'New trip assigned' },
  { id: 'preplan', label: 'New preplan assigned' },
  { id: 'status_enroute', label: 'Trip status — en route' },
  { id: 'dispatch_instructions', label: 'Dispatch instructions updated' },
  { id: 'driver_mismatch', label: 'Driver / tractor location mismatch' },
  { id: 'daily_shift', label: 'End of shift summary' },
  { id: 'weekly_summary', label: 'Weekly mileage summary' },
]

const VALID_KINDS = new Set(EMAIL_TEST_KINDS.map((k) => k.id))

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
 * @param {ReturnType<import('./user-profile-pg.mjs').getSmtpPrefsForAccount> extends Promise<infer T> ? T : never} prefs
 * @param {'trip' | 'daily' | 'weekly'} kind
 */
function ccForKind(prefs, kind) {
  if (kind === 'daily') return prefs.dailyShiftCc || undefined
  if (kind === 'weekly') return prefs.weeklySummaryCc || undefined
  return prefs.tripCc || undefined
}

/** @param {import('./email-trip-details.mjs').EmailTripContext | null} trip @param {object} creds */
function applyCredsToTrip(trip, creds) {
  if (!trip) return null
  trip.driverName = creds.driverName || trip.driverName
  if (creds.tractorNumber) trip.tractorNumber = String(creds.tractorNumber)
  return trip
}

/**
 * @param {string} accountKey
 * @param {'active' | 'preplan'} kind
 */
async function tripContextFromAssignmentOrLedger(accountKey, kind = 'active') {
  const assignment = await readAssignmentForAccount(accountKey)
  const snap =
    kind === 'preplan'
      ? assignment?.persistedPrePlanTripSnapshot
      : assignment?.persistedLinehaulTripSnapshot
  if (snap) return buildEmailTripContextFromBody(snap)

  const ledger = Array.isArray(assignment?.tripHistoryLedger) ? assignment.tripHistoryLedger : []
  const latest = [...ledger].sort((a, b) => entryTs(b) - entryTs(a))[0]
  if (latest) return buildEmailTripContextFromLedgerEntry(latest)
  return null
}

/** @param {string} accountKey */
async function ledgerForAccount(accountKey) {
  const assignment = await readAssignmentForAccount(accountKey)
  return Array.isArray(assignment?.tripHistoryLedger) ? assignment.tripHistoryLedger : []
}

/**
 * @param {{ subject: string, html: string, text?: string }} mail
 */
function markTestMail(mail) {
  const prefix = '[Test] '
  return {
    ...mail,
    subject: mail.subject.startsWith(prefix) ? mail.subject : `${prefix}${mail.subject}`,
  }
}

/**
 * Build a preview/send payload for a notification template using live account data.
 * @param {string} accountKey
 * @param {EmailTestKind} kind
 */
export async function buildTestEmailForKind(accountKey, kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`Unknown test email type: ${kind}`)
  }

  if (kind === 'smtp') {
    const prefs = await getSmtpPrefsForAccount(accountKey)
    if (!prefs.enabled) throw new Error('SMTP is not enabled')
    return { ccKind: /** @type {'trip'} */ ('trip'), mail: null, useConnectivityTest: true }
  }

  return runWithCredentialAccountKey(accountKey, async () => {
    const creds = await getCredentialsMeta()
    const assignment = await readAssignmentForAccount(accountKey)
    const ledger = await ledgerForAccount(accountKey)

    if (kind === 'new_trip') {
      const trip = applyCredsToTrip(await tripContextFromAssignmentOrLedger(accountKey, 'active'), creds)
      if (!trip) throw new Error('No active trip or history data available for a new-trip test email.')
      return { ccKind: /** @type {'trip'} */ ('trip'), mail: markTestMail(newTripEmail(trip)) }
    }

    if (kind === 'preplan') {
      const trip = applyCredsToTrip(await tripContextFromAssignmentOrLedger(accountKey, 'preplan'), creds)
      if (!trip) {
        throw new Error('No preplan snapshot or history data available for a preplan test email.')
      }
      return { ccKind: /** @type {'trip'} */ ('trip'), mail: markTestMail(preplanTripEmail(trip)) }
    }

    if (kind === 'status_enroute') {
      const trip = applyCredsToTrip(await resolveActiveEmailTripContext(accountKey), creds)
      if (!trip) {
        const fallback = applyCredsToTrip(
          await tripContextFromAssignmentOrLedger(accountKey, 'active'),
          creds,
        )
        if (!fallback) throw new Error('No trip data available for a status test email.')
        return {
          ccKind: /** @type {'trip'} */ ('trip'),
          mail: markTestMail(
            tripStatusEmail({
              statusLabel: 'En route',
              fromPhase: 'assigned',
              toPhase: 'dispatched',
              trip: fallback,
            }),
          ),
        }
      }
      return {
        ccKind: /** @type {'trip'} */ ('trip'),
        mail: markTestMail(
          tripStatusEmail({
            statusLabel: 'En route',
            fromPhase: 'assigned',
            toPhase: 'dispatched',
            trip,
          }),
        ),
      }
    }

    if (kind === 'dispatch_instructions') {
      const trip = applyCredsToTrip(await resolveActiveEmailTripContext(accountKey), creds)
      const hint = String(assignment?.instructions ?? trip?.dispatchInstructions ?? '').trim()
      if (!trip && !hint) {
        throw new Error('No dispatch instructions or trip data available for this test email.')
      }
      return {
        ccKind: /** @type {'trip'} */ ('trip'),
        mail: markTestMail(
          dispatchInstructionsEmail({
            hint: hint || 'Sample dispatch instructions from TripBuddy test send.',
            trip,
          }),
        ),
      }
    }

    if (kind === 'driver_mismatch') {
      const trip = applyCredsToTrip(await resolveActiveEmailTripContext(accountKey), creds)
      return {
        ccKind: /** @type {'trip'} */ ('trip'),
        mail: markTestMail(
          driverMismatchEmail({
            tractorLocation: '40.7128, -74.0060',
            driverLocation: '40.7580, -73.9855',
            trip,
          }),
        ),
      }
    }

    if (kind === 'daily_shift') {
      const prefs = await getSmtpPrefsForAccount(accountKey)
      const shiftStart = creds.shiftStartMins ?? 0
      const shiftEnd = creds.shiftEndMins ?? 1439
      const tz = prefs.timezone || 'America/New_York'
      const shift = { shiftStartMins: shiftStart, shiftEndMins: shiftEnd }
      const shiftDayKey = resolveLatestLedgerWorkDayKey(ledger, shift, tz)
      if (!shiftDayKey) {
        throw new Error('No completed trips found for the latest shift day.')
      }
      const summary = buildDailyShiftSummary(ledger, shiftDayKey, {
        shiftStartMins: shiftStart,
        shiftEndMins: shiftEnd,
        timeZone: tz,
      })
      if (!summary.tripCount) {
        throw new Error('No completed trips found for the latest shift day.')
      }
      return {
        ccKind: /** @type {'daily'} */ ('daily'),
        mail: markTestMail(dailyShiftEmail(summary)),
      }
    }

    if (kind === 'weekly_summary') {
      const latest = [...ledger].sort((a, b) => entryTs(b) - entryTs(a))[0]
      const refMs = latest ? entryTs(latest) : Date.now()
      const workWeek = weekMetaForTimestamp(refMs, creds, 'default')
      const payWeek = weekMetaForTimestamp(refMs, creds, 'fedexPaySchedule')
      if (!workWeek?.key || !payWeek?.key) throw new Error('Could not resolve work week for test email.')

      const driverBlock = creds.driverName ? String(creds.driverName) : 'Driver'
      const truckBlock = creds.tractorNumber ? `#${creds.tractorNumber}` : 'Tractor —'
      const ctx = {
        workWeekStartDay: creds.workWeekStartDay ?? 0,
        workWeekEndDay: creds.workWeekEndDay ?? 6,
        workWeekScheduleHistory: creds.workWeekScheduleHistory,
        shiftStartMins: creds.shiftStartMins ?? 0,
        shiftEndMins: creds.shiftEndMins ?? 1439,
        driverBlock,
        truckBlock,
        tractorNumber: creds.tractorNumber || '',
      }
      const weekTrips = buildWeeklyTripContexts(ledger, workWeek, {
        ...ctx,
        groupLabelMode: 'default',
      })
      const workOpts = buildWeekTotalsPdfOpts(ledger, workWeek, {
        ...ctx,
        groupLabelMode: 'default',
      })
      const payOpts = buildWeekTotalsPdfOpts(ledger, payWeek, {
        ...ctx,
        groupLabelMode: 'fedexPaySchedule',
      })
      const [workPdf, payPdf] = await Promise.all([
        getHistoryWeekTotalsPdfBuffer(workOpts),
        getHistoryWeekTotalsPdfBuffer(payOpts),
      ])
      const driverId = await getLinehaulDriverId()
      const mail = markTestMail(
        weeklySummaryEmail({
          weekLabel: workWeek.groupLabel,
          workWeekLabel: workWeek.groupLabel,
          payWeekLabel: payWeek.groupLabel,
          driverName: creds.driverName || driverBlock,
          driverId: driverId || '—',
          tractorsUsed: weekTrips.tractorsUsed,
          tripCount: weekTrips.tripCount,
          totalMiles: weekTrips.totalMiles,
          trips: weekTrips.trips,
        }),
      )
      return {
        ccKind: /** @type {'weekly'} */ ('weekly'),
        mail,
        attachments: [
          {
            filename: 'work-week-mileage.pdf',
            content: workPdf.buffer,
            contentType: 'application/pdf',
          },
          {
            filename: 'pay-schedule-mileage.pdf',
            content: payPdf.buffer,
            contentType: 'application/pdf',
          },
        ],
      }
    }

    throw new Error(`Unsupported test email type: ${kind}`)
  })
}

/**
 * @param {string} accountKey
 * @param {EmailTestKind} kind
 */
export async function sendTestEmailForKind(accountKey, kind) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  if (!prefs.enabled) throw new Error('SMTP is not enabled')

  const built = await buildTestEmailForKind(accountKey, kind)
  if (built.useConnectivityTest) {
    return sendSmtpTestEmail(accountKey)
  }
  if (!built.mail) throw new Error('Failed to build test email.')

  return sendEmailForAccount(accountKey, {
    ...built.mail,
    cc: ccForKind(prefs, built.ccKind),
    attachments: built.attachments,
  })
}
