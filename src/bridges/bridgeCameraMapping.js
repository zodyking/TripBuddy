/**
 * Maps bridge routeIds and names to 511NY camera identifiers.
 * Cameras are matched by the server using Location strings from the 511NY API.
 */

/**
 * Camera bridge keys returned by GET /api/511ny/cameras
 * @type {Readonly<Record<string, string>>}
 */
const CAMERA_BRIDGE_KEYS = Object.freeze({
  'Bayonne': 'Bayonne',
  'Goethals': 'Goethals',
  'Outerbridge': 'Outerbridge',
  'Verrazzano-ToNJ': 'Verrazzano-ToNJ',
  'Verrazzano-ToNY': 'Verrazzano-ToNY',
})

/** GWB upper deck only (matches TrafficCrossingsContent filters): live YouTube embed. */
export const GWB_YOUTUBE_VIDEO_ID = '2K2tW3cRlWQ'

/**
 * George Washington Bridge upper deck row for the active direction toggle.
 * To NY: routeId 211. To NJ: routeId 12.
 * @param {unknown} row
 * @param {'ToNY' | 'ToNJ'} direction
 */
export function isGwbUpperDeckRow(row, direction) {
  if (row == null || typeof row !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (row)
  const name = String(o.crossingDisplayName ?? '')
  if (!/george washington bridge/i.test(name)) return false
  const rid = o.routeId
  const n = typeof rid === 'number' ? rid : Number(rid)
  if (direction === 'ToNY') return n === 211
  return n === 12
}

/**
 * Maps PANYNJ routeIds to camera bridge keys.
 * Some bridges have multiple routeIds for different directions/decks.
 * @type {Readonly<Record<string, string>>}
 */
const ROUTE_ID_TO_CAMERA = Object.freeze({
  // Bayonne Bridge
  '217': 'Bayonne',
  '222': 'Bayonne',
  // Goethals Bridge
  '86': 'Goethals',
  '87': 'Goethals',
  // Outerbridge Crossing
  '260': 'Outerbridge',
  '2520': 'Outerbridge',
})

/**
 * Maps display names (from crossingDisplayName) to camera bridge keys.
 * Fallback when routeId mapping is not available.
 * @type {Readonly<Record<string, string>>}
 */
const DISPLAY_NAME_TO_CAMERA = Object.freeze({
  'bayonne bridge': 'Bayonne',
  'goethals bridge': 'Goethals',
  'outerbridge crossing': 'Outerbridge',
})

/**
 * Get the camera key for a given PANYNJ bridge routeId.
 * @param {string | number} routeId
 * @returns {string | null} Camera key like 'Bayonne', 'Goethals', etc.
 */
export function getCameraKeyForRouteId(routeId) {
  const k = String(routeId ?? '').trim()
  return ROUTE_ID_TO_CAMERA[k] || null
}

/**
 * Get the camera key for a given bridge display name.
 * @param {string} displayName
 * @returns {string | null} Camera key like 'Bayonne', 'Goethals', etc.
 */
export function getCameraKeyForDisplayName(displayName) {
  const n = String(displayName ?? '').toLowerCase().trim()
  for (const [key, value] of Object.entries(DISPLAY_NAME_TO_CAMERA)) {
    if (n.includes(key)) return value
  }
  return null
}

/**
 * Get the Verrazzano camera key for a given travel direction.
 * Verrazzano is not in PANYNJ data, so we use direction-specific cameras.
 * @param {'ToNY' | 'ToNJ'} direction
 * @returns {string} Camera key 'Verrazzano-ToNY' or 'Verrazzano-ToNJ'
 */
export function getVerrazzanoCameraKey(direction) {
  return direction === 'ToNJ' ? 'Verrazzano-ToNJ' : 'Verrazzano-ToNY'
}

/**
 * Find camera data for a bridge row from the cameras array.
 * @param {unknown} row PANYNJ bridge row
 * @param {Array<{ bridge: string, videoUrl: string | null, imageUrl: string | null, status: string }>} cameras
 * @returns {{ bridge: string, videoUrl: string | null, imageUrl: string | null, status: string } | null}
 */
export function findCameraForBridgeRow(row, cameras) {
  if (!row || typeof row !== 'object' || !Array.isArray(cameras)) return null
  const o = /** @type {Record<string, unknown>} */ (row)
  const routeId = String(o.routeId ?? '')
  const displayName = String(o.crossingDisplayName ?? '')
  
  let cameraKey = getCameraKeyForRouteId(routeId)
  if (!cameraKey) {
    cameraKey = getCameraKeyForDisplayName(displayName)
  }
  if (!cameraKey) return null
  
  return cameras.find((c) => c.bridge === cameraKey) || null
}

/**
 * Find Verrazzano camera data for a given direction.
 * @param {'ToNY' | 'ToNJ'} direction
 * @param {Array<{ bridge: string, videoUrl: string | null, imageUrl: string | null, status: string }>} cameras
 * @returns {{ bridge: string, videoUrl: string | null, imageUrl: string | null, status: string } | null}
 */
export function findVerrazzanoCamera(direction, cameras) {
  if (!Array.isArray(cameras)) return null
  const key = getVerrazzanoCameraKey(direction)
  return cameras.find((c) => c.bridge === key) || null
}

/**
 * 511NY camera row or GWB YouTube live stream for the crossings UI.
 * @param {unknown} row
 * @param {'ToNY' | 'ToNJ'} direction
 * @param {Array<{ bridge: string, videoUrl: string | null, imageUrl: string | null, status: string }>} cameras
 * @returns {{
 *   youtubeVideoId: string | null,
 *   videoUrl: string | null,
 *   imageUrl: string | null,
 *   status: string,
 * } | null}
 */
export function resolveBridgeCameraFeed(row, direction, cameras) {
  if (isGwbUpperDeckRow(row, direction)) {
    return {
      youtubeVideoId: GWB_YOUTUBE_VIDEO_ID,
      videoUrl: null,
      imageUrl: null,
      status: 'Unknown',
    }
  }
  const cam = findCameraForBridgeRow(row, cameras)
  if (!cam) return null
  return {
    youtubeVideoId: null,
    videoUrl: cam.videoUrl,
    imageUrl: cam.imageUrl,
    status: cam.status || 'Unknown',
  }
}

export { CAMERA_BRIDGE_KEYS }
