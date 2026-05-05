import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * jsPDF WinAnsi fonts cannot render common Unicode punctuation from UI strings.
 * @param {string} s
 */
function asciiPdfText(s) {
  return String(s ?? '')
    .replace(/\u2192/g, '->')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00b7/g, '|')
    .replace(/\u2022/g, '*')
}

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
 *   dayLabel: string,
 *   sumBillable: number,
 *   rows: { od: string, when: string, billableMi: number, rounded: boolean }[],
 * }} WeekTotalsPdfDaySection
 */

/**
 * @typedef {{
 *   documentTitle?: string,
 *   driverBlock: string,
 *   truckBlock: string,
 *   weekRangeLabel: string,
 *   calendarContext?: string,
 *   groupingModeLabel: string,
 *   generatedAtMs?: number,
 *   roundingBandMin: number,
 *   roundingBandMax: number,
 *   roundingToMi: number,
 *   days: WeekTotalsPdfDaySection[],
 *   sumBillable: number,
 * }} WeekTotalsPdfOpts
 */

/**
 * @param {number} n
 */
function formatMi(n) {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * @param {WeekTotalsPdfOpts} opts
 */
export function downloadHistoryWeekTotalsPdf(opts) {
  const docTitle = opts.documentTitle?.trim() || 'Week billable mileage summary'
  const generatedAt =
    typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
      ? new Date(opts.generatedAtMs)
      : new Date()

  const doc = new jsPDF({
    unit: 'mm',
    format: 'letter',
    orientation: 'portrait',
  })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  const innerW = pageW - margin * 2

  doc.setDrawColor(41, 53, 74)
  doc.setLineWidth(0.5)
  doc.line(margin, margin + 8, pageW - margin, margin + 8)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text(docTitle, margin, margin + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(82, 94, 112)
  const meta = [
    opts.calendarContext?.trim(),
    `Grouping: ${opts.groupingModeLabel}`,
    `Report period: ${opts.weekRangeLabel}`,
    `Generated: ${generatedAt.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`,
  ]
    .filter(Boolean)
    .join('   |   ')
  doc.text(doc.splitTextToSize(meta, innerW), margin, margin + 13)

  let yAfterMeta = margin + 13 + Math.max(4, doc.splitTextToSize(meta, innerW).length * 3.2)

  autoTable(doc, {
    startY: yAfterMeta,
    margin: { left: margin, right: margin },
    body: [
      [
        {
          content: 'Driver information',
          styles: {
            fontStyle: 'bold',
            fontSize: 7,
            textColor: [30, 41, 59],
            fillColor: [248, 250, 252],
          },
        },
        {
          content: 'Truck information',
          styles: {
            fontStyle: 'bold',
            fontSize: 7,
            textColor: [30, 41, 59],
            fillColor: [248, 250, 252],
          },
        },
      ],
      [
        {
          content: opts.driverBlock?.trim() || '—',
          styles: {
            fontStyle: 'normal',
            fontSize: 6.5,
            cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
            valign: 'top',
          },
        },
        {
          content: opts.truckBlock?.trim() || '—',
          styles: {
            fontStyle: 'normal',
            fontSize: 6.5,
            cellPadding: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
            valign: 'top',
          },
        },
      ],
    ],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      lineColor: [203, 213, 225],
      lineWidth: 0.12,
    },
    columnStyles: {
      0: { cellWidth: innerW / 2 },
      1: { cellWidth: innerW / 2 },
    },
  })

  let cursorY =
    doc.lastAutoTable != null &&
    typeof doc.lastAutoTable.finalY === 'number'
      ? doc.lastAutoTable.finalY + 3
      : yAfterMeta + 28

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(71, 85, 105)
  const rule = `Billable miles match on-screen History totals. Paid miles ${opts.roundingBandMin}-${opts.roundingBandMax} count as ${opts.roundingToMi} mi; missing paid mileage counts as 0. Unofficial estimate only.`
  const ruleLines = doc.splitTextToSize(rule, innerW)
  doc.text(ruleLines, margin, cursorY)
  cursorY += ruleLines.length * 2.8 + 3

  /** @type {unknown[][]} */
  const tableBody = []

  if (!opts.days.length) {
    tableBody.push([
      {
        content: 'No shift-day groups for this report.',
        colSpan: 4,
        styles: { fontStyle: 'italic', textColor: [100, 116, 139], fontSize: 6.5 },
      },
    ])
  }

  for (const day of opts.days) {
    const label = asciiPdfText(day.dayLabel || 'Shift day')
    tableBody.push([
      {
        content: label.toUpperCase(),
        colSpan: 4,
        styles: {
          fillColor: [226, 232, 240],
          textColor: [51, 65, 85],
          fontStyle: 'bold',
          fontSize: 6.5,
          cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
        },
      },
    ])

    for (const r of day.rows) {
      const note = r.rounded
        ? `${opts.roundingBandMin}-${opts.roundingBandMax} mi -> ${opts.roundingToMi} mi`
        : ''
      const miStr =
        typeof r.billableMi === 'number' && Number.isFinite(r.billableMi)
          ? Number.isInteger(r.billableMi)
            ? String(r.billableMi)
            : String(Math.round(r.billableMi * 10) / 10)
          : '—'
      tableBody.push([
        asciiPdfText(r.od || '—'),
        asciiPdfText(r.when || '—'),
        `${miStr} mi`,
        note,
      ])
    }

    tableBody.push([
      {
        content: `Day total (${label})`,
        colSpan: 3,
        styles: {
          fontStyle: 'bold',
          fillColor: [248, 250, 252],
          fontSize: 6.5,
          textColor: [51, 65, 85],
        },
      },
      {
        content: `${formatMi(day.sumBillable)} mi`,
        styles: {
          fontStyle: 'bold',
          halign: 'right',
          fillColor: [248, 250, 252],
          fontSize: 6.5,
          textColor: [51, 65, 85],
        },
      },
    ])
  }

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [['Origin -> Dest (IDs)', 'Dispatch | Leg', 'Billable mi', 'Rounding']],
    body: tableBody,
    foot: [
      [
        {
          content: 'Week total (billable miles)',
          colSpan: 3,
          styles: { fontStyle: 'bold', fillColor: [241, 245, 249], fontSize: 7 },
        },
        {
          content: `${formatMi(opts.sumBillable)} mi`,
          styles: {
            fontStyle: 'bold',
            halign: 'right',
            fillColor: [241, 245, 249],
            fontSize: 7,
          },
        },
      ],
    ],
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 6.5,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [51, 65, 85],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      lineWidth: { top: 0.25 },
      lineColor: [148, 163, 184],
    },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 24 },
      3: { cellWidth: 38 },
    },
    alternateRowStyles: { fillColor: [252, 252, 254] },
    didDrawPage() {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(5.5)
      doc.setTextColor(148, 163, 184)
      doc.text(
        'Confidential | Driver reference only | Not an official FedEx document',
        margin,
        pageH - 10,
        { maxWidth: innerW },
      )
    },
  })

  const slug = sanitizeFilenameSegment(opts.weekRangeLabel.replace(/\s+/g, '-'))
  doc.save(`week-totals-${slug}.pdf`)
}
