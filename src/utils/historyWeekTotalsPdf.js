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

/** PDF-safe text but keeps the route arrow (→) for origin/destination. */
function asciiRoute(s) {
  return String(s ?? '')
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
 * @param {{ originId?: string, destId?: string, routeOd?: string }} r
 * @returns {string}
 */
function routeDisplay(r) {
  const o = String(r.originId ?? '-').trim()
  const dest = String(r.destId ?? '-').trim()
  if (typeof r.routeOd === 'string' && r.routeOd.trim()) return r.routeOd.trim()
  return `${o} \u2192 ${dest}`
}

/**
 * @param {string | undefined} seq
 * @param {string} o
 * @param {string} dest
 * @param {string} dispatchDate
 * @param {string} leg
 */
function proofDedupeKey(seq, o, dest, dispatchDate, leg) {
  const s = String(seq ?? '').trim()
  if (s) return `seq:${s}`
  return `leg:${o}|${dest}|${dispatchDate}|${leg}`
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
 *     routeOd?: string,
 *     weekday: string,
 *     dispatchDate: string,
 *     dispatchTime: string,
 *     legLabel: string,
 *     tractorNumber: string,
 *     equipmentBlock?: string,
 *     dailyTripLegSequence?: string,
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

const BLACK = [0, 0, 0]
const DARK = [24, 24, 24]
const DGRAY = [55, 55, 55]
const MGRAY = [100, 100, 100]
const GRAY = [140, 140, 140]
const LGRAY = [200, 200, 200]
const RULE = [220, 220, 220]
const BG = [245, 245, 245]
const BGALT = [250, 250, 250]
const WHITE = [255, 255, 255]

const COLS = 8

/** @typedef {{ key: string, originId: string, destId: string, dispatchDate: string, dispatchTime: string, legLabel: string, tractorNumber: string, when: string, od: string, screenshots: { label: string, jpeg: string }[] }} ProofTripAppendix */

/**
 * @param {WeekTotalsPdfOpts} opts
 * @param {Map<string, string> | null} proofRangeByKey padded "007-012" inclusive page span in appendix (two pages per capture: title + image)
 * @returns {{ body: unknown[][], proofTrips: ProofTripAppendix[] }}
 */
function buildTableBody(opts, proofRangeByKey) {
  /** @type {unknown[][]} */
  const body = []
  /** @type {ProofTripAppendix[]} */
  const proofTrips = []
  /** @type {Set<string>} */
  const proofKeySeen = new Set()

  if (!opts.days.length) {
    body.push([
      {
        content: 'No trips for this period.',
        colSpan: COLS,
        styles: { fontStyle: 'italic', textColor: MGRAY, halign: 'center' },
      },
    ])
    return { body, proofTrips }
  }

  for (const day of opts.days) {
    body.push([
      {
        content: `${ascii(day.dayLabel || 'Day').toUpperCase()}  ·  DAY TOTAL: ${fmtMi(day.sumBillable)} mi`,
        colSpan: COLS,
        styles: {
          fillColor: BLACK,
          textColor: WHITE,
          fontStyle: 'bold',
          fontSize: 7,
          cellPadding: { top: 1.2, bottom: 1.2, left: 2.5, right: 2.5 },
        },
      },
    ])

    day.rows.forEach((r, i) => {
      const hasProof = Array.isArray(r.proofScreenshots) && r.proofScreenshots.length > 0
      const o = String(r.originId ?? '-').trim()
      const dest = String(r.destId ?? '-').trim()
      const leg = String(r.legLabel ?? '-').trim()
      const dispatchDate = String(r.dispatchDate ?? '-').trim()
      const pk = proofDedupeKey(r.dailyTripLegSequence, o, dest, dispatchDate, leg)

      if (hasProof && !proofKeySeen.has(pk)) {
        proofKeySeen.add(pk)
        proofTrips.push({
          key: pk,
          originId: o || '-',
          destId: dest || '-',
          dispatchDate: dispatchDate || '-',
          dispatchTime: String(r.dispatchTime ?? '-').trim() || '-',
          legLabel: leg || '-',
          tractorNumber: String(r.tractorNumber ?? '-').trim() || '-',
          when: String(r.when ?? '-').trim() || '-',
          od: String(r.od ?? '-').trim() || '-',
          screenshots: r.proofScreenshots.map((s) => ({ label: s.label, jpeg: s.jpeg })),
        })
      }

      body.push([
        { content: String(i + 1), styles: { halign: 'center', textColor: MGRAY } },
        { content: asciiRoute(routeDisplay(r)), styles: { fontStyle: 'bold' } },
        ascii(r.weekday || '-'),
        ascii(r.dispatchDate || '-'),
        ascii(r.dispatchTime || '-'),
        { content: ascii(r.legLabel || '-'), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: ascii(r.tractorNumber || '-'), styles: { halign: 'center' } },
        { content: fmtMi(r.billableMi), styles: { fontStyle: 'bold', halign: 'right' } },
      ])

      const eq = typeof r.equipmentBlock === 'string' ? r.equipmentBlock.trim() : ''
      const eqLine = eq ? ascii(eq) : ''
      let proofLine = ''
      if (hasProof) {
        const span = proofRangeByKey?.get(pk) ?? '000-000'
        proofLine = `Proof pages ${span}`
      }
      const subContent = [eqLine, proofLine].filter(Boolean).join('\n')
      if (subContent) {
        body.push([
          {
            content: '',
            _equipSpacer: true,
          },
          {
            content: subContent,
            colSpan: 7,
            _equip: true,
          },
        ])
      }
    })
  }

  return { body, proofTrips }
}

/**
 * @param {ReturnType<typeof buildTableBody>['proofTrips']} proofTrips
 * @param {number} appendixStartPage 1-based page index of first appendix page
 * @returns {Map<string, string>} key -> "000-012"
 */
function computeProofPageRanges(proofTrips, appendixStartPage) {
  /** @type {Map<string, string>} */
  const map = new Map()
  let p = appendixStartPage
  for (const trip of proofTrips) {
    const blockStart = p
    p += trip.screenshots.length * 2
    const blockEnd = p - 1
    map.set(
      trip.key,
      `${String(blockStart).padStart(3, '0')}-${String(blockEnd).padStart(3, '0')}`,
    )
  }
  return map
}

/** @param {WeekTotalsPdfOpts} opts */
export function downloadHistoryWeekTotalsPdf(opts) {
  const title = ascii(opts.documentTitle?.trim() || 'Weekly Mileage Report')
  const genAt =
    typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
      ? new Date(opts.generatedAtMs)
      : new Date()
  const genLabel = genAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  const MX = 10
  const MB = 10

  /**
   * @param {import('jspdf').jsPDF} doc
   * @param {unknown[][]} body
   * @param {{ startY: number }} cfg
   */
  function runAutoTable(doc, body, cfg) {
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const IW = W - MX * 2

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

    autoTable(doc, {
      startY: cfg.startY,
      tableWidth: IW,
      margin: { left: MX, right: MX, bottom: MB },

      head: [['#', 'Route', 'Day', 'Date', 'Time', 'Leg #', 'Tractor', 'Miles']],
      body,
      foot: [
        [
          {
            content: 'WEEK TOTAL',
            colSpan: 7,
            styles: {
              fontStyle: 'bold',
              fillColor: BLACK,
              textColor: WHITE,
              fontSize: 7.5,
            },
          },
          {
            content: `${fmtMi(opts.sumBillable)} mi`,
            styles: {
              fontStyle: 'bold',
              halign: 'right',
              fillColor: BLACK,
              textColor: WHITE,
              fontSize: 7.5,
            },
          },
        ],
      ],

      theme: 'grid',

      styles: {
        font: 'helvetica',
        fontSize: 7,
        minCellHeight: 4,
        cellPadding: { top: 0.55, bottom: 0.55, left: 1.2, right: 1.2 },
        overflow: 'linebreak',
        textColor: DARK,
        lineColor: RULE,
        lineWidth: 0.08,
        valign: 'middle',
      },

      headStyles: {
        fillColor: DGRAY,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 6.5,
        cellPadding: { top: 1.2, bottom: 1.2, left: 1.2, right: 1.2 },
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
        0: { cellWidth: 6, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 13 },
        3: { cellWidth: 17 },
        4: { cellWidth: 13, halign: 'center' },
        5: { cellWidth: 11, halign: 'center', overflow: 'ellipsize' },
        6: { cellWidth: 15, halign: 'center' },
        7: { cellWidth: 11, halign: 'right' },
      },

      didParseCell(data) {
        const raw = data.cell.raw
        if (raw && typeof raw === 'object' && '_equipSpacer' in raw) {
          data.cell.styles.fillColor = BG
          data.cell.styles.textColor = BG
          data.cell.styles.fontSize = 6.2
          data.cell.styles.cellPadding = { top: 0.35, bottom: 0.35, left: 1.2, right: 0 }
          data.cell.styles.lineColor = [235, 235, 235]
          data.cell.styles.lineWidth = 0.05
          data.cell.styles.minCellHeight = 3.2
        }
        if (raw && typeof raw === 'object' && '_equip' in raw) {
          data.cell.styles.fillColor = BG
          data.cell.styles.fontSize = 6.2
          data.cell.styles.textColor = DGRAY
          data.cell.styles.halign = 'left'
          data.cell.styles.cellPadding = { top: 0.35, bottom: 0.35, left: 0.5, right: 1.2 }
          data.cell.styles.lineColor = [235, 235, 235]
          data.cell.styles.lineWidth = 0.05
          data.cell.styles.minCellHeight = 3.2
          data.cell.styles.overflow = 'linebreak'
        }
      },

      didDrawPage: pageFooter,
    })
  }

  /**
   * @param {import('jspdf').jsPDF} doc
   * @param {unknown[][]} body
   */
  function drawMain(doc, body) {
    const W = doc.internal.pageSize.getWidth()
    const IW = W - MX * 2

    doc.setFillColor(...BLACK)
    doc.rect(0, 0, W, 28, 'F')

    let y = 12
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...WHITE)
    doc.text(title, MX, y)

    y += 6.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...LGRAY)
    doc.text(ascii(opts.weekRangeLabel), MX, y)

    const metaParts = [opts.calendarContext?.trim(), `Grouping: ${opts.groupingModeLabel}`]
      .filter(Boolean)
      .map(ascii)
      .join('   ·   ')
    if (metaParts) {
      doc.setFontSize(6.2)
      doc.setTextColor(...GRAY)
      doc.text(metaParts, W - MX, y, { align: 'right' })
    }

    y = 33

    const boxGap = 4
    const boxW = (IW - boxGap) / 2

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    const driverBody = opts.driverBlock?.trim() || '-'
    const truckBody = opts.truckBlock?.trim() || '-'
    const linesDriver = doc.splitTextToSize(ascii(driverBody), boxW - 7)
    const linesTruck = doc.splitTextToSize(ascii(truckBody), boxW - 7)
    const maxBodyLines = Math.max(linesDriver.length, linesTruck.length, 1)
    const lineStepMm = 7 * 0.352778 * 1.35
    const boxH = Math.max(22, 9 + maxBodyLines * lineStepMm + 2.5)

    /** @param {number} bx @param {number} by @param {string} label @param {string[]} lines */
    function infoBlock(bx, by, label, lines) {
      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.15)
      doc.setFillColor(...BG)
      doc.roundedRect(bx, by, boxW, boxH, 1.5, 1.5, 'FD')

      doc.setDrawColor(...BLACK)
      doc.setLineWidth(0.45)
      doc.line(bx, by, bx + boxW, by)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...BLACK)
      doc.text(label.toUpperCase(), bx + 3.5, by + 4.8)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...DGRAY)
      doc.text(lines, bx + 3.5, by + 9, { lineHeightFactor: 1.35 })
    }

    infoBlock(MX, y, 'Driver', linesDriver)
    infoBlock(MX + boxW + boxGap, y, 'Truck', linesTruck)
    y += boxH + 3

    runAutoTable(doc, body, { startY: y })
  }

  /**
   * @param {import('jspdf').jsPDF} doc
   * @param {ProofTripAppendix[]} proofTrips
   */
  function drawAppendix(doc, proofTrips) {
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const IW = W - MX * 2

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

    /** @param {number} y0 @param {ProofTripAppendix} trip @param {string} captureTitle */
    function drawTripTitleBlock(y0, trip, captureTitle) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(...BLACK)
      doc.text('Dispatch proof', MX, y0)
      let yl = y0 + 5.5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...DGRAY)
      doc.text(ascii(captureTitle), MX, yl)
      yl += 7

      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.2)
      doc.line(MX, yl, W - MX, yl)
      yl += 5

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...MGRAY)
      const labels = ['Route', 'Dispatch date', 'Dispatch time', 'Leg', 'Tractor', 'OD line', 'Scheduled / notes']
      const vals = [
        `${asciiRoute(trip.originId)} \u2192 ${asciiRoute(trip.destId)}`,
        ascii(trip.dispatchDate),
        ascii(trip.dispatchTime),
        ascii(trip.legLabel),
        ascii(trip.tractorNumber),
        ascii(trip.od),
        ascii(trip.when),
      ]
      const lh = 5.2
      for (let i = 0; i < labels.length; i++) {
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...MGRAY)
        doc.text(`${labels[i]}:`, MX, yl)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...DARK)
        const lines = doc.splitTextToSize(vals[i] || '-', IW - 34)
        doc.text(lines, MX + 32, yl)
        yl += Math.max(lh, lines.length * lh * 0.85)
      }
    }

    for (const trip of proofTrips) {
      for (const shot of trip.screenshots) {
        doc.addPage()
        pageFooter()
        drawTripTitleBlock(MX + 6, trip, shot.label)

        doc.addPage()
        pageFooter()

        let yp = MX + 5
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...DARK)
        doc.text(ascii(shot.label), MX, yp)
        yp += 4

        try {
          const imgData = `data:image/jpeg;base64,${shot.jpeg}`
          const imgW = IW
          const maxImgH = H - yp - MB - 2
          doc.addImage(imgData, 'JPEG', MX, yp, imgW, maxImgH, undefined, 'FAST')
        } catch {
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(8)
          doc.setTextColor(...MGRAY)
          doc.text('Screenshot could not be rendered.', MX, yp + 4)
        }
      }
    }
  }

  function stampPageNumbers(doc) {
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const pages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...MGRAY)
      doc.text(`Page ${i} of ${pages}`, W / 2, H - MB + 5.5, { align: 'center' })
    }
  }

  const { body: measureBody, proofTrips } = buildTableBody(opts, null)
  const measureDoc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  drawMain(measureDoc, measureBody)

  const appendixStartPage = measureDoc.internal.getNumberOfPages() + 1
  const proofRangeByKey = computeProofPageRanges(proofTrips, appendixStartPage)
  const { body: finalBody } = buildTableBody(opts, proofRangeByKey)

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  drawMain(doc, finalBody)
  if (proofTrips.length) drawAppendix(doc, proofTrips)
  stampPageNumbers(doc)

  doc.save(`week-totals-${slug(opts.weekRangeLabel.replace(/\s+/g, '-'))}.pdf`)
}
