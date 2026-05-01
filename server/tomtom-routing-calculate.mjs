/**
 * TomTom Routing API v1 — calculateRoute for road-snapped preview when
 * Route Monitoring `/routing` is unavailable for the key (see docs).
 * @see https://developer.tomtom.com/routing-api/documentation/routing/calculate-route
 */

/**
 * @param {{ latitude: number, longitude: number }[]} pathPoints
 * @returns {string} colon-separated `lat,lon` per TomTom examples
 */
export function buildCalculateRouteLocationPath(pathPoints) {
  return pathPoints
    .map((p) => `${p.latitude},${p.longitude}`)
    .join(':')
}

/**
 * @param {unknown} data calculateRoute JSON root
 * @returns {{ latitude: number, longitude: number }[]}
 */
export function extractPointsFromCalculateRoute(data) {
  if (!data || typeof data !== 'object') return []
  const root = /** @type {Record<string, unknown>} */ (data)
  const routes = root.routes
  if (!Array.isArray(routes) || !routes.length) return []
  const r0 = routes[0]
  if (!r0 || typeof r0 !== 'object') return []
  const legs = /** @type {Record<string, unknown>} */ (r0).legs
  if (!Array.isArray(legs)) return []
  /** @type {{ latitude: number, longitude: number }[]} */
  const out = []
  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') continue
    const pts = /** @type {Record<string, unknown>} */ (leg).points
    if (!Array.isArray(pts)) continue
    for (const p of pts) {
      if (!p || typeof p !== 'object') continue
      const o = /** @type {Record<string, unknown>} */ (p)
      const lat = Number(o.latitude)
      const lng = Number(o.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      out.push({ latitude: lat, longitude: lng })
    }
  }
  return out
}

/**
 * @param {string} apiKey
 * @param {{ latitude: number, longitude: number }[]} pathPoints
 */
export async function getCalculateRoutePolyline(apiKey, pathPoints) {
  if (pathPoints.length < 2) {
    return { ok: false, status: 400, data: { error: 'Need at least two points' }, points: [] }
  }
  const locPath = encodeURIComponent(buildCalculateRouteLocationPath(pathPoints))
  const qs = new URLSearchParams({
    key: apiKey,
    routeType: 'fastest',
    traffic: 'true',
    travelMode: 'car',
  })
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${locPath}/json?${qs}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 240) }
  }
  const points = res.ok && data ? extractPointsFromCalculateRoute(data) : []
  return { ok: res.ok, status: res.status, data, points }
}
