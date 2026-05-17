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
  if (!t || t === '—') return '—'
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

  const tripDestHeaderShort =
    destId && destAbbr
      ? `${destId} / ${ascii(destAbbr).toUpperCase()}`
      : destId || ascii(str(dh.destination)).toUpperCase() || '—'

  const driverFedex = formatDriverFedex(
    (opts.driverName || '').trim() || 'DRIVER NAME NOT ON FILE',
  )

  const destDir = dirGet(opts.directory, opts.destLocationId)
  const originDir = dirGet(opts.directory, opts.originLocationId)

  const destNameLine = ascii(
    destDir?.locationName || str(dh.destination).replace(/^[\d\s]+·\s*/, '').trim() || '—',
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
      : originId || ascii(str(dh.origin)).toUpperCase() || '—'
  const originAddrRaw = originDir?.address ? originDir.address : str(dh.origin)
  const originAddr = ascii(originAddrRaw)
  const originPhone = formatPhoneFedex(originDir?.phone || '')

  const destPhone = formatPhoneFedex(destDir?.phone || '')
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
  const H = doc.internal.pageSize.getHeight()
  const M = MARGIN_MM
  const IW = W - M * 2
  let y = M

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

  /**
   * @param {'normal' | 'bold'} weight
   * @param {number} sz
   */
  function setF(weight, sz) {
    doc.setFont(FONT, weight)
    doc.setFontSize(sz)
    doc.setTextColor(...BLACK)
  }

  /** ---------- Header: Tractor: **n** | Destination **id/abbr** | DRIVER **NAME** (FedEx weights) ---------- */
  const headerY = y
  setF('normal', FS_HEAD)
  const labTr = 'Tractor: '
  doc.text(labTr, M, headerY)
  let xAfter = M + doc.getTextWidth(labTr)
  setF('bold', FS_HEAD)
  doc.text(tractor, xAfter, headerY)

  const labDest = 'Destination '
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

  const labDrv = 'DRIVER '
  setF('normal', FS_HEAD)
  const wDrvLab = doc.getTextWidth(labDrv)
  setF('bold', FS_HEAD)
  const wDrvName = doc.getTextWidth(driverFedex)
  const xDrv0 = W - M - wDrvLab - wDrvName
  setF('normal', FS_HEAD)
  doc.text(labDrv, xDrv0, headerY)
  setF('bold', FS_HEAD)
  doc.text(driverFedex, xDrv0 + wDrvLab, headerY)

  y += 4.2
  setF('bold', FS_SMALL)
  doc.text('DRIVER', W - M, y, { align: 'right' })
  y += 5.5

  /** ---------- Linehaul instructions (thin outer, thin vertical) — titles match FedEx sheet ---------- */
  const instrH = 17.5
  strokeRect(M, y, IW, instrH, BW_THIN)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(M + IW * 0.5, y, M + IW * 0.5, y + instrH)

  setF('bold', FS_BODY)
  doc.text('Linehaul Driver', M + 2, y + 4)
  setF('normal', FS_SMALL)
  const leftInstr = ascii(
    '- Trailer seal numbers, Dolly IDs, and Pre-Trip Inspection\n- Return completed form to Linehaul Office',
  )
  doc.text(doc.splitTextToSize(leftInstr, IW * 0.46 - 2), M + 2, y + 7.5)

  setF('bold', FS_BODY)
  doc.text('Linehaul Responsibilities:', M + IW * 0.5 + 2, y + 4)
  setF('normal', FS_SMALL)
  const rightInstr = ascii(
    '- Seals provided match TLCRs, the proper FedEx ID and dolly numbers are correct in TMS',
  )
  doc.text(doc.splitTextToSize(rightInstr, IW * 0.48 - 2), M + IW * 0.5 + 2, y + 7.5)
  y += instrH + 2.2

  /** ---------- Safety (thick border, centered halves) ---------- */
  const safetyH = 9.2
  strokeRect(M, y, IW, safetyH, BW_THICK)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(W / 2, y, W / 2, y + safetyH)
  const midX = W / 2
  const halfW = IW / 2
  setF('bold', FS_BODY - 0.2)
  const safetyMidY = y + safetyH / 2 + 1.2
  doc.text('LIGHTS AND SEAT BELTS ON FOR SAFETY?', midX - halfW / 2, safetyMidY, {
    align: 'center',
    maxWidth: halfW - 3,
  })
  doc.text('ALL COUPLING DEVICES SECURE?', midX + halfW / 2, safetyMidY, {
    align: 'center',
    maxWidth: halfW - 3,
  })
  y += safetyH + 2.2

  /** ---------- Two-column body (FedEx ~58% / 42% split) ---------- */
  const midTop = y
  const colGap = 2
  const leftW = IW * 0.58
  const rightW = IW - leftW - colGap
  const rx = M + leftW + colGap
  const splitX = M + leftW

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
  lh += 6.5
  lh += 4
  lh += 4
  const addrLines = destDir?.address
    ? [destNameLine, ...splitToWidth(doc, ascii(destDir.address), leftW - 4)]
    : splitToWidth(doc, destNameLine, leftW - 4)
  lh += Math.min(addrLines.length, 5) * 3.5
  if (destPhone) lh += 3.5
  lh += 2
  lh += 4.5
  lh += 3.5
  lh += 4.5
  /** GPS: blank coords use two ruled lines (~12mm); lat/lng use two text lines (~8.5mm). */
  lh += latStr && lngStr ? 8.5 : 12.5
  const leftInnerH = lh + 8
  const midH = Math.max(leftInnerH, rightStackH + 6)

  strokeRect(M, midTop, IW, midH, BW_THIN)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  doc.line(splitX, midTop, splitX, midTop + midH)

  /** ----- Left column ----- */
  let ly = midTop + 3.5
  const lx0 = M + 2
  setF('bold', FS_BODY)
  doc.text('TRIP DESTINATION:', lx0, ly)
  setF('bold', FS_BODY)
  doc.text(tripDestHeaderShort, lx0 + 38, ly)
  ly += 4.8

  setF('bold', FS_BODY)
  doc.text('ETA OF TRIP LEG:', lx0, ly)
  ly += 4.6
  setF('bold', FS_ETA)
  if (etaDisplay) {
    doc.text(etaDisplay, lx0, ly)
  } else {
    doc.setLineWidth(BW_THIN)
    doc.line(lx0, ly - 1.1, M + leftW - 2, ly - 1.1)
    doc.line(lx0, ly + 0.8, M + leftW - 2, ly + 0.8)
  }
  ly += 7

  setF('normal', FS_SMALL)
  doc.text(ascii(basedUponFedexExact), lx0, ly)
  ly += 4.5

  setF('bold', FS_BODY)
  doc.text('DESTINATION ADDRESS:', lx0, ly)
  ly += 4
  setF('normal', FS_BODY)
  for (const ln of addrLines.slice(0, 5)) {
    doc.text(ln, lx0, ly)
    ly += 3.45
  }
  if (destPhone) {
    doc.text(destPhone, lx0, ly)
    ly += 3.45
  }
  ly += 1.5

  setF('bold', FS_BODY)
  doc.text('PAID', lx0, ly)
  setF('bold', FS_BODY)
  const paidTxt = paidMi || '—'
  doc.text(paidTxt, M + leftW - 3, ly, { align: 'right' })
  ly += 4.8

  setF('normal', FS_SMALL)
  doc.setTextColor(...GRAY)
  doc.text('STANDARD ROUTE DETAILS PROVIDED UPON REQUEST', lx0, ly)
  doc.setTextColor(...BLACK)
  ly += 3.8

  setF('bold', FS_BODY)
  doc.text('AUTOMATED DISPATCH / ARRIVAL (AVR):', lx0, ly)
  setF('normal', FS_BODY)
  doc.text('1-888-867-1142', lx0 + 62, ly)
  ly += 5

  const gpsRightX = M + leftW - 2.5
  if (latStr && lngStr) {
    setF('bold', FS_BODY)
    const gpsLab = 'GPS COORDINATES: '
    doc.text(gpsLab, lx0, ly)
    setF('normal', FS_BODY)
    doc.text(latStr, lx0 + doc.getTextWidth(gpsLab), ly)
    ly += 3.6
    doc.text(lngStr, gpsRightX, ly, { align: 'right' })
    ly += 1.2
  } else {
    setF('bold', FS_BODY)
    doc.text('GPS COORDINATES:', lx0, ly)
    ly += 3.6
    setF('normal', FS_BODY)
    doc.setLineWidth(BW_THIN)
    doc.line(lx0, ly - 0.8, gpsRightX, ly - 0.8)
    ly += 3.5
    doc.line(lx0, ly - 0.8, gpsRightX, ly - 0.8)
    ly += 1.2
  }

  /** ----- Right column: T1, D1, T2, D2, T3, Trip leg origin (FedEx order) ----- */
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
    const lab = hasNbr ? `TRAILER ${idx}: ` : `TRAILER ${idx}:`
    setF('bold', FS_BODY)
    doc.text(lab, ix, iy0)
    if (hasNbr) {
      const labW = doc.getTextWidth(lab)
      setF('bold', FS_BODY)
      doc.text(String(slot.trlr), ix + labW, iy0)
    }

    setF('bold', FS_SMALL)
    const sealLab = 'SEAL:'
    doc.text(sealLab, ix, ry + 8.8)
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(BW_THIN)
    const sealLabW = doc.getTextWidth(sealLab)
    doc.line(ix + sealLabW + 0.6, ry + 8.1, rx + rightW - 2, ry + 8.1)
    if (slot.seal) {
      setF('normal', FS_SMALL)
      doc.text(slot.seal, ix + sealLabW + 1.2, ry + 8.9)
    }

    setF('bold', FS_SMALL)
    const loadBr = 'LOAD '
    doc.text(loadBr, ix, ry + 13.2)
    const loadLabW = doc.getTextWidth(loadBr)
    setF('normal', FS_SMALL)
    const loadTxt = slot.load || '-'
    const loadAvail = rightW - (ix - rx) - loadLabW - 2
    const loadLines = splitToWidth(doc, loadTxt, loadAvail)
    doc.text(loadLines[0] || '-', ix + loadLabW, ry + 13.2)
    if (loadLines.length > 1) {
      doc.text(loadLines[1], ix, ry + 16.35)
    }

    setF('bold', FS_SMALL)
    const pwLab = 'PACKAGE WEIGHT:'
    doc.text(pwLab, ix, ry + 20.5)
    setF('normal', FS_SMALL)
    doc.text(slot.weight || '—', ix + doc.getTextWidth(pwLab) + 0.8, ry + 20.5)
    ry += trailerBoxH + gapBox
  }

  for (let i = 0; i < 3; i++) {
    drawTrailerBox(trailerSlots[i], i + 1)
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
    doc.line(ix + doc.getTextWidth(dollyLab) + 0.8, ry + 5.2, rx + rightW - 2, ry + 5.2)
    if (val) {
      setF('normal', FS_BODY)
      doc.text(val, ix + doc.getTextWidth(dollyLab) + 1.2, ry + 6.1)
    }
    ry += dollyBoxH + gapBox
  }

  drawDollyBox('DOLLY 1', dolly1)
  drawDollyBox('DOLLY 2', dolly2)

  /** Trip leg origin — inside right stack (FedEx original placement) */
  strokeRect(rx, ry, rightW, originBoxH, BW_MED)
  const ox = rx + 1.8
  let oy2 = ry + 4
  setF('bold', FS_BODY)
  doc.text(`TRIP LEG ORIGIN: ${originHeader}`, ox, oy2)
  oy2 += 4.5
  setF('normal', FS_SMALL)
  for (const ln of splitToWidth(doc, originAddr, rightW - 4).slice(0, 3)) {
    doc.text(ln, ox, oy2)
    oy2 += 3.35
  }
  if (originPhone) {
    doc.text(originPhone, ox, oy2)
  }
  ry += originBoxH + 2

  y = midTop + midH + 2.5

  /** ---------- Purchased carrier invoice — only under left column ---------- */
  const invH = 16
  strokeRect(M, y, leftW, invH, BW_THIN)
  setF('bold', FS_BODY)
  doc.text('PURCHASED CARRIER INVOICE', M + 2, y + 4.5)
  setF('bold', FS_SMALL)
  const refLab = 'REFERENCE #:'
  doc.text(refLab, M + 2, y + 10)
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(BW_THIN)
  const refLabW = doc.getTextWidth(refLab)
  const refLineX0 = M + 2 + refLabW + 1.2
  doc.line(refLineX0, y + 9.3, M + leftW - 2, y + 9.3)
  if (tmsRef) {
    setF('normal', FS_SMALL)
    doc.text(tmsRef, refLineX0 + 0.6, y + 10.1)
  }
  y += invH + 2.5

  /** ---------- DOT (thick outer) ---------- */
  const dotH = 56
  if (y + dotH > H - 12) {
    doc.addPage()
    y = M
  }
  strokeRect(M, y, IW, dotH, BW_THICK)

  setF('bold', FS_HEAD + 0.5)
  doc.text('DOT REQUIRED PRE-TRIP', W / 2, y + 5.2, { align: 'center' })

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
  const col1 = ['LIGHTS / REFLECTORS', 'TIRES / WHEELS', 'BRAKES', 'SUSPENSION']
  const col2 = ['AIR LINES / AIR SYSTEMS', 'DOOR / DOOR LATCHES', 'LANDING GEAR', 'FRAME']
  const col3 = [
    'COUPLING DEVICES (e.g., FIFTH WHEEL, PINTLE HOOK)',
    'SAFETY CHAIN',
    'BODY: ________________',
    'OTHER: ________________',
  ]
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
  const stmt = ascii(
    'I have inspected all of the above components on the above vehicles/equipment as required by 49 CFR Part 396 and declare that all are compliant with DOT standards.',
  )
  doc.text(doc.splitTextToSize(stmt, IW - 5), M + 2.5, cy)
  cy += 11.5

  setF('normal', FS_SMALL)
  doc.text('Driver Signature ________________________________', M + 2.5, cy)
  doc.text('Date ______________', M + IW * 0.52, cy)
  cy += 4.8
  doc.text('Driver ID Number: ____________________________', M + 2.5, cy)

  y += dotH + 2.5

  /** Footer — FedEx sheet: small muted line at bottom margin (left-aligned like scan) */
  setF('normal', 6)
  doc.setTextColor(...GRAY)
  const foot = `Printed Time: ${ascii(genLabel)}   |   Leg #${legSeq || '—'}   |   FedExTool trip reference (not an official FedEx document)`
  doc.text(foot, M, H - 7.2, { maxWidth: IW })

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
