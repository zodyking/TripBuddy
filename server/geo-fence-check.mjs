import { readGeoFence } from './geo-fence-store.mjs'
import { lookupIpLatLng } from './ip-geolocation.mjs'
import { isPrivateOrLocalIp } from './client-ip.mjs'
import {
  fenceDecisionByIp,
  FENCE_DECISION_TTL_MS,
} from './geo-fence-ip-cache.mjs'

/**
 * Ray casting: point inside polygon (lng = x, lat = y).
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{ lat: number, lng: number }>} ring
 */
export function pointInPolygon(lat, lng, ring) {
  if (!ring || ring.length < 3) return false
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].lng
    const yi = ring[i].lat
    const xj = ring[j].lng
    const yj = ring[j].lat
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function isValidRedirectUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * If visitor should be redirected outside allowed area, return redirect URL string.
 * Cached briefly per IP for fast repeated checks on same navigation.
 * @param {string} ip
 * @returns {Promise<string | null>}
 */
export async function getGeoFenceRedirectUrl(ip) {
  const key = String(ip || '').trim() || '_'
  const now = Date.now()
  const hit = fenceDecisionByIp.get(key)
  if (hit && now - hit.at < FENCE_DECISION_TTL_MS) {
    return hit.url
  }

  const cfg = await readGeoFence()
  if (!cfg.enabled || !isValidRedirectUrl(cfg.redirectUrl)) {
    fenceDecisionByIp.set(key, { url: null, at: now })
    return null
  }
  if (cfg.polygon.length < 3) {
    fenceDecisionByIp.set(key, { url: null, at: now })
    return null
  }
  if (isPrivateOrLocalIp(ip)) {
    fenceDecisionByIp.set(key, { url: null, at: now })
    return null
  }

  const pos = await lookupIpLatLng(ip)
  if (!pos) {
    fenceDecisionByIp.set(key, { url: null, at: now })
    return null
  }

  if (pointInPolygon(pos.lat, pos.lng, cfg.polygon)) {
    fenceDecisionByIp.set(key, { url: null, at: now })
    return null
  }
  const url = cfg.redirectUrl
  fenceDecisionByIp.set(key, { url, at: now })
  return url
}
