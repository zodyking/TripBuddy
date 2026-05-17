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

/**
 * Canonical FedEx Ground linehaul trip sheet wording (printed reference).
 * Keep literals aligned with the printed FedEx linehaul sheet (Adobe scan reference).
 */
const FEDEX_FORM = {
  headerTractorLab: 'Tractor: ',
  headerDestLab: 'Destination ',
  headerDriverLab: 'DRIVER ',
  headerDriverSub: 'DRIVER',
  instrLinehaulDriverTitle: 'Linehaul Driver',
  instrLinehaulDriverBullets:
    '- Trailer seal numbers, Dolly IDs, and Pre-Trip Inspection\n- Return completed form to Linehaul Office',
  instrLinehaulRespTitle: 'Linehaul Responsibilities:',
  instrLinehaulRespBullets:
    '- Seals provided match TLCRs, the proper FedEx ID and dolly numbers are correct in TMS',
  safetyLights: 'LIGHTS AND SEAT BELTS ON FOR SAFETY?',
  safetyCoupling: 'ALL COUPLING DEVICES SECURE?',
  tripDestinationLab: 'TRIP DESTINATION:',
  etaOfTripLegLab: 'ETA OF TRIP LEG:',
  paidLab: 'PAID',
  standardRouteNote: 'STANDARD ROUTE DETAILS PROVIDED UPON REQUEST',
  avrLab: 'AUTOMATED DISPATCH / ARRIVAL (AVR):',
  avrPhone: '1-888-867-1142',
  gpsCoordinatesLab: 'GPS COORDINATES:',
  purchasedCarrierInvoice: 'PURCHASED CARRIER INVOICE',
  referenceLab: 'REFERENCE #:',
  dotTitle: 'DOT REQUIRED PRE-TRIP',
  dotCol1: ['LIGHTS / REFLECTORS', 'TIRES / WHEELS', 'BRAKES', 'SUSPENSION'],
  dotCol2: ['AIR LINES / AIR SYSTEMS', 'DOOR / DOOR LATCHES', 'LANDING GEAR', 'FRAME'],
  dotCol3: [
    'COUPLING DEVICES (e.g., FIFTH WHEEL, PINTLE HOOK)',
    'SAFETY CHAIN',
    'BODY: ________________',
    'OTHER: _____________',
  ],
  dotDeclaration:
    'I have inspected all of the above components on the above vehicles/equipment as required by 49 CFR Part 396 and declare that all are compliant with DOT standards.',
  dotDriverSig: 'Driver Signature ________________________',
  dotDate: 'Date __________________',
  dotDriverId: 'Driver ID Number: ________________________',
  tripLegOriginLab: 'TRIP LEG ORIGIN:',
  sealLab: 'SEAL:',
  loadLab: 'LOAD',
  packageWeightLab: 'PACKAGE WEIGHT:',
  originPhoneLab: 'Phone: ',
  dolly1Lab: 'DOLLY 1',
  dolly2Lab: 'DOLLY 2',
}

const BLACK = [0, 0, 0]
const GRAY = [110, 110, 110]

/** Border weights (mm) — FedEx scan: thin rules, medium equipment cells, heavy safety + DOT band */
const BW_THIN = 0.15
const BW_MED = 0.45
const BW_THICK = 1.05

/** ~0.5" side margins on Letter (FedEx print) */
const MARGIN_MM = 12.7

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

/** FedEx-style "LAST, FIRST" in caps */
function formatDriverFedex(name) {
  const t = String(name || '').trim()
  if (!t) return ''
  if (/,/.test(t)) return ascii(t).toUpperCase()
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    const last = ascii(parts[parts.length - 1]).toUpperCase()
    const first = parts
      .slice(0, -1)
      .map((p) => ascii(p).toUpperCase())
      .join(' ')
    return `${last}, ${first}`
  }
  return ascii(t).toUpperCase()
}

/** Strip " lbs" etc. so the form shows numeric weight like the FedEx sheet (e.g. 11701.88). */
function packageWeightFedexDisplay(raw) {
  const t = String(raw ?? '').trim()
  if (!t || t === '—' || t === '-') return '-'
  const m = t.match(/^([\d,.]+)\s*(?:lbs?)?/i)
  return m ? m[1].replace(/,/g, '') : ascii(t)
}

