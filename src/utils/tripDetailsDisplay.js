/**
 * Display helpers for FedEx `GET …/trips` payload (see Agent-Files/fedex trip details api.md).
 */

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function humanizeKey(key) {
  const s = key.replace(/([A-Z])/g, ' $1').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Route labels for the dispatch card. FedEx trip payloads use current stop + trip
 * destination; `originLocation` may equal current stop number — prefer current
 * location for “where I am / start” and tripDest* for “where this leg is going.”
 * @param {unknown} body trips `body` object
 * @returns {{ origin: string, destination: string }}
 */
export function extractOriginDest(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { origin: '—', destination: '—' }
  }
  const o = /** @type {Record<string, unknown>} */ (body)
  // Current position / origin side (tractor at this location)
  const oNum = o.currentLocationNumber ?? o.originLocation
  const oName = o.currentLocationName || o.currentLocationAbbrv || ''
  // Trip destination (next terminal / end of leg in payload)
  const dNum = o.tripDestNumber
  const dName = o.tripDest || o.tripDestAbbrv || ''

  let origin = oNum != null && String(oNum).trim() !== '' ? String(oNum) : '—'
  if (oName) origin = `${origin} · ${oName}`

  let destination = dNum != null && String(dNum).trim() !== '' ? String(dNum) : '—'
  if (dName) destination = `${destination} · ${dName}`

  return { origin, destination }
}

/**
 * Org ids for mileage API (`orgIdOrigin`, `orgIdDest`) — digits from trip payload.
 * @param {unknown} body
 * @returns {{ originId: string | null, destinationId: string | null }}
 */
export function extractTripOrgIds(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { originId: null, destinationId: null }
  }
  const o = /** @type {Record<string, unknown>} */ (body)
  const rawO = o.currentLocationNumber ?? o.originLocation
  const rawD = o.tripDestNumber
  const originId =
    rawO != null && String(rawO).trim() !== ''
      ? String(rawO).replace(/\D/g, '').slice(0, 12) || null
      : null
  const destinationId =
    rawD != null && String(rawD).trim() !== ''
      ? String(rawD).replace(/\D/g, '').slice(0, 12) || null
      : null
  return { originId, destinationId }
}

/**
 * True when trip details include both origin and destination (not placeholders).
 * @param {unknown} body
 */
export function hasTripOriginAndDestination(body) {
  const { origin, destination } = extractOriginDest(body)
  return origin !== '—' && destination !== '—'
}

/**
 * Best-effort: pull dispatch / special instruction text from trip payload keys that vary by API version.
 * @param {unknown} body
 * @returns {string}
 */
