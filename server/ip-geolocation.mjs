import { isPrivateOrLocalIp } from './client-ip.mjs'

/** @type {Map<string, { lat: number, lng: number, at: number }>} */
const cache = new Map()
const CACHE_MS = 60 * 60 * 1000

/**
 * Free IP → lat/lon (no API key). Used for geo-fence.
 * @param {string} ip
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
export async function lookupIpLatLng(ip) {
  if (!ip || isPrivateOrLocalIp(ip)) return null
  const now = Date.now()
  const hit = cache.get(ip)
  if (hit && now - hit.at < CACHE_MS) {
    return { lat: hit.lat, lng: hit.lng }
  }

  try {
    const u = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon`
    const res = await fetch(u, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 'success' || data.lat == null || data.lon == null) {
      return null
    }
    const lat = Number(data.lat)
    const lng = Number(data.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    cache.set(ip, { lat, lng, at: now })
    return { lat, lng }
  } catch {
    return null
  }
}

/**
 * Reverse geocode via Nominatim (OSM) for display / logging.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string | null>}
 */
export async function reverseGeocodeNominatim(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'FedExTool/1.0 (geo-fence; self-hosted)',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data.display_name === 'string' && data.display_name.trim()) {
      return data.display_name.trim()
    }
    return null
  } catch {
    return null
  }
}
