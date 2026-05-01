/**
 * Shared PANYNJ bridge row filtering (matches Traffic crossings UI).
 */

/**
 * @param {unknown} v
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
export function normalizeApiTravelDir(v) {
  const s = String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (s === 'TONY' || s === 'TOWARDNY' || s === 'TONYC') return 'ToNY'
  if (s === 'TONJ' || s === 'TOWARDNJ' || s === 'TONJE') return 'ToNJ'
  if (s.includes('TO') && s.includes('NY') && !s.includes('NJ')) return 'ToNY'
  if (s.includes('TO') && s.includes('NJ') && !s.includes('NY')) return 'ToNJ'
  return ''
}

/**
 * @param {unknown} row
 * @param {'ToNY' | 'ToNJ'} d
 */
export function matchDir(row, d) {
  if (row == null || typeof row !== 'object' || !('travelDirection' in row)) {
    return false
  }
  const raw = /** @type {Record<string, unknown>} */ (row).travelDirection
  return normalizeApiTravelDir(raw) === d
}

/** @param {unknown} row */
export function isTunnelRow(row) {
  if (row == null || typeof row !== 'object') return false
  const n = String(
    (/** @type {Record<string, unknown>} */ (row)).crossingDisplayName || '',
  )
  return /\btunnel\b/i.test(n)
}

/** @param {unknown} row */
export function isGwbRow(row) {
  return (
    row != null &&
    typeof row === 'object' &&
    /george washington bridge/i.test(
      String(/** @type {Record<string, unknown>} */ (row).crossingDisplayName || ''),
    )
  )
}

/**
 * GWB upper deck only for toggle.
 * @param {unknown} row
 * @param {'ToNY' | 'ToNJ'} d
 */
export function gwbMatchRouteForToggle(row, d) {
  const o = /** @type {Record<string, unknown>} */ (row)
  const rid = o.routeId
  const n = typeof rid === 'number' ? rid : Number(rid)
  if (d === 'ToNY') return n === 211
  return n === 12
}

/**
 * @param {unknown[]} live
 * @param {'ToNY' | 'ToNJ'} d
 */
export function filterBridgeRowsForDirection(live, d) {
  if (!Array.isArray(live)) return []
  return live.filter((r) => {
    if (isTunnelRow(r)) return false
    if (!matchDir(r, d)) return false
    if (isGwbRow(r) && !gwbMatchRouteForToggle(r, d)) return false
    return true
  })
}

/**
 * @param {unknown} row
 */
export function rowTravelMinutes(row) {
  if (row == null || typeof row !== 'object') return null
  const m = (/** @type {Record<string, unknown>} */ (row)).routeTravelTime
  if (typeof m === 'number' && Number.isFinite(m)) return m
  if (typeof m === 'string' && m !== '') {
    const n = Number(m)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * @param {unknown} row
 */
export function rowRouteSpeedMph(row) {
  if (row == null || typeof row !== 'object') return null
  const s = (/** @type {Record<string, unknown>} */ (row)).routeSpeed
  if (typeof s === 'number' && Number.isFinite(s)) return s
  if (typeof s === 'string' && s !== '') {
    const n = Number(s)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * @param {unknown} row
 */
export function rowRouteId(row) {
  if (row == null || typeof row !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (row)
  if (o.routeId == null) return ''
  return String(o.routeId)
}

/**
 * @param {unknown} row
 */
export function rowDisplayTitle(row) {
  if (row == null || typeof row !== 'object') return 'Bridge'
  const o = /** @type {Record<string, unknown>} */ (row)
  const name =
    typeof o.crossingDisplayName === 'string' ? o.crossingDisplayName : 'Bridge'
  const mod = typeof o.facilityModifier === 'string' ? o.facilityModifier.trim() : ''
  if (isGwbRow(row)) {
    const base = String(name)
      .replace(/\s*[—–-]\s*(upper|lower)\s*$/i, '')
      .trim()
    return `${base || name} — Upper`
  }
  if (mod) return `${name} — ${mod}`
  return name
}
