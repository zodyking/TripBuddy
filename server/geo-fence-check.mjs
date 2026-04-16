import { readGeoFence } from './geo-fence-store.mjs'
import { lookupIpLatLng } from './ip-geolocation.mjs'
import { isPrivateOrLocalIp } from './client-ip.mjs'

/**
 * Ray casting: point inside polygon (lng = x, lat = y).
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{ lat: number, lng: number }>} ring closed or open ring (3+ points)
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
 * @param {string} ip
 * @returns {Promise<string | null>}
 */
export async function getGeoFenceRedirectUrl(ip) {
  const cfg = await readGeoFence()
  if (!cfg.enabled || !isValidRedirectUrl(cfg.redirectUrl)) return null
  if (cfg.polygon.length < 3) return null
  if (isPrivateOrLocalIp(ip)) return null

  const pos = await lookupIpLatLng(ip)
  if (!pos) return null

  if (pointInPolygon(pos.lat, pos.lng, cfg.polygon)) {
    return null
  }
  return cfg.redirectUrl
}
