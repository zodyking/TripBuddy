/**
 * Infer Trip Ready boolean from FedEx trip-status JSON (schema varies).
 * @param {unknown} body
 * @returns {boolean | null} null if no boolean could be inferred
 */
export function parseTripReadyBoolean(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const o = /** @type {Record<string, unknown>} */ (body)
  const preferredKeys = [
    'tripReady',
    'tripReadyInd',
    'readyInd',
    'isTripReady',
    'ready',
    'tripPreparationComplete',
    'tripStatusReady',
  ]
  for (const k of preferredKeys) {
    if (!(k in o)) continue
    const v = o[k]
    if (typeof v === 'boolean') return v
    if (v === true || v === false) return Boolean(v)
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase()
      if (s === 'y' || s === 'true' || s === 'yes') return true
      if (s === 'n' || s === 'false' || s === 'no') return false
    }
  }
  for (const v of Object.values(o)) {
    if (typeof v === 'boolean') return v
  }
  return null
}
