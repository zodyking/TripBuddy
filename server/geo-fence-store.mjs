import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { clearFenceDecisionCache } from './geo-fence-ip-cache.mjs'
import { G } from './scope-kv.mjs'

const KV_KEY = G('geofence:config')

/**
 * @typedef {{ lat: number, lng: number }} LatLngPoint
 * @typedef {{
 *   enabled: boolean,
 *   redirectUrl: string,
 *   polygon: LatLngPoint[],
 * }} GeoFenceConfig
 */

const DEFAULT = /** @type {GeoFenceConfig} */ ({
  enabled: false,
  redirectUrl: '',
  polygon: [],
})

let cachedConfig = /** @type {GeoFenceConfig | null} */ (null)
let cachedAt = 0
const CACHE_MS = 5000

export function invalidateGeoFenceCache() {
  cachedConfig = null
  cachedAt = 0
  clearFenceDecisionCache()
}

/**
 * @param {unknown} p
 * @returns {p is LatLngPoint}
 */
function isPoint(p) {
  if (!p || typeof p !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (p)
  const lat = Number(o.lat)
  const lng = Number(o.lng)
  return Number.isFinite(lat) && Number.isFinite(lng)
}

/**
 * @returns {Promise<GeoFenceConfig>}
 */
export async function readGeoFence() {
  const now = Date.now()
  if (cachedConfig && now - cachedAt < CACHE_MS) {
    return {
      ...cachedConfig,
      polygon: cachedConfig.polygon.map((p) => ({ ...p })),
    }
  }
  const data = await readKeyJson(
    KV_KEY,
    () => ({ enabled: false, redirectUrl: '', polygon: [] }),
  )
  if (!data || typeof data !== 'object') {
    cachedConfig = { ...DEFAULT, polygon: [] }
    cachedAt = now
    return { ...DEFAULT }
  }
  const o = /** @type {Record<string, unknown>} */ (data)
  const polyRaw = o.polygon
  const polygon = Array.isArray(polyRaw)
    ? polyRaw
        .filter((p) => isPoint(/** @type {unknown} */ (p)))
        .map((p) => {
          const q = /** @type {Record<string, unknown>} */ (p)
          return { lat: Number(q.lat), lng: Number(q.lng) }
        })
    : []
  const next = {
    enabled: o.enabled === true,
    redirectUrl:
      typeof o.redirectUrl === 'string' ? o.redirectUrl.trim() : '',
    polygon,
  }
  cachedConfig = {
    ...next,
    polygon: next.polygon.map((p) => ({ ...p })),
  }
  cachedAt = now
  return next
}

/**
 * @param {Partial<GeoFenceConfig>} patch
 * @returns {Promise<GeoFenceConfig>}
 */
export async function writeGeoFence(patch) {
  const prev = await readGeoFence()
  const next = {
    enabled:
      typeof patch.enabled === 'boolean' ? patch.enabled : prev.enabled,
    redirectUrl:
      typeof patch.redirectUrl === 'string'
        ? patch.redirectUrl.trim()
        : prev.redirectUrl,
    polygon: Array.isArray(patch.polygon)
      ? patch.polygon.filter(isPoint).map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        }))
      : prev.polygon,
  }
  await writeKeyJson(KV_KEY, next)
  invalidateGeoFenceCache()
  return next
}
