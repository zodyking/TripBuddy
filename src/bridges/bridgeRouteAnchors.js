/**
 * WGS84 anchors on span center (Wikipedia/landmark). One point per *display* lane (not both GWB decks).
 * @type {Readonly<Record<string, readonly [number, number]>>}
 */
export const BRIDGE_ANCHOR = Object.freeze(
  /** @type {Record<string, readonly [number, number]>} */({
    gwb: [40.8517, -73.9527],
    bay217: [40.6419, -74.1422],
    bay222: [40.6418, -74.1415],
    goe87: [40.6356, -74.1972],
    goe86: [40.6355, -74.1965],
    out260: [40.525, -74.247],
    out2520: [40.5252, -74.2463],
  }),
)

/**
 * @param {string} k
 * @returns {readonly [number, number] | null}
 */
export function getAnchorByKey(k) {
  return BRIDGE_ANCHOR[k] || null
}
