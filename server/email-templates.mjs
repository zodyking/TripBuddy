const BRAND = {
  purple: '#4D148C',
  purpleDark: '#3D0F6E',
  orange: '#FF6600',
  bg: '#F4F2F8',
  card: '#FFFFFF',
  text: '#1A1A2E',
  muted: '#5C5C72',
  border: '#E8E4F0',
  success: '#0D7A4E',
  subtle: '#FAF9FC',
}

export const EMAIL_FOOTER_HTML =
  'TripBuddy Integration · Built by Brandon King'

/**
 * Title-case email subjects and headings; preserve ALL-CAPS tokens (airport codes, acronyms).
 * @param {string} input
 */
export function toEmailTitleCase(input) {
  return String(input ?? '').replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    if (word === word.toUpperCase() && word.length >= 2) return word
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })
}

/** @param {string} [outcome] @param {string} [reason] */
export function formatEmailOutcome(outcome, reason) {
  const raw = String(outcome ?? '').trim()
  if (!raw || raw === '—') return '—'
  const label = toEmailTitleCase(raw)
  const norm = raw.toLowerCase()
  if (norm === 'delivered') return label
  const why = String(reason ?? '').trim()
  return why ? `${label} — ${why}` : label
}

/** @param {string} [value] */
function emailDisplayValue(value) {
  const s = String(value ?? '').trim()
  if (!s || s === '—') return '—'
  return toEmailTitleCase(s)
}

/**
 * @param {{ title: string, preheader?: string, bodyHtml: string, ctaLabel?: string, ctaHref?: string }} opts
 */
