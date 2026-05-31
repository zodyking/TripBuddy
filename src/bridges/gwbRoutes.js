/**
 * George Washington Bridge upper-deck PANYNJ route IDs.
 * API has used 12 / 211 and 5219 / 881 for the same upper-deck legs.
 */

/** @type {readonly number[]} */
export const GWB_UPPER_ROUTE_IDS_TO_NJ = Object.freeze([12, 5219])

/** @type {readonly number[]} */
export const GWB_UPPER_ROUTE_IDS_TO_NY = Object.freeze([211, 881])

/**
 * @param {unknown} routeId
 * @param {'ToNY' | 'ToNJ'} direction
 */
export function isGwbUpperRouteId(routeId, direction) {
  const n = typeof routeId === 'number' ? routeId : Number(routeId)
  if (!Number.isFinite(n)) return false
  const list = direction === 'ToNY' ? GWB_UPPER_ROUTE_IDS_TO_NY : GWB_UPPER_ROUTE_IDS_TO_NJ
  return list.includes(n)
}

/**
 * @param {unknown} row
 * @param {'ToNY' | 'ToNJ'} direction
 */
export function isGwbUpperDeckRow(row, direction) {
  if (row == null || typeof row !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (row)
  const name = String(o.crossingDisplayName ?? '')
  if (!/george washington bridge/i.test(name)) return false
  const mod = String(o.facilityModifier ?? '').trim().toLowerCase()
  if (mod === 'lower') return false
  if (mod === 'upper') return true
  return isGwbUpperRouteId(o.routeId, direction)
}

/**
 * First known route id for map anchors (12 / 211 are current PANYNJ ids).
 * @param {'ToNY' | 'ToNJ'} direction
 */
export function gwbUpperRouteIdForDirection(direction) {
  return direction === 'ToNY' ? GWB_UPPER_ROUTE_IDS_TO_NY[0] : GWB_UPPER_ROUTE_IDS_TO_NJ[0]
}
