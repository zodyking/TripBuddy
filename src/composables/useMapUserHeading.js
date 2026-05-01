/**
 * Heading for rotating the user/truck map marker: fuses GPS course, compass
 * (DeviceOrientation), and movement bearing — similar to navigation maps.
 */
import { shallowRef } from 'vue'

/** @param {number} d */
function normalizeDeg360(d) {
  if (!Number.isFinite(d)) return null
  let x = d % 360
  if (x < 0) x += 360
  return x
}

/**
 * @param {number} fromDeg
 * @param {number} toDeg
 * @param {number} alpha 0..1 blend toward `to`
 */
function smoothHeading(fromDeg, toDeg, alpha) {
  const a = normalizeDeg360(fromDeg)
  const b = normalizeDeg360(toDeg)
  if (a == null || b == null) return b ?? a ?? null
  let delta = b - a
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const next = normalizeDeg360(a + delta * alpha)
  return next ?? a
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const s =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Initial bearing from point 1 → 2 (degrees clockwise from north).
 */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return normalizeDeg360((θ * 180) / Math.PI)
}

/**
 * @typedef {{
 *   headingDeg: import('vue').ShallowRef<number | null>,
 *   feedGeolocation: (coords: GeolocationCoordinates) => void,
 *   startListening: () => Promise<void>,
 *   stopListening: () => void,
 * }} MapUserHeadingApi
 */

/** Prefer GPS course above this speed (m/s). */
const GPS_SPEED_USE_HEADING = 0.65
/** After GPS-based heading, ignore compass briefly (ms). */
const GPS_HEADING_HOLD_MS = 2200
/** Minimum movement for bearing-from-track (m). */
const MIN_BEARING_MOVE_M = 5
/** Smoothing toward new samples (higher = snappier). */
const BLEND_ALPHA = 0.35

/**
 * @returns {MapUserHeadingApi}
 */
export function useMapUserHeading() {
  /** @type {import('vue').ShallowRef<number | null>} */
  const headingDeg = shallowRef(null)

  let smoothed = /** @type {number | null} */ (null)
  let gpsHoldUntil = 0

  let prevLat = /** @type {number | null} */ (null)
  let prevLng = /** @type {number | null} */ (null)
  let prevMoveTs = 0

  let oriAttached = false

  function pushHeading(rawDeg, force = false) {
    const h = normalizeDeg360(rawDeg)
    if (h == null) return
    if (smoothed == null || force) {
      smoothed = h
    } else {
      smoothed = smoothHeading(smoothed, h, BLEND_ALPHA)
    }
    headingDeg.value = smoothed
  }

  /**
   * @param {DeviceOrientationEvent} ev
   */
  function compassHeadingFromEvent(ev) {
    const wh = /** @type {unknown} */ (ev).webkitCompassHeading
    if (typeof wh === 'number' && Number.isFinite(wh)) {
      return normalizeDeg360(wh)
    }
    if (ev.absolute && typeof ev.alpha === 'number' && Number.isFinite(ev.alpha)) {
      return normalizeDeg360(360 - ev.alpha)
    }
    return null
  }

  function onDeviceOrientation(ev) {
    if (Date.now() < gpsHoldUntil) return
    const h = compassHeadingFromEvent(ev)
    if (h == null) return
    pushHeading(h)
  }

  function bindOrientationDom() {
    if (typeof window === 'undefined' || oriAttached) return
    window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true)
    window.addEventListener('deviceorientation', onDeviceOrientation, true)
    oriAttached = true
  }

  function unbindOrientationDom() {
    if (typeof window === 'undefined' || !oriAttached) return
    window.removeEventListener('deviceorientationabsolute', onDeviceOrientation, true)
    window.removeEventListener('deviceorientation', onDeviceOrientation, true)
    oriAttached = false
  }

  /**
   * Request compass access (iOS 13+). Should follow a user gesture when possible.
   */
  async function startListening() {
    if (typeof window === 'undefined') return
    try {
      const DO = /** @type {typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted'|'denied'> }} */ (
        DeviceOrientationEvent
      )
      if (typeof DO.requestPermission === 'function') {
        const r = await DO.requestPermission()
        if (r !== 'granted') return
      }
    } catch {
      return
    }
    bindOrientationDom()
  }

  function stopListening() {
    unbindOrientationDom()
  }

  /**
   * @param {GeolocationCoordinates} coords
   */
  function feedGeolocation(coords) {
    const lat = coords.latitude
    const lng = coords.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const spd =
      coords.speed != null && Number.isFinite(coords.speed) ? coords.speed : null
    const gh =
      coords.heading != null && Number.isFinite(coords.heading)
        ? coords.heading
        : null

    if (
      gh != null &&
      spd != null &&
      spd >= GPS_SPEED_USE_HEADING &&
      gh >= 0 &&
      gh <= 360
    ) {
      gpsHoldUntil = Date.now() + GPS_HEADING_HOLD_MS
      pushHeading(gh)
      prevLat = lat
      prevLng = lng
      prevMoveTs = Date.now()
      return
    }

    if (prevLat != null && prevLng != null) {
      const dt = Date.now() - prevMoveTs
      const dist = haversineM(prevLat, prevLng, lat, lng)
      if (dist >= MIN_BEARING_MOVE_M && dt >= 280 && dt < 120_000) {
        const br = bearingDeg(prevLat, prevLng, lat, lng)
        if (br != null && Date.now() >= gpsHoldUntil) {
          pushHeading(br)
        }
      }
    }

    prevLat = lat
    prevLng = lng
    prevMoveTs = Date.now()
  }

  function resetTrack() {
    prevLat = null
    prevLng = null
    prevMoveTs = 0
    gpsHoldUntil = 0
    smoothed = null
    headingDeg.value = null
  }

  return {
    headingDeg,
    feedGeolocation,
    startListening,
    stopListening,
    resetTrack,
  }
}
