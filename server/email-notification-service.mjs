import { runWithCredentialAccountKey } from './request-context.mjs'
import { readAssignmentForAccount } from './assignment-store.mjs'
import { getCredentialsMeta, getLinehaulDriverId } from './credentials-store.mjs'
import {
  getSmtpPrefsForAccount,
  patchSmtpSendStateForAccount,
} from './user-profile-pg.mjs'
import { sendEmailForAccount } from './smtp-mail.mjs'
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
  computeDailyShiftEmailDecision,
  computeWeeklyEmailDecision,
} from '../src/utils/shiftCalendar.js'
import {
  resolveEmailTripContextForNotification,
  resolveActiveEmailTripContext,
} from './email-trip-details.mjs'
import {
  assignmentHasIncompleteActiveTrips,
  resolveDailyShiftSummaryDayKey,
  DAILY_TRIP_IDLE_MINS,
} from './email-daily-shift-logic.mjs'
import { buildWeekMileagePdfBuffer } from './email-week-pdf.mjs'

/**
 * @param {ReturnType<import('./user-profile-pg.mjs').getSmtpPrefsForAccount> extends Promise<infer T> ? T : never} prefs
 * @param {'trip' | 'daily' | 'weekly'} kind
 */
function ccForKind(prefs, kind) {
  if (kind === 'daily') return prefs.dailyShiftCc || undefined
  if (kind === 'weekly') return prefs.weeklySummaryCc || undefined
  return prefs.tripCc || undefined
}

/**
 * @param {string} accountKey
 * @param {{ type?: string, message: string, extra?: object }} payload
 */
export async function maybeSendEmailForInAppNotification(accountKey, payload) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  if (!prefs.enabled) return { skipped: 'disabled' }

  const extra = payload.extra && typeof payload.extra === 'object' ? payload.extra : {}
  const event = String(extra.event ?? '')

  if (event === 'dispatch_instructions') {
    if (!prefs.onDispatchInstructions) return { skipped: 'disabled' }
    const hint = String(extra.hint ?? '').trim()
    const fp = `dispatch:${hint.slice(0, 200)}`
    if (fp && fp === prefs.lastDispatchNotifyFp) return { skipped: 'deduped' }
    return runWithCredentialAccountKey(accountKey, async () => {
      const creds = await getCredentialsMeta()
      const trip = await resolveActiveEmailTripContext(accountKey)
      if (trip) {
        trip.driverName = creds.driverName || trip.driverName
        if (creds.tractorNumber) trip.tractorNumber = String(creds.tractorNumber)
      }
      const mail = dispatchInstructionsEmail({ hint, trip })
      await sendEmailForAccount(accountKey, { ...mail, cc: ccForKind(prefs, 'trip') })
      await patchSmtpSendStateForAccount(accountKey, { lastDispatchNotifyFp: fp })
      return { ok: true }
    })
  }

  if (event === 'trip_assigned') {
    if (!prefs.onNewTrip) return { skipped: 'disabled' }
    return sendTripRouteEmail(accountKey, prefs, extra, newTripEmail, 'trip_assigned')
  }

  if (event === 'preplan_assigned') {
    if (!prefs.onPreplan) return { skipped: 'disabled' }
    return sendTripRouteEmail(accountKey, prefs, extra, preplanTripEmail, 'preplan_assigned')
  }

  if (event === 'status_assigned' || event === 'status_enroute' || event === 'status_complete') {
    if (!prefs.onStatusChange) return { skipped: 'disabled' }
    const fromPhase = String(extra.fromPhase ?? '')
    const toPhase = String(extra.toPhase ?? '')
    const fp = `${event}:${fromPhase}:${toPhase}`
    if (fp && fp === prefs.lastStatusNotifyFp) return { skipped: 'deduped' }
    const statusLabel =
      event === 'status_assigned'
        ? 'Assigned'
        : event === 'status_enroute'
          ? 'En route'
          : 'Complete'
    return runWithCredentialAccountKey(accountKey, async () => {
      const creds = await getCredentialsMeta()
      const trip = await resolveEmailTripContextForNotification(accountKey, extra, event)
      trip.driverName = creds.driverName || trip.driverName
      if (creds.tractorNumber) trip.tractorNumber = String(creds.tractorNumber)
      const mail = tripStatusEmail({ statusLabel, fromPhase, toPhase, trip })
      await sendEmailForAccount(accountKey, { ...mail, cc: ccForKind(prefs, 'trip') })
      const patch = { lastStatusNotifyFp: fp }
      if (event === 'status_complete') {
        patch.lastTripNotifyFp = ''
      }
      await patchSmtpSendStateForAccount(accountKey, patch)
      return { ok: true }
    })
  }

  if (event === 'driver_tractor_mismatch') {
    if (!prefs.onDriverMismatch) return { skipped: 'disabled' }
    const cooldownMs = 30 * 60 * 1000
    if (prefs.lastDriverMismatchMs && Date.now() - prefs.lastDriverMismatchMs < cooldownMs) {
      return { skipped: 'deduped' }
    }
    const tractorLocation = formatLocation(extra.tractorLocation)
    const driverLocation = formatLocation(extra.driverLocation)
    return runWithCredentialAccountKey(accountKey, async () => {
      const creds = await getCredentialsMeta()
      const trip = await resolveActiveEmailTripContext(accountKey)
      if (trip) {
        trip.driverName = creds.driverName || trip.driverName
        if (creds.tractorNumber) trip.tractorNumber = String(creds.tractorNumber)
      }
      const mail = driverMismatchEmail({ tractorLocation, driverLocation, trip })
      await sendEmailForAccount(accountKey, { ...mail, cc: ccForKind(prefs, 'trip') })
      await patchSmtpSendStateForAccount(accountKey, { lastDriverMismatchMs: Date.now() })
      return { ok: true }
    })
  }

  return { skipped: 'not_email_event' }
}

