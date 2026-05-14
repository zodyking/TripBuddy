/**
 * Geolocation resolution for headless browser automation.
 * Mocks the device location to match either:
 *   - Trip destination coordinates (if active trip)
 *   - Driver/tractor location coordinates (fallback)
 */

import { readDirectory } from '../locations-directory-store.mjs'

/**
 * @typedef {Object} GeoCoordinates
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} [accuracy] - defaults to 10 meters
 */

/**
 * Look up coordinates for a location ID from the directory.
 * @param {string} locationId - The location ID to look up
 * @returns {Promise<GeoCoordinates | null>}
 */
export async function getGeoFromDirectory(locationId) {
  const id = String(locationId ?? '').trim()
  if (!id) return null

  const directory = await readDirectory()
  const entry = directory[id]

  if (!entry) return null

  const lat = entry.latitude != null ? Number(entry.latitude) : NaN
  const lng = entry.longitude != null ? Number(entry.longitude) : NaN

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  return {
    latitude: lat,
    longitude: lng,
    accuracy: 10,
  }
}

/**
 * Extract destination location ID from a persisted trip snapshot.
 * @param {unknown} snapshot - The trip snapshot (persistedLinehaulTripSnapshot, etc.)
 * @returns {string}
 */
function extractDestinationLocationId(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return ''
  const s = /** @type {Record<string, unknown>} */ (snapshot)
  const id = s.tripDestNumber ?? s.destinationLocationId ?? s.destLocationId ?? ''
  return String(id).trim()
}

/**
 * Check if assignment has an active trip (has a persisted trip snapshot with destination).
 * @param {unknown} assignment
 * @returns {{ hasTrip: boolean, destLocationId: string }}
 */
function checkActiveTrip(assignment) {
  if (!assignment || typeof assignment !== 'object') {
    return { hasTrip: false, destLocationId: '' }
  }
  const a = /** @type {Record<string, unknown>} */ (assignment)

  const snapshots = [
    a.persistedLinehaulTripSnapshot,
    a.persistedCachedTripSnapshot,
    a.persistedPrePlanTripSnapshot,
  ]

  for (const snap of snapshots) {
    const destId = extractDestinationLocationId(snap)
    if (destId) {
      return { hasTrip: true, destLocationId: destId }
    }
  }

  return { hasTrip: false, destLocationId: '' }
}

/**
 * Resolve geolocation for automation based on:
 * 1. Active trip destination (if trip exists)
 * 2. Driver/tractor location (fallback when no active trip)
 *
 * @param {object} opts
 * @param {unknown} opts.assignment - The assignment data from readAssignment()
 * @param {string} [opts.driverLocationId] - The driver's current location ID (from linehaulTractorBody.locationId or linehaulDriverBody.driverLocation)
 * @returns {Promise<{ geo: GeoCoordinates | null, source: 'trip_destination' | 'driver_location' | 'none', locationId: string }>}
 */
export async function resolveAutomationGeolocation({ assignment, driverLocationId }) {
  const { hasTrip, destLocationId } = checkActiveTrip(assignment)

  if (hasTrip && destLocationId) {
    const geo = await getGeoFromDirectory(destLocationId)
    if (geo) {
      return { geo, source: 'trip_destination', locationId: destLocationId }
    }
  }

  const driverId = String(driverLocationId ?? '').trim()
  if (driverId) {
    const geo = await getGeoFromDirectory(driverId)
    if (geo) {
      return { geo, source: 'driver_location', locationId: driverId }
    }
  }

  return { geo: null, source: 'none', locationId: '' }
}

/**
 * Determine if an automation requires geolocation mocking.
 * Returns true if the automation contains arrive or inspect/checkout actions.
 * @param {unknown} automation
 * @returns {boolean}
 */
export function automationNeedsGeolocation(automation) {
  if (!automation || typeof automation !== 'object') return false
  const a = /** @type {Record<string, unknown>} */ (automation)
  const actions = Array.isArray(a.actions) ? a.actions : []

  const geoActionTypes = new Set([
    'arriveEndToEnd',
    'inspectCheckoutHomeGate',
    'inspectCheckoutContinue',
  ])

  function hasGeoAction(actionList) {
    for (const action of actionList) {
      if (!action || typeof action !== 'object') continue
      const act = /** @type {Record<string, unknown>} */ (action)
      if (geoActionTypes.has(String(act.type ?? ''))) return true
      if (act.children) {
        const c = /** @type {Record<string, unknown>} */ (act.children)
        if (Array.isArray(c.then) && hasGeoAction(c.then)) return true
        if (Array.isArray(c.else) && hasGeoAction(c.else)) return true
        if (Array.isArray(c.sequence) && hasGeoAction(c.sequence)) return true
        if (Array.isArray(c.default) && hasGeoAction(c.default)) return true
        if (Array.isArray(c.options)) {
          for (const opt of c.options) {
            if (opt && Array.isArray(opt.actions) && hasGeoAction(opt.actions)) return true
          }
        }
      }
    }
    return false
  }

  return hasGeoAction(actions)
}
