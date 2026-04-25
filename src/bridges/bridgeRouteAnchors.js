/**
 * Map anchors per PANYNJ `routeId` (one row per live API record; bridges only — no tunnels).
 * Slightly offset for ToNY / ToNJ so the map “leans” the right way when a direction is selected.
 * @type {Readonly<Record<string, { ToNY: readonly [number, number], ToNJ: readonly [number, number] }>>}
 */
const BRIDGE_ANCHORS_BYDIR = Object.freeze(
  /** @type {Record<string, { ToNY: readonly [number, number], ToNJ: readonly [number, number] }>} */({
    // Bayonne
    217: { ToNY: [40.6412, -74.1336], ToNJ: [40.6405, -74.1345] },
    222: { ToNY: [40.641, -74.1328], ToNJ: [40.64, -74.1332] },
    // George Washington — per deck / direction
    12: { ToNY: [40.8524, -73.9515], ToNJ: [40.8522, -73.9522] },
    211: { ToNY: [40.8508, -73.9526], ToNJ: [40.8505, -73.9531] },
    11: { ToNY: [40.8509, -73.9512], ToNJ: [40.8504, -73.9517] },
    212: { ToNY: [40.8488, -73.9526], ToNJ: [40.8485, -73.9529] },
    // Goethals
    87: { ToNY: [40.6192, -74.1892], ToNJ: [40.6185, -74.1902] },
    86: { ToNY: [40.6188, -74.1882], ToNJ: [40.618, -74.189] },
    // Outerbridge
    260: { ToNY: [40.5308, -74.2522], ToNJ: [40.53, -74.2532] },
    2520: { ToNY: [40.5292, -74.2492], ToNJ: [40.5285, -74.2502] },
  }),
)

/**
 * @param {string} routeId
 * @param {'ToNY' | 'ToNJ'} [direction]
 * @returns {readonly [number, number] | null}
 */
export function getBridgeAnchorForRouteId(routeId, direction) {
  const k = String(routeId ?? '')
  if (!k || !(k in BRIDGE_ANCHORS_BYDIR)) return null
  const row = BRIDGE_ANCHORS_BYDIR[k]
  const d = direction === 'ToNY' || direction === 'ToNJ' ? direction : 'ToNY'
  return row[d] ?? null
}