/**
 * @param {string} accountKey
 * @param {object} prefs
 * @param {object} extra
 * @param {(trip: object) => object} buildMail
 * @param {string} eventKey
 */
async function sendTripRouteEmail(accountKey, prefs, extra, buildMail, eventKey) {
  const leg = String(extra.leg ?? '').trim()
  const origin = String(extra.origin ?? '').trim()
  const destination = String(extra.destination ?? '').trim()
  const fp = `${eventKey}:${leg}:${origin}:${destination}`
  if (fp && fp === prefs.lastTripNotifyFp) return { skipped: 'deduped' }

  return runWithCredentialAccountKey(accountKey, async () => {
    const creds = await getCredentialsMeta()
    const trip = await resolveEmailTripContextForNotification(accountKey, extra, eventKey)
    trip.driverName = creds.driverName || trip.driverName
    if (creds.tractorNumber) trip.tractorNumber = String(creds.tractorNumber)
    const mail = buildMail(trip)
    await sendEmailForAccount(accountKey, { ...mail, cc: ccForKind(prefs, 'trip') })
    await patchSmtpSendStateForAccount(accountKey, { lastTripNotifyFp: fp })
    return { ok: true }
  })
}

/** @param {unknown} loc */
function formatLocation(loc) {
  if (!loc || typeof loc !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (loc)
  const lat = o.lat ?? o.latitude
  const lng = o.lng ?? o.longitude
  if (typeof lat === 'number' && typeof lng === 'number') {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  }
  return String(loc).slice(0, 80)
}

/**
 * @param {string} accountKey
 * @param {string} shiftDayKey
 */
export async function sendDailyShiftSummaryEmail(accountKey, shiftDayKey) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  if (!prefs.enabled || !prefs.onDailyShiftSummary) return { skipped: 'disabled' }
  if (prefs.lastDailyShiftKey === shiftDayKey) return { skipped: 'already_sent' }

  return runWithCredentialAccountKey(accountKey, async () => {
    const creds = await getCredentialsMeta()
    const tz = prefs.timezone || 'America/New_York'
    const assignment = await readAssignmentForAccount(accountKey)
    const ledger = Array.isArray(assignment?.tripHistoryLedger) ? assignment.tripHistoryLedger : []
    const summary = buildDailyShiftSummary(ledger, shiftDayKey, {
      shiftStartMins: creds.shiftStartMins ?? 0,
      shiftEndMins: creds.shiftEndMins ?? 1439,
      timeZone: tz,
    })
    if (!summary.tripCount) return { skipped: 'no_trips' }
    const mail = dailyShiftEmail(summary)
    await sendEmailForAccount(accountKey, { ...mail, cc: ccForKind(prefs, 'daily') })
    await patchSmtpSendStateForAccount(accountKey, { lastDailyShiftKey: shiftDayKey })
    return { ok: true, tripCount: summary.tripCount }
  })
}

/**
 * @param {string} accountKey
 * @param {number} referenceMs — timestamp in completed week
 */
