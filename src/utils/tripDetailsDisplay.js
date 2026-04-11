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
