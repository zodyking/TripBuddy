import { runWithCredentialAccountKey } from './request-context.mjs'
import { readAssignmentForAccount } from './assignment-store.mjs'
import { getCredentialsMeta } from './credentials-store.mjs'
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
  weekMetaForTimestamp,
  shiftDateKeyForEventMs,
} from './email-ledger-summary.mjs'
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
  const type = String(payload.type ?? '')

  if (type === 'assignment' || event === 'dispatch_instructions') {
    if (!prefs.onDispatchInstructions) return { skipped: 'disabled' }
    const hint = String(extra.hint ?? '').trim()
    const fp = `dispatch:${hint.slice(0, 200)}`
    if (fp && fp === prefs.lastDispatchNotifyFp) return { skipped: 'deduped' }
    return runWithCredentialAccountKey(accountKey, async () => {
      const mail = dispatchInstructionsEmail({ hint })
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
      const mail = tripStatusEmail({ statusLabel, fromPhase, toPhase })
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
    const tractorLocation = formatLocation(extra.tractorLocation)
    const driverLocation = formatLocation(extra.driverLocation)
    return runWithCredentialAccountKey(accountKey, async () => {
      const mail = driverMismatchEmail({ tractorLocation, driverLocation })
      await sendEmailForAccount(accountKey, { ...mail, cc: ccForKind(prefs, 'trip') })
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
    const mail = buildMail({
      leg,
      origin: origin || '—',
      destination: destination || '—',
      driverName: creds.driverName || undefined,
    })
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
    const assignment = await readAssignmentForAccount(accountKey)
    const ledger = Array.isArray(assignment?.tripHistoryLedger) ? assignment.tripHistoryLedger : []
    const summary = buildDailyShiftSummary(ledger, shiftDayKey, {
      shiftStartMins: creds.shiftStartMins ?? 0,
      shiftEndMins: creds.shiftEndMins ?? 1439,
    })
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

    const [workPdf, payPdf] = await Promise.all([
      Promise.resolve(buildWeekMileagePdfBuffer(workOpts)),
      Promise.resolve(buildWeekMileagePdfBuffer(payOpts)),
    ])

    const mail = weeklySummaryEmail({
      weekLabel: workWeek.groupLabel,
      workWeekLabel: workWeek.groupLabel,
      payWeekLabel: payWeek.groupLabel,
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
 * Local wall-clock parts in a timezone.
 * @param {Date} d
 * @param {string} tz
 */
function zonedParts(d, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(d)
  /** @type {Record<string, string>} */
  const m = {}
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value
  }
  const hour = Number(m.hour)
  const minute = Number(m.minute)
  return {
    mins: hour * 60 + minute,
    ymd: `${m.year}-${m.month}-${m.day}`,
    weekday: m.weekday,
  }
}

/**
 * @param {string} accountKey
 * @param {Date} now
 */
export async function maybeSendScheduledEmailsForAccount(accountKey, now = new Date()) {
  const prefs = await getSmtpPrefsForAccount(accountKey)
  if (!prefs.enabled) return

  const tz = prefs.timezone || 'America/New_York'
  const parts = zonedParts(now, tz)

  return runWithCredentialAccountKey(accountKey, async () => {
    const creds = await getCredentialsMeta()
    const shiftEnd = creds.shiftEndMins ?? 1439
    const shiftStart = creds.shiftStartMins ?? 0
    const dailyDelay = prefs.dailyDelayMins ?? 30

    const dailyTrigger = shiftEnd + dailyDelay
    if (prefs.onDailyShiftSummary && parts.mins >= dailyTrigger && parts.mins < dailyTrigger + 2) {
      const shiftDayKey = shiftDateKeyForEventMs(now.getTime(), shiftStart, shiftEnd)
      try {
        await sendDailyShiftSummaryEmail(accountKey, shiftDayKey)
      } catch (e) {
        console.error('[email] daily shift failed', accountKey, e)
      }
    }

    if (prefs.onWeeklySummary && parts.weekday === 'Mon' && parts.mins >= 360 && parts.mins < 362) {
      const prevWeekMs = now.getTime() - 24 * 60 * 60 * 1000
      try {
        await sendWeeklySummaryEmail(accountKey, prevWeekMs)
      } catch (e) {
        console.error('[email] weekly summary failed', accountKey, e)
      }
    }
  })
}
