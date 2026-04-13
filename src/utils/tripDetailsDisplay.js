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
 * @param {unknown} body trips `body` object
 * @returns {{ origin: string, destination: string }}
 */
export function extractOriginDest(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { origin: '—', destination: '—' }
  }
  const o = /** @type {Record<string, unknown>} */ (body)
  const originNum = o.originLocation ?? o.currentLocationNumber
  const originName = o.currentLocationName || o.currentLocationAbbrv || ''
  const destNum = o.tripDestNumber
  const destName = o.tripDest || o.tripDestAbbrv || ''

  let origin = originNum != null ? String(originNum) : '—'
  if (originName) origin = `${origin} · ${originName}`

  let destination = destNum != null ? String(destNum) : '—'
  if (destName) destination = `${destination} · ${destName}`

  return { origin, destination }
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
 * @returns {{
 *   trlrNbr: string,
 *   size: '20ft' | '53ft',
 *   loadStatus: string,
 *   statusLabel: string,
 *   statusClass: string,
 *   emptyFlag: string,
 *   loadType: string,
 *   loadTypeClass: string,
 *   hasGps: boolean,
 *   lat: number | null,
 *   lng: number | null,
 *   sealNumber: string,
 *   loadDest: string,
 *   pkgWeight: string,
 *   dueDate: string
 * }}
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
  } else if (loadStatus) {
    statusLabel = loadStatus
  }

  const emptyFlag = String(trailer.emptyFlag ?? '').toUpperCase()
  let loadType = '—'
  let loadTypeClass = 'load-unknown'
  if (emptyFlag === 'N') {
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
    dueDate,
  }
}

/**
 * Build enhanced trailer cards with header badges and categorized rows.
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
 *   summaryRows: { label: string, value: string }[],
 *   detailRows: { label: string, value: string }[]
 * }[]}
 */
export function buildEnhancedTrailerCards(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return []
  const o = /** @type {Record<string, unknown>} */ (body)
  const arr = o.trailers
  if (!Array.isArray(arr)) return []

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

  return arr
    .map((t, i) => {
      const tr =
        t && typeof t === 'object' && !Array.isArray(t)
          ? /** @type {Record<string, unknown>} */ (t)
          : {}

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
        id: `trailer-${order}-${i}`,
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
