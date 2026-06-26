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
 * @param {string | undefined} seq
 * @param {string} o
 * @param {string} dest
 * @param {string} dispatchDate
 * @param {string} leg
 */
export function proofDedupeKey(seq, o, dest, dispatchDate, leg) {
  const s = String(seq ?? '').trim()
  if (s) return `seq:${s}`
  return `leg:${o}|${dest}|${dispatchDate}|${leg}`
}

/**
 * Screenshot labels used only for automation context (omit from dispatch proof title line).
 * @param {string} label
 */
function isDispatchProofTitleNoiseLabel(label) {
  const s = String(label ?? '').trim().toLowerCase()
  if (!s) return false
  return /\b(dolly|inspect|inspection|checklist|validated|validation)\b/i.test(s)
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
 *     originLocationName?: string,
 *     destLocationName?: string,
 *     routeOd?: string,
 *     weekday: string,
 *     dispatchDate: string,
 *     dispatchTime: string,
 *     legLabel: string,
 *     tractorNumber: string,
 *     equipmentBlock?: string,
 *     outcomeReasonRight?: string,
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
 *   tripFormPdfByProofKey?: Map<string, ArrayBuffer | Uint8Array>,
 *   tripFormPageCountByProofKey?: Map<string, number>,
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

/**
 * Draw origin → dest inside table cell (Helvetica often omits Unicode → in embedded fonts).
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number, width: number, height: number }} cell
 * @param {{ origin: string, dest: string, routeOd?: string, originName?: string, destName?: string }} parts
 */
function drawRouteCellWithArrow(doc, cell, parts) {
  const padL = 1.2
  const padR = 1.2
  const padT = 0.55
  const x = cell.x + padL
  const yTop = cell.y + padT
  const innerW = cell.width - padL - padR
  const innerH = cell.height - padT - 0.55
  const midY = yTop + innerH / 2
  const fs = 7
  const cellRight = cell.x + cell.width - padR

  const nameO = String(parts.originName ?? '').trim()
  const nameD = String(parts.destName ?? '').trim()
  const hasNames = Boolean(nameO || nameD)

  /**
   * @param {number} xAfterIds right edge of printed id/dest segment
   * @param {number} [secondLineY]
   */
  function drawNameParenthetical(xAfterIds, secondLineY) {
    if (!hasNames) return
    const na = ascii(nameO || '—')
    const nb = ascii(nameD || '—')
    const suf = ` (${na} -> ${nb})`
    const nfs = 5.75
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(nfs)
    doc.setTextColor(...DGRAY)
    const rem = cellRight - xAfterIds - 0.5
    if (secondLineY != null || rem < 8) {
      const lines = doc.splitTextToSize(suf, innerW)
      const y0 = secondLineY ?? midY + fs * 0.72
      doc.text(lines, x, y0)
    } else {
      const sufW = doc.getTextDimensions(suf, { fontSize: nfs }).w
      if (sufW <= rem) doc.text(suf, xAfterIds + 0.35, midY, { baseline: 'middle' })
      else {
        const lines = doc.splitTextToSize(suf, innerW)
        doc.text(lines, x, midY + fs * 0.72)
      }
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fs)
    doc.setTextColor(...DARK)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fs)
  doc.setTextColor(...DARK)

  const routeOd = typeof parts.routeOd === 'string' ? parts.routeOd.trim() : ''
  if (routeOd) {
    const line = asciiRoute(routeOd)
    const arrowSplit = line.split(/\s*(?:\u2192|->)\s*/)
    if (arrowSplit.length === 2) {
      const o = arrowSplit[0].trim() || '-'
      const d = arrowSplit[1].trim() || '-'
      const gap = 0.9
      const arrowStem = 2.2
      const arrowHead = 0.9
      const wO = doc.getTextDimensions(o, { fontSize: fs }).w
      const wD = doc.getTextDimensions(d, { fontSize: fs }).w
      const need = wO + gap + arrowStem + arrowHead + gap + wD
      if (need <= innerW) {
        doc.text(o, x, midY, { baseline: 'middle' })
        const ax = x + wO + gap
        doc.setDrawColor(...DARK)
        doc.setLineWidth(0.22)
        doc.line(ax, midY, ax + arrowStem, midY)
        doc.line(ax + arrowStem, midY, ax + arrowStem - arrowHead * 0.55, midY - arrowHead * 0.45)
        doc.line(ax + arrowStem, midY, ax + arrowStem - arrowHead * 0.55, midY + arrowHead * 0.45)
        doc.text(d, ax + arrowStem + gap, midY, { baseline: 'middle' })
        drawNameParenthetical(ax + arrowStem + gap + wD)
        return
      }
    }
    const lines = doc.splitTextToSize(line, innerW)
    doc.text(lines, x, yTop + innerH / 2 - ((lines.length - 1) * fs * 0.35), {
      baseline: 'middle',
      maxWidth: innerW,
    })
    if (hasNames) drawNameParenthetical(x + innerW, yTop + innerH - 2)
    return
  }

  const o = ascii(String(parts.origin ?? '-').trim() || '-')
  const d = ascii(String(parts.dest ?? '-').trim() || '-')
  const gap = 0.9
  const arrowStem = 2.2
  const arrowHead = 0.9

  const wO = doc.getTextDimensions(o, { fontSize: fs }).w
  const wD = doc.getTextDimensions(d, { fontSize: fs }).w
  const need = wO + gap + arrowStem + arrowHead + gap + wD
  if (need <= innerW) {
    doc.text(o, x, midY, { baseline: 'middle' })
    const ax = x + wO + gap
    doc.setDrawColor(...DARK)
    doc.setLineWidth(0.22)
    doc.line(ax, midY, ax + arrowStem, midY)
    doc.line(ax + arrowStem, midY, ax + arrowStem - arrowHead * 0.55, midY - arrowHead * 0.45)
    doc.line(ax + arrowStem, midY, ax + arrowStem - arrowHead * 0.55, midY + arrowHead * 0.45)
    doc.text(d, ax + arrowStem + gap, midY, { baseline: 'middle' })
    drawNameParenthetical(ax + arrowStem + gap + wD)
  } else {
    const lines = doc.splitTextToSize(`${o} → ${d}`, innerW)
    doc.text(lines, x, yTop + innerH / 2 - ((lines.length - 1) * fs * 0.35), {
      baseline: 'middle',
      maxWidth: innerW,
    })
    if (hasNames) drawNameParenthetical(x + innerW, yTop + innerH - 2)
  }
}

const COLS = 10

/** Column labels repeated under each day section (matches mileage table headers). */
const MILEAGE_LEDGER_LABELS = [
  '#',
  'Route',
  'Day',
  'Date',
  'Assigned',
  'Dispatched',
  'Arrived',
  'Leg #',
  'Tractor',
  'Miles',
]

/**
 * @returns {unknown[]}
 */
function mileageLedgerHeaderBodyRow() {
  return MILEAGE_LEDGER_LABELS.map((label) => ({
    content: ascii(label),
    _ledgerHeader: true,
  }))
}

/** @typedef {{ key: string, originId: string, destId: string, dispatchDate: string, dispatchTime: string, legLabel: string, dailyTripLegSequence?: string, tractorNumber: string, when: string, od: string, tripFormPageCount: number, screenshots: { label: string, jpeg: string }[] }} ProofTripAppendix */

/**
 * @param {WeekTotalsPdfOpts} opts
 * @param {Map<string, string> | null} proofRangeByKey appendix page span "9-16" per trip (one title + N image pages)
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
        content: `${ascii(String(day.dayLabel || 'Day').trim())}  ·  Day total ${fmtMi(day.sumBillable)} mi`,
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
    body.push(mileageLedgerHeaderBodyRow())

    day.rows.forEach((r, i) => {
      const hasProof = Array.isArray(r.proofScreenshots) && r.proofScreenshots.length > 0
      const o = String(r.originId ?? '-').trim()
      const dest = String(r.destId ?? '-').trim()
      const leg = String(r.legLabel ?? '-').trim()
      const dispatchDate = String(r.dispatchDate ?? '-').trim()
      const pk = proofDedupeKey(r.dailyTripLegSequence, o, dest, dispatchDate, leg)

      if (hasProof && !proofKeySeen.has(pk)) {
        proofKeySeen.add(pk)
        const tripFormPageCount = opts.tripFormPageCountByProofKey?.get(pk) ?? 0
        proofTrips.push({
          key: pk,
          originId: o || '-',
          destId: dest || '-',
          dispatchDate: dispatchDate || '-',
          dispatchTime: String(r.dispatchTime ?? '-').trim() || '-',
          legLabel: leg || '-',
          dailyTripLegSequence: String(r.dailyTripLegSequence ?? '').trim(),
          tractorNumber: String(r.tractorNumber ?? '-').trim() || '-',
          when: String(r.when ?? '-').trim() || '-',
          od: String(r.od ?? '-').trim() || '-',
          tripFormPageCount,
          screenshots: r.proofScreenshots.map((s) => ({ label: s.label, jpeg: s.jpeg })),
        })
      }

      body.push([
        { content: String(i + 1), styles: { halign: 'center', textColor: MGRAY } },
        {
          content: '',
          styles: { fontStyle: 'bold' },
          _routeDraw: {
            origin: o,
            dest,
            routeOd: typeof r.routeOd === 'string' ? r.routeOd.trim() : '',
            originName: typeof r.originLocationName === 'string' ? r.originLocationName.trim() : '',
            destName: typeof r.destLocationName === 'string' ? r.destLocationName.trim() : '',
          },
        },
        ascii(r.weekday || '-'),
        ascii(r.dispatchDate || '-'),
        ascii(String(r.assignedTime ?? r.dispatchTime ?? '-').trim() || '-'),
        ascii(String(r.dispatchedTime ?? 'n/a').trim() || 'n/a'),
        ascii(String(r.arrivedTime ?? 'n/a').trim() || 'n/a'),
        { content: ascii(r.legLabel || '-'), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: ascii(r.tractorNumber || '-'), styles: { halign: 'center' } },
        { content: fmtMi(r.billableMi), styles: { fontStyle: 'bold', halign: 'right' } },
      ])

      const eq = typeof r.equipmentBlock === 'string' ? r.equipmentBlock.trim() : ''
      const eqLine = eq ? ascii(eq) : ''
      let proofLine = ''
      if (hasProof) {
        const span = proofRangeByKey?.get(pk) ?? '0-0'
        const [from, to] = span.split('-').map((s) => String(s ?? '').trim() || '0')
        proofLine = `Proof of Dispatch: pg${from} - pg${to}`
      }
      const reasonRaw =
        typeof r.outcomeReasonRight === 'string' ? r.outcomeReasonRight.trim() : ''
      const reasonLine = reasonRaw ? `Reason: ${ascii(reasonRaw)}` : ''
      const notesRaw =
        typeof r.pdfNotesRight === 'string' ? r.pdfNotesRight.trim() : ''
      const notesLine = notesRaw ? `Notes: ${ascii(notesRaw)}` : ''
      const rightBlock = [reasonLine, notesLine].filter(Boolean).join('\n')
      const leftBlock = [eqLine, proofLine].filter(Boolean).join('\n')
      if (leftBlock || rightBlock) {
        if (rightBlock) {
          body.push([
            {
              content: '',
              _equipSpacer: true,
            },
            {
              content: leftBlock,
              colSpan: 4,
              _equip: true,
            },
            {
              content: rightBlock,
              colSpan: 5,
              _equipReason: true,
            },
          ])
        } else {
          body.push([
            {
              content: '',
              _equipSpacer: true,
            },
            {
              content: leftBlock,
              colSpan: 9,
              _equip: true,
            },
          ])
        }
      }
    })
  }

  return { body, proofTrips }
}

/**
 * @param {ReturnType<typeof buildTableBody>['proofTrips']} proofTrips
 * @param {number} appendixStartPage 1-based page index of first appendix page
 * @returns {Map<string, string>} key -> "9-16" (unpadded inclusive appendix page range)
 */
function computeProofPageRanges(proofTrips, appendixStartPage) {
  /** @type {Map<string, string>} */
  const map = new Map()
  let p = appendixStartPage
  for (const trip of proofTrips) {
    const blockStart = p
    const tripPages = typeof trip.tripFormPageCount === 'number' ? trip.tripFormPageCount : 0
    p += 1 + tripPages + trip.screenshots.length
    const blockEnd = p - 1
    map.set(trip.key, `${blockStart}-${blockEnd}`)
  }
  return map
}

/**
 * 1-based page indices of full-black dispatch proof **section title** slides (one per trip leg block).
 * @param {number} appendixStartPage
 * @param {{ screenshots: { length: number }[] }[]} proofTrips
 */
function appendixDispatchDarkTitlePageSet(appendixStartPage, proofTrips) {
  /** @type {Set<number>} */
  const s = new Set()
  let p = appendixStartPage
  for (const trip of proofTrips) {
    s.add(p)
    const tripPages = typeof trip.tripFormPageCount === 'number' ? trip.tripFormPageCount : 0
    p += 1 + tripPages + trip.screenshots.length
  }
  return s
}

/**
 * Build the week mileage PDF (caller may `save` or `output('blob')`).
 * @param {WeekTotalsPdfOpts} opts
 * @returns {Promise<{ doc: import('jspdf').jsPDF, fileName: string }>}
 */
async function buildWeekTotalsJsPdf(opts) {
  const title = ascii(opts.documentTitle?.trim() || 'Weekly Mileage')
  const genAt =
    typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
      ? new Date(opts.generatedAtMs)
      : new Date()
  const genLabel = genAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  const MX = 10
  const MB = 12

  /**
   * Shared footer: week-totals table pages and proof pages (light or dark background).
   * @param {import('jspdf').jsPDF} doc
   * @param {'light' | 'dark'} surface
   */
  function paintPdfFooter(doc, surface) {
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const yLine = H - MB + 2
    const yPrimary = H - MB + 6.2
    const yDisc = H - MB + 9.2
    if (surface === 'dark') {
      doc.setDrawColor(72, 72, 72)
      doc.setLineWidth(0.15)
      doc.line(MX, yLine, W - MX, yLine)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...WHITE)
      doc.text('LBP LINES INC', MX, yPrimary)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(168, 168, 168)
      doc.text(
        'Confidential  ·  Driver reference only  ·  Not an official FedEx document',
        MX,
        yDisc,
      )
      doc.setTextColor(218, 218, 218)
      doc.text(genLabel, W - MX, yPrimary, { align: 'right' })
    } else {
      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.15)
      doc.line(MX, yLine, W - MX, yLine)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...DARK)
      doc.text('LBP LINES INC', MX, yPrimary)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.5)
      doc.setTextColor(...GRAY)
      doc.text(
        'Confidential  ·  Driver reference only  ·  Not an official FedEx document',
        MX,
        yDisc,
      )
      doc.text(genLabel, W - MX, yPrimary, { align: 'right' })
    }
  }

  /**
   * Black band letterhead for **mileage table pages only**: title, week range, driver, truck.
   * @param {import('jspdf').jsPDF} doc
   * @param {string} titleText
   * @returns {number} height (mm) of the letterhead block
   */
  function drawWeekTotalsLetterhead(doc, titleText) {
    const W = doc.internal.pageSize.getWidth()
    const IW = W - MX * 2
    const printedLine = ascii(`Printed ${genLabel}`)

    const driverBody = ascii((opts.driverBlock ?? '').trim().replace(/\s*\n\s*/g, '  ·  ') || '-')
    const truckBody = ascii((opts.truckBlock ?? '').trim().replace(/\s*\n\s*/g, '  ·  ') || '-')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    const driverLines = doc.splitTextToSize(`Driver  ${driverBody}`, IW)
    const truckLines = doc.splitTextToSize(`Tractor  ${truckBody}`, IW)
    const dShow = driverLines.slice(0, 2)
    const tShow = truckLines.slice(0, 2)
    const lineGap = 3.55

    const titleY = 11
    const weekY = titleY + 5.4
    const blockY0 = weekY + 4.8
    const headerH = Math.max(32, blockY0 + dShow.length * lineGap + tShow.length * lineGap + 4)

    doc.setFillColor(...BLACK)
    doc.rect(0, 0, W, headerH, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...WHITE)
    doc.text(titleText, MX, titleY)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...LGRAY)
    doc.text(ascii(opts.weekRangeLabel), MX, weekY)
    doc.setFontSize(6.2)
    doc.setTextColor(...GRAY)
    doc.text(printedLine, W - MX, weekY, { align: 'right' })

    let y = blockY0
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.4)
    doc.setTextColor(...WHITE)
    for (const ln of dShow) {
      doc.text(ln, MX, y)
      y += lineGap
    }
    doc.setTextColor(...LGRAY)
    for (const ln of tShow) {
      doc.text(ln, MX, y)
      y += lineGap
    }

    return headerH
  }

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
      paintPdfFooter(doc, 'light')
    }

    autoTable(doc, {
      startY: cfg.startY,
      tableWidth: IW,
      margin: { left: MX, right: MX, bottom: MB },
      showFoot: 'lastPage',
      showHead: 'never',
      head: [],
      body,
      foot: [
        [
          {
            content: 'WEEK TOTAL',
            colSpan: 9,
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
        fontSize: 7,
        cellPadding: { top: 1, bottom: 1, left: 0.85, right: 0.85 },
        lineColor: DGRAY,
      },

      footStyles: {
        fillColor: BLACK,
        textColor: WHITE,
        fontStyle: 'bold',
        lineColor: BLACK,
        minCellHeight: 5.5,
        valign: 'middle',
        overflow: 'visible',
      },

      alternateRowStyles: { fillColor: BGALT },

      columnStyles: {
        0: { cellWidth: 5.5, halign: 'center', overflow: 'visible' },
        1: { cellWidth: 'auto', halign: 'left', overflow: 'linebreak' },
        2: { cellWidth: 15, halign: 'center', overflow: 'visible' },
        3: { cellWidth: 14, halign: 'center', overflow: 'visible' },
        4: { cellWidth: 17, halign: 'center', overflow: 'visible' },
        5: { cellWidth: 18, halign: 'center', overflow: 'visible' },
        6: { cellWidth: 17, halign: 'center', overflow: 'visible' },
        7: { cellWidth: 14, halign: 'center', overflow: 'visible' },
        8: { cellWidth: 11.5, halign: 'center', overflow: 'visible' },
        9: { cellWidth: 10.5, halign: 'right', overflow: 'visible' },
      },

      willDrawCell(data) {
        const raw = data.cell.raw
        if (raw && typeof raw === 'object' && '_routeDraw' in raw) {
          data.cell.text = ['']
        }
      },

      didDrawCell(data) {
        const raw = data.cell.raw
        if (raw && typeof raw === 'object' && '_routeDraw' in raw && data.section === 'body') {
          const p = raw._routeDraw
          if (p && typeof p === 'object') drawRouteCellWithArrow(doc, data.cell, p)
        }
      },

      didParseCell(data) {
        const colIdx =
          data.column && typeof data.column.index === 'number'
            ? data.column.index
            : typeof data.column === 'number'
              ? data.column
              : -1
        const raw = data.cell.raw
        if (raw && typeof raw === 'object' && '_ledgerHeader' in raw) {
          data.cell.styles.fillColor = DGRAY
          data.cell.styles.textColor = WHITE
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fontSize = 7
          data.cell.styles.valign = 'middle'
          data.cell.styles.overflow = 'visible'
          data.cell.styles.lineColor = DGRAY
          data.cell.styles.cellPadding = { top: 1, bottom: 1, left: 0.85, right: 0.85 }
          data.cell.styles.halign =
            colIdx === 1 ? 'left' : colIdx === 9 ? 'right' : 'center'
        } else if (
          data.section === 'body' &&
          colIdx >= 2 &&
          colIdx <= 9
        ) {
          data.cell.styles.overflow = 'visible'
          if (colIdx >= 4 && colIdx <= 6) {
            data.cell.styles.cellPadding = { top: 0.5, bottom: 0.5, left: 0.55, right: 0.55 }
          }
        }
        if (raw && typeof raw === 'object' && '_routeDraw' in raw) {
          const rd = raw._routeDraw
          if (
            rd &&
            typeof rd === 'object' &&
            (String(rd.originName ?? '').trim() || String(rd.destName ?? '').trim())
          ) {
            data.cell.styles.minCellHeight = Math.max(7.2, data.cell.styles.minCellHeight ?? 0)
          } else {
            data.cell.styles.minCellHeight = 4.8
          }
        }
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
        if (raw && typeof raw === 'object' && '_equipReason' in raw) {
          data.cell.styles.fillColor = BG
          data.cell.styles.fontSize = 6.2
          data.cell.styles.textColor = DGRAY
          data.cell.styles.halign = 'left'
          data.cell.styles.valign = 'top'
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
    const headerH = drawWeekTotalsLetterhead(doc, title)
    runAutoTable(doc, body, { startY: headerH + 4 })
  }

  /**
   * @param {import('jspdf').jsPDF} doc
   * @param {ProofTripAppendix[]} proofTrips
   */
  async function drawAppendix(doc, proofTrips) {
    const { renderPdfPageToJpegDataUrl } = await import('./renderPdfPageToJpegDataUrl.js')
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const IW = W - MX * 2
    const contentTop = MX + 4

    /** One full-bleed black slide per trip leg: title + single wrapped detail line (no duplicate leg/date/OD). */
    function drawDispatchProofTitlePage(trip) {
      doc.setFillColor(...BLACK)
      doc.rect(0, 0, W, H, 'F')
      const cx = W / 2
      const maxW = IW * 0.92
      const n = trip.screenshots.length

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(22)
      doc.setTextColor(...WHITE)
      const titleY = H * 0.32
      doc.text('DISPATCH PROOF', cx, titleY, { align: 'center', maxWidth: maxW })

      const firstLabel = String(trip.screenshots[0]?.label ?? '').trim()
      const leg = `Leg #${ascii(trip.legLabel)}`
      const dispatch = `${ascii(trip.dispatchDate)} ${ascii(trip.dispatchTime)}`.replace(/\s+/g, ' ').trim()
      const route = `${asciiRoute(trip.originId)} -> ${asciiRoute(trip.destId)}`
      const tractor = `Tractor ${ascii(trip.tractorNumber)}`
      const images = `${n} attached image${n === 1 ? '' : 's'}`

      /** @type {string[]} */
      const segs = []
      if (firstLabel && !isDispatchProofTitleNoiseLabel(firstLabel)) segs.push(ascii(firstLabel))
      segs.push(leg, dispatch, route, tractor, images)
      const detailLine = segs.join(' · ')

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...LGRAY)
      const lines = doc.splitTextToSize(detailLine, maxW)
      doc.text(lines, cx, titleY + 11, { align: 'center', maxWidth: maxW })
    }

    for (const trip of proofTrips) {
      doc.addPage()
      drawDispatchProofTitlePage(trip)
      paintPdfFooter(doc, 'dark')

      const pdfBytes = opts.tripFormPdfByProofKey?.get(trip.key)
      const nTripPages =
        pdfBytes && typeof trip.tripFormPageCount === 'number' && trip.tripFormPageCount > 0
          ? trip.tripFormPageCount
          : 0
      if (nTripPages > 0 && pdfBytes) {
        const maxW = IW
        const maxH = H - contentTop - MB - 2
        for (let pi = 1; pi <= nTripPages; pi++) {
          doc.addPage()
          paintPdfFooter(doc, 'light')
          try {
            const { dataUrl, widthMm, heightMm } = await renderPdfPageToJpegDataUrl(pdfBytes, pi, {
              maxWidthMm: maxW,
              maxHeightMm: maxH,
            })
            const x = MX + Math.max(0, (maxW - widthMm) / 2)
            const y = contentTop + Math.max(0, (maxH - heightMm) / 2)
            doc.addImage(dataUrl, 'JPEG', x, y, widthMm, heightMm, undefined, 'FAST')
          } catch (e) {
            console.warn('[weekTotalsPdf] trip form page render failed', { page: pi, err: e })
            doc.setFont('helvetica', 'italic')
            doc.setFontSize(8)
            doc.setTextColor(...MGRAY)
            doc.text('Trip form PDF page could not be rendered.', MX, contentTop + 4)
          }
        }
      }

      const nShots = trip.screenshots.length
      for (let si = 0; si < nShots; si++) {
        const shot = trip.screenshots[si]
        doc.addPage()
        paintPdfFooter(doc, 'light')

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        const legTxt = `Leg #${ascii(trip.legLabel)}`
        const dateTxt = ascii(trip.dispatchDate)
        const idxTxt = `Proof image ${si + 1}/${nShots}`
        const headerLine = `${legTxt} · ${dateTxt} · ${idxTxt}`
        const headerLines = doc.splitTextToSize(headerLine, IW)
        const bandH = Math.min(20, Math.max(9, 5 + headerLines.length * 3.5))
        doc.setFillColor(...BLACK)
        doc.rect(0, 0, W, bandH, 'F')
        doc.setTextColor(...WHITE)
        doc.text(headerLines, MX, 6.2)

        const yp = bandH + 2
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

  /**
   * @param {import('jspdf').jsPDF} doc
   * @param {Set<number> | null} appendixDarkTitlePages 1-based page numbers with full-black dispatch section title
   */
  function stampPageNumbers(doc, appendixDarkTitlePages) {
    const W = doc.internal.pageSize.getWidth()
    const H = doc.internal.pageSize.getHeight()
    const pages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      const darkTitle = appendixDarkTitlePages != null && appendixDarkTitlePages.has(i)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...(darkTitle ? LGRAY : MGRAY))
      doc.text(`Page ${i} of ${pages}`, W / 2, H - MB + 9.5, { align: 'center' })
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
  if (proofTrips.length) await drawAppendix(doc, proofTrips)
  const appendixDarkTitles =
    proofTrips.length > 0 ? appendixDispatchDarkTitlePageSet(appendixStartPage, proofTrips) : null
  stampPageNumbers(doc, appendixDarkTitles)

  const fileName = `week-totals-${slug(opts.weekRangeLabel.replace(/\s+/g, '-'))}.pdf`
  return { doc, fileName }
}

/** @param {WeekTotalsPdfOpts} opts */
export async function downloadHistoryWeekTotalsPdf(opts) {
  const { doc, fileName } = await buildWeekTotalsJsPdf(opts)
  doc.save(fileName)
}

/**
 * @param {WeekTotalsPdfOpts} opts
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function getHistoryWeekTotalsPdfBlob(opts) {
  const { doc, fileName } = await buildWeekTotalsJsPdf(opts)
  return { blob: doc.output('blob'), filename: fileName }
}

/**
 * Node/server: PDF as Buffer for email attachments.
 * @param {WeekTotalsPdfOpts} opts
 */
export async function getHistoryWeekTotalsPdfBuffer(opts) {
  const { doc, fileName } = await buildWeekTotalsJsPdf(opts)
  return { buffer: Buffer.from(doc.output('arraybuffer')), filename: fileName }
}
