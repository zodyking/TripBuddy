/**
 * Trip lifecycle in-app notifications (persisted inbox + SSE).
 * Mirrors dedupe logic in tripVoiceAnnouncement.js but is independent of TTS settings.
 */
import { postInAppNotification } from '../api.js'
import {
  extractOriginDest,
  hasTripOriginAndDestination,
} from './tripDetailsDisplay.js'

/** @param {unknown} body */
function legSeqKey(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return ''
  const s = /** @type {Record<string, unknown>} */ (body).dailyTripLegSequence
  if (s == null) return ''
  const t = String(s).trim()
  return /^\d+$/.test(t) ? t : ''
}

/** @param {unknown} body */
function tripBodyForNotifyExtra(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const o = /** @type {Record<string, unknown>} */ (body)
  /** @type {Record<string, unknown>} */
  const slim = {
    dailyTripLegSequence: o.dailyTripLegSequence,
    tripStatus: o.tripStatus,
    currentLocationNumber: o.currentLocationNumber,
    currentLocationName: o.currentLocationName,
    tripDestNumber: o.tripDestNumber,
    tripDest: o.tripDest,
    tractorNumber: o.tractorNumber,
    dollyNumber1: o.dollyNumber1,
    dollyNumber2: o.dollyNumber2,
    dollyEquipmentSequence1: o.dollyEquipmentSequence1,
    dollyEquipmentSequence2: o.dollyEquipmentSequence2,
    trailers: o.trailers,
  }
  const entries = Object.entries(slim).filter(([, v]) => {
    if (v == null || v === '') return false
    if (Array.isArray(v) && !v.length) return false
    return true
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

let lastTripFingerprint = ''
let lastPrePlanFingerprint = ''
let lastStablePhase = ''

/**
 * @param {{ type?: string, message: string, source?: string, extra?: object }} payload
 */
async function publishTripNotification(payload) {
  if (typeof window === 'undefined') return
  const message = String(payload.message || '').trim()
  if (!message) return
  try {
    await postInAppNotification({
      type: payload.type || 'trip',
      message,
      source: payload.source || 'linehaul',
      extra: payload.extra,
    })
  } catch {
    /* offline or unauth */
  }
}

/**
 * @param {unknown} tripsBody
 * @param {boolean} noActiveTrip
 */
export function maybeNotifyNewTripInApp(tripsBody, noActiveTrip) {
  if (typeof window === 'undefined') return

  if (noActiveTrip || tripsBody == null) {
    lastTripFingerprint = ''
    return
  }
  if (!hasTripOriginAndDestination(tripsBody)) return

  const { origin, destination } = extractOriginDest(tripsBody)
  const leg = legSeqKey(tripsBody)
  const fp = `${leg}|||${origin}|||${destination}`
  if (fp === lastTripFingerprint) return
  lastTripFingerprint = fp

  void publishTripNotification({
    type: 'trip',
    message: `New trip assigned: ${origin} → ${destination}`,
    source: 'linehaul',
    extra: { event: 'trip_assigned', leg, origin, destination },
  })
}

/** @param {unknown} prePlanBody */
export function maybeNotifyPrePlanTripInApp(prePlanBody) {
  if (typeof window === 'undefined') return
  if (prePlanBody == null) {
    lastPrePlanFingerprint = ''
    return
  }
  if (!hasTripOriginAndDestination(prePlanBody)) return

  const { origin, destination } = extractOriginDest(prePlanBody)
  const leg = legSeqKey(prePlanBody)
  const fp = `preplan:${leg}|||${origin}|||${destination}`
  if (fp === lastPrePlanFingerprint) return
  lastPrePlanFingerprint = fp

  void publishTripNotification({
    type: 'preplan',
    message: `New preplan assigned: ${origin} → ${destination}`,
    source: 'linehaul',
    extra: { event: 'preplan_assigned', leg, origin, destination },
  })
}

/**
 * @param {'none' | 'assigned' | 'dispatched'} phase
 */
export function seedTripPhaseInAppTracking(phase) {
  lastStablePhase = phase || 'none'
}

/**
 * Call after debouncing tripPhase (~850ms stable).
 * @param {'none' | 'assigned' | 'dispatched'} phase
 * @param {unknown} [tripBody] Trip details shown on Home (stable state or live body)
 */
export function syncTripPhaseInAppStable(phase, tripBody) {
  if (typeof window === 'undefined') return
  const p = phase || 'none'
  if (p === lastStablePhase) return
  const prev = lastStablePhase
  lastStablePhase = p
  if (!prev) return

  let message = ''
  let event = ''
  if (p === 'assigned' && prev !== 'assigned') {
    message = 'Trip status: assigned'
    event = 'status_assigned'
  } else if (p === 'dispatched' && prev !== 'dispatched') {
    message = 'Trip status: en route'
    event = 'status_enroute'
  } else if (p === 'none' && prev !== 'none') {
    message = 'Trip status: complete'
    event = 'status_complete'
  }
  if (!message) return

  const leg = tripBody ? legSeqKey(tripBody) : ''
  let origin = ''
  let destination = ''
  if (tripBody && hasTripOriginAndDestination(tripBody)) {
    const od = extractOriginDest(tripBody)
    origin = od.origin
    destination = od.destination
  }
  const tripBodyExtra = tripBodyForNotifyExtra(tripBody)

  void publishTripNotification({
    type: 'trip',
    message,
    source: 'linehaul',
    extra: {
      event,
      fromPhase: prev,
      toPhase: p,
      leg,
      origin,
      destination,
      tripBody: tripBodyExtra,
    },
  })
}

/**
 * Prime fingerprints so the first poll after load does not notify unchanged data.
 * @param {unknown} tripsBody
 * @param {boolean} noActiveTrip
 * @param {unknown} prePlanBody
 * @param {'none' | 'assigned' | 'dispatched'} [phase]
 */
export function seedTripInAppFromSnapshot(tripsBody, noActiveTrip, prePlanBody, phase) {
  if (typeof window === 'undefined') return

  if (noActiveTrip || tripsBody == null) {
    lastTripFingerprint = ''
  } else if (hasTripOriginAndDestination(tripsBody)) {
    const { origin, destination } = extractOriginDest(tripsBody)
    const leg = legSeqKey(tripsBody)
    lastTripFingerprint = `${leg}|||${origin}|||${destination}`
  }

  if (prePlanBody == null) {
    lastPrePlanFingerprint = ''
  } else if (hasTripOriginAndDestination(prePlanBody)) {
    const { origin, destination } = extractOriginDest(prePlanBody)
    const leg = legSeqKey(prePlanBody)
    lastPrePlanFingerprint = `preplan:${leg}|||${origin}|||${destination}`
  }

  if (phase) seedTripPhaseInAppTracking(phase)
}

let prevLocationMatch = null

/**
 * Notify when tractor and driver locations diverge (edge on false only).
 * @param {boolean | null} match
 * @param {{ tractorLocation?: unknown, driverLocation?: unknown }} [extra]
 */
export function maybeNotifyDriverTractorMismatchInApp(match, extra) {
  if (typeof window === 'undefined') return
  if (match === false && prevLocationMatch !== false) {
    void publishTripNotification({
      type: 'warning',
      message: 'Driver and tractor locations do not match',
      source: 'linehaul',
      extra: {
        event: 'driver_tractor_mismatch',
        tractorLocation: extra?.tractorLocation,
        driverLocation: extra?.driverLocation,
      },
    })
  }
  prevLocationMatch = match
}

export function clearTripInAppTracking() {
  lastTripFingerprint = ''
  lastPrePlanFingerprint = ''
  lastStablePhase = ''
  prevLocationMatch = null
}