/** `(516) 576-0170` from digits */
function formatPhoneFedex(raw) {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return ascii(String(raw ?? '').trim())
}

/**
 * FedEx printed "BASED UPON … EDT DEPARTUR" (original misspelling on the linehaul form).
 * Clock + zone match the Eastern dispatch print (EST/EDT), not the viewer's local zone.
 * @param {number} tsMs
 */
function formatBasedUponDepartur(tsMs) {
  const d = new Date(tsMs)
  if (isNaN(d.getTime())) return 'BASED UPON ________________________________ EDT DEPARTUR'
  const tz = 'America/New_York'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  /** @param {string} t */
  const get = (t) => parts.find((p) => p.type === t)?.value ?? ''
  const monRaw = get('month')
  const mon = monRaw ? monRaw.charAt(0).toUpperCase() + monRaw.slice(1).toLowerCase() : ''
  const day = get('day')
  const yr = get('year')
  const hr24 = get('hour')
  const min = get('minute')
  const tzParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d)
  const tzRaw = tzParts.find((p) => p.type === 'timeZoneName')?.value?.trim() ?? ''
  const tzAbbr = /^(EST|EDT)$/i.test(tzRaw) ? tzRaw.toUpperCase() : 'EDT'
  /** FedEx linehaul sheet uses 24h clock + `DEPARTUR` (printed typo on the paper form). */
  return `BASED UPON ${mon} ${day} ${yr} ${hr24}:${min} ${tzAbbr} DEPARTUR`
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
 * FedEx-style address: `Street..., City, ST ZIP` → street + `CITY` / `ST ZIP` row.
 * @param {string} raw
 * @returns {{ streetPart: string, city: string, stateZip: string } | null}
 */
function splitUsAddressFedex(raw) {
  const t = ascii(String(raw ?? '').trim())
  if (!t) return null
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const last = parts[parts.length - 1]
  const m = last.match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
  if (!m) return null
  const stateZip = `${m[1].toUpperCase()} ${m[2]}`
  if (parts.length >= 3) {
    const city = parts[parts.length - 2].toUpperCase()
    const streetPart = parts.slice(0, -2).join(', ').trim()
    if (!streetPart) return null
    return { streetPart: streetPart.toUpperCase(), city, stateZip }
  }
  return { streetPart: '', city: parts[0].toUpperCase(), stateZip }
}

/**
 * @param {TripFormPdfOpts} opts
 * @returns {{ doc: import('jspdf').jsPDF, fileName: string }}
 */
