/**
 * PANYNJ row helpers for server-side bridge tier broadcasts.
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
 */
export function isTunnelRow(row) {
  if (row == null || typeof row !== 'object') return false
  const n = String(
    (/** @type {Record<string, unknown>} */ (row)).crossingDisplayName || '',
  )
  return /\btunnel\b/i.test(n)
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
export function rowDisplayTitle(row) {
  if (row == null || typeof row !== 'object') return 'Crossing'
  const o = /** @type {Record<string, unknown>} */ (row)
  const name =
    typeof o.crossingDisplayName === 'string' ? o.crossingDisplayName : 'Crossing'
  const mod = typeof o.facilityModifier === 'string' ? o.facilityModifier.trim() : ''
  if (mod) return `${name} — ${mod}`
  return name
}

/**
 * @param {unknown} row
 */
export function rowKey(row) {
  if (row == null || typeof row !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (row)
  if (o.routeId == null) return ''
  const id = String(o.routeId)
  const d = normalizeApiTravelDir(o.travelDirection)
  return d ? `${id}:${d}` : id
}
