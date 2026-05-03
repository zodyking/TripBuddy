/**
 * HERE Traffic API v7 wrapper for route monitoring.
 * Provides real-time traffic flow data along corridors with speed, jam factor, and travel time.
 * 
 * @see https://docs.here.com/traffic-api/docs/send-request-readme
 * @see https://docs.here.com/traffic-api/docs/geospatial-filters-here-traffic-api-v7-concepts
 */

const HERE_TRAFFIC_BASE = 'https://data.traffic.hereapi.com/v7'
const HERE_ROUTING_BASE = 'https://router.hereapi.com/v8'

/**
 * Encode coordinates to HERE Flexible Polyline format.
 * Based on HERE's flexible-polyline algorithm.
 * @see https://github.com/heremaps/flexible-polyline
 * 
 * Header format (version 1):
 * - Byte 1: (precision << 3) | (thirdDimType << 1) | thirdDimFlag
 * - If thirdDimFlag=1, Byte 2: thirdDimPrecision
 * 
 * @param {Array<{ lat: number, lng: number } | { latitude: number, longitude: number }>} points
 * @param {number} [precision=5] - Coordinate precision (5 = ~1m accuracy)
 * @returns {string} Encoded flexible polyline
 */
export function encodeFlexiblePolyline(points, precision = 5) {
  if (!Array.isArray(points) || points.length < 2) {
    return ''
  }

  const normalized = points.map(p => {
    const lat = typeof p.lat === 'number' ? p.lat : (typeof p.latitude === 'number' ? p.latitude : NaN)
    const lng = typeof p.lng === 'number' ? p.lng : (typeof p.longitude === 'number' ? p.longitude : NaN)
    return { lat, lng }
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))

  if (normalized.length < 2) {
    return ''
  }

  const ENCODING_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const multiplier = Math.pow(10, precision)

  /** @param {number} value */
  function encodeUnsignedVarint(value) {
    let result = ''
    while (value > 0x1F) {
      result += ENCODING_TABLE[(value & 0x1F) | 0x20]
      value >>>= 5
    }
    result += ENCODING_TABLE[value]
    return result
  }

  /** @param {number} value */
  function encodeSignedVarint(value) {
    let unsigned = value < 0 ? ~(value << 1) : (value << 1)
    return encodeUnsignedVarint(unsigned)
  }

  // Header: (precision << 3) | (thirdDimType << 1) | thirdDimFlag
  // For 2D polyline: thirdDimType=0, thirdDimFlag=0
  const headerValue = (precision << 3) | 0
  let result = encodeUnsignedVarint(headerValue)

  let lastLat = 0
  let lastLng = 0

  for (const { lat, lng } of normalized) {
    const scaledLat = Math.round(lat * multiplier)
    const scaledLng = Math.round(lng * multiplier)

    result += encodeSignedVarint(scaledLat - lastLat)
    result += encodeSignedVarint(scaledLng - lastLng)

    lastLat = scaledLat
    lastLng = scaledLng
  }

  return result
}

/**
 * Decode HERE Flexible Polyline to coordinates.
 * @see https://github.com/heremaps/flexible-polyline
 * 
 * Header format (version 1):
 * - Byte 1: (precision << 3) | (thirdDimType << 1) | thirdDimFlag
 * - If thirdDimFlag=1, Byte 2: thirdDimPrecision
 * 
 * @param {string} encoded
 * @returns {Array<{ lat: number, lng: number }>}
 */
export function decodeFlexiblePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') {
    return []
  }

  const DECODING_TABLE = {}
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('').forEach((c, i) => {
    DECODING_TABLE[c] = i
  })

  let index = 0

  function decodeUnsignedVarint() {
    let result = 0
    let shift = 0
    while (index < encoded.length) {
      const value = DECODING_TABLE[encoded[index++]]
      if (value === undefined) break
      result |= (value & 0x1F) << shift
      if ((value & 0x20) === 0) break
      shift += 5
    }
    return result
  }

  function decodeSignedVarint() {
    const unsigned = decodeUnsignedVarint()
    return (unsigned & 1) ? ~(unsigned >>> 1) : (unsigned >>> 1)
  }

  // Decode header: (precision << 3) | (thirdDimType << 1) | thirdDimFlag
  const header = decodeUnsignedVarint()
  const thirdDimFlag = header & 1
  const thirdDimType = (header >> 1) & 0x07
  const precision = (header >> 4) & 0x0F
  const multiplier = Math.pow(10, precision)

  // If 3D, decode third dimension precision (skip it for now)
  let thirdDimPrecision = 0
  if (thirdDimFlag) {
    thirdDimPrecision = decodeUnsignedVarint()
  }

  const points = []
  let lat = 0
  let lng = 0
  let thirdDim = 0

  while (index < encoded.length) {
    lat += decodeSignedVarint()
    lng += decodeSignedVarint()
    if (thirdDimFlag && thirdDimType !== 0) {
      thirdDim += decodeSignedVarint()
    }
    points.push({ lat: lat / multiplier, lng: lng / multiplier })
  }

  return points
}

