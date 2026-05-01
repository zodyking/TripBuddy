/**
 * Haversine distance in meters (WGS84).
 */
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 */
export function pointDistanceM(a, b) {
  return haversineM(a.lat, a.lng, b.lat, b.lng)
}

/**
 * Closest point on a polyline to `p` (planar lerp in lat/lng — fine for short segments).
 * @param {{ lat: number, lng: number }} p
 * @param {Array<{ lat: number, lng: number }>} poly at least 2 points
 * @returns {{ lat: number, lng: number, segIndex: number, t: number }}
 */
export function closestPointOnPolyline(p, poly) {
  if (!poly || poly.length < 2) {
    return { lat: p.lat, lng: p.lng, segIndex: 0, t: 0 }
  }
  let bestD = Infinity
  /** @type {{ lat: number, lng: number, segIndex: number, t: number }} */
  let best = { lat: poly[0].lat, lng: poly[0].lng, segIndex: 0, t: 0 }

  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    const lat1 = a.lat
    const lon1 = a.lng
    const lat2 = b.lat
    const lon2 = b.lng
    const dx = lon2 - lon1
    const dy = lat2 - lat1
    const len2 = dx * dx + dy * dy
    let t = 0
    if (len2 > 1e-18) {
      t = ((p.lng - lon1) * dx + (p.lat - lat1) * dy) / len2
      t = Math.max(0, Math.min(1, t))
    }
    const lat = lat1 + t * dy
    const lng = lon1 + t * dx
    const d = haversineM(p.lat, p.lng, lat, lng)
    if (d < bestD) {
      bestD = d
      best = { lat, lng, segIndex: i, t }
    }
  }
  return best
}

/**
 * Insert `snapped` into `waypoints` at the index that best continues the path (short detour).
 * @param {Array<{ lat: number, lng: number }>} waypoints
 * @param {{ lat: number, lng: number }} snapped
 */
export function bestWaypointInsertionIndex(waypoints, snapped) {
  const n = waypoints.length
  if (n === 0) return 0
  let bestK = n
  let bestScore = Infinity
  for (let k = 0; k <= n; k++) {
    let score = 0
    if (k === 0) {
      score = pointDistanceM(snapped, waypoints[0])
    } else if (k === n) {
      score = pointDistanceM(waypoints[n - 1], snapped)
    } else {
      const a = waypoints[k - 1]
      const b = waypoints[k]
      score =
        pointDistanceM(a, snapped) +
        pointDistanceM(snapped, b) -
        pointDistanceM(a, b)
    }
    if (score < bestScore) {
      bestScore = score
      bestK = k
    }
  }
  return bestK
}
