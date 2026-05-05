import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * @param {string} s
 */
function sanitizeFilenameSegment(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'week'
}

/**
 * @typedef {{
 *   appTitle?: string,
 *   weekRangeLabel: string,
 *   calendarContext?: string,
 *   groupingModeLabel: string,
 *   preparedFor?: string,
 *   preparedAtMs?: number,
 *   roundingBandMin: number,
 *   roundingBandMax: number,
 *   roundingToMi: number,
 *   rows: { od: string, when: string, billableMi: number, rounded: boolean }[],
 *   sumBillable: number,
 * }} WeekTotalsPdfOpts
 */

/**
 * Generate a single-page, formal summary PDF for History → Week totals.
 * @param {WeekTotalsPdfOpts} opts
 */
export function downloadHistoryWeekTotalsPdf(opts) {
  const appTitle = opts.appTitle?.trim() || 'FedExTool — Linehaul'
  const preparedAt =
    typeof opts.preparedAtMs === 'number' && Number.isFinite(opts.preparedAtMs)
      ? new Date(opts.preparedAtMs)
      : new Date()

  const doc = new jsPDF({
    unit: 'mm',
    format: 'letter',
    orientation: 'portrait',
  })

  const pageW = doc.internal.pageSize.getWidth()
  const margin = 18
  let y = margin

  doc.setFillColor(248, 249, 251)
  doc.rect(0, 0, pageW, 42, 'F')

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.35)
  doc.line(margin, 41, pageW - margin, 41)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(15, 23, 42)
  doc.text(appTitle, margin, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  doc.text('Trip history — week billable mileage summary', margin, y + 12)

  doc.setFont('times', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(30, 41, 59)
  doc.text(opts.weekRangeLabel, margin, y + 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(100, 116, 139)
  const metaLines = [
    opts.calendarContext?.trim(),
    `Grouping: ${opts.groupingModeLabel}`,
    opts.preparedFor?.trim()
      ? `Prepared for: ${opts.preparedFor.trim()}`
      : null,
    `Generated: ${preparedAt.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`,
  ].filter(Boolean)
  doc.text(metaLines.join(' · '), margin, y + 28, { maxWidth: pageW - margin * 2 })

  y = 50

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(71, 85, 105)
  const rule = `Billable miles use the same rounding as on-screen week totals: paid miles between ${opts.roundingBandMin} and ${opts.roundingBandMax} count as ${opts.roundingToMi} mi; trips without paid mileage count as 0. Estimates are unofficial — verify with payroll.`
  const splitRule = doc.splitTextToSize(rule, pageW - margin * 2)
  doc.text(splitRule, margin, y)
  y += splitRule.length * 3.6 + 4

  const body = opts.rows.map((r) => {
    const note = r.rounded
      ? `${opts.roundingBandMin}–${opts.roundingBandMax} mi → ${opts.roundingToMi} mi`
      : ''
    const miStr =
      typeof r.billableMi === 'number' && Number.isFinite(r.billableMi)
        ? Number.isInteger(r.billableMi)
          ? String(r.billableMi)
          : String(Math.round(r.billableMi * 10) / 10)
        : '—'
    return [r.od || '—', r.when || '—', `${miStr} mi`, note]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Route (loc. IDs)', 'Dispatch · leg', 'Billable mi', 'Rounding']],
    body,
    foot: [
      [
        {
          content: 'Week total (billable miles)',
          colSpan: 3,
          styles: { fontStyle: 'bold', fillColor: [241, 245, 249] },
        },
        {
          content: `${formatMi(opts.sumBillable)} mi`,
          styles: {
            fontStyle: 'bold',
            halign: 'right',
            fillColor: [241, 245, 249],
          },
        },
      ],
    ],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
      fontSize: 8,
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      lineWidth: { top: 0.35 },
      lineColor: [148, 163, 184],
    },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 28 },
      3: { cellWidth: 42 },
    },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.15,
    didDrawPage() {
      const fh = doc.internal.pageSize.getHeight()
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7)
      doc.setTextColor(148, 163, 184)
      doc.text(
        'Confidential — driver use only. Not an official FedEx document.',
        margin,
        fh - 12,
        { maxWidth: pageW - margin * 2 },
      )
    },
  })

  const slug = sanitizeFilenameSegment(opts.weekRangeLabel.replace(/\s+/g, '-'))
  doc.save(`week-totals-${slug}.pdf`)
}

/**
 * @param {number} n
 */
function formatMi(n) {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
