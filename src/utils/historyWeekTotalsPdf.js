import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/** @param {string} s */
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
 *     proofScreenshots?: { label: string, jpeg: string, ts: number }[],
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

const BLACK   = [0, 0, 0]
const DARK    = [24, 24, 24]
const DGRAY   = [55, 55, 55]
const MGRAY   = [100, 100, 100]
const GRAY    = [140, 140, 140]
const LGRAY   = [200, 200, 200]
const RULE    = [220, 220, 220]
const BG      = [245, 245, 245]
const BGALT   = [250, 250, 250]
const WHITE   = [255, 255, 255]

/** @param {WeekTotalsPdfOpts} opts */
export function downloadHistoryWeekTotalsPdf(opts) {
  const title = ascii(opts.documentTitle?.trim() || 'Weekly Mileage Report')
  const genAt = typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
    ? new Date(opts.generatedAtMs) : new Date()
  const genLabel = genAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const MX = 14
  const MB = 14
  const IW = W - MX * 2
  const totalTrips = opts.days.reduce((s, d) => s + d.rows.length, 0)

  /* ── Footer on every page ── */
  function pageFooter() {
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.15)
    doc.line(MX, H - MB + 1, W - MX, H - MB + 1)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...GRAY)
    doc.text('Confidential  ·  Driver reference only  ·  Not an official FedEx document', MX, H - MB + 5.5)
    doc.text(genLabel, W - MX, H - MB + 5.5, { align: 'right' })
  }

  /* ══════════════════════════════════════════════
     HEADER — black banner
     ══════════════════════════════════════════════ */
  doc.setFillColor(...BLACK)
  doc.rect(0, 0, W, 30, 'F')

  let y = 13
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...WHITE)
  doc.text(title, MX, y)

  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...LGRAY)
  doc.text(ascii(opts.weekRangeLabel), MX, y)

  const metaParts = [
    opts.calendarContext?.trim(),
    `Grouping: ${opts.groupingModeLabel}`,
  ].filter(Boolean).map(ascii).join('   ·   ')
  if (metaParts) {
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(metaParts, W - MX, y, { align: 'right' })
  }

  y = 36

  /* ══════════════════════════════════════════════
     DRIVER / TRUCK INFO — side by side
     ══════════════════════════════════════════════ */
  const boxGap = 5
  const boxW = (IW - boxGap) / 2
  const boxH = 24

  /** @param {number} bx @param {number} by @param {string} label @param {string} body */
  function infoBlock(bx, by, label, body) {
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.2)
    doc.setFillColor(...BG)
    doc.roundedRect(bx, by, boxW, boxH, 2, 2, 'FD')

    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.6)
    doc.line(bx, by, bx + boxW, by)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...BLACK)
    doc.text(label.toUpperCase(), bx + 4, by + 5.5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...DGRAY)
    const lines = doc.splitTextToSize(ascii(body), boxW - 8)
    doc.text(lines.slice(0, 5), bx + 4, by + 10.5, { lineHeightFactor: 1.4 })
  }

  infoBlock(MX, y, 'Driver', opts.driverBlock?.trim() || '-')
  infoBlock(MX + boxW + boxGap, y, 'Truck', opts.truckBlock?.trim() || '-')
  y += boxH + 4

  /* ══════════════════════════════════════════════
     SUMMARY BAR
     ══════════════════════════════════════════════ */
  doc.setFillColor(...BLACK)
  doc.roundedRect(MX, y, IW, 9, 1.5, 1.5, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...WHITE)
  doc.text(`${totalTrips} Trips`, MX + 5, y + 5.8)

  doc.setFont('helvetica', 'bold')
  doc.text(`${fmtMi(opts.sumBillable)} Billable Miles`, MX + 35, y + 5.8)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...LGRAY)
  doc.text(`Rounding: ${opts.roundingBandMin}-${opts.roundingBandMax} mi = ${opts.roundingToMi} mi`, W - MX - 5, y + 5.8, { align: 'right' })

  y += 12

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...MGRAY)
  doc.text(
    'Billable miles match on-screen History totals. Missing paid mileage counts as 0. Unofficial estimate only.',
    MX, y,
    { maxWidth: IW },
  )
  y += 5

  /* ══════════════════════════════════════════════
     TABLE BODY
     ══════════════════════════════════════════════ */
  const COLS = 7
  /** @type {unknown[][]} */
  const body = []

  if (!opts.days.length) {
    body.push([{
      content: 'No trips for this period.',
      colSpan: COLS,
      styles: { fontStyle: 'italic', textColor: MGRAY, halign: 'center' },
    }])
  }

  /** @type {{ originId: string, destId: string, dispatchDate: string, legLabel: string, screenshots: { label: string, jpeg: string }[] }[]} */
  const proofAppendix = []

  for (const day of opts.days) {
    body.push([{
      content: ascii(day.dayLabel || 'Day').toUpperCase(),
      colSpan: COLS - 1,
      styles: {
        fillColor: BLACK, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5,
        cellPadding: { top: 2, bottom: 2, left: 3, right: 2 },
      },
    }, {
      content: `${fmtMi(day.sumBillable)} mi`,
      styles: {
        fillColor: BLACK, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5,
        halign: 'right',
        cellPadding: { top: 2, bottom: 2, left: 2, right: 3 },
      },
    }])

    day.rows.forEach((r, i) => {
      const hasProof = Array.isArray(r.proofScreenshots) && r.proofScreenshots.length > 0

      body.push([
        { content: String(i + 1), styles: { halign: 'center', textColor: MGRAY } },
        { content: ascii(r.originId || '-'), styles: { fontStyle: 'bold' } },
        { content: ascii(r.destId || '-'), styles: { fontStyle: 'bold' } },
        ascii(r.dispatchDate || '-'),
        ascii(r.dispatchTime || '-'),
        { content: ascii(r.tractorNumber || '-'), styles: { halign: 'center' } },
        { content: fmtMi(r.billableMi), styles: { fontStyle: 'bold', halign: 'right' } },
      ])

      const eq = typeof r.equipmentBlock === 'string' ? r.equipmentBlock.trim() : ''
      const eqLine = eq ? ascii(eq) : ''
      const proofLine = hasProof ? `Proof of Dispatch: see appendix` : ''
      const subContent = [eqLine, proofLine].filter(Boolean).join('\n')
      if (subContent) {
        body.push([{
          content: subContent,
          colSpan: COLS,
          _equip: true,
        }])
      }

      if (hasProof) {
        proofAppendix.push({
          originId: r.originId || '-',
          destId: r.destId || '-',
          dispatchDate: r.dispatchDate || '-',
          legLabel: r.legLabel || '-',
          screenshots: r.proofScreenshots,
        })
      }
    })
  }

  /* ══════════════════════════════════════════════
     RENDER TABLE
     ══════════════════════════════════════════════ */
  autoTable(doc, {
    startY: y,
    tableWidth: IW,
    margin: { left: MX, right: MX, bottom: MB },

    head: [['#', 'Origin', 'Dest', 'Date', 'Time', 'Tractor', 'Miles']],
    body,
    foot: [[
      { content: 'WEEK TOTAL', colSpan: 6, styles: { fontStyle: 'bold', fillColor: BLACK, textColor: WHITE, fontSize: 8 } },
      { content: `${fmtMi(opts.sumBillable)} mi`, styles: { fontStyle: 'bold', halign: 'right', fillColor: BLACK, textColor: WHITE, fontSize: 8 } },
    ]],

    theme: 'grid',

    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      minCellHeight: 5.5,
      cellPadding: { top: 1.4, bottom: 1.4, left: 2.5, right: 2.5 },
      overflow: 'linebreak',
      textColor: DARK,
      lineColor: RULE,
      lineWidth: 0.1,
      valign: 'middle',
    },

    headStyles: {
      fillColor: DGRAY,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
      lineColor: DGRAY,
    },

    footStyles: {
      fillColor: BLACK,
      textColor: WHITE,
      fontStyle: 'bold',
      lineColor: BLACK,
    },

    alternateRowStyles: { fillColor: BGALT },

    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 28 },
      2: { cellWidth: 28 },
      3: { cellWidth: 28 },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 24, halign: 'center' },
      6: { cellWidth: 'auto', halign: 'right' },
    },

    didParseCell(data) {
      const raw = data.cell.raw
      if (raw && typeof raw === 'object' && '_equip' in raw) {
        data.cell.styles.fillColor = BG
        data.cell.styles.fontSize = 6.5
        data.cell.styles.textColor = DGRAY
        data.cell.styles.cellPadding = { top: 0.8, bottom: 1, left: 10, right: 2.5 }
        data.cell.styles.lineColor = [235, 235, 235]
        data.cell.styles.lineWidth = 0.06
      }
    },

    didDrawPage: pageFooter,
  })

  /* ══════════════════════════════════════════════
     PROOF OF DISPATCH APPENDIX
     ══════════════════════════════════════════════ */
  for (const trip of proofAppendix) {
    for (const shot of trip.screenshots) {
      doc.addPage()
      pageFooter()

      doc.setFillColor(...BLACK)
      doc.rect(0, 0, W, 20, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...WHITE)
      doc.text('Proof of Dispatch', MX, 9)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...LGRAY)
      doc.text(`${ascii(trip.originId)} -> ${ascii(trip.destId)}    ${ascii(trip.dispatchDate)}    Leg ${ascii(trip.legLabel)}`, MX, 15)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...DARK)
      doc.text(ascii(shot.label), MX, 26)

      try {
        const imgData = `data:image/jpeg;base64,${shot.jpeg}`
        const imgW = IW
        const maxImgH = H - 36 - MB
        doc.addImage(imgData, 'JPEG', MX, 30, imgW, maxImgH, undefined, 'FAST')
      } catch {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8)
        doc.setTextColor(...MGRAY)
        doc.text('Screenshot could not be rendered.', MX, 36)
      }
    }
  }

  /* ── Page numbers ── */
  const pages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...MGRAY)
    doc.text(`Page ${i} of ${pages}`, W / 2, H - MB + 5.5, { align: 'center' })
  }

  doc.save(`week-totals-${slug(opts.weekRangeLabel.replace(/\s+/g, '-'))}.pdf`)
}
