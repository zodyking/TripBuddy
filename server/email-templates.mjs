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
}

/**
 * @param {{ title: string, preheader?: string, bodyHtml: string, ctaLabel?: string, ctaHref?: string }} opts
 */
export function wrapEmailHtml(opts) {
  const title = escapeHtml(opts.title)
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
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.card};border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(77,20,140,0.08);border:1px solid ${BRAND.border};">
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
              Sent by TripBuddy · FedEx driver tools
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
        <td style="padding:8px 0;font-size:13px;color:${BRAND.muted};width:38%;vertical-align:top;">${escapeHtml(r.label)}</td>
        <td style="padding:8px 0;font-size:15px;font-weight:600;color:${BRAND.text};vertical-align:top;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${rows}</table>`
}

/**
 * @param {{ headers: string[], rows: string[][] }} table
 */
export function dataTable(table) {
  const th = (table.headers || [])
    .map(
      (h) =>
        `<th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};border-bottom:2px solid ${BRAND.border};">${escapeHtml(h)}</th>`,
    )
    .join('')
  const body = (table.rows || [])
    .map((row, i) => {
      const bg = i % 2 === 0 ? BRAND.card : '#FAF9FC'
      const tds = row
        .map(
          (c) =>
            `<td style="padding:10px 12px;font-size:14px;color:${BRAND.text};border-bottom:1px solid ${BRAND.border};background:${bg};">${escapeHtml(c)}</td>`,
        )
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<div style="overflow-x:auto;border:1px solid ${BRAND.border};border-radius:12px;margin-top:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:420px;">
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`
}

/** @param {{ leg: string, origin: string, destination: string, driverName?: string }} trip */
export function newTripEmail(trip) {
  const route = `${trip.origin} → ${trip.destination}`
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      A new trip has been assigned and is ready in TripBuddy.
    </p>
    ${keyValueBlock({
      rows: [
        { label: 'Route', value: route },
        { label: 'Leg', value: trip.leg || '—' },
        ...(trip.driverName ? [{ label: 'Driver', value: trip.driverName }] : []),
      ],
    })}
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Open TripBuddy on your device to review trip details, trailers, and quick actions.
    </p>`
  return {
    subject: `New trip: ${route}`,
    html: wrapEmailHtml({
      title: 'New trip assigned',
      preheader: `New trip ${route}`,
      bodyHtml,
    }),
    text: `New trip assigned\nRoute: ${route}\nLeg: ${trip.leg || '—'}`,
  }
}

/** @param {{ shiftLabel: string, tripCount: number, totalMiles: number, rows: string[][] }} summary */
export function dailyShiftEmail(summary) {
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
      summary.rows.length
        ? dataTable({
            headers: ['Time', 'Leg', 'Route', 'Outcome', 'Miles'],
            rows: summary.rows,
          })
        : `<p style="margin:16px 0 0;font-size:14px;color:${BRAND.muted};">No completed trips recorded for this shift.</p>`
    }`
  return {
    subject: `Shift summary — ${summary.shiftLabel}`,
    html: wrapEmailHtml({
      title: 'End of shift summary',
      preheader: `${summary.tripCount} trip(s) · ${fmtMi(summary.totalMiles)} mi`,
      bodyHtml,
    }),
    text: `Shift summary ${summary.shiftLabel}\nTrips: ${summary.tripCount}\nMiles: ${fmtMi(summary.totalMiles)}`,
  }
}

/** @param {{ weekLabel: string, workWeekLabel: string, payWeekLabel: string }} opts */
export function weeklySummaryEmail(opts) {
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${BRAND.text};">
      Your weekly mileage reports are attached as PDFs.
    </p>
    ${keyValueBlock({
      rows: [
        { label: 'Work week', value: opts.workWeekLabel },
        { label: 'Pay schedule week', value: opts.payWeekLabel },
      ],
    })}
    <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${BRAND.muted};">
      Attachments: <strong>work-week-mileage.pdf</strong> and <strong>pay-schedule-mileage.pdf</strong>.
      These match the PDF exports from TripBuddy History.
    </p>`
  return {
    subject: `Weekly summary — ${opts.weekLabel}`,
    html: wrapEmailHtml({
      title: 'Weekly mileage summary',
      preheader: opts.weekLabel,
      bodyHtml,
    }),
    text: `Weekly summary ${opts.weekLabel}\nWork week: ${opts.workWeekLabel}\nPay week: ${opts.payWeekLabel}`,
  }
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
