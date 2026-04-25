/**
 * Map anchor per PANYNJ `routeId` (one point per live API row, bridges only — no tunnels).
 * Approximate mid-crossing; for glance UI / comparison, not survey-grade.
 * @type {Readonly<Record<string, readonly [number, number]>>}
 */
export const BRIDGE_ANCHOR_BY_ROUTE_ID = Object.freeze(
  /** @type {Record<string, readonly [number, number]>} */ ({
    // Bayonne
    217: [40.64, -74.134],
    222: [40.64, -74.132],
    // George Washington — Upper / Lower (separate route rows)
    12: [40.8521, -73.9522],
    211: [40.851, -73.9528],
    11: [40.8506, -73.9519],
    212: [40.8495, -73.9523],
    // Goethals
    87: [40.619, -74.19],
    86: [40.618, -74.189],
    // Outerbridge
    260: [40.5305, -74.253],
    2520: [40.529, -74.25],
  }),
)

/**
 * @param {string} routeId
 * @returns {readonly [number, number] | null}
 */
export function getBridgeAnchorForRouteId(routeId) {
  const k = String(routeId ?? '')
  if (!k) return null
  if (k in BRIDGE_ANCHOR_BY_ROUTE_ID) {
    return BRIDGE_ANCHOR_BY_ROUTE_ID[k]
  }
  return null
}