export function wrapEmailHtml(opts) {
  const title = escapeHtml(toEmailTitleCase(opts.title))
  const preheader = escapeHtml(opts.preheader || opts.title)
  const cta =
    opts.ctaLabel && opts.ctaHref
      ? `<p style="margin:28px 0 0;text-align:center;">
          <a href="${escapeAttr(opts.ctaHref)}" style="display:inline-block;background:${BRAND.orange};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:10px;">${escapeHtml(opts.ctaLabel)}</a>
        </p>`
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${BRAND.card};border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(77,20,140,0.08);border:1px solid ${BRAND.border};">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.purple} 0%,${BRAND.purpleDark} 100%);padding:24px 28px;">
              <div style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.82);">TripBuddy</div>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;font-weight:700;color:#fff;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${opts.bodyHtml}
              ${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid ${BRAND.border};font-size:12px;line-height:1.5;color:${BRAND.muted};text-align:center;">
              ${escapeHtml(EMAIL_FOOTER_HTML)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * @param {{ rows: { label: string, value: string }[] }} opts
 */
export function keyValueBlock(opts) {
  const rows = (opts.rows || [])
    .map(
      (r) => `<tr>
        <td style="padding:5px 10px 5px 0;font-size:14px;color:${BRAND.muted};white-space:nowrap;vertical-align:top;width:1%;">${escapeHtml(r.label)}</td>
        <td style="padding:5px 0;font-size:14px;font-weight:600;color:${BRAND.text};vertical-align:top;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-collapse:collapse;">${rows}</table>`
}

/**
 * @param {{ headers: string[], rows: string[][] }} table
 */
export function dataTable(table) {
  const th = (table.headers || [])
    .map(
      (h) =>
        `<th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};border-bottom:2px solid ${BRAND.border};white-space:nowrap;">${escapeHtml(h)}</th>`,
    )
    .join('')
  const body = (table.rows || [])
    .map((row, i) => {
      const bg = i % 2 === 0 ? BRAND.card : BRAND.subtle
      const tds = row
        .map((c, colIdx) => {
          const nowrap = colIdx <= 2 ? 'white-space:nowrap;' : ''
          return `<td style="padding:8px 10px;font-size:13px;line-height:1.35;color:${BRAND.text};border-bottom:1px solid ${BRAND.border};background:${bg};vertical-align:top;${nowrap}">${escapeHtml(c)}</td>`
        })
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<div style="overflow-x:auto;border:1px solid ${BRAND.border};border-radius:12px;margin-top:12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`
}

/**
 * @param {import('./email-trip-details.mjs').EmailTripContext} trip
 * @param {{ compact?: boolean, showMeta?: boolean, stackedRoute?: boolean }} [opts]
 */
export function tripDetailCardHtml(trip, opts = {}) {
  const compact = opts.compact === true
  const showMeta = opts.showMeta !== false
  const stackedRoute = opts.stackedRoute === true

  const metaRows = []
  if (showMeta) {
    if (trip.completedAt) metaRows.push({ label: 'Completed', value: trip.completedAt })
    if (trip.leg && trip.leg !== '—') metaRows.push({ label: 'Leg', value: trip.leg })
    if (trip.outcome && trip.outcome !== '—') {
      metaRows.push({
        label: 'Outcome',
        value: formatEmailOutcome(trip.outcome, trip.outcomeReason),
      })
    }
    if (trip.miles && trip.miles !== '—') metaRows.push({ label: 'Miles', value: trip.miles })
    if (trip.driverName) metaRows.push({ label: 'Driver', value: emailDisplayValue(trip.driverName) })
    if (trip.tractorNumber) metaRows.push({ label: 'Tractor', value: trip.tractorNumber })
    if (trip.tripStatus) {
      metaRows.push({ label: 'Trip status', value: emailDisplayValue(trip.tripStatus) })
    }
  }

  const originLabel = emailDisplayValue(trip.originDisplay || trip.origin)
  const destinationLabel = emailDisplayValue(trip.destinationDisplay || trip.destination)

  const routeBlock = stackedRoute
    ? `<div style="font-size:16px;font-weight:700;line-height:1.4;color:${BRAND.text};">${escapeHtml(originLabel)}</div>
    <div style="margin:6px 0;font-size:13px;color:${BRAND.muted};">to</div>
    <div style="font-size:16px;font-weight:700;line-height:1.4;color:${BRAND.text};">${escapeHtml(destinationLabel)}</div>`
    : `<div style="font-size:16px;font-weight:700;line-height:1.4;color:${BRAND.text};white-space:nowrap;">${escapeHtml(trip.route)}</div>`

  const trailerBlock =
    trip.trailers.length > 0
      ? `<div style="margin-top:${compact ? '10' : '14'}px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:8px;">Trailers</div>
          ${trip.trailers
            .map((tr) => {
              const header = `Trailer ${tr.order}${tr.number !== '—' ? ` · #${tr.number}` : ''}${tr.size !== '—' ? ` · ${tr.size}` : ''}`
              const badges = [emailDisplayValue(tr.loadType), emailDisplayValue(tr.status)]
                .filter((b) => b && b !== '—')
                .join(' · ')
              const details = [
                tr.seal !== '—' ? `Seal ${tr.seal}` : '',
                tr.weight !== '—' ? tr.weight : '',
                tr.destination !== '—' ? `Dest ${emailDisplayValue(tr.destination)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')
              return `<div style="padding:10px 12px;margin-bottom:8px;border-radius:10px;background:${BRAND.subtle};border:1px solid ${BRAND.border};">
                <div style="font-size:14px;font-weight:600;color:${BRAND.text};">${escapeHtml(header)}</div>
                ${badges ? `<div style="margin-top:4px;font-size:12px;color:${BRAND.muted};">${escapeHtml(badges)}</div>` : ''}
                ${details ? `<div style="margin-top:4px;font-size:13px;color:${BRAND.text};">${escapeHtml(details)}</div>` : ''}
              </div>`
            })
            .join('')}
        </div>`
      : `<div style="margin-top:10px;font-size:13px;color:${BRAND.muted};">No trailer details on file.</div>`

  const dollyBlock =
    trip.dollies.length > 0
      ? `<div style="margin-top:${compact ? '10' : '14'}px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">Dollies</div>
          <div style="font-size:14px;color:${BRAND.text};font-weight:600;">${escapeHtml(trip.dollySummary)}</div>
        </div>`
      : ''

  const instructions =
    trip.dispatchInstructions && !compact
      ? `<div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:${BRAND.subtle};border:1px solid ${BRAND.border};">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">Dispatch instructions</div>
          <div style="font-size:14px;line-height:1.55;color:${BRAND.text};white-space:pre-wrap;">${escapeHtml(trip.dispatchInstructions)}</div>
        </div>`
      : ''

  return `<div style="margin-top:${compact ? '12' : '16'}px;padding:${compact ? '14' : '16'}px;border-radius:12px;border:1px solid ${BRAND.border};background:${BRAND.card};">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">Route</div>
    ${routeBlock}
    ${metaRows.length ? keyValueBlock({ rows: metaRows }) : ''}
    ${dollyBlock}
    ${trailerBlock}
    ${instructions}
  </div>`
}

/** @param {import('./email-trip-details.mjs').EmailTripContext} trip */
export function tripDetailPlainText(trip) {
  const origin = trip.originDisplay || trip.origin
  const destination = trip.destinationDisplay || trip.destination
  const lines = [`Route: ${origin} → ${destination}`]
  if (trip.leg && trip.leg !== '—') lines.push(`Leg: ${trip.leg}`)
  if (trip.outcome && trip.outcome !== '—') {
    lines.push(`Outcome: ${formatEmailOutcome(trip.outcome, trip.outcomeReason)}`)
  }
  if (trip.driverName) lines.push(`Driver: ${trip.driverName}`)
  if (trip.tractorNumber) lines.push(`Tractor: ${trip.tractorNumber}`)
  if (trip.miles) lines.push(`Miles: ${trip.miles}`)
  if (trip.tripStatus) lines.push(`Trip status: ${trip.tripStatus}`)
  if (trip.completedAt) lines.push(`Completed: ${trip.completedAt}`)
  if (trip.dollies.length) lines.push(`Dollies: ${trip.dollySummary}`)
  for (const tr of trip.trailers) {
    const parts = [
      `Trailer ${tr.order}`,
      tr.number !== '—' ? `#${tr.number}` : '',
      tr.size !== '—' ? tr.size : '',
      tr.loadType !== '—' ? tr.loadType : '',
      tr.seal !== '—' ? `Seal ${tr.seal}` : '',
      tr.weight !== '—' ? tr.weight : '',
    ].filter(Boolean)
    lines.push(parts.join(' · '))
  }
  if (trip.dispatchInstructions) {
    lines.push('', 'Dispatch instructions:', trip.dispatchInstructions)
  }
  return lines.join('\n')
}

/**
 * @param {import('./email-trip-details.mjs').EmailTripContext} trip
 */
function tripEmailCommon(trip) {
  return {
    route: trip.route,
    bodyTrip: tripDetailCardHtml(trip),
    textTrip: tripDetailPlainText(trip),
  }
}

/** @param {import('./email-trip-details.mjs').EmailTripContext} trip */
export function newTripEmail(trip) {
  const { route, bodyTrip, textTrip } = tripEmailCommon(trip)
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      A new trip has been assigned and is ready in TripBuddy.
    </p>
    ${bodyTrip}
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Open TripBuddy on your device for live updates and quick actions.
    </p>`
  return {
    subject: toEmailTitleCase(`New trip: ${route}`),
    html: wrapEmailHtml({
      title: 'New trip assigned',
      preheader: `New trip ${route}`,
      bodyHtml,
    }),
    text: `New Trip Assigned\n\n${textTrip}`,
  }
}

/** @param {import('./email-trip-details.mjs').EmailTripContext} trip */
export function preplanTripEmail(trip) {
  const { route, bodyTrip, textTrip } = tripEmailCommon(trip)
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      A new preplan trip has been assigned in TripBuddy.
    </p>
    ${bodyTrip}
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Review the preplan in TripBuddy before it becomes your active trip.
    </p>`
  return {
    subject: toEmailTitleCase(`New preplan: ${route}`),
    html: wrapEmailHtml({
      title: 'New preplan assigned',
      preheader: `Preplan ${route}`,
      bodyHtml,
    }),
    text: `New Preplan Assigned\n\n${textTrip}`,
  }
}

/** @param {{ statusLabel: string, fromPhase?: string, toPhase?: string, trip?: import('./email-trip-details.mjs').EmailTripContext | null }} opts */
export function tripStatusEmail(opts) {
  const tripBlock = opts.trip ? tripDetailCardHtml(opts.trip) : ''
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      Your active trip status changed to <strong>${escapeHtml(opts.statusLabel)}</strong>.
    </p>
    ${
      opts.fromPhase && opts.toPhase
        ? keyValueBlock({
            rows: [
              { label: 'Previous', value: phaseLabel(opts.fromPhase) },
              { label: 'Current', value: phaseLabel(opts.toPhase) },
            ],
          })
        : ''
    }
    ${tripBlock}
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Open TripBuddy for live trip details and quick actions.
    </p>`
  const textTrip = opts.trip ? `\n\n${tripDetailPlainText(opts.trip)}` : ''
  return {
    subject: toEmailTitleCase(
      opts.trip?.route ? `Trip status: ${opts.statusLabel} — ${opts.trip.route}` : `Trip status: ${opts.statusLabel}`,
    ),
    html: wrapEmailHtml({
      title: `Trip status: ${opts.statusLabel}`,
      preheader: `Status ${opts.statusLabel}`,
      bodyHtml,
    }),
    text: `Trip Status: ${opts.statusLabel}${textTrip}`,
  }
}

/** @param {{ hint?: string, trip?: import('./email-trip-details.mjs').EmailTripContext | null }} opts */
export function dispatchInstructionsEmail(opts) {
  const hint = String(opts.hint ?? '').trim()
  const tripBlock = opts.trip ? tripDetailCardHtml(opts.trip, { showMeta: false }) : ''
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      ${
        hint
          ? 'Dispatch instructions were updated in TripBuddy.'
          : 'Dispatch instructions were cleared in TripBuddy.'
      }
    </p>
    ${tripBlock}
    ${
      hint
        ? `<div style="margin:16px 0 0;padding:16px;border-radius:12px;background:${BRAND.subtle};border:1px solid ${BRAND.border};">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:8px;">Updated instructions</div>
            <div style="font-size:14px;line-height:1.55;color:${BRAND.text};white-space:pre-wrap;">${escapeHtml(hint)}</div>
          </div>`
        : `<p style="margin:16px 0 0;font-size:14px;color:${BRAND.muted};">No dispatch instructions are currently on file.</p>`
    }`
  const textTrip = opts.trip ? `\n\n${tripDetailPlainText(opts.trip)}` : ''
  return {
    subject: toEmailTitleCase(
      hint
        ? opts.trip?.route
          ? `Dispatch instructions updated — ${opts.trip.route}`
          : 'Dispatch instructions updated'
        : 'Dispatch instructions cleared',
    ),
    html: wrapEmailHtml({
      title: hint ? 'Dispatch instructions updated' : 'Dispatch instructions cleared',
      preheader: hint ? 'New dispatch instructions' : 'Instructions cleared',
      bodyHtml,
    }),
    text: hint
      ? `Dispatch Instructions Updated${textTrip}\n\n${hint}`
      : `Dispatch Instructions Cleared${textTrip}`,
  }
}

/** @param {{ tractorLocation?: string, driverLocation?: string, trip?: import('./email-trip-details.mjs').EmailTripContext | null }} opts */
export function driverMismatchEmail(opts) {
  const tripBlock = opts.trip ? tripDetailCardHtml(opts.trip) : ''
  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      TripBuddy detected that your driver and tractor locations do not match.
    </p>
    ${keyValueBlock({
      rows: [
        ...(opts.tractorLocation
          ? [{ label: 'Tractor location', value: opts.tractorLocation }]
          : []),
        ...(opts.driverLocation
          ? [{ label: 'Driver location', value: opts.driverLocation }]
          : []),
      ],
    })}
    ${tripBlock}
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Verify your assignment and location in TripBuddy when it is safe to do so.
    </p>`
  const textTrip = opts.trip ? `\n\n${tripDetailPlainText(opts.trip)}` : ''
  return {
    subject: toEmailTitleCase(
      opts.trip?.route
        ? `Location mismatch — ${opts.trip.route}`
        : 'Driver and tractor location mismatch',
    ),
    html: wrapEmailHtml({
      title: 'Location mismatch alert',
      preheader: 'Driver and tractor locations differ',
      bodyHtml,
    }),
    text: `Driver and Tractor Location Mismatch${textTrip}`,
  }
}

import { dailyTripTableRow } from './email-trip-details.mjs'

/** @param {{ shiftLabel: string, tripCount: number, totalMiles: number, trips: import('./email-trip-details.mjs').EmailTripContext[], tableRows?: string[][] }} summary */
export function dailyShiftEmail(summary) {
  const tripCards = summary.trips.length
    ? summary.trips
        .map((t) => tripDetailCardHtml(t, { compact: true, stackedRoute: true }))
        .join('')
    : ''

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      Here is your completed work for <strong>${escapeHtml(summary.shiftLabel)}</strong>.
    </p>
    ${keyValueBlock({
      rows: [
        { label: 'Trips', value: String(summary.tripCount) },
        { label: 'Billable miles', value: fmtMi(summary.totalMiles) },
      ],
    })}
    ${
      tripCards
        ? `<div style="margin-top:20px;">
            <div style="font-size:13px;font-weight:700;color:${BRAND.text};margin-bottom:10px;">Trip details</div>
            ${tripCards}
          </div>`
        : `<p style="margin:16px 0 0;font-size:14px;color:${BRAND.muted};">No completed trips recorded for this shift.</p>`
    }`

  const textTrips = summary.trips.length
    ? summary.trips.map((t, i) => `Trip ${i + 1}\n${tripDetailPlainText(t)}`).join('\n\n')
    : 'No completed trips recorded for this shift.'

  return {
    subject: toEmailTitleCase(`Shift summary — ${summary.shiftLabel}`),
    html: wrapEmailHtml({
      title: 'End of shift summary',
      preheader: `${summary.tripCount} trip(s) · ${fmtMi(summary.totalMiles)} mi`,
      bodyHtml,
    }),
    text: `Shift Summary ${summary.shiftLabel}\nTrips: ${summary.tripCount}\nBillable miles: ${fmtMi(summary.totalMiles)}\n\n${textTrips}`,
  }
}

/** @param {{
 *   weekLabel: string,
 *   workWeekLabel: string,
 *   payWeekLabel: string,
 *   driverName?: string,
 *   driverId?: string,
 *   tractorsUsed?: string[],
 *   tripCount?: number,
 *   totalMiles?: number,
 *   tableRows?: string[][],
 * }} opts */
export function weeklySummaryEmail(opts) {
  const tractorsLabel =
    opts.tractorsUsed && opts.tractorsUsed.length
      ? opts.tractorsUsed.map((t) => `#${t}`).join(', ')
      : '—'

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      Your weekly mileage summary for <strong>${escapeHtml(opts.workWeekLabel)}</strong>.
      Full PDF reports are attached below.
    </p>
    ${keyValueBlock({
      rows: [
        { label: 'Driver', value: opts.driverName || '—' },
        { label: 'Driver ID', value: opts.driverId || '—' },
        { label: 'Tractors this week', value: tractorsLabel },
        { label: 'Total trips', value: String(opts.tripCount ?? 0) },
        { label: 'Total miles', value: fmtMi(opts.totalMiles ?? 0) },
        { label: 'Work week', value: opts.workWeekLabel },
        { label: 'Pay schedule week', value: opts.payWeekLabel },
      ],
    })}
    ${
      opts.tableRows && opts.tableRows.length
        ? `<div style="margin-top:20px;">
            <div style="font-size:13px;font-weight:700;color:${BRAND.text};margin-bottom:10px;">Work week trips</div>
            ${dataTable({
              headers: ['When', 'Leg', 'Route', 'Trailers', 'Dollies', 'Miles'],
              rows: opts.tableRows,
            })}
          </div>`
        : `<p style="margin:16px 0 0;font-size:14px;color:${BRAND.muted};">No completed trips recorded for this work week.</p>`
    }
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Attachments: <strong>work-week-mileage.pdf</strong> and <strong>pay-schedule-mileage.pdf</strong>.
      These match the PDF exports from TripBuddy History.
    </p>`

  const textTable =
    opts.tableRows && opts.tableRows.length
      ? opts.tableRows
          .map(
            (row, i) =>
              `Trip ${i + 1}: ${row[0]} | Leg ${row[1]} | ${row[2]} | ${row[3]} | Dollies ${row[4]} | ${row[5]}`,
          )
          .join('\n')
      : 'No completed trips recorded for this work week.'

  return {
    subject: toEmailTitleCase(
      `Weekly summary — ${opts.tripCount ?? 0} trip(s), ${fmtMi(opts.totalMiles ?? 0)}`,
    ),
    html: wrapEmailHtml({
      title: 'Weekly mileage summary',
      preheader: `${opts.tripCount ?? 0} trip(s) · ${fmtMi(opts.totalMiles ?? 0)} · ${opts.driverName || 'Driver'}`,
      bodyHtml,
    }),
    text: [
      `Weekly Summary ${opts.weekLabel}`,
      `Driver: ${opts.driverName || '—'}`,
      `Driver ID: ${opts.driverId || '—'}`,
      `Tractors: ${tractorsLabel}`,
      `Trips: ${opts.tripCount ?? 0}`,
      `Miles: ${fmtMi(opts.totalMiles ?? 0)}`,
      `Work week: ${opts.workWeekLabel}`,
      `Pay week: ${opts.payWeekLabel}`,
      '',
      textTable,
    ].join('\n'),
  }
}

/** @param {string} phase */
function phaseLabel(phase) {
  if (phase === 'assigned') return 'Assigned'
  if (phase === 'dispatched') return 'En route'
  if (phase === 'none') return 'Complete'
  return phase
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

/** @param {number} n */
function fmtMi(n) {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)} mi`
}
