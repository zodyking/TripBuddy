/**
 * Label for “my location” truck marker: live Linehaul tractor body, else Settings tractor number.
 * @param {unknown} tractorBody
 * @param {unknown} credentialsMeta API `/api/settings/credentials` JSON (optional)
 */
export function vehicleIdForUserMapMarker(tractorBody, credentialsMeta) {
  if (tractorBody != null && typeof tractorBody === 'object') {
    const tn = /** @type {Record<string, unknown>} */ (tractorBody).tractorNbr
    if (tn != null) {
      const s = String(tn).trim()
      if (s) return s
    }
  }
  if (credentialsMeta != null && typeof credentialsMeta === 'object') {
    const cn = /** @type {Record<string, unknown>} */ (credentialsMeta).tractorNumber
    if (cn != null) {
      const s = String(cn).trim()
      if (s) return s
    }
  }
  return ''
}
