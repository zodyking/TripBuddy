import { normalizeDirectoryLocationId } from './directoryLocationLookup.js'
import { generateLinehaulPretripPDF } from './linehaulPretripPdfTemplate.js'

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
  // First check linehaulExtras
  for (const k of preferredKeys) {
    if (extras[k]) return extras[k]
  }
  for (const [k, v] of Object.entries(extras)) {
    if (/arriv|eta|sched|due|est.*time|trip.*time/i.test(k) && v.length < 140) return v
  }
  // Check top-level td fields (raw API may store ETA directly)
  for (const k of preferredKeys) {
    const v = td[k]
    if (v != null && typeof v !== 'object') {
      const s = String(v).trim()
      if (s) return s
    }
  }
  // Check mileage sub-object
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

/** @param {string} stateZip e.g. `NY 11714` */
function stateZipParts(stateZip) {
  const m = String(stateZip ?? '').match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
  if (!m) return { state: '', zip: '' }
  return { state: m[1].toUpperCase(), zip: m[2] }
}

/** Split ETA string for two-field template layout (main + trailing TZ). */
function splitEtaDisplay(etaAscii) {
  const s = String(etaAscii || '').trim()
  if (!s) return { eta: '', timezone: '' }
  const m = s.match(
    /^(.+?)\s+(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|AST|UTC|GMT)$/i,
  )
  if (m) return { eta: m[1].trim(), timezone: m[2].toUpperCase() }
  return { eta: s, timezone: '' }
}

/** Template prints the "BASED UPON" label separately; value column is the rest of the FedEx line. */
function basedUponValueOnly(fullLine) {
  return String(fullLine || '')
    .trim()
    .replace(/^BASED\s+UPON\s+/i, '')
    .trim()
}

/** Footer printed time (Eastern), e.g. `May 16 2026 23:55 EDT`. */
function formatPrintedTimeFedex(tsMs = Date.now()) {
  const d = new Date(tsMs)
  if (isNaN(d.getTime())) return ''
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
  const hr = get('hour')
  const min = get('minute')
  const tzParts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d)
  const tzRaw = tzParts.find((p) => p.type === 'timeZoneName')?.value?.trim() ?? ''
  const tzAbbr = /^(EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/i.test(tzRaw) ? tzRaw.toUpperCase() : 'EDT'
  return `${mon} ${day} ${yr} ${hr}:${min} ${tzAbbr}`
}

/** Signature date format (MM/DD/YY style for handwritten look). */
function formatSignatureDateFedex(tsMs = Date.now()) {
  const d = new Date(tsMs)
  if (isNaN(d.getTime())) return ''
  const tz = 'America/New_York'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  }).formatToParts(d)
  /** @param {string} t */
  const get = (t) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('month')}/${get('day')}/${get('year')}`
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

  // Prefer directory abbreviation (4-letter code like "BETH") over dispatch label which may have full name
  const destAbbr =
    dirGet(opts.directory, opts.destLocationId)?.abbreviation ||
    extras.tripDestAbbrv ||
    locAbbrFromDispatchLabel(dh.destination) ||
    ''
  const originAbbr =
    dirGet(opts.directory, opts.originLocationId)?.abbreviation ||
    extras.currentLocationAbbrv ||
    locAbbrFromDispatchLabel(dh.origin) ||
    ''

  const tripDestHeaderShort =
    destId && destAbbr
      ? `${destId} / ${ascii(destAbbr).toUpperCase()}`
      : destId || ascii(str(dh.destination)).toUpperCase() || '-'

  const driverFedex = formatDriverFedex((opts.driverName || '').trim())

  const destDir = dirGet(opts.directory, opts.destLocationId)
  const originDir = dirGet(opts.directory, opts.originLocationId)

  // Prefer tripDest from linehaulExtras (full name like "BETHPAGE - HD - HOME DELIVERY")
  // Fall back to directory locationName, then dispatch header destination
  const destNameLine = ascii(
    extras.tripDest ||
    destDir?.locationName ||
    str(dh.destination).replace(/^[\d\s]+·\s*/, '').trim() ||
    '-',
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

  // td.trailers is already pre-processed by buildHistoryTripDetailsFromBody with summaryRows
  const storedTrailers = Array.isArray(td.trailers) ? td.trailers : []
  /** @type {{ order: string, trlr: string, seal: string, load: string, weight: string }[]} */
  const trailerSlots = []
  for (let i = 0; i < 3; i++) {
    const c = storedTrailers[i]
    if (c && typeof c === 'object') {
      const rows = Array.isArray(c.summaryRows) ? c.summaryRows : []
      const sealRow = rows.find((r) => r.label === 'Seal')
      const destRow = rows.find((r) => r.label === 'Destination')
      const wtRow = rows.find((r) => r.label === 'Weight')
      trailerSlots.push({
        order: String(c.order ?? i + 1),
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

  const { eta: etaField, timezone: tzField } = splitEtaDisplay(etaDisplay)
  const basedUponField = basedUponValueOnly(basedUponFedexExact)

  let destAddress = ''
  let destCity = ''
  let destState = ''
  let destZip = ''
  if (destAddrParsed) {
    destAddress = destAddrParsed.streetPart || ''
    destCity = destAddrParsed.city || ''
    const sz = stateZipParts(destAddrParsed.stateZip)
    destState = sz.state
    destZip = sz.zip
  } else if (destAddrRawForParse) {
    destAddress = destAddrRawForParse
  }

  let originStreet = ''
  let originCity = ''
  let originState = ''
  let originZip = ''
  if (originAddrParsed) {
    originStreet = originAddrParsed.streetPart || originAddr
    originCity = originAddrParsed.city || ''
    const oz = stateZipParts(originAddrParsed.stateZip)
    originState = oz.state
    originZip = oz.zip
  } else {
    originStreet = originAddr
  }

  const tractorField = tractor === '-' ? '' : tractor

  const doc = generateLinehaulPretripPDF({
    tractor: tractorField,
    destination: tripDestHeaderShort,
    tripDestination: tripDestHeaderShort,
    driver: driverFedex,
    eta: etaField,
    timezone: tzField,
    basedUpon: basedUponField,
    facilityName: ascii(destNameLine).toUpperCase(),
    address: destAddress,
    city: destCity,
    state: destState,
    zip: destZip,
    phone: destPhone,
    paid: paidMi || '-',
    avr: '1-888-867-1142',
    invoiceRef: tmsRef,
    gpsNorth: latStr,
    gpsWest: lngStr,
    originCode: originHeader,
    originAddress: originStreet,
    originCity,
    originState,
    originZip,
    originPhone,
    printedTime: formatPrintedTimeFedex(),
    trailers: trailerSlots.map((s) => ({
      number: s.trlr,
      seal: s.seal,
      load: s.load || 'N/A',
      weight: s.weight || 'N/A',
    })),
    dollies: [dolly1, dolly2],
    // Driver-filled fields (handwriting style)
    driverSignature: driverFedex, // Use driver name as signature
    signatureDate: formatSignatureDateFedex(dispatchTs ?? Date.now()), // Use trip date
    driverId: ascii(String(opts.employeeNumber ?? '').trim()),
  })
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