export function extractTripDispatchInstructions(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return ''
  const o = /** @type {Record<string, unknown>} */ (body)
  const preferredKeys = [
    'dispatchInstructions',
    'tripInstructions',
    'specialInstructions',
    'splInstr',
    'splInstruction',
    'tripComment',
    'dispatchComment',
    'tripRemarks',
    'dispatchRemarks',
    'specialMessage',
    'tripNotes',
    'dispatchNotes',
    'tmsComments',
    'comments',
  ]
  const parts = []
  const seen = new Set()
  const push = (s) => {
    const t = String(s).trim()
    if (!t || t === '—') return
    const low = t.toLowerCase()
    if (seen.has(low)) return
    seen.add(low)
    parts.push(t)
  }
  for (const key of preferredKeys) {
    if (!(key in o)) continue
    const v = o[key]
    if (typeof v === 'string') push(v)
    else if (v != null && typeof v !== 'object') push(String(v))
  }
  for (const key of Object.keys(o)) {
    if (preferredKeys.includes(key)) continue
    if (!/(instruction|remark|comment|splinstr|splmessage|notes)$/i.test(key)) continue
    const v = o[key]
    if (typeof v === 'string') push(v)
    else if (v != null && typeof v !== 'object') push(String(v))
  }
  return parts.join('\n\n')
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {{ label: string, value: string }[]}
 */
function rowsFromObject(obj) {
  return Object.keys(obj)
    .sort()
    .map((k) => ({ label: humanizeKey(k), value: fmt(obj[k]) }))
}

/**
 * @param {unknown} body
 * @returns {{ id: string, title: string, rows: { label: string, value: string }[] }[]}
 * @deprecated Use buildEnhancedTrailerCards for the new card design
 */
export function buildTrailerCards(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return []
  const o = /** @type {Record<string, unknown>} */ (body)
  const arr = o.trailers
  if (!Array.isArray(arr)) return []
  return arr.map((t, i) => {
    const tr = t && typeof t === 'object' && !Array.isArray(t)
      ? /** @type {Record<string, unknown>} */ (t)
      : {}
    const order = tr.trlrOrder != null ? String(tr.trlrOrder) : String(i + 1)
    return {
      id: `trailer-${order}-${i}`,
      title: `Trailer ${order}`,
      rows: rowsFromObject(tr),
    }
  }).filter((card) => card.rows.length > 0)
}

/**
 * Parse trailer metadata for display badges.
 * @param {Record<string, unknown>} trailer
 */
export function parseTrailerMeta(trailer) {
  const trlrNbr = String(trailer.trlrNbr ?? '').trim()
  const size = trlrNbr.startsWith('8') ? '20ft' : '53ft'

  const loadStatus = String(trailer.detlCodeLoadStatus ?? '').toUpperCase()
  let statusLabel = '—'
  let statusClass = 'status-unknown'
  if (loadStatus === 'LDNG') {
    statusLabel = 'Loading'
    statusClass = 'status-loading'
  } else if (loadStatus === 'CLSD') {
    statusLabel = 'Closed'
    statusClass = 'status-closed'
  } else if (loadStatus === 'TMPCL') {
    statusLabel = 'TMPCL'
    statusClass = 'status-tmpcl'
  } else if (loadStatus) {
    statusLabel = loadStatus
  }

  const emptyFlag = String(trailer.emptyFlag ?? '').toUpperCase()

  /** @returns {number | null} */
  const pkgWeightLbs = () => {
    const w = trailer.pkgWeight
    if (w === null || w === undefined || w === '') return null
    const n = typeof w === 'number' ? w : parseFloat(String(w).replace(/,/g, '').trim())
    return Number.isFinite(n) ? n : null
  }

  /**
   * Empty vs LOAD badge: `emptyFlag` alone is unreliable next to `pkgWeight` (e.g. N + 0 lbs).
   * Prefer actual weight when present; fall back to Y/N only when weight is absent.
   */
  let loadType = '—'
  let loadTypeClass = 'load-unknown'
  const lbs = pkgWeightLbs()
  if (lbs !== null) {
    if (lbs > 0) {
      loadType = 'LOAD'
      loadTypeClass = 'load-full'
    } else {
      loadType = 'Empty'
      loadTypeClass = 'load-empty'
    }
  } else if (emptyFlag === 'N') {
    loadType = 'LOAD'
    loadTypeClass = 'load-full'
  } else if (emptyFlag === 'Y') {
    loadType = 'Empty'
    loadTypeClass = 'load-empty'
  }

  const lat = trailer.latitude != null ? Number(trailer.latitude) : null
  const lng = trailer.longitude != null ? Number(trailer.longitude) : null
  const hasGps = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)

  const sealNumber = fmt(trailer.sealNumber)
  const loadDest = trailer.loadDest
    ? `${fmt(trailer.loadDestNumber)} · ${fmt(trailer.loadDest)}`
    : fmt(trailer.loadDestNumber)
  const pkgWeight = trailer.pkgWeight != null ? `${fmt(trailer.pkgWeight)} lbs` : '—'

  let dueDate = '—'
  if (trailer.dueDate) {
    try {
      const d = new Date(String(trailer.dueDate))
      if (!isNaN(d.getTime())) {
        dueDate = d.toLocaleString()
      }
    } catch {
      dueDate = fmt(trailer.dueDate)
    }
  }

  return {
    trlrNbr,
    size,
    loadStatus,
    statusLabel,
    statusClass,
    emptyFlag,
    loadType,
    loadTypeClass,
    hasGps,
    lat,
    lng,
    sealNumber,
    loadDest,
    pkgWeight,
    /** Numeric lbs when API sends pkgWeight; null if unknown */
    pkgWeightLbs: lbs,
    dueDate,
  }
}

/**
 * History ledger snapshots store `loadType` from an older parse; re-derive from snapshot `Weight` row when possible.
 * @param {{ loadType?: string, loadTypeClass?: string, summaryRows?: { label: string, value: string }[] }} card
 */
export function resolveHistoryTrailerLoadBadge(card) {
  const rows = Array.isArray(card?.summaryRows) ? card.summaryRows : []
  const wRow = rows.find((r) => String(r?.label ?? '').trim().toLowerCase() === 'weight')
  if (wRow) {
    const raw = String(wRow.value ?? '').trim()
    const m = raw.match(/([\d.,]+)\s*lbs?\b/i)
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''))
      if (Number.isFinite(n)) {
        return n > 0
          ? { text: 'LOAD', variant: 'full' }
          : { text: 'Empty', variant: 'empty' }
      }
    }
  }
  const lt = String(card?.loadType ?? '').trim()
  if (lt && lt !== '—') {
    const u = lt.toUpperCase()
    if (u === 'EMPTY') return { text: lt, variant: 'empty' }
    if (u === 'LOAD') return { text: lt, variant: 'full' }
    return { text: lt, variant: 'unknown' }
  }
  return { text: '—', variant: 'unknown' }
}

