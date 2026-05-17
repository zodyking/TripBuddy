import { jsPDF } from 'jspdf'
import { buildEnhancedTrailerCards } from './tripDetailsDisplay.js'
import { normalizeDirectoryLocationId } from './directoryLocationLookup.js'

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

const BLACK = [0, 0, 0]
const GRAY = [90, 90, 90]

/**
 * @param {unknown} id
 */
function padLocationId(id) {
  const d = String(id ?? '')
    .replace(/\D/g, '')
    .trim()
  if (!d) return ''
  return d.length >= 5 ? d : d.padStart(5, '0')
}

/**
 * @param {unknown} loc
 */
function locAbbrFromDispatchLabel(loc) {
  const s = String(loc ?? '').trim()
  if (!s) return ''
  const parts = s.split(/\s*·\s*/)
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1].trim()
    if (tail && !/^\d+$/.test(tail)) return tail
  }
  return ''
}

/**
 * Rich directory row for trip form (phone + coordinates).
 * @param {unknown[]} locations
 * @returns {Map<string, { locationName: string, abbreviation: string, address: string, phone: string, lat: number | null, lng: number | null }>}
 */
export function buildDirectoryTripFormLookup(locations) {
  /** @type {Map<string, { locationName: string, abbreviation: string, address: string, phone: string, lat: number | null, lng: number | null }>} */
  const m = new Map()
  if (!Array.isArray(locations)) return m
  for (const loc of locations) {
    const id = normalizeDirectoryLocationId(loc?.locationId)
    if (!id) continue
    const latN = loc?.latitude != null ? Number(loc.latitude) : NaN
    const lngN = loc?.longitude != null ? Number(loc.longitude) : NaN
    m.set(id, {
      locationName: String(loc?.locationName ?? '').trim(),
      abbreviation: String(loc?.abbreviation ?? '').trim(),
      address: String(loc?.address ?? '').trim(),
      phone: String(loc?.phone ?? '').trim(),
      lat: Number.isFinite(latN) ? latN : null,
      lng: Number.isFinite(lngN) ? lngN : null,
    })
  }
  return m
}

/**
 * @param {Map<string, { locationName: string, abbreviation: string, address: string, phone: string, lat: number | null, lng: number | null }>} map
 * @param {unknown} locationId
 */
function dirGet(map, locationId) {
  const k = normalizeDirectoryLocationId(locationId)
  if (!k) return null
  return map.get(k) ?? null
}

/**
 * @param {Record<string, unknown>} td
 * @returns {Record<string, string>}
 */
function linehaulExtrasFromTripDetails(td) {
  const x = td.linehaulExtras
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(x)) {
    if (v == null || typeof v === 'object') continue
    const s = String(v).trim()
    if (s) out[k] = s
  }
  return out
}

/**
 * @param {Record<string, string>} extras
 * @param {Record<string, unknown>} td
 */
function pickEtaLine(extras, td) {
  const preferredKeys = [
    'etaOfTripLeg',
    'estimatedTripArrivalDateTime',
    'scheduledArrivalTime',
    'tripArrivalTime',
    'tripEta',
    'etaAtDest',
    'reportingTime',
    'estimatedArrival',
  ]
  for (const k of preferredKeys) {
    if (extras[k]) return extras[k]
  }
  for (const [k, v] of Object.entries(extras)) {
    if (/arriv|eta|sched|due|est.*time|trip.*time/i.test(k) && v.length < 140) return v
  }
  const mil = td.mileage && typeof td.mileage === 'object' && !Array.isArray(td.mileage)
    ? /** @type {Record<string, unknown>} */ (td.mileage)
    : null
  if (mil) {
    const cand = ['eta', 'estimatedArrival', 'scheduledArrival', 'tripArrival']
    for (const k of cand) {
      const v = mil[k]
      if (v != null && typeof v !== 'object') {
        const s = String(v).trim()
        if (s) return s
      }
    }
  }
  return ''
}

/**
 * @param {unknown} v
 */
function str(v) {
  if (v == null) return ''
  return String(v).trim()
}

/**
 * @typedef {{
 *   displayDate: number,
 *   dailyTripLegSequence?: string,
 *   dispatchHeader?: Record<string, unknown> | null,
 *   tripDetails?: Record<string, unknown> | null,
 *   source?: string,
 * }} TripFormLedgerEntry
 */

