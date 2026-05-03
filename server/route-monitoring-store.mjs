import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

/**
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {{
 *   localId: string,
 *   name: string,
 *   pathPoints: LatLng[],
 *   polyline?: string,
 *   createdAt: number,
 *   tomtomRouteId?: number,
 * }} StoredMonitoredRoute
 */

/**
 * @param {unknown} p
 * @returns {p is LatLng}
 */
function isLatLng(p) {
  if (!p || typeof p !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (p)
  const lat = Number(o.lat)
  const lng = Number(o.lng ?? o.lon)
  return Number.isFinite(lat) && Number.isFinite(lng)
}

/**
 * @returns {Promise<StoredMonitoredRoute[]>}
 */
export async function readMonitoredRoutesForUser() {
  const key = userScopeKey('traffic:monitored-routes')
  const data = await readKeyJson(key, () => ({ routes: [] }))
  if (!data || typeof data !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (data)
  const arr = o.routes
  if (!Array.isArray(arr)) return []
  /** @type {StoredMonitoredRoute[]} */
  const out = []
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue
    const r = /** @type {Record<string, unknown>} */ (row)
    const localId = typeof r.localId === 'string' ? r.localId.trim() : ''
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const polyline = typeof r.polyline === 'string' ? r.polyline.trim() : ''
    const pp = r.pathPoints
    const pathPoints = Array.isArray(pp)
      ? pp.filter((p) => isLatLng(p)).map((p) => {
          const q = /** @type {Record<string, unknown>} */ (p)
          return {
            lat: Number(q.lat),
            lng: Number(q.lng ?? q.lon),
          }
        })
      : []
    const createdAt = Number(r.createdAt)
    // Legacy tomtomRouteId (optional for migration)
    const tomtomRouteId = typeof r.tomtomRouteId === 'number' ? r.tomtomRouteId : undefined

    if (!localId || !name || pathPoints.length < 2) {
      continue
    }
    out.push({
      localId,
      name,
      pathPoints,
      polyline: polyline || undefined,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      tomtomRouteId,
    })
  }
  return out
}

/**
 * @param {StoredMonitoredRoute[]} routes
 */
export async function writeMonitoredRoutesForUser(routes) {
  const key = userScopeKey('traffic:monitored-routes')
  await writeKeyJson(key, { routes })
}

/**
 * @param {StoredMonitoredRoute} route
 */
export async function appendMonitoredRoute(route) {
  const prev = await readMonitoredRoutesForUser()
  prev.push(route)
  await writeMonitoredRoutesForUser(prev)
}

/**
 * @param {string} localId
 * @returns {Promise<StoredMonitoredRoute | null>}
 */
export async function removeMonitoredRouteByLocalId(localId) {
  const id = String(localId || '').trim()
  if (!id) return null
  const prev = await readMonitoredRoutesForUser()
  const idx = prev.findIndex((r) => r.localId === id)
  if (idx < 0) return null
  const [removed] = prev.splice(idx, 1)
  await writeMonitoredRoutesForUser(prev)
  return removed || null
}

/**
 * Update route's polyline (for routes created before polyline support).
 * @param {string} localId
 * @param {string} polyline
 */
export async function updateMonitoredRoutePolyline(localId, polyline) {
  const id = String(localId || '').trim()
  if (!id) return
  const routes = await readMonitoredRoutesForUser()
  const route = routes.find((r) => r.localId === id)
  if (route) {
    route.polyline = polyline
    await writeMonitoredRoutesForUser(routes)
  }
}
