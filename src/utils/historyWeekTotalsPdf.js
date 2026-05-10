import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * @param {string} s
 */
function ascii(s) {
  return String(s ?? '')
    .replace(/\u2192/g, '->')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00b7/g, '|')
    .replace(/\u2022/g, '*')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}

/** @param {string} s */
function slug(s) {
  return String(s || '').trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'week'
}

/** @param {number} n */
function fmtMi(n) {
  if (!Number.isFinite(n)) return '-'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * @typedef {{
 *   dayLabel: string,
 *   sumBillable: number,
 *   rows: {
 *     od: string,
 *     when: string,
 *     billableMi: number,
 *     rounded: boolean,
 *     originId: string,
 *     destId: string,
 *     weekday: string,
 *     dispatchDate: string,
 *     dispatchTime: string,
 *     legLabel: string,
 *     tractorNumber: string,
 *     equipmentBlock?: string,
 *   }[],
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

/* ───────── Color palette ────────── */
const C = {
  navy:    [17, 24, 39],
  dark:    [31, 41, 55],
  mid:     [75, 85, 99],
  slate:   [107, 114, 128],
  light:   [156, 163, 175],
  rule:    [209, 213, 219],
  bg:      [243, 244, 246],
  bgAlt:   [249, 250, 251],
  white:   [255, 255, 255],
  accent:  [79, 70, 229],
  accentL: [99, 102, 241],
}

/** @param {WeekTotalsPdfOpts} opts */
export function downloadHistoryWeekTotalsPdf(opts) {
  const title = ascii(opts.documentTitle?.trim() || 'Weekly Mileage Report')
  const genAt = typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
    ? new Date(opts.generatedAtMs) : new Date()
  const genLabel = genAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MX = 12
  const MT = 12
  const MB = 14
  const IW = W - MX * 2
  const totalTrips = opts.days.reduce((s, d) => s + d.rows.length, 0)

  /* ══════════ Page frame (footer) ═══════ */
  function pageFrame() {
    doc.setDrawColor(...C.rule)
    doc.setLineWidth(0.2)
    doc.line(MX, H - MB + 2, W - MX, H - MB + 2)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...C.light)
    doc.text('Confidential  |  Driver reference only  |  Not an official FedEx document', MX, H - MB + 6)
    doc.text(`Generated ${genLabel}`, W - MX, H - MB + 6, { align: 'right' })
  }

  /* ══════════ Header ═══════ */
  let y = MT

  doc.setFillColor(...C.navy)
  doc.rect(0, 0, W, 28, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...C.white)
  doc.text(title, MX, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(180, 190, 210)
  doc.text(ascii(opts.weekRangeLabel), MX, y + 12)

  const metaRight = [
    opts.calendarContext?.trim(),
    `Grouping: ${opts.groupingModeLabel}`,
  ].filter(Boolean).map(ascii).join('  |  ')
  if (metaRight) {
    doc.setFontSize(6.5)
    doc.text(metaRight, W - MX, y + 12, { align: 'right' })
  }

  y = 32

  /* ══════════ Driver / Truck info blocks ═══════ */
  const boxGap = 4
  const boxW = (IW - boxGap) / 2
  const boxH = 22

  /** @param {number} x @param {number} bY @param {string} label @param {string} body */
  function infoBox(x, bY, label, body) {
    doc.setFillColor(...C.bg)
    doc.setDrawColor(...C.rule)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, bY, boxW, boxH, 2, 2, 'FD')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...C.accent)
    doc.text(label.toUpperCase(), x + 4, bY + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...C.navy)
    const lines = doc.splitTextToSize(ascii(body), boxW - 8)
    doc.text(lines.slice(0, 5), x + 4, bY + 9.5, { lineHeightFactor: 1.35 })
  }

  infoBox(MX, y, 'Driver', opts.driverBlock?.trim() || '-')
  infoBox(MX + boxW + boxGap, y, 'Truck', opts.truckBlock?.trim() || '-')
  y += boxH + 3

  /* ══════════ Summary bar ═══════ */
  doc.setFillColor(...C.bg)
  doc.setDrawColor(...C.rule)
  doc.setLineWidth(0.2)
  doc.roundedRect(MX, y, IW, 10, 2, 2, 'FD')

  const stats = [
    `${totalTrips} Trips`,
    `${fmtMi(opts.sumBillable)} Billable Miles`,
    `Rounding: ${opts.roundingBandMin}-${opts.roundingBandMax} mi = ${opts.roundingToMi} mi`,
  ]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...C.navy)
  doc.text(stats.join('     |     '), MX + 4, y + 6.2)
  y += 13

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...C.slate)
  doc.text('Billable miles match on-screen History totals. Paid miles in the rounding band count at the rounded value; missing paid mileage counts as 0. Unofficial estimate.', MX, y, { maxWidth: IW })
  y += 6

  /* ══════════ Build table body ═══════ */
  const COLS = 8
  /** @type {unknown[][]} */
  const body = []

  if (!opts.days.length) {
    body.push([{ content: 'No trips for this period.', colSpan: COLS, styles: { fontStyle: 'italic', textColor: C.slate, halign: 'center' } }])
  }

  for (const day of opts.days) {
    body.push([{
      content: `${ascii(day.dayLabel || 'Day').toUpperCase()}`,
      colSpan: COLS - 1,
      styles: { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 7, cellPadding: { top: 1.8, bottom: 1.8, left: 3, right: 2 } },
    }, {
      content: `${fmtMi(day.sumBillable)} mi`,
      styles: { fillColor: C.navy, textColor: C.white, fontStyle: 'bold', fontSize: 7, halign: 'right', cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 3 } },
    }])

    day.rows.forEach((r, i) => {
      const route = `${ascii(r.originId || '-')}  →  ${ascii(r.destId || '-')}`
      body.push([
        String(i + 1),
        route,
        ascii(r.weekday || '-'),
        ascii(r.dispatchDate || '-'),
        ascii(r.dispatchTime || '-'),
        ascii(r.legLabel || '-'),
        ascii(r.tractorNumber || '-'),
        fmtMi(r.billableMi),
      ])

      const eq = typeof r.equipmentBlock === 'string' ? r.equipmentBlock.trim() : ''
      if (eq) {
        body.push([{
          content: ascii(eq),
          colSpan: COLS,
          _equip: true,
        }])
      }
    })
  }

  /* ══════════ Render table ═══════ */
  autoTable(doc, {
    startY: y,
    tableWidth: IW,
    margin: { left: MX, right: MX, bottom: MB },

    head: [['#', 'Route', 'Day', 'Date', 'Time', 'Leg', 'Tractor', 'Miles']],
    body,
    foot: [[
      { content: 'WEEK TOTAL', colSpan: 7, styles: { fontStyle: 'bold', fillColor: C.navy, textColor: C.white, fontSize: 7.5 } },
      { content: `${fmtMi(opts.sumBillable)} mi`, styles: { fontStyle: 'bold', halign: 'right', fillColor: C.navy, textColor: C.white, fontSize: 7.5 } },
    ]],

    theme: 'grid',

    styles: {
      font: 'helvetica',
      fontSize: 7,
      minCellHeight: 5,
      cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 },
      overflow: 'linebreak',
      textColor: C.dark,
      lineColor: C.rule,
      lineWidth: 0.1,
      valign: 'middle',
    },

    headStyles: {
      fillColor: C.dark,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      lineColor: C.dark,
    },

    footStyles: {
      fillColor: C.navy,
      textColor: C.white,
      fontStyle: 'bold',
      lineColor: C.navy,
    },

    alternateRowStyles: { fillColor: C.bgAlt },

    columnStyles: {
      0: { cellWidth: 8, halign: 'center', textColor: C.slate, fontSize: 6.5 },
      1: { cellWidth: 36 },
      2: { cellWidth: 22 },
      3: { cellWidth: 24 },
      4: { cellWidth: 20, halign: 'center' },
      5: { cellWidth: 30, fontSize: 6.5 },
      6: { cellWidth: 22, halign: 'center' },
      7: { cellWidth: 'auto', halign: 'right', fontStyle: 'bold' },
    },

    didParseCell(data) {
      const raw = data.cell.raw
      if (raw && typeof raw === 'object' && '_equip' in raw) {
        data.cell.styles.fillColor = C.bg
        data.cell.styles.fontSize = 6.5
        data.cell.styles.textColor = C.mid
        data.cell.styles.fontStyle = 'italic'
        data.cell.styles.cellPadding = { top: 0.8, bottom: 0.8, left: 6, right: 2 }
        data.cell.styles.lineColor = [229, 231, 235]
      }
    },

    didDrawPage: pageFrame,
  })

  /* ══════════ Page numbers ═══════ */
  const pages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...C.slate)
    doc.text(`Page ${i} of ${pages}`, W / 2, H - MB + 6, { align: 'center' })
  }

  doc.save(`week-totals-${slug(opts.weekRangeLabel.replace(/\s+/g, '-'))}.pdf`)
}