/**
 * @typedef {{
 *   entry: TripFormLedgerEntry,
 *   driverName: string,
 *   employeeNumber: string,
 *   directory: Map<string, { locationName: string, abbreviation: string, address: string, phone: string, lat: number | null, lng: number | null }>,
 *   originLocationId: string,
 *   destLocationId: string,
 *   generatedAtMs?: number,
 * }} TripFormPdfOpts
 */

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {string} text
 * @param {number} maxW
 */
function splitToWidth(doc, text, maxW) {
  const t = String(text || '').trim()
  if (!t) return []
  return doc.splitTextToSize(ascii(t), maxW).map((/** @type {string} */ s) => String(s).trim())
}

/**
 * @param {TripFormPdfOpts} opts
 * @returns {{ doc: import('jspdf').jsPDF, fileName: string }}
 */
function buildTripFormJsPdf(opts) {
  const genAt =
    typeof opts.generatedAtMs === 'number' && Number.isFinite(opts.generatedAtMs)
      ? new Date(opts.generatedAtMs)
      : new Date()
  const genLabel = genAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  const e = opts.entry
  const dh = e.dispatchHeader && typeof e.dispatchHeader === 'object' ? e.dispatchHeader : {}
  const td = e.tripDetails && typeof e.tripDetails === 'object' && !Array.isArray(e.tripDetails)
    ? /** @type {Record<string, unknown>} */ (e.tripDetails)
    : /** @type {Record<string, unknown>} */ ({})

  const extras = linehaulExtrasFromTripDetails(td)
  const tractor = ascii(str(td.tractorNumber) || '-')
  const destId = padLocationId(opts.destLocationId)
  const originId = padLocationId(opts.originLocationId)

  const destAbbr =
    extras.tripDestAbbrv ||
    locAbbrFromDispatchLabel(dh.destination) ||
    dirGet(opts.directory, opts.destLocationId)?.abbreviation ||
    ''
  const originAbbr =
    extras.currentLocationAbbrv ||
    locAbbrFromDispatchLabel(dh.origin) ||
    dirGet(opts.directory, opts.originLocationId)?.abbreviation ||
    ''

  const tripDestHeader =
    destId && destAbbr ? `${destId} / ${ascii(destAbbr)}` : destId || ascii(str(dh.destination)) || '—'

  const driverLine = ascii(
    (opts.driverName || '').trim() || 'Driver name not on file — open Home after sign-in',
  )

  const destDir = dirGet(opts.directory, opts.destLocationId)
  const originDir = dirGet(opts.directory, opts.originLocationId)

  const destNameLine =
    ascii(destDir?.locationName || str(dh.destination).replace(/^[\d\s]+·\s*/, '').trim() || '—')

  const paidMi =
    td.mileage && typeof td.mileage === 'object' && !Array.isArray(td.mileage)
      ? String(/** @type {Record<string, unknown>} */ (td.mileage).totalMiles ?? '').trim()
      : ''

  const etaBold = pickEtaLine(extras, td)
  const dispatchTs =
    typeof e.displayDate === 'number' && Number.isFinite(e.displayDate) && e.displayDate > 0
      ? e.displayDate
      : null
  const basedUponLine =
    dispatchTs != null
      ? ascii(
          `${new Date(dispatchTs).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })} departure (dispatch record)`,
        )
      : '—'

  const legSeq = str(e.dailyTripLegSequence)

  const cards = buildEnhancedTrailerCards(td)
  /** @type {{ order: string, trlr: string, seal: string, load: string, weight: string }[]} */
  const trailerSlots = []
  for (let i = 0; i < 3; i++) {
    const c = cards[i]
    if (c) {
      const sealRow = c.summaryRows.find((r) => r.label === 'Seal')
      const destRow = c.summaryRows.find((r) => r.label === 'Destination')
      const wtRow = c.summaryRows.find((r) => r.label === 'Weight')
      trailerSlots.push({
        order: String(c.order),
        trlr: ascii(str(c.trlrNbr)),
        seal: ascii(sealRow?.value && sealRow.value !== '—' ? String(sealRow.value) : ''),
        load: ascii(destRow?.value && destRow.value !== '—' ? String(destRow.value) : ''),
        weight: ascii(wtRow?.value && wtRow.value !== '—' ? String(wtRow.value) : ''),
      })
    } else {
      trailerSlots.push({
        order: String(i + 1),
        trlr: '',
        seal: '',
        load: 'N/A',
        weight: 'N/A',
      })
    }
  }

  const dollyRows = td.dolly && typeof td.dolly === 'object' && Array.isArray(td.dolly.rows)
    ? /** @type {{ label: string, value: string }[]} */ (
        td.dolly.rows.filter(
          (r) =>
            r &&
            typeof r === 'object' &&
            String(r.value ?? '').trim() &&
            String(r.value ?? '').trim() !== '—' &&
            !/sequence/i.test(String(r.label ?? '')),
        )
      )
    : []
  const dolly1 = dollyRows[0] ? ascii(String(dollyRows[0].value)) : ''
  const dolly2 = dollyRows[1] ? ascii(String(dollyRows[1].value)) : ''

  const tmsRef = ascii(extras.tmsRefNbr || str(td.tmsRefNbr))

  const originHeader =
    originId && originAbbr ? `${originId} / ${ascii(originAbbr)}` : originId || ascii(str(dh.origin)) || '—'
  const originAddr = originDir?.address ? ascii(originDir.address) : ascii(str(dh.origin))
  const originPhone = ascii(originDir?.phone || '')

  const destPhone = ascii(destDir?.phone || '')
  let latStr = ''
  let lngStr = ''
  if (destDir?.lat != null && destDir?.lng != null) {
    latStr = `${Math.abs(destDir.lat).toFixed(6)} ${destDir.lat >= 0 ? 'NORTH' : 'SOUTH'}`
    lngStr = `${Math.abs(destDir.lng).toFixed(6)} ${destDir.lng >= 0 ? 'EAST' : 'WEST'}`
  }

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 10
  const IW = W - M * 2
  let y = M

  function drawRect(x0, y0, w, h) {
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.25)
    doc.rect(x0, y0, w, h)
  }

  function setDataFont() {
    doc.setFont('courier', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...BLACK)
  }

  function setLabelFont() {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...BLACK)
  }

  function setBoldFont(sz = 8) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(sz)
    doc.setTextColor(...BLACK)
  }

  /** Header */
  setBoldFont(9)
  doc.text(`Tractor: ${tractor}`, M, y)
  doc.text(tripDestHeader, W / 2, y, { align: 'center' })
  doc.text(`Driver: ${driverLine}`, W - M, y, { align: 'right' })
  y += 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.text('DRIVER', W - M, y, { align: 'right' })
  y += 5

  /** Instructions */
  const instrH = 18
  drawRect(M, y, IW, instrH)
  setLabelFont()
  doc.text('Linehaul Driver:', M + 1.5, y + 4)
  const leftInstr = ascii(
    '- Trailer seal numbers, Dolly IDs, and Pre-Trip Inspection\n- Return completed form to Linehaul Office',
  )
  doc.setFontSize(6.8)
  doc.text(doc.splitTextToSize(leftInstr, IW * 0.48), M + 1.5, y + 7)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('Linehaul Responsibilities:', M + IW * 0.5 + 1, y + 4)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  const rightInstr = ascii(
    '- Seals provided match TLCRs, the proper FedEx ID and dolly numbers are correct in TMS',
  )
  doc.text(doc.splitTextToSize(rightInstr, IW * 0.47), M + IW * 0.5 + 1, y + 7)
  doc.line(M + IW * 0.5, y, M + IW * 0.5, y + instrH)
  y += instrH + 2

  /** Safety */
  const safetyH = 9
  drawRect(M, y, IW, safetyH)
  setBoldFont(7.5)
  doc.text('LIGHTS AND SEAT BELTS ON FOR SAFETY?', M + 1.5, y + 5.5)
  doc.text('ALL COUPLING DEVICES SECURE?', W - M - 1.5, y + 5.5, { align: 'right' })
  y += safetyH + 2

  /** Two-column middle */
  const midTop = y
  const colGap = 3
  const leftW = IW * 0.56
  const rightW = IW - leftW - colGap
  const rx = M + leftW + colGap

  const trailerBoxH = 26
  const dollyBoxH = 10
  const rightInnerH = 3 * (trailerBoxH + 2) + 2 * (dollyBoxH + 2)
  const leftInnerMin = 102
  const midH = Math.max(leftInnerMin, rightInnerH + 6)

  drawRect(M, midTop, leftW, midH)
  drawRect(rx, midTop, rightW, midH)
  doc.line(M + leftW, midTop, M + leftW, midTop + midH)

  let ly = midTop + 4
  setBoldFont(8)
  doc.text('TRIP DESTINATION:', M + 1.5, ly)
  setDataFont()
  doc.text(tripDestHeader, M + 34, ly)
  ly += 5

  setLabelFont()
  doc.text('ETA OF TRIP LEG:', M + 1.5, ly)
  ly += 4
  setBoldFont(11)
  doc.text(etaBold || '_____________________________', M + 1.5, ly)
  ly += 6

  setLabelFont()
  doc.text('BASED UPON', M + 1.5, ly)
  setDataFont()
  doc.text(basedUponLine, M + 22, ly)
  ly += 5

  setBoldFont(7.5)
  doc.text('Destination Address:', M + 1.5, ly)
  ly += 4
  setDataFont()
  doc.setFontSize(7.5)
  const addrBlock = destDir?.address
    ? [destNameLine, ...splitToWidth(doc, ascii(destDir.address), leftW - 4)]
    : splitToWidth(doc, destNameLine, leftW - 4)
  for (const ln of addrBlock.slice(0, 5)) {
    if (ln) {
      doc.text(ln, M + 1.5, ly)
      ly += 3.6
    }
  }
  if (destPhone) {
    doc.text(destPhone, M + 1.5, ly)
    ly += 3.6
  }
  ly += 1
  setLabelFont()
  doc.text('PAID:', M + 1.5, ly)
  setDataFont()
  doc.text(paidMi || '—', M + 16, ly)
  ly += 4.5

  setLabelFont()
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  doc.text('STANDARD ROUTE DETAILS PROVIDED UPON REQUEST', M + 1.5, ly)
  ly += 3.5
  setBoldFont(7)
  doc.setTextColor(...BLACK)
  doc.text('AUTOMATED DISPATCH / ARRIVAL (AVR):', M + 1.5, ly)
  setDataFont()
  doc.text('1-888-867-1142', M + 62, ly)
  ly += 5

  setBoldFont(7.5)
  doc.text('GPS COORDINATES:', M + 1.5, ly)
  ly += 4
  setDataFont()
  if (latStr && lngStr) {
    doc.text(latStr, M + 1.5, ly)
    ly += 3.6
    doc.text(lngStr, M + 1.5, ly)
  } else {
    doc.text('_________________________', M + 1.5, ly)
    ly += 3.6
    doc.text('_________________________', M + 1.5, ly)
  }

  /** Right column: trailers + dollies */
  let ry = midTop + 3
  function drawTrailerBox(slot, idx) {
    drawRect(rx, ry, rightW, trailerBoxH)
    setBoldFont(8)
    doc.text(`TRAILER ${idx}:`, rx + 1.5, ry + 4)
    setDataFont()
    doc.text(slot.trlr || '__________', rx + 22, ry + 4)
    setLabelFont()
    doc.text('SEAL:', rx + 1.5, ry + 9)
    doc.setLineWidth(0.12)
    doc.line(rx + 12, ry + 8.2, rx + rightW - 2, ry + 8.2)
    if (slot.seal) {
      setDataFont()
      doc.text(slot.seal, rx + 13, ry + 9.2)
    }
    setLabelFont()
    doc.text('LOAD:', rx + 1.5, ry + 14)
    setDataFont()
    const loadLines = splitToWidth(doc, slot.load || '—', rightW - 14)
    let yy = ry + 14
    for (const ln of loadLines.slice(0, 2)) {
      doc.text(ln, rx + 14, yy)
      yy += 3.4
    }
    setLabelFont()
    doc.text('PACKAGE WEIGHT:', rx + 1.5, ry + 22)
    setDataFont()
    doc.text(slot.weight || '—', rx + 36, ry + 22)
    ry += trailerBoxH + 2
  }

  for (let i = 0; i < 3; i++) {
    drawTrailerBox(trailerSlots[i], i + 1)
  }

  function drawDollyBox(label, val) {
    drawRect(rx, ry, rightW, dollyBoxH)
    setBoldFont(8)
    doc.text(`${label}:`, rx + 1.5, ry + 6)
    doc.setLineWidth(0.12)
    doc.line(rx + 18, ry + 5.2, rx + rightW - 2, ry + 5.2)
    if (val) {
      setDataFont()
      doc.text(val, rx + 19, ry + 6.2)
    }
    ry += dollyBoxH + 2
  }

  drawDollyBox('DOLLY 1', dolly1)
  drawDollyBox('DOLLY 2', dolly2)

  y = midTop + midH + 2

  /** Bottom row: invoice + origin */
  const botH = 22
  const invW = leftW
  const origW = IW - invW - colGap
  drawRect(M, y, invW, botH)
  setBoldFont(8)
  doc.text('PURCHASED CARRIER INVOICE', M + 1.5, y + 5)
  setLabelFont()
  doc.text('REFERENCE #:', M + 1.5, y + 11)
  doc.setLineWidth(0.12)
  doc.line(M + 24, y + 10.2, M + invW - 2, y + 10.2)
  if (tmsRef) {
    setDataFont()
    doc.text(tmsRef, M + 25, y + 11.2)
  }

  drawRect(M + invW + colGap, y, origW, botH)
  setBoldFont(7.5)
  doc.text(`TRIP LEG ORIGIN: ${originHeader}`, M + invW + colGap + 1.5, y + 5)
  setDataFont()
  doc.setFontSize(7)
  const oLines = splitToWidth(doc, originAddr || '—', origW - 3)
  let oy = y + 9
  for (const ln of oLines.slice(0, 2)) {
    doc.text(ln, M + invW + colGap + 1.5, oy)
    oy += 3.5
  }
  if (originPhone) {
    doc.text(originPhone, M + invW + colGap + 1.5, oy)
  }
  y += botH + 2

  /** DOT Pre-trip */
  const dotH = 58
  if (y + dotH > H - 14) {
    doc.addPage()
    y = M
  }
  drawRect(M, y, IW, dotH)
  setBoldFont(9)
  doc.text('DOT REQUIRED PRE-TRIP', W / 2, y + 5, { align: 'center' })

  const c1x = M + 2
  const c2x = M + IW * 0.34
  const c3x = M + IW * 0.67
  let cy = y + 11
  setLabelFont()
  doc.setFontSize(6.6)
  const col1 = ['LIGHTS / REFLECTORS', 'TIRES / WHEELS', 'BRAKES', 'SUSPENSION']
  const col2 = ['AIR LINES / AIR SYSTEMS', 'DOOR / DOOR LATCHES', 'LANDING GEAR', 'FRAME']
  const col3 = [
    'COUPLING DEVICES (e.g., FIFTH WHEEL, PINTLE HOOK)',
    'SAFETY CHAIN',
    'BODY: ________________',
    'OTHER: ________________',
  ]
  for (let i = 0; i < 4; i++) {
    doc.rect(c1x, cy - 2.2, 2.2, 2.2)
    doc.text(col1[i] || '', c1x + 3.2, cy)
    doc.rect(c2x, cy - 2.2, 2.2, 2.2)
    doc.text(col2[i] || '', c2x + 3.2, cy)
    doc.rect(c3x, cy - 2.2, 2.2, 2.2)
    doc.text(col3[i] || '', c3x + 3.2, cy)
    cy += 5.2
  }

  cy += 1
  doc.setFontSize(6.4)
  const stmt = ascii(
    'I have inspected all of the above components on the above vehicles/equipment as required by 49 CFR Part 396 and declare that all are compliant with DOT standards.',
  )
  doc.text(doc.splitTextToSize(stmt, IW - 4), M + 2, cy)
  cy += 12

  doc.setFontSize(6.8)
  doc.text('Driver Signature ________________________________', M + 2, cy)
  doc.text('Date ______________', M + IW * 0.52, cy)
  cy += 5
  doc.text('Driver ID Number: ____________________________', M + 2, cy)

  y += dotH + 3

  /** Footer */
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...GRAY)
  const foot = `Printed Time: ${genLabel}   ·   Leg #${legSeq || '—'}   ·   FedExTool trip reference (not an official FedEx document)`
  doc.text(ascii(foot), M, H - 8)

  const slug =
    legSeq && /^\d+$/.test(legSeq)
      ? legSeq
      : String(e.id || 'trip')
          .replace(/[^\w-]+/g, '-')
          .slice(0, 40) || 'trip'
  const fileName = `trip-form-${slug}.pdf`
  return { doc, fileName }
}

/**
 * @param {TripFormPdfOpts} opts
 * @returns {{ blob: Blob, filename: string }}
 */
export function getHistoryTripFormPdfBlob(opts) {
  const { doc, fileName } = buildTripFormJsPdf(opts)
  return { blob: doc.output('blob'), filename: fileName }
}
