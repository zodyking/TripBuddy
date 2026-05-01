/**
 * TomTom Route Monitoring API v3 — server-side proxy using user key from client.
 * @see https://developer.tomtom.com/route-monitoring/documentation/routes-service/routes
 */

const BASE = 'https://api.tomtom.com/routemonitoring/3'

/**
 * @param {unknown} p
 * @returns {{ latitude: number, longitude: number } | null}
 */
function toTomTomPoint(p) {
  if (!p || typeof p !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (p)
  const lat = Number(o.lat ?? o.latitude)
  const lng = Number(o.lng ?? o.lon ?? o.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { latitude: lat, longitude: lng }
}

/**
 * @param {unknown[]} raw
 * @returns {{ latitude: number, longitude: number }[]}
 */
export function normalizePathPointsForTomTom(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const p of raw) {
    const q = toTomTomPoint(p)
    if (q) out.push(q)
  }
  return out
}

/**
 * @param {string} key
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function tomTomFetch(key, path, init = {}) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 200) }
  }
  return { ok: res.ok, status: res.status, data }
}

/**
 * POST /routing — preview geometry for path points.
 * @param {string} apiKey
 * @param {{ latitude: number, longitude: number }[]} pathPoints
 */
export async function postRouteMonitoringPreview(apiKey, pathPoints) {
  const body = JSON.stringify({ pathPoints })
  return tomTomFetch(apiKey, '/routing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

/**
 * POST /routes — create monitored route.
 * @param {string} apiKey
 * @param {string} name
 * @param {{ latitude: number, longitude: number }[]} pathPoints
 */
export async function postRouteMonitoringCreate(apiKey, name, pathPoints) {
  const body = JSON.stringify({ name, pathPoints })
  return tomTomFetch(apiKey, '/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

/**
 * GET /routes/{id} — short status (travel time when ACTIVE).
 * @param {string} apiKey
 * @param {number} routeId
 */
export async function getRouteMonitoringRouteShort(apiKey, routeId) {
  const id = Math.floor(Number(routeId))
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, data: { error: 'Invalid route id' } }
  }
  return tomTomFetch(apiKey, `/routes/${id}`)
}

/**
 * DELETE /routes/{id}
 * @param {string} apiKey
 * @param {number} routeId
 */
export async function deleteRouteMonitoringRoute(apiKey, routeId) {
  const id = Math.floor(Number(routeId))
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, data: { error: 'Invalid route id' } }
  }
  return tomTomFetch(apiKey, `/routes/${id}`, { method: 'DELETE' })
}
