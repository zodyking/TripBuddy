/**
 * Shared WAHA message timestamp extraction (client + server).
 * @param {unknown} msg
 * @returns {number} Milliseconds since epoch, or 0 if unknown
 */
export function wahaMessageTimestampMs(msg) {
  if (!msg || typeof msg !== 'object') return 0
  const data = /** @type {Record<string, unknown>} */ (msg)._data
  const dataObj = data && typeof data === 'object' ? data : {}
  const m = /** @type {Record<string, unknown>} */ (msg)
  const candidates = [
    m.timestamp,
    m.messageTimestamp,
    m.ts,
    m.t,
    dataObj.timestamp,
    dataObj.messageTimestamp,
    dataObj.ts,
    dataObj.t,
  ]
  let ts = candidates.map((v) => Number(v)).find((v) => Number.isFinite(v) && v > 0)
  if (!Number.isFinite(ts)) return 0
  if (ts < 1e12) ts *= 1000
  return Math.floor(ts)
}
