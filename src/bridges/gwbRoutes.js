/**
 * George Washington Bridge upper-deck PANYNJ route IDs.
 * API switched from 12 (To NJ) / 211 (To NY) to 5219 / 881; keep both for stored history.
 */

/** @type {readonly number[]} */
export const GWB_UPPER_ROUTE_IDS_TO_NJ = Object.freeze([5219, 12])

/** @type {readonly number[]} */
export const GWB_UPPER_ROUTE_IDS_TO_NY = Object.freeze([881, 211])

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
 * Preferred route id for map anchors / export (current PANYNJ API).
 * @param {'ToNY' | 'ToNJ'} direction
 */
export function gwbUpperRouteIdForDirection(direction) {
  return direction === 'ToNY' ? GWB_UPPER_ROUTE_IDS_TO_NY[0] : GWB_UPPER_ROUTE_IDS_TO_NJ[0]
}
