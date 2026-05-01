/**
 * Infer PANYNJ-style travel direction (ToNY / ToNJ) from persisted Linehaul trip snapshot.
 * Used to filter bridge delay alerts to the leg the driver is likely running.
 */

/**
 * @param {unknown} body Linehaul `trips` body object
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
export function inferTravelDirectionFromTripBody(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return ''
  const o = /** @type {Record<string, unknown>} */ (body)
  const bits = [
    o.tripDest,
    o.tripDestAbbrv,
    o.tripDestNumber,
    o.currentLocationName,
    o.currentLocationAbbrv,
    o.currentLocationNumber,
    o.originLocation,
    o.dispatchOrigin,
    o.dispatchDestination,
  ]
    .map((x) => (x != null ? String(x) : ''))
    .join(' ')

  const s = bits.toUpperCase()

  const ny =
    /\b(NY|NYC|N\.Y\.|NEW YORK|BRONX|BROOKLYN|QUEENS|STATEN|MANHATTAN|LGA|JFK)\b/.test(
      s,
    ) || /\bNY\b/.test(s)
  const nj =
    /\b(NJ|N\.J\.|NEW JERSEY|JERSEY|NEWARK|EWR|PATERSON|CAMDEN|TRENTON)\b/.test(s) ||
    /\bNJ\b/.test(s)

  const dStr = String(o.tripDest ?? o.tripDestAbbrv ?? '').toUpperCase()
  const oStr = String(
    o.currentLocationName ?? o.currentLocationAbbrv ?? o.currentLocationNumber ?? '',
  ).toUpperCase()

  const destNj = nj && (dStr.includes('NJ') || /\bEWR\b/.test(dStr))
  const destNy = ny && (dStr.includes('NY') || /LGA|JFK|NYC/.test(dStr))
  const origNj = nj && (oStr.includes('NJ') || /\bEWR\b/.test(oStr))
  const origNy = ny && (oStr.includes('NY') || /LGA|JFK|NYC/.test(oStr))

  if (destNy && origNj && !destNj) return 'ToNY'
  if (destNj && origNy && !destNy) return 'ToNJ'
  if (destNy && !destNj && origNj) return 'ToNY'
  if (destNj && !destNy && origNy) return 'ToNJ'
  if (ny && !nj) return ''
  if (nj && !ny) return ''
  return ''
}