function buildTripFormJsPdf(opts) {
  const e = opts.entry
  const dh = e.dispatchHeader && typeof e.dispatchHeader === 'object' ? e.dispatchHeader : {}
  const td = e.tripDetails && typeof e.tripDetails === 'object' && !Array.isArray(e.tripDetails)
    ? /** @type {Record<string, unknown>} */ (e.tripDetails)
    : /** @type {Record<string, unknown>} */ ({})

  const extras = linehaulExtrasFromTripDetails(td)
  const tractorRaw = ascii(str(td.tractorNumber) || '').trim()
  const tractor = tractorRaw || '-'
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

  const tripDestHeaderShort =
    destId && destAbbr
      ? `${destId} / ${ascii(destAbbr).toUpperCase()}`
      : destId || ascii(str(dh.destination)).toUpperCase() || '-'

  const driverFedex = formatDriverFedex((opts.driverName || '').trim())

  const destDir = dirGet(opts.directory, opts.destLocationId)
  const originDir = dirGet(opts.directory, opts.originLocationId)

  const destNameLine = ascii(
    destDir?.locationName || str(dh.destination).replace(/^[\d\s]+·\s*/, '').trim() || '-',
  )

  const paidMi =
    td.mileage && typeof td.mileage === 'object' && !Array.isArray(td.mileage)
      ? String(/** @type {Record<string, unknown>} */ (td.mileage).totalMiles ?? '').trim()
      : ''

  const etaBold = pickEtaLine(extras, td)
  const etaDisplay = etaBold ? ascii(etaBold) : ''

  const dispatchTs =
    typeof e.displayDate === 'number' && Number.isFinite(e.displayDate) && e.displayDate > 0
      ? e.displayDate
      : null
  const basedUponFedexExact =
    dispatchTs != null ? formatBasedUponDepartur(dispatchTs) : 'BASED UPON ________________________________ EDT DEPARTUR'

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
        weight: packageWeightFedexDisplay(wtRow?.value && wtRow.value !== '—' ? String(wtRow.value) : ''),
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
    originId && originAbbr
      ? `${originId} / ${ascii(originAbbr).toUpperCase()}`
      : originId || ascii(str(dh.origin)).toUpperCase() || '-'
  const originAddrRaw = originDir?.address ? originDir.address : str(dh.origin)
  const originAddr = ascii(originAddrRaw)
  const originAddrParsed = splitUsAddressFedex(originAddr)
  const originPhone = formatPhoneFedex(originDir?.phone || '')

  const destPhone = formatPhoneFedex(destDir?.phone || '')
  const destAddrRawForParse = destDir?.address ? ascii(destDir.address) : ''
  const destAddrParsed = splitUsAddressFedex(destAddrRawForParse)

  let latStr = ''
  let lngStr = ''
  if (destDir?.lat != null && destDir?.lng != null) {
    latStr = `${Math.abs(destDir.lat).toFixed(6)} NORTH`
    lngStr = `${Math.abs(destDir.lng).toFixed(6)} WEST`
    if (destDir.lat < 0) latStr = `${Math.abs(destDir.lat).toFixed(6)} SOUTH`
    if (destDir.lng >= 0) lngStr = `${Math.abs(destDir.lng).toFixed(6)} EAST`
  }

  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait', compress: true })
  const W = doc.internal.pageSize.getWidth()
  const M = MARGIN_MM
  const IW = W - M * 2
  let y = M

  /** FedEx printed sheet uses monospaced type (Courier-class), not proportional sans. */
  const FONT = 'courier'
  const FS_HEAD = 9
  const FS_BODY = 7.2
  const FS_SMALL = 6.5
  const FS_ETA = 10.5

  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} w
   * @param {number} h
   * @param {number} lw
   */
  function strokeRect(x0, y0, w, h, lw) {
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(lw)
    doc.rect(x0, y0, w, h)
  }

  /** FedEx safety band: heavy top + bottom rules, thin verticals (image 2). */
  function strokeRectThickHorizontalEnds(x0, y0, w, h) {
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(BW_THICK)
    doc.line(x0, y0, x0 + w, y0)
    doc.line(x0, y0 + h, x0 + w, y0 + h)
    doc.setLineWidth(BW_THIN)
    doc.line(x0, y0, x0, y0 + h)
    doc.line(x0 + w, y0, x0 + w, y0 + h)
  }

  /**
   * @param {'normal' | 'bold'} weight
   * @param {number} sz
   */
  function setF(weight, sz) {
    doc.setFont(FONT, weight)
    doc.setFontSize(sz)
    doc.setTextColor(...BLACK)
  }

  /** ---------- Header ---------- */
  const headerY = y
  setF('normal', FS_HEAD)
  doc.text(FEDEX_FORM.headerTractorLab, M, headerY)
  const xTractorVal = M + doc.getTextWidth(FEDEX_FORM.headerTractorLab)
  setF('bold', FS_HEAD)
  const tractorDisp = tractor === '-' ? '' : tractor
  if (tractorDisp) {
    doc.text(tractorDisp, xTractorVal, headerY)
  }

  const labDest = FEDEX_FORM.headerDestLab
  const destVal = tripDestHeaderShort
  setF('normal', FS_HEAD)
  const wDestLab = doc.getTextWidth(labDest)
  setF('bold', FS_HEAD)
  const wDestVal = doc.getTextWidth(destVal)
  const xDest0 = W / 2 - (wDestLab + wDestVal) / 2
  setF('normal', FS_HEAD)
  doc.text(labDest, xDest0, headerY)
  setF('bold', FS_HEAD)
  doc.text(destVal, xDest0 + wDestLab, headerY)

  const labDrv = FEDEX_FORM.headerDriverLab
  const driverBlockRight = W - M
  setF('normal', FS_HEAD)
  const wDrvLab = doc.getTextWidth(labDrv)
  setF('bold', FS_HEAD)
  const wDrvName = driverFedex ? doc.getTextWidth(driverFedex) : 0
  const driverLineWidth = wDrvLab + wDrvName
  /** Same left edge for `DRIVER` on both header rows (FedEx scan). */
  const xDriverLabelLeft = driverBlockRight - driverLineWidth
  setF('normal', FS_HEAD)
  doc.text(labDrv, xDriverLabelLeft, headerY)
  if (driverFedex) {
    setF('bold', FS_HEAD)
    doc.text(driverFedex, xDriverLabelLeft + wDrvLab, headerY)
  }

  y += 3.85
  setF('bold', FS_SMALL)
  doc.text(FEDEX_FORM.headerDriverSub, xDriverLabelLeft, y)
  y += 5.2

  /** ---------- Linehaul instructions (vertical at page center like FedEx scan) ---------- */
  const instrH = 17.5
  const instrMidX = M + IW * 0.5
  strokeRect(M, y, IW, instrH, BW_THIN)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(instrMidX, y, instrMidX, y + instrH)

  const halfW = IW / 2
  setF('bold', FS_BODY)
  doc.text(FEDEX_FORM.instrLinehaulDriverTitle, M + 2, y + 4)
  setF('normal', FS_SMALL)
  doc.text(doc.splitTextToSize(ascii(FEDEX_FORM.instrLinehaulDriverBullets), IW * 0.46 - 2), M + 2, y + 7.5)

  setF('bold', FS_BODY)
  doc.text(FEDEX_FORM.instrLinehaulRespTitle, instrMidX + 2, y + 4)
  setF('normal', FS_SMALL)
  doc.text(doc.splitTextToSize(ascii(FEDEX_FORM.instrLinehaulRespBullets), IW * 0.48 - 2), instrMidX + 2, y + 7.5)
  y += instrH + 1.4

  /** ---------- Safety (thick top/bottom, thin sides; single-line prompts like FedEx scan) ---------- */
  const safetyH = 10.5
  strokeRectThickHorizontalEnds(M, y, IW, safetyH)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(instrMidX, y, instrMidX, y + safetyH)
  const safetyPad = 2.5
  const safetyMidY = y + safetyH / 2 + 1.35
  const safetyFs = 5.85
  setF('bold', safetyFs)
  doc.text(FEDEX_FORM.safetyLights, M + safetyPad, safetyMidY, {
    align: 'left',
    maxWidth: halfW - safetyPad * 2,
  })
  doc.text(FEDEX_FORM.safetyCoupling, W - M - safetyPad, safetyMidY, {
    align: 'right',
    maxWidth: halfW - safetyPad * 2,
  })
  y += safetyH + 1.4

  /** ---------- Two-column body (FedEx: single vertical between columns — no gap strip) ---------- */
  const midTop = y
  const colGap = 0
  const leftW = IW * 0.56
  const rightW = IW - leftW - colGap
  const rx = M + leftW + colGap
  const splitX = rx

  const trailerBoxH = 24
  const dollyBoxH = 9.5
  const originBoxH = 27
  const gapBox = 1.2
  const rightPadTop = 2.5
  const rightStackH =
    rightPadTop +
    3 * (trailerBoxH + gapBox) +
    2 * (dollyBoxH + gapBox) +
    originBoxH +
    5

  /** Measure left column content height */
  setF('normal', FS_BODY)
  let lh = 0
  lh += 4.5
  lh += 4.5
  lh += etaDisplay ? 6.5 : 4.2
  lh += 4
  lh += 4
  /** Destination block: bold name (up to 2 lines) + street / city row (FedEx image 2). */
  const destNameLineCount = Math.min(splitToWidth(doc, ascii(destNameLine).toUpperCase(), leftW - 4).length, 2)
  lh += Math.max(destNameLineCount, 1) * 3.55
  if (destAddrParsed) {
    const sl = destAddrParsed.streetPart
      ? splitToWidth(doc, destAddrParsed.streetPart, leftW - 4)
      : []
    lh += Math.min(Math.max(sl.length, 0), 4) * 3.5
    if (destAddrParsed.city) lh += 3.5
    else if (destAddrParsed.stateZip && !destAddrParsed.streetPart) lh += 3.5
  } else if (destAddrRawForParse) {
    const fallback = splitToWidth(doc, destAddrRawForParse, leftW - 4)
    lh += Math.min(fallback.length, 5) * 3.5
  }
  if (destPhone) lh += 3.5
  lh += 2
  lh += 4.5
  lh += 3.5
  lh += 4.5
  /** GPS: blank coords use two ruled lines (~12mm); lat/lng use two text lines (~8.5mm). */
  lh += latStr && lngStr ? 8.5 : 12.5
  const leftInnerH = lh + 5
  const midH = Math.max(leftInnerH, rightStackH + 3)

  strokeRect(M, midTop, IW, midH, BW_THIN)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(splitX, midTop, splitX, midTop + midH)

  /** ----- Left column (FedEx: label + value spacing from measured label width) ----- */
  const leftColR = M + leftW - 2
  let ly = midTop + 3.5
  const lx0 = M + 2
  const labTripDest = FEDEX_FORM.tripDestinationLab
  setF('bold', FS_BODY)
  doc.text(labTripDest, lx0, ly)
  doc.text(tripDestHeaderShort, lx0 + doc.getTextWidth(labTripDest) + 1, ly)
  ly += 4.8

  const labEta = FEDEX_FORM.etaOfTripLegLab
  setF('bold', FS_BODY)
  doc.text(labEta, lx0, ly)
  ly += 4.6
  setF('bold', FS_ETA)
  if (etaDisplay) {
    doc.text(etaDisplay, lx0, ly)
  } else {
    doc.setLineWidth(BW_THIN)
    doc.line(lx0, ly - 0.35, leftColR, ly - 0.35)
  }
  ly += 7

  setF('normal', FS_SMALL)
  doc.text(ascii(basedUponFedexExact), lx0, ly)
  ly += 4.5

  /** Destination name + address (no "DESTINATION ADDRESS:" label on FedEx sheet). */
  const destNameUpper = ascii(destNameLine).toUpperCase()
  setF('bold', FS_BODY)
  for (const nl of splitToWidth(doc, destNameUpper, leftW - 4).slice(0, 2)) {
    doc.text(nl, lx0, ly)
    ly += 3.55
  }
  setF('normal', FS_BODY)
  if (destAddrParsed) {
    if (destAddrParsed.streetPart) {
      for (const ln of splitToWidth(doc, destAddrParsed.streetPart, leftW - 4).slice(0, 4)) {
        doc.text(ln, lx0, ly)
        ly += 3.45
      }
    }
    if (destAddrParsed.city) {
      setF('normal', FS_BODY)
      doc.text(destAddrParsed.city, lx0, ly)
      doc.text(destAddrParsed.stateZip, leftColR, ly, { align: 'right' })
      ly += 3.5
    } else if (destAddrParsed.stateZip) {
      doc.text(destAddrParsed.stateZip, lx0, ly)
      ly += 3.45
    }
  } else if (destAddrRawForParse) {
    for (const ln of splitToWidth(doc, destAddrRawForParse, leftW - 4).slice(0, 5)) {
      doc.text(ln, lx0, ly)
      ly += 3.45
    }
  }
  if (destPhone) {
    doc.text(destPhone, lx0, ly)
    ly += 3.45
  }
  ly += 1.5

  const labPaid = FEDEX_FORM.paidLab
  setF('bold', FS_BODY)
  doc.text(labPaid, lx0, ly)
  setF('bold', FS_BODY)
  const paidTxt = paidMi || '-'
  doc.text(paidTxt, leftColR, ly, { align: 'right' })
  ly += 4.8

  setF('normal', FS_SMALL)
  doc.setTextColor(...GRAY)
  doc.text(FEDEX_FORM.standardRouteNote, lx0, ly)
  doc.setTextColor(...BLACK)
  ly += 3.8

  const labAvr = FEDEX_FORM.avrLab
  setF('bold', FS_BODY)
  doc.text(labAvr, lx0, ly)
  setF('normal', FS_BODY)
  doc.text(FEDEX_FORM.avrPhone, lx0 + doc.getTextWidth(labAvr) + 1.2, ly)
  ly += 5

  const gpsRightX = leftColR
  if (latStr && lngStr) {
    setF('bold', FS_BODY)
    const gpsLab = `${FEDEX_FORM.gpsCoordinatesLab} `
    doc.text(gpsLab, lx0, ly)
    setF('normal', FS_BODY)
    const latX = lx0 + doc.getTextWidth(gpsLab)
    doc.text(latStr, latX, ly)
    ly += 3.6
    doc.text(lngStr, latX, ly)
    ly += 1.2
  } else {
    setF('bold', FS_BODY)
    doc.text(FEDEX_FORM.gpsCoordinatesLab, lx0, ly)
    ly += 3.6
    setF('normal', FS_BODY)
    doc.setLineWidth(BW_THIN)
    doc.line(lx0, ly - 0.8, gpsRightX, ly - 0.8)
    ly += 3.5
    doc.line(lx0, ly - 0.8, gpsRightX, ly - 0.8)
    ly += 1.2
  }

  /** ----- Right column: T1, D1, T2, D2, T3, Trip leg origin (FedEx order) ----- */
  const rightInnerR = rx + rightW - 2
  let ry = midTop + 2.5

  /**
   * @param {{ order: string, trlr: string, seal: string, load: string, weight: string }} slot
   * @param {number} idx
   */
  function drawTrailerBox(slot, idx) {
    strokeRect(rx, ry, rightW, trailerBoxH, BW_MED)
    const ix = rx + 1.8
    const iy0 = ry + 3.8
    const hasNbr = Boolean(String(slot.trlr ?? '').trim())
    setF('bold', FS_BODY)
    if (hasNbr) {
      const labWithSpace = `TRAILER ${idx}: `
      doc.text(labWithSpace, ix, iy0)
      doc.text(String(slot.trlr), ix + doc.getTextWidth(labWithSpace), iy0)
    } else {
      doc.text(`TRAILER ${idx}:`, ix, iy0)
    }

    setF('bold', FS_SMALL)
    const sealLab = FEDEX_FORM.sealLab
    doc.text(sealLab, ix, ry + 8.8)
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(BW_THIN)
    const sealLabW = doc.getTextWidth(sealLab)
    doc.line(ix + sealLabW + 0.6, ry + 8.1, rightInnerR, ry + 8.1)
    if (slot.seal) {
      setF('normal', FS_SMALL)
      doc.text(slot.seal, ix + sealLabW + 1.2, ry + 8.9)
    }

    const loadRowY = ry + 13.2
    const loadLab = FEDEX_FORM.loadLab
    setF('bold', FS_SMALL)
    doc.text(loadLab, ix, loadRowY)
    setF('normal', FS_SMALL)
    const loadDisp = String(slot.load || '-').trim() || '-'
    const loadLabW = doc.getTextWidth(loadLab) + 2
    doc.text(loadDisp, rightInnerR, loadRowY, {
      align: 'right',
      maxWidth: Math.max(8, rightInnerR - ix - loadLabW),
    })

    const pwY = ry + 20.5
    const pwLab = FEDEX_FORM.packageWeightLab
    setF('bold', FS_SMALL)
    doc.text(pwLab, ix, pwY)
    setF('normal', FS_SMALL)
    const wTxt = String(slot.weight || '-').trim()
    doc.text(wTxt, rightInnerR, pwY, { align: 'right' })
    ry += trailerBoxH + gapBox
  }

  /**
   * @param {string} label
   * @param {string} val
   */
  function drawDollyBox(label, val) {
    strokeRect(rx, ry, rightW, dollyBoxH, BW_MED)
    const ix = rx + 1.8
    setF('bold', FS_BODY)
    const dollyLab = `${label}:`
    doc.text(dollyLab, ix, ry + 6)
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(BW_THIN)
    doc.line(ix + doc.getTextWidth(dollyLab) + 0.8, ry + 5.2, rightInnerR, ry + 5.2)
    if (val) {
      setF('normal', FS_BODY)
      doc.text(val, ix + doc.getTextWidth(dollyLab) + 1.2, ry + 6.1)
    }
    ry += dollyBoxH + gapBox
  }

  /** FedEx image 2 order: T1, D1, T2, D2, T3, trip leg origin. */
  drawTrailerBox(trailerSlots[0], 1)
  drawDollyBox(FEDEX_FORM.dolly1Lab, dolly1)
  drawTrailerBox(trailerSlots[1], 2)
  drawDollyBox(FEDEX_FORM.dolly2Lab, dolly2)
  drawTrailerBox(trailerSlots[2], 3)

  /** Trip leg origin — right stack after trailers/dollies (FedEx image 2). */
  strokeRect(rx, ry, rightW, originBoxH, BW_MED)
  const ox = rx + 1.8
  let oy2 = ry + 4
  const labTripLegOrigin = FEDEX_FORM.tripLegOriginLab
  setF('bold', FS_BODY)
  doc.text(labTripLegOrigin, ox, oy2)
  setF('bold', FS_BODY)
  doc.text(originHeader, ox + doc.getTextWidth(labTripLegOrigin) + 1, oy2)
  oy2 += 4.5
  setF('normal', FS_SMALL)
  if (originAddrParsed?.streetPart) {
    for (const ln of splitToWidth(doc, originAddrParsed.streetPart, rightW - 4).slice(0, 2)) {
      doc.text(ln, ox, oy2)
      oy2 += 3.35
    }
  } else {
    for (const ln of splitToWidth(doc, originAddr, rightW - 4).slice(0, 3)) {
      doc.text(ln, ox, oy2)
      oy2 += 3.35
    }
  }
  if (originAddrParsed?.city) {
    doc.text(originAddrParsed.city, ox, oy2)
    doc.text(originAddrParsed.stateZip, rightInnerR, oy2, { align: 'right' })
    oy2 += 3.35
  }
  if (originPhone) {
    doc.text(`${FEDEX_FORM.originPhoneLab}${originPhone}`, ox, oy2)
  }
  ry += originBoxH + 2

  y = midTop + midH + 1.2

  /** ---------- Purchased carrier invoice — left column width only (matches FedEx scan) ---------- */
  const invH = 16
  strokeRect(M, y, leftW, invH, BW_THIN)
  setF('bold', FS_BODY)
  doc.text(FEDEX_FORM.purchasedCarrierInvoice, M + 2, y + 4.5)
  setF('bold', FS_SMALL)
  const refLab = FEDEX_FORM.referenceLab
  doc.text(refLab, M + 2, y + 10)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  const refLabW = doc.getTextWidth(refLab)
  const refLineX0 = M + 2 + refLabW + 1.2
  const invInnerR = M + leftW - 2
  doc.line(refLineX0, y + 9.3, invInnerR, y + 9.3)
  if (tmsRef) {
    setF('normal', FS_SMALL)
    doc.text(tmsRef, refLineX0 + 0.6, y + 10.1)
  }
  y += invH + 1.5

  /** ---------- DOT (thin sides/bottom + heavy top; checklist labels match FedEx form) ---------- */
  const dotH = 56
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(M, y, M, y + dotH)
  doc.line(M + IW, y, M + IW, y + dotH)
  doc.line(M, y + dotH, M + IW, y + dotH)
  doc.setLineWidth(BW_THICK)
  doc.line(M, y, M + IW, y)

  setF('bold', FS_HEAD + 0.5)
  doc.text(FEDEX_FORM.dotTitle, W / 2, y + 5.2, { align: 'center' })

  const chkFs = 5.55
  setF('bold', chkFs)
  const c1w = IW * 0.24
  const c2w = IW * 0.26
  const c3w = IW - c1w - c2w - 5.5
  const c1x = M + 2.5
  const c2x = c1x + c1w + 1
  const c3x = c2x + c2w + 1
  const cb = 2.35
  let cy = y + 10.8
  const col1 = FEDEX_FORM.dotCol1
  const col2 = FEDEX_FORM.dotCol2
  const col3 = FEDEX_FORM.dotCol3
  for (let i = 0; i < 4; i++) {
    doc.setLineWidth(BW_THIN)
    doc.rect(c1x, cy - 2.2, cb, cb)
    doc.text(col1[i] || '', c1x + cb + 0.85, cy, { maxWidth: c1w - cb - 1.2, baseline: 'middle' })
    doc.rect(c2x, cy - 2.2, cb, cb)
    doc.text(col2[i] || '', c2x + cb + 0.85, cy, { maxWidth: c2w - cb - 1.2, baseline: 'middle' })
    doc.rect(c3x, cy - 2.2, cb, cb)
    doc.text(col3[i] || '', c3x + cb + 0.85, cy, { maxWidth: c3w - cb - 1.5, baseline: 'middle' })
    cy += 5.15
  }

  cy += 1.2
  setF('normal', 6.15)
  const stmt = ascii(FEDEX_FORM.dotDeclaration)
  doc.text(doc.splitTextToSize(stmt, IW - 5), M + 2.5, cy)
  cy += 11.5

  setF('normal', FS_SMALL)
  doc.text(FEDEX_FORM.dotDriverSig, M + 2.5, cy)
  doc.text(FEDEX_FORM.dotDate, M + IW * 0.5, cy)
  cy += 4.8
  doc.text(FEDEX_FORM.dotDriverId, M + 2.5, cy)

  y += dotH + 2.5

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
