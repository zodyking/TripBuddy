/**
 * Match 511NY camera feed rows to bridge crossing cards.
 */

/** @typedef {{ bridge: string, location: string, locationAlt?: string, locationAlts?: string[], roadway?: string }} BridgeCameraMapping */

/** @type {readonly BridgeCameraMapping[]} */
export const NY511_BRIDGE_CAMERAS = Object.freeze([
  { bridge: 'Bayonne', location: 'NY440 at Walker Street', locationAlt: 'Bayonne Br' },
  { bridge: 'Goethals', location: 'I-278 at Forest Avenue' },
  { bridge: 'Outerbridge', location: '909C at Tyrellan Avenue', locationAlt: 'Tyrellan' },
  {
    bridge: 'Verrazzano-ToNJ',
    location: 'I-278 at Fingerboard Road',
    locationAlt: 'Fingerboard',
    locationAlts: ['Verrazzano', 'Narrows', 'I-278'],
    roadway: 'I-278',
  },
  {
    bridge: 'Verrazzano-ToNY',
    location: 'I-278 at 92nd Street',
    locationAlt: '92nd',
    locationAlts: ['92nd St', 'Verrazzano', 'Narrows', 'I-278'],
    roadway: 'I-278',
  },
])

const INACTIVE_VIEW_STATUSES = new Set(['disabled', 'blocked', 'offline'])

/**
 * @param {string} s
 */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} cameraLocation
 * @param {string} targetLocation
 * @param {string} [targetAlt]
 */
export function matchCameraLocation(cameraLocation, targetLocation, targetAlt) {
  if (!cameraLocation || typeof cameraLocation !== 'string') return false
  const loc = norm(cameraLocation)
  const tgt = norm(targetLocation)
  if (!tgt) return false
  if (loc.includes(tgt) || tgt.includes(loc)) return true
  if (targetAlt) {
    const alt = norm(targetAlt)
    if (alt && (loc.includes(alt) || alt.includes(loc))) return true
  }
  return false
}

/**
 * @param {string} haystack
 * @param {string} needle
 */
function tokenIncludes(haystack, needle) {
  const n = norm(needle)
  if (!n || n.length < 3) return false
  return norm(haystack).includes(n)
}

/**
 * @param {unknown} cam
 * @param {BridgeCameraMapping} mapping
 */
function mappingMatchesCamera(cam, mapping) {
  if (!cam || typeof cam !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (cam)
  const location = typeof o.Location === 'string' ? o.Location : ''
  const roadway = typeof o.Roadway === 'string' ? o.Roadway : ''
  const blob = `${location} ${roadway}`

  if (matchCameraLocation(location, mapping.location, mapping.locationAlt)) return true

  const alts = [
    mapping.locationAlt,
    ...(Array.isArray(mapping.locationAlts) ? mapping.locationAlts : []),
  ].filter(Boolean)

  for (const alt of alts) {
    if (matchCameraLocation(location, String(alt), '')) return true
    if (tokenIncludes(blob, String(alt))) return true
  }

  if (mapping.roadway && tokenIncludes(roadway, mapping.roadway)) {
    const must = norm(mapping.location).split(' ').filter((t) => t.length > 3)
    if (must.length === 0) return false
    return must.every((t) => tokenIncludes(blob, t))
  }

  return false
}

/**
 * @param {unknown} view
 */
function viewIsPlayable(view) {
  if (!view || typeof view !== 'object') return false
  const o = /** @type {Record<string, unknown>} */ (view)
  const status = norm(o.Status)
  if (INACTIVE_VIEW_STATUSES.has(status)) {
    return Boolean(o.VideoUrl || o.Url)
  }
  return Boolean(o.VideoUrl || o.Url)
}

/**
 * Pick the best 511NY view (prefer live video over still).
 * @param {unknown} cam
 */
export function pickBestCameraView(cam) {
  const views = cam && typeof cam === 'object' ? /** @type {any} */ (cam).Views : null
  if (!Array.isArray(views) || views.length === 0) return null

  /** @type {unknown[]} */
  const playable = views.filter((v) => viewIsPlayable(v))
  const pool = playable.length ? playable : views

  const withVideo = pool.find((v) => v && typeof v === 'object' && /** @type {any} */ (v).VideoUrl)
  if (withVideo) return withVideo

  const withImage = pool.find((v) => v && typeof v === 'object' && /** @type {any} */ (v).Url)
  return withImage || pool[0] || null
}

/**
 * @param {unknown} view
 */
function viewStatusLabel(view) {
  if (!view || typeof view !== 'object') return 'Unknown'
  const s = /** @type {Record<string, unknown>} */ (view).Status
  return typeof s === 'string' && s.trim() ? s.trim() : 'Unknown'
}

/**
 * Score a camera match (higher = better).
 * @param {unknown} cam
 */
function scoreCameraMatch(cam) {
  const view = pickBestCameraView(cam)
  if (!view) return -100
  let score = 0
  const status = norm(viewStatusLabel(view))
  if (!INACTIVE_VIEW_STATUSES.has(status)) score += 40
  if (/** @type {any} */ (view).VideoUrl) score += 30
  if (/** @type {any} */ (view).Url) score += 10
  return score
}

/**
 * @param {unknown[]} allCameras
 * @param {BridgeCameraMapping} mapping
 */
export function findBest511CameraForMapping(allCameras, mapping) {
  if (!Array.isArray(allCameras)) return null
  /** @type {{ cam: unknown, score: number }[]} */
  const hits = []
  for (const cam of allCameras) {
    if (!mappingMatchesCamera(cam, mapping)) continue
    hits.push({ cam, score: scoreCameraMatch(cam) })
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.score - a.score)
  return hits[0].cam
}

/**
 * @param {unknown[]} allCameras
 * @returns {Array<{
 *   bridge: string,
 *   cameraId: unknown,
 *   location: string,
 *   roadway: string,
 *   direction: string,
 *   lat: number,
 *   lng: number,
 *   imageUrl: string | null,
 *   videoUrl: string | null,
 *   status: string,
 * }>}
 */
export function resolveBridgeCamerasFrom511List(allCameras) {
  /** @type {ReturnType<typeof resolveBridgeCamerasFrom511List>} */
  const bridgeCameras = []
  for (const mapping of NY511_BRIDGE_CAMERAS) {
    const cam = findBest511CameraForMapping(allCameras, mapping)
    if (!cam || typeof cam !== 'object') continue
    const c = /** @type {Record<string, unknown>} */ (cam)
    const view = pickBestCameraView(cam)
    const v = view && typeof view === 'object' ? /** @type {Record<string, unknown>} */ (view) : null
    bridgeCameras.push({
      bridge: mapping.bridge,
      cameraId: c.Id,
      location: typeof c.Location === 'string' ? c.Location : '',
      roadway: typeof c.Roadway === 'string' ? c.Roadway : '',
      direction: typeof c.Direction === 'string' ? c.Direction : '',
      lat: typeof c.Latitude === 'number' ? c.Latitude : 0,
      lng: typeof c.Longitude === 'number' ? c.Longitude : 0,
      imageUrl: typeof v?.Url === 'string' ? v.Url : null,
      videoUrl: typeof v?.VideoUrl === 'string' ? v.VideoUrl : null,
      status: viewStatusLabel(view),
    })
  }
  return bridgeCameras
}
