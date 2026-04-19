import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'
import { clearFenceDecisionCache } from './geo-fence-ip-cache.mjs'

const FILE = path.join(LOCAL_DIR, 'geo-fence.json')

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
  try {
    const raw = await fs.readFile(FILE, 'utf8')
    const data = JSON.parse(raw)
    const polygon = Array.isArray(data.polygon)
      ? data.polygon.filter(isPoint).map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        }))
      : []
    const next = {
      enabled: data.enabled === true,
      redirectUrl:
        typeof data.redirectUrl === 'string' ? data.redirectUrl.trim() : '',
      polygon,
    }
    cachedConfig = {
      ...next,
      polygon: next.polygon.map((p) => ({ ...p })),
    }
    cachedAt = now
    return next
  } catch {
    cachedConfig = { ...DEFAULT, polygon: [] }
    cachedAt = now
    return { ...DEFAULT }
  }
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
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), 'utf8')
  invalidateGeoFenceCache()
  return next
}