/**
 * Stable order: API `trlrOrder` is not always ordered; prefer `dailyTripLegConfigSeq` when present.
 * @param {Record<string, unknown>} tr
 * @param {number} index
 */
function trailerCardSortKey(tr, index) {
  const seq = tr.dailyTripLegConfigSeq
  if (seq != null && String(seq).trim() !== '') {
    const n = Number(seq)
    if (Number.isFinite(n)) return n
  }
  const ord = tr.trlrOrder
  if (ord != null && String(ord).trim() !== '') {
    const n = Number(ord)
    if (Number.isFinite(n)) return n
  }
  return 1e12 + index
}

/**
 * Build enhanced trailer cards with header badges and categorized rows.
 * Trailers are sorted by `dailyTripLegConfigSeq` (then `trlrOrder`) so display order matches trip order.
 * @param {unknown} body
 * @returns {{
 *   id: string,
 *   order: string,
 *   trlrNbr: string,
 *   size: '20ft' | '53ft',
 *   statusLabel: string,
 *   statusClass: string,
 *   loadType: string,
 *   loadTypeClass: string,
 *   hasGps: boolean,
 *   lat: number | null,
 *   lng: number | null,
 *   pkgWeightLbs: number | null,
 *   summaryRows: { label: string, value: string }[],
 *   detailRows: { label: string, value: string }[]
 * }[]}
 */
export function buildEnhancedTrailerCards(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return []
  const o = /** @type {Record<string, unknown>} */ (body)
  const arr = o.trailers
  if (!Array.isArray(arr)) return []

  const indexed = arr
    .map((t, i) => {
      const tr =
        t && typeof t === 'object' && !Array.isArray(t)
          ? /** @type {Record<string, unknown>} */ (t)
          : {}
      return { tr, i }
    })
    .sort((a, b) => {
      const ka = trailerCardSortKey(a.tr, a.i)
      const kb = trailerCardSortKey(b.tr, b.i)
      if (ka !== kb) return ka - kb
      return a.i - b.i
    })

  const summaryKeys = new Set([
    'sealNumber',
    'loadNumber',
    'loadDest',
    'loadDestNumber',
    'pkgWeight',
    'dueDate',
  ])

  const excludeFromDetails = new Set([
    'trlrOrder',
    'trlrNbr',
    'trlrPrefix',
    'detlCodeLoadStatus',
    'emptyFlag',
    'latitude',
    'longitude',
    'lastGpsDate',
    'dailyTripLegConfigSeq',
    ...summaryKeys,
  ])

  return indexed
    .map(({ tr, i }) => {
      const order = tr.trlrOrder != null ? String(tr.trlrOrder) : String(i + 1)
      const meta = parseTrailerMeta(tr)

      const summaryRows = [
        { label: 'Seal', value: meta.sealNumber },
        { label: 'Destination', value: meta.loadDest },
        { label: 'Weight', value: meta.pkgWeight },
        { label: 'Due', value: meta.dueDate },
      ].filter((r) => r.value !== '—')

      const detailRows = Object.keys(tr)
        .filter((k) => !excludeFromDetails.has(k))
        .sort()
        .map((k) => ({ label: humanizeKey(k), value: fmt(tr[k]) }))
        .filter((r) => r.value !== '—')

      return {
        id: `trailer-${i}-${order}`,
        order,
        trlrNbr: meta.trlrNbr,
        size: meta.size,
        statusLabel: meta.statusLabel,
        statusClass: meta.statusClass,
        loadType: meta.loadType,
        loadTypeClass: meta.loadTypeClass,
        hasGps: meta.hasGps,
        lat: meta.lat,
        lng: meta.lng,
        pkgWeightLbs: meta.pkgWeightLbs,
        summaryRows,
        detailRows,
      }
    })
    .filter((card) => card.trlrNbr || card.summaryRows.length > 0 || card.detailRows.length > 0)
}

/**
 * @param {unknown} body
 * @returns {{ show: boolean, rows: { label: string, value: string }[], hasData: boolean }}
 * `show` is true only when at least one dolly field is non-empty (omit block otherwise).
 */
export function buildDollySection(body) {
  const dollyKeys = [
    'dollyNumber1',
    'dollyNumber2',
    'dollyEquipmentSequence1',
    'dollyEquipmentSequence2',
  ]
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { show: false, rows: [], hasData: false }
  }
  const o = /** @type {Record<string, unknown>} */ (body)
  const rows = dollyKeys.map((k) => ({
    label: humanizeKey(k),
    value: fmt(o[k]),
  }))
  const hasData = rows.some((r) => r.value !== '—')
  return { show: hasData, rows, hasData }
}