/**
 * @param {string} key
 * @returns {string}
 */
export function sanitizeHereApiKey(key) {
  if (typeof key !== 'string') return ''
  const k = key.trim()
  if (k.length < 20 || k.length > 100) return ''
  if (!/^[A-Za-z0-9_-]+$/.test(k)) return ''
  return k
}

/**
 * Get traffic flow data along a corridor.
 * 
 * @param {string} apiKey - HERE API key
 * @param {string} polyline - Flexible polyline encoded route
 * @param {number} [radiusMeters=100] - Corridor radius in meters (max 5000)
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export async function getTrafficFlowCorridor(apiKey, polyline, radiusMeters = 100) {
  if (!apiKey || !polyline) {
    return { ok: false, status: 400, data: { error: 'Missing API key or polyline' } }
  }

  const radius = Math.min(Math.max(radiusMeters, 10), 5000)

  const url = `${HERE_TRAFFIC_BASE}/flow?` + new URLSearchParams({
    apiKey,
    in: `corridor:${polyline};r=${radius}`,
    locationReferencing: 'shape',
  }).toString()

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : 'Network error' } }
  }
}

/**
 * Get traffic incidents along a corridor.
 * 
 * @param {string} apiKey
 * @param {string} polyline
 * @param {number} [radiusMeters=100]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown }>}
 */
export async function getTrafficIncidentsCorridor(apiKey, polyline, radiusMeters = 100) {
  if (!apiKey || !polyline) {
    return { ok: false, status: 400, data: { error: 'Missing API key or polyline' } }
  }

  const radius = Math.min(Math.max(radiusMeters, 10), 5000)

  const url = `${HERE_TRAFFIC_BASE}/incidents?` + new URLSearchParams({
    apiKey,
    in: `corridor:${polyline};r=${radius}`,
    locationReferencing: 'shape',
  }).toString()

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : 'Network error' } }
  }
}

/**
 * Get a routed polyline between waypoints using HERE Routing API.
 * 
 * @param {string} apiKey
 * @param {Array<{ lat: number, lng: number }>} waypoints
 * @returns {Promise<{ ok: boolean, status: number, data: unknown, polyline?: string, points?: Array<{ lat: number, lng: number }> }>}
 */
