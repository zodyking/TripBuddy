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
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
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
 * @param {number} n
 */
function formatMi(n) {
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

/**
 * @param {WeekTotalsPdfOpts} opts
 */
export function downloadHistoryWeekTotalsPdf(opts) {
  const docTitle = asciiPdfText(
    opts.documentTitle?.trim() || 'Weekly Billable Mileage Report',
  )

  const generatedAt =
    typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
      ? new Date(opts.generatedAtMs)
      : new Date()

  const doc = new jsPDF({
    unit: 'mm',
    format: 'letter',
    orientation: 'portrait',
    compress: true,
  })

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  const marginX = 9
  const marginTop = 8
  const marginBottom = 10
  const innerW = pageW - marginX * 2

  const colors = {
    ink: [15, 23, 42],
    muted: [71, 85, 105],
    faint: [100, 116, 139],
    line: [203, 213, 225],
    softLine: [226, 232, 240],
    header: [30, 41, 59],
    soft: [248, 250, 252],
    softer: [252, 252, 254],
    band: [241, 245, 249],
    dayBand: [226, 232, 240],
    white: [255, 255, 255],
  }

  const generatedLabel = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const allTripRows = opts.days.reduce((sum, day) => sum + day.rows.length, 0)

  function drawPageFrame() {
    doc.setDrawColor(...colors.softLine)
    doc.setLineWidth(0.15)
    doc.line(marginX, pageH - 8, pageW - marginX, pageH - 8)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.4)
    doc.setTextColor(...colors.faint)

    doc.text(
      'Confidential | Driver reference only | Not an official FedEx document',
      marginX,
      pageH - 4.5,
    )
  }

  function drawHeader() {
    let y = marginTop

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...colors.ink)
    doc.text(docTitle, marginX, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...colors.muted)

    const subLine = [
      opts.calendarContext?.trim(),
      `Report Period: ${opts.weekRangeLabel}`,
      `Grouping: ${opts.groupingModeLabel}`,
      `Generated: ${generatedLabel}`,
    ]
      .filter(Boolean)
      .map(asciiPdfText)
      .join('   |   ')

    doc.text(doc.splitTextToSize(subLine, innerW), marginX, y + 8.5)

    y += 13

    doc.setDrawColor(...colors.header)
    doc.setLineWidth(0.45)
    doc.line(marginX, y, pageW - marginX, y)

    return y + 3
  }

  function drawInfoBoxes(startY) {
    const gap = 2
    const boxW = (innerW - gap * 2) / 3
    const boxH = 17

    const boxes = [
      {
        title: 'Driver',
        value: opts.driverBlock?.trim() || '-',
      },
      {
        title: 'Truck',
        value: opts.truckBlock?.trim() || '-',
      },
      {
        title: 'Summary',
        value: [
          `Trips: ${allTripRows}`,
          `Billable: ${formatMi(opts.sumBillable)} mi`,
          `Rounding: ${opts.roundingBandMin}-${opts.roundingBandMax} mi = ${opts.roundingToMi} mi`,
        ].join('\n'),
      },
    ]

    boxes.forEach((box, i) => {
      const x = marginX + i * (boxW + gap)

      doc.setFillColor(...colors.soft)
      doc.setDrawColor(...colors.line)
      doc.setLineWidth(0.15)
      doc.roundedRect(x, startY, boxW, boxH, 1.5, 1.5, 'FD')

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(5.8)
      doc.setTextColor(...colors.header)
      doc.text(asciiPdfText(box.title).toUpperCase(), x + 2, startY + 4)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(5.7)
      doc.setTextColor(...colors.ink)

      const lines = doc.splitTextToSize(asciiPdfText(box.value), boxW - 4)
      doc.text(lines.slice(0, 4), x + 2, startY + 7.3, {
        lineHeightFactor: 1.05,
      })
    })

    return startY + boxH + 3
  }

  function drawRuleNote(startY) {
    const rule = `Billable miles match on-screen History totals. Paid miles ${opts.roundingBandMin}-${opts.roundingBandMax} count as ${opts.roundingToMi} mi; missing paid mileage counts as 0. Unofficial estimate only.`

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.6)
    doc.setTextColor(...colors.muted)

    const lines = doc.splitTextToSize(asciiPdfText(rule), innerW)
    doc.text(lines, marginX, startY, { lineHeightFactor: 1.05 })

    return startY + lines.length * 2.4 + 2
  }

  let cursorY = drawHeader()
  cursorY = drawInfoBoxes(cursorY)
  cursorY = drawRuleNote(cursorY)

  /** @type {unknown[][]} */
  const tableBody = []

  const COL_COUNT = 9

  if (!opts.days.length) {
    tableBody.push([
      {
        content: 'No shift-day groups for this report.',
        colSpan: COL_COUNT,
        styles: {
          fontStyle: 'italic',
          textColor: colors.faint,
          fontSize: 5.8,
          halign: 'center',
        },
      },
    ])
  }

  for (const day of opts.days) {
    const dayLabel = asciiPdfText(day.dayLabel || 'Shift day')

    tableBody.push([
      {
        content: `${dayLabel.toUpperCase()}   |   DAY TOTAL: ${formatMi(day.sumBillable)} mi`,
        colSpan: COL_COUNT,
        styles: {
          fillColor: colors.dayBand,
          textColor: colors.header,
          fontStyle: 'bold',
          fontSize: 5.8,
          cellPadding: { top: 1.25, bottom: 1.25, left: 1.6, right: 1.6 },
        },
      },
    ])

    day.rows.forEach((r, index) => {
      const mi =
        typeof r.billableMi === 'number' && Number.isFinite(r.billableMi)
          ? `${formatMi(r.billableMi)}`
          : '-'

      const rounding = r.rounded
        ? `${opts.roundingBandMin}-${opts.roundingBandMax} -> ${opts.roundingToMi}`
        : ''

      const o = asciiPdfText(r.originId ?? '-')
      const dest = asciiPdfText(r.destId ?? '-')
      const wd = asciiPdfText(r.weekday ?? '-')
      const dt = asciiPdfText(r.dispatchDate ?? '-')
      const tm = asciiPdfText(r.dispatchTime ?? '-')
      const leg = asciiPdfText(r.legLabel ?? '-')

      tableBody.push([
        String(index + 1),
        o,
        dest,
        wd,
        dt,
        tm,
        leg,
        mi,
        rounding,
      ])

      const equip = typeof r.equipmentBlock === 'string' ? r.equipmentBlock.trim() : ''
      if (equip) {
        tableBody.push([
          {
            content: asciiPdfText(equip),
            colSpan: COL_COUNT,
            __pdfEquipment: true,
          },
        ])
      }
    })
  }

  autoTable(doc, {
    startY: cursorY,
    margin: {
      left: marginX,
      right: marginX,
      bottom: marginBottom,
    },

    head: [
      [
        '#',
        'Origin',
        'Destination',
        'Day',
        'Date',
        'Time',
        'Leg #',
        'Billable Mi',
        'Rounding',
      ],
    ],
    body: tableBody,

    foot: [
      [
        {
          content: 'WEEK TOTAL',
          colSpan: 7,
          styles: {
            fontStyle: 'bold',
            fillColor: colors.band,
            textColor: colors.ink,
            fontSize: 6,
          },
        },
        {
          content: `${formatMi(opts.sumBillable)} mi`,
          colSpan: 2,
          styles: {
            fontStyle: 'bold',
            halign: 'right',
            fillColor: colors.band,
            textColor: colors.ink,
            fontSize: 6,
          },
        },
      ],
    ],

    theme: 'grid',

    styles: {
      font: 'helvetica',
      fontSize: 5.2,
      minCellHeight: 3.5,
      cellPadding: {
        top: 0.85,
        bottom: 0.85,
        left: 1.35,
        right: 1.35,
      },
      overflow: 'linebreak',
      textColor: colors.ink,
      lineColor: colors.softLine,
      lineWidth: 0.08,
      valign: 'middle',
    },

    headStyles: {
      fillColor: colors.header,
      textColor: colors.white,
      fontStyle: 'bold',
      fontSize: 5.45,
      cellPadding: {
        top: 1.25,
        bottom: 1.25,
        left: 1.35,
        right: 1.35,
      },
      lineColor: colors.header,
      lineWidth: 0.08,
    },

    footStyles: {
      fillColor: colors.band,
      textColor: colors.ink,
      fontStyle: 'bold',
      lineColor: colors.line,
      lineWidth: 0.12,
    },

    alternateRowStyles: {
      fillColor: colors.softer,
    },

    columnStyles: {
      0: {
        cellWidth: 6,
        halign: 'center',
        textColor: colors.faint,
      },
      1: {
        cellWidth: 16,
        halign: 'center',
      },
      2: {
        cellWidth: 16,
        halign: 'center',
      },
      3: {
        cellWidth: 18,
      },
      4: {
        cellWidth: 22,
      },
      5: {
        cellWidth: 15,
        halign: 'center',
      },
      6: {
        cellWidth: 24,
        halign: 'center',
        fontSize: 5,
      },
      7: {
        cellWidth: 16,
        halign: 'right',
      },
      8: {
        cellWidth: 22,
        halign: 'center',
        textColor: colors.muted,
      },
    },

    didParseCell(data) {
      const raw = data.cell.raw
      if (
        raw &&
        typeof raw === 'object' &&
        '__pdfEquipment' in raw &&
        /** @type {{ __pdfEquipment?: boolean }} */ (raw).__pdfEquipment
      ) {
        data.cell.styles.fillColor = colors.soft
        data.cell.styles.font = 'courier'
        data.cell.styles.fontSize = 4.85
        data.cell.styles.textColor = colors.muted
        data.cell.styles.valign = 'top'
        data.cell.styles.cellPadding = {
          top: 0.4,
          bottom: 0.55,
          left: 2.8,
          right: 1.35,
        }
        data.cell.styles.lineColor = colors.softLine
        return
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'content' in raw &&
        String(/** @type {{ content?: unknown }} */ (raw).content ?? '').includes(
          'DAY TOTAL:',
        )
      ) {
        data.cell.styles.lineWidth = 0.08
      }
    },

    didDrawPage: drawPageFrame,
  })

  const totalPages = doc.internal.getNumberOfPages()

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.4)
    doc.setTextColor(...colors.faint)

    doc.text(`Page ${i} of ${totalPages}`, pageW - marginX, pageH - 4.5, {
      align: 'right',
    })
  }

  const slug = sanitizeFilenameSegment(opts.weekRangeLabel.replace(/\s+/g, '-'))
  doc.save(`week-totals-${slug}.pdf`)
}