export async function sendWeeklySummaryEmail(accountKey, referenceMs) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  if (!prefs.enabled || !prefs.onWeeklySummary) return { skipped: 'disabled' }

  return runWithCredentialAccountKey(accountKey, async () => {
    const creds = await getCredentialsMeta()
    const assignment = await readAssignmentForAccount(accountKey)
    const ledger = Array.isArray(assignment?.tripHistoryLedger) ? assignment.tripHistoryLedger : []

    const workWeek = weekMetaForTimestamp(referenceMs, creds, 'default')
    const payWeek = weekMetaForTimestamp(referenceMs, creds, 'fedexPaySchedule')
    if (!workWeek?.key || !payWeek?.key) return { skipped: 'no_week' }

    if (prefs.lastWeeklyWorkKey === workWeek.key && prefs.lastWeeklyPayKey === payWeek.key) {
      return { skipped: 'already_sent' }
    }

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

    const workOpts = buildWeekTotalsPdfOpts(ledger, workWeek, {
      ...ctx,
      groupLabelMode: 'default',
    })
    const payOpts = buildWeekTotalsPdfOpts(ledger, payWeek, {
      ...ctx,
      groupLabelMode: 'fedexPaySchedule',
    })
    const weekTrips = buildWeeklyTripContexts(ledger, workWeek, {
      ...ctx,
      groupLabelMode: 'default',
    })

    const [workPdf, payPdf] = await Promise.all([
      Promise.resolve(buildWeekMileagePdfBuffer(workOpts)),
      Promise.resolve(buildWeekMileagePdfBuffer(payOpts)),
    ])

    const driverId = await getLinehaulDriverId()
    const mail = weeklySummaryEmail({
      weekLabel: workWeek.groupLabel,
      workWeekLabel: workWeek.groupLabel,
      payWeekLabel: payWeek.groupLabel,
      driverName: creds.driverName || driverBlock,
      driverId: driverId || '—',
      tractorsUsed: weekTrips.tractorsUsed,
      tripCount: weekTrips.tripCount,
      totalMiles: weekTrips.totalMiles,
      tableRows: weekTrips.tableRows,
    })

    await sendEmailForAccount(accountKey, {
      ...mail,
      cc: ccForKind(prefs, 'weekly'),
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
    })

    await patchSmtpSendStateForAccount(accountKey, {
      lastWeeklyWorkKey: workWeek.key,
      lastWeeklyPayKey: payWeek.key,
    })
    return { ok: true }
  })
}

/**
 * @param {string} accountKey
 * @param {Date} now
 */
export async function maybeSendScheduledEmailsForAccount(accountKey, now = new Date()) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  if (!prefs.enabled) return

  const tz = prefs.timezone || 'America/New_York'
  const nowMs = now.getTime()

  return runWithCredentialAccountKey(accountKey, async () => {
    const creds = await getCredentialsMeta()
    const shiftEnd = creds.shiftEndMins ?? 1439
    const shiftStart = creds.shiftStartMins ?? 0
    const dailyDelay = prefs.dailyDelayMins ?? 30

    if (prefs.onDailyShiftSummary) {
      const assignment = await readAssignmentForAccount(accountKey)
      const ledger = Array.isArray(assignment?.tripHistoryLedger)
        ? assignment.tripHistoryLedger
        : []
      const incomplete = assignmentHasIncompleteActiveTrips(assignment)
      const daily = computeDailyShiftEmailDecision({
        nowMs,
        timeZone: tz,
        shiftStartMins: shiftStart,
        shiftEndMins: shiftEnd,
        dailyDelayMins: dailyDelay,
        lastTripActivityMs: prefs.lastTripActivityMs ?? 0,
        idleMins: DAILY_TRIP_IDLE_MINS,
        hasIncompleteTrips: incomplete,
      })
      if (daily.shouldSend && daily.shiftDayKey) {
        if (prefs.lastDailyShiftKey === daily.shiftDayKey) {
          // Already sent for this ended shift window — skip until the shift day key advances.
        } else {
          const targetDay = resolveDailyShiftSummaryDayKey(ledger, {
            endedShiftDayKey: daily.shiftDayKey,
            lastDailyShiftKey: prefs.lastDailyShiftKey || '',
            shiftStartMins: shiftStart,
            shiftEndMins: shiftEnd,
            timeZone: tz,
          })
          if (targetDay) {
            try {
              await sendDailyShiftSummaryEmail(accountKey, targetDay)
            } catch (e) {
              console.error('[email] daily shift failed', accountKey, e)
            }
          }
        }
      }
    }

    if (prefs.onWeeklySummary) {
      const weekly = computeWeeklyEmailDecision({
        nowMs,
        timeZone: tz,
        workWeekEndDay: creds.workWeekEndDay ?? 6,
        shiftStartMins: shiftStart,
        shiftEndMins: shiftEnd,
        lastTripActivityMs: prefs.lastTripActivityMs ?? 0,
      })
      if (weekly.shouldSend) {
        try {
          await sendWeeklySummaryEmail(accountKey, weekly.referenceMs)
        } catch (e) {
          console.error('[email] weekly summary failed', accountKey, e)
        }
      }
    }
  })
}