export async function getRoutedPolyline(apiKey, waypoints) {
  if (!apiKey || !Array.isArray(waypoints) || waypoints.length < 2) {
    return { ok: false, status: 400, data: { error: 'Missing API key or waypoints' } }
  }

  const origin = `${waypoints[0].lat},${waypoints[0].lng}`
  const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`

  const viaPoints = waypoints.slice(1, -1).map(p => `${p.lat},${p.lng}`)

  const params = new URLSearchParams({
    apiKey,
    origin,
    destination,
    transportMode: 'truck',
    return: 'polyline,summary',
  })

  for (const via of viaPoints) {
    params.append('via', via)
  }

  const url = `${HERE_ROUTING_BASE}/routes?${params.toString()}`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return { ok: false, status: res.status, data }
    }

    // Extract polyline from response
    const routes = data.routes
    if (!Array.isArray(routes) || routes.length === 0) {
      return { ok: false, status: 404, data: { error: 'No route found' } }
    }

    const route = routes[0]
    const sections = route.sections
    if (!Array.isArray(sections) || sections.length === 0) {
      return { ok: false, status: 404, data: { error: 'No route sections' } }
    }

    // Combine all section polylines
    const allPoints = []
    for (const section of sections) {
      if (section.polyline) {
        const decoded = decodeFlexiblePolyline(section.polyline)
        allPoints.push(...decoded)
      }
    }

    if (allPoints.length < 2) {
      return { ok: false, status: 404, data: { error: 'No route geometry' } }
    }

    // Re-encode combined polyline
    const combinedPolyline = encodeFlexiblePolyline(allPoints)

    return {
      ok: true,
      status: 200,
      data,
      polyline: combinedPolyline,
      points: allPoints,
    }
  } catch (e) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : 'Network error' } }
  }
}

/**
 * Parse HERE traffic flow response into a simplified format.
 * 
 * @param {unknown} data - Raw HERE API response
 * @returns {{
 *   totalLengthMeters: number,
 *   avgSpeedMps: number,
 *   avgFreeFlowMps: number,
 *   avgJamFactor: number,
 *   travelTimeSeconds: number,
 *   freeFlowTimeSeconds: number,
 *   delaySeconds: number,
 *   segments: Array<{
 *     lengthMeters: number,
 *     speedMps: number,
 *     freeFlowMps: number,
 *     jamFactor: number,
 *     confidence: number,
 *     traversability: string,
 *     points: Array<{ lat: number, lng: number }>
 *   }>
 * }}
 */
export function parseTrafficFlowResponse(data) {
  const result = {
    totalLengthMeters: 0,
    avgSpeedMps: 0,
    avgFreeFlowMps: 0,
    avgJamFactor: 0,
    travelTimeSeconds: 0,
    freeFlowTimeSeconds: 0,
    delaySeconds: 0,
    segments: [],
  }

  if (!data || typeof data !== 'object') {
    return result
  }

  const d = /** @type {Record<string, unknown>} */ (data)
  const results = d.results
  if (!Array.isArray(results)) {
    return result
  }

  let totalLength = 0
  let weightedSpeed = 0
  let weightedFreeFlow = 0
  let weightedJamFactor = 0

  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    const r = /** @type {Record<string, unknown>} */ (item)

    const location = r.location
    const currentFlow = r.currentFlow
    if (!location || typeof location !== 'object') continue
    if (!currentFlow || typeof currentFlow !== 'object') continue

    const loc = /** @type {Record<string, unknown>} */ (location)
    const flow = /** @type {Record<string, unknown>} */ (currentFlow)

    const length = Number(loc.length) || 0
    const speed = Number(flow.speed) || 0
    const freeFlow = Number(flow.freeFlow) || speed
    const jamFactor = Number(flow.jamFactor) || 0
    const confidence = Number(flow.confidence) || 0
    const traversability = String(flow.traversability || 'unknown')

    // Extract shape points
    const points = []
    const shape = loc.shape
    if (shape && typeof shape === 'object') {
      const s = /** @type {Record<string, unknown>} */ (shape)
      const links = s.links
      if (Array.isArray(links)) {
        for (const link of links) {
          if (!link || typeof link !== 'object') continue
          const l = /** @type {Record<string, unknown>} */ (link)
          const pts = l.points
          if (Array.isArray(pts)) {
            for (const pt of pts) {
              if (!pt || typeof pt !== 'object') continue
              const p = /** @type {Record<string, unknown>} */ (pt)
              const lat = Number(p.lat)
              const lng = Number(p.lng)
              if (Number.isFinite(lat) && Number.isFinite(lng)) {
                points.push({ lat, lng })
              }
            }
          }
        }
      }
    }

    result.segments.push({
      lengthMeters: length,
      speedMps: speed,
      freeFlowMps: freeFlow,
      jamFactor,
      confidence,
      traversability,
      points,
    })

    totalLength += length
    weightedSpeed += speed * length
    weightedFreeFlow += freeFlow * length
    weightedJamFactor += jamFactor * length
  }

  result.totalLengthMeters = totalLength

  if (totalLength > 0) {
    result.avgSpeedMps = weightedSpeed / totalLength
    result.avgFreeFlowMps = weightedFreeFlow / totalLength
    result.avgJamFactor = weightedJamFactor / totalLength

    if (result.avgSpeedMps > 0) {
      result.travelTimeSeconds = totalLength / result.avgSpeedMps
    }
    if (result.avgFreeFlowMps > 0) {
      result.freeFlowTimeSeconds = totalLength / result.avgFreeFlowMps
    }
    result.delaySeconds = Math.max(0, result.travelTimeSeconds - result.freeFlowTimeSeconds)
  }

  return result
}

/**
 * Format HERE API error message.
 * @param {unknown} data
 * @param {number} status
 * @returns {string}
 */
export function formatHereApiError(data, status) {
  if (!data || typeof data !== 'object') {
    return `HERE API error (HTTP ${status})`
  }

  const d = /** @type {Record<string, unknown>} */ (data)

  // HERE error format
  if (d.error && typeof d.error === 'string') {
    return d.error
  }
  if (d.title && typeof d.title === 'string') {
    const cause = d.cause && typeof d.cause === 'string' ? `: ${d.cause}` : ''
    return `${d.title}${cause}`
  }
  if (d.message && typeof d.message === 'string') {
    return d.message
  }

  return `HERE API error (HTTP ${status})`
}
