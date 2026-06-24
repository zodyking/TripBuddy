import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Simplified work-week / pay-week mileage PDF for email attachments.
 * @param {import('./email-ledger-summary.mjs').buildWeekTotalsPdfOpts extends Function ? ReturnType<import('./email-ledger-summary.mjs').buildWeekTotalsPdfOpts> : never} opts
 */
export function buildWeekMileagePdfBuffer(opts) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const title = opts.documentTitle || 'Week Mileage'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title, 14, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(String(opts.weekRangeLabel || ''), 14, 26)
  doc.text(`Driver: ${opts.driverBlock || '—'}`, 14, 32)
  doc.text(`Tractor: ${opts.truckBlock || '—'}`, 14, 38)
  doc.text(`Generated: ${new Date(opts.generatedAtMs || Date.now()).toLocaleString()}`, 14, 44)

  /** @type {string[][]} */
  const body = []
  for (const day of opts.days || []) {
    if (!day.rows?.length) continue
    for (const row of day.rows) {
      body.push([
        day.dayLabel,
        row.legLabel || '—',
        row.od || '—',
        String(row.billableMi ?? '—'),
      ])
    }
  }

  autoTable(doc, {
    startY: 50,
    head: [['Day', 'Leg', 'Route', 'Billable mi']],
    body: body.length ? body : [['—', '—', 'No trips', '—']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [77, 20, 140], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 246, 252] },
  })

  const finalY = /** @type {any} */ (doc).lastAutoTable?.finalY ?? 60
  doc.setFont('helvetica', 'bold')
  doc.text(`Week total: ${fmtMi(opts.sumBillable)} mi`, 14, finalY + 10)

  const slug = String(opts.weekRangeLabel || 'week')
    .replace(/[^\w\-]+/g, '-')
    .slice(0, 60)
  return {
    buffer: Buffer.from(doc.output('arraybuffer')),
    filename: `${slug || 'week'}-mileage.pdf`,
  }
}

/** @param {number} n */
function fmtMi(n) {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
