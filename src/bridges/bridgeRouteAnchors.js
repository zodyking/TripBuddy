/**
 * Bridge deck center / landmark coordinates (WGS84, public sources: Wikipedia, HAER where noted).
 * One set per `routeId` in PANYNJ `crossingtimesapi.json` (bridge rows only).
 * Slight nudge between ToNY and ToNJ per span so the map re-centers on toggle; all points sit on
 * the crossing — not the distant highway approaches.
 * @type {Readonly<Record<string, { ToNY: readonly [number, number], ToNJ: readonly [number, number] }>>}
 */
const BRIDGE_ANCHORS_BYDIR = Object.freeze(
  /** @type {Record<string, { ToNY: readonly [number, number], ToNJ: readonly [number, number] }>} */({
    /**
     * Bayonne Bridge — Wikipedia: 40.6419°N, 74.1422°W (center / landmark).
     * 217 westbound to NJ, 222 eastbound to NY.
     */
    217: {
      ToNY: [40.64185, -74.1414],
      ToNJ: [40.6415, -74.143],
    },
    222: {
      ToNY: [40.6419, -74.1412],
      ToNJ: [40.6414, -74.1431],
    },
    /**
     * George Washington Bridge — Wikipedia landmark: 40.8517°N, 73.9527°W (Hudson center span).
     * Upper To NY: 881 (was 211). Upper To NJ: 5219 (was 12). Lower: 212 / 11.
     */
    5219: {
      ToNY: [40.8514, -73.9534],
      ToNJ: [40.85185, -73.9521],
    },
    12: {
      ToNY: [40.8514, -73.9534],
      ToNJ: [40.85185, -73.9521],
    },
    11: {
      ToNY: [40.8509, -73.9536],
      ToNJ: [40.8514, -73.9520],
    },
    881: {
      ToNY: [40.85175, -73.9530],
      ToNJ: [40.8512, -73.9533],
    },
    211: {
      ToNY: [40.85175, -73.9530],
      ToNJ: [40.8512, -73.9533],
    },
    212: {
      ToNY: [40.85095, -73.9532],
      ToNJ: [40.8504, -73.9534],
    },
    /**
     * Goethals Bridge — Wikipedia: 40.63556°N, 74.19722°W (centermost main span, HAER ±12 m).
     * 86 east to NY, 87 west to NJ.
     */
    87: {
      ToNY: [40.6351, -74.1962],
      ToNJ: [40.636, -74.1981],
    },
    86: {
      ToNY: [40.6352, -74.1960],
      ToNJ: [40.6359, -74.1980],
    },
    /**
     * Outerbridge — Wikipedia: 40.525°N, 74.247°W (landmark).
     * 2520 east to NY, 260 west to NJ.
     */
    260: {
      ToNY: [40.5254, -74.2460],
      ToNJ: [40.5244, -74.2475],
    },
    2520: {
      ToNY: [40.5253, -74.2458],
      ToNJ: [40.5243, -74.2473],
    },
    /**
     * Verrazzano-Narrows Bridge — Wikipedia: 40.6066°N, 74.0447°W (center main span).
     * MTA bridge, not PANYNJ. Synthetic 'verrazzano' routeId.
     */
    verrazzano: {
      ToNY: [40.6070, -74.0440],
      ToNJ: [40.6062, -74.0454],
    },
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