/** Same substitutions as week-totals PDF (WinAnsi-safe). */
function pdfEquipmentAscii(s) {
  return String(s ?? '')
    .replace(/\u2192/g, '->')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u00b7/g, '|')
    .replace(/\u2022/g, '*')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function pdfDollyEquipmentLine(body) {
  const o =
    body && typeof body === 'object' && !Array.isArray(body)
      ? /** @type {Record<string, unknown>} */ (body)
      : {}
  const nested = o.dolly
  /** @type {string[]} */
  let parts = []
  if (nested && typeof nested === 'object' && Array.isArray(nested.rows)) {
    for (const row of nested.rows) {
      if (!row || typeof row !== 'object') continue
      const label = String(/** @type {{ label?: unknown }} */ (row).label ?? '').trim()
      const value = String(/** @type {{ value?: unknown }} */ (row).value ?? '').trim()
      if (!value || value === '—' || value === '-' || value === '–') continue
      parts.push(`${label}: ${value}`)
    }
  }
  if (!parts.length) {
    const flat = buildDollySection(body)
    parts = flat.rows
      .filter((r) => r.value !== '—')
      .map((r) => `${r.label}: ${r.value}`)
  }
  if (!parts.length) return ''
  return `Dolly | ${parts.join(' | ')}`
}

/**
 * Trailers for PDF: supports raw Linehaul trip bodies and persisted history cards (`summaryRows`).
 * @param {unknown} body
 * @returns {string[]}
 */
function pdfTrailerEquipmentLines(body) {
  const o =
    body && typeof body === 'object' && !Array.isArray(body)
      ? /** @type {Record<string, unknown>} */ (body)
      : {}
  const arr = o.trailers
  if (!Array.isArray(arr) || arr.length === 0) return []

  const first = arr[0]
  const isPersistedCard =
    first &&
    typeof first === 'object' &&
    Array.isArray(/** @type {{ summaryRows?: unknown }} */ (first).summaryRows)

  if (isPersistedCard) {
    return arr.map((raw, i) => {
      const c = /** @type {Record<string, unknown>} */ (raw)
      const order = c.order != null ? String(c.order) : String(i + 1)
      const nbr = String(c.trlrNbr ?? '').trim()
      const size = String(c.size ?? '').trim()
      const rows = Array.isArray(c.summaryRows) ? c.summaryRows : []
      /** @param {string} lab */
      const valFor = (lab) => {
        const row = rows.find(
          (r) =>
            r &&
            typeof r === 'object' &&
            String(/** @type {{ label?: unknown }} */ (r).label ?? '').trim() === lab,
        )
        return row
          ? String(/** @type {{ value?: unknown }} */ (row).value ?? '').trim()
          : ''
      }
      const seal = valFor('Seal')
      const weight = valFor('Weight')
      /** @type {string[]} */
      const bits = [
        `Trailer ${order}`,
        nbr ? `#${nbr}` : '',
        size,
        seal && seal !== '—' ? `Seal ${seal}` : '',
        weight && weight !== '—' ? weight : '',
      ].filter(Boolean)
      return bits.join(' | ')
    })
  }

  const cards = buildEnhancedTrailerCards(body)
  return cards.map((c) => {
    const sealRow = c.summaryRows.find((r) => r.label === 'Seal')
    const seal =
      sealRow && sealRow.value !== '—' ? String(sealRow.value).trim() : ''
    const weightRow = c.summaryRows.find((r) => r.label === 'Weight')
    const weight =
      weightRow && weightRow.value !== '—' ? String(weightRow.value).trim() : ''
    /** @type {string[]} */
    const bits = [
      `Trailer ${c.order}`,
      c.trlrNbr ? `#${c.trlrNbr}` : '',
      c.size,
      seal ? `Seal ${seal}` : '',
      weight,
    ].filter(Boolean)
    return bits.join(' | ')
  })
}

/**
 * Multi-line block for History week PDF: dolly fields plus each trailer
 * (number, size, seal, weight only — no load/status/destination).
 * Works with raw trip payloads and with `buildHistoryTripDetailsFromBody` snapshots.
 * @param {unknown} body `tripDetails` or Linehaul trip body
 * @returns {string} WinAnsi-safe text; empty when no equipment rows
 */
export function formatTripEquipmentPdfBlock(body) {
  /** @type {string[]} */
  const lines = []
  const dolly = pdfDollyEquipmentLine(body)
  if (dolly) lines.push(dolly)
  lines.push(...pdfTrailerEquipmentLines(body))
  if (!lines.length) return ''
  return lines.map((ln) => pdfEquipmentAscii(ln)).join('\n')
}
