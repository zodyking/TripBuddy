/**
 * Trip-related alerts on **this device** (TTS and/or bell).
 * All announcements go through the unified queue in alertAudioQueue.js.
 * Bell: `public/sounds/trip-ready-bell.mp3` (Mixkit preview SFX, royalty-free — mixkit.co).
 */
import { extractOriginDest, hasTripOriginAndDestination } from './tripDetailsDisplay.js'
import { pushLiveLog } from '../stores/liveLogStore.js'
import { enqueueAnnouncement, speakDirect, cancelAllAlerts } from './alertAudioQueue.js'

const OLD_TTS_KEY = 'fedexTripTtsEnabled'
const MODE_KEY = 'fedexTripAlertMode'
const TRIP_STATUS_CHANGE_KEY = 'fedexTripStatusChangeEnabled'
const TRAILER_STATUS_CHANGE_KEY = 'fedexTrailerStatusChangeEnabled'
const ARRIVAL_ALERTS_KEY = 'fedexArrivalAlertsEnabled'
/** Relocation + near-trailer TTS (default on). */
const TRAILER_GPS_TTS_KEY = 'fedexTrailerGpsTtsEnabled'

/** 
 * Audio mode: off = no alerts, tts = speech only, both = bell chime before speech
 * @typedef {'off' | 'tts' | 'both'} TripAlertMode 
 */

/** @returns {TripAlertMode} */
export function getTripAlertMode() {
  if (typeof window === 'undefined' || !window.localStorage) return 'tts'
  const raw = window.localStorage.getItem(MODE_KEY)
  if (raw === 'bell') return 'tts'
  if (raw === 'off' || raw === 'tts' || raw === 'both') return raw
  const legacy = window.localStorage.getItem(OLD_TTS_KEY)
  if (legacy === 'false') return 'off'
  return 'tts'
}

/** @param {TripAlertMode} mode */
export function setTripAlertMode(mode) {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (mode !== 'off' && mode !== 'tts' && mode !== 'both') return
  window.localStorage.setItem(MODE_KEY, mode)
  try {
    window.localStorage.removeItem(OLD_TTS_KEY)
  } catch {
    /* ignore */
  }
}

/** @returns {boolean} True when TTS should run (tts or both). */
export function isTripTtsEnabled() {
  const m = getTripAlertMode()
  return m === 'tts' || m === 'both'
}

/** @returns {boolean} Bell chime should play before TTS (only when mode is 'both'). */
export function isTripBellEnabled() {
  return getTripAlertMode() === 'both'
}

/** Any non-off alert (for hints / unlock UI). */
export function isTripAlertEnabled() {
  return getTripAlertMode() !== 'off'
}

/** @returns {boolean} Trip status change alerts enabled (assigned/dispatched/completed). */
export function isTripStatusChangeEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  const raw = window.localStorage.getItem(TRIP_STATUS_CHANGE_KEY)
  return raw !== 'false'
}

/** @param {boolean} enabled */
export function setTripStatusChangeEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(TRIP_STATUS_CHANGE_KEY, enabled ? 'true' : 'false')
}

/** @returns {boolean} Trailer load status change alerts enabled (LDNG to CLSD). */
export function isTrailerStatusChangeEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  const raw = window.localStorage.getItem(TRAILER_STATUS_CHANGE_KEY)
  return raw !== 'false'
}

/** @param {boolean} enabled */
export function setTrailerStatusChangeEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(TRAILER_STATUS_CHANGE_KEY, enabled ? 'true' : 'false')
}

/** @returns {boolean} Arrival alerts enabled (arrived successfully, geofence arrival). */
export function isArrivalAlertsEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  const raw = window.localStorage.getItem(ARRIVAL_ALERTS_KEY)
  return raw !== 'false'
}

/** @param {boolean} enabled */
export function setArrivalAlertsEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(ARRIVAL_ALERTS_KEY, enabled ? 'true' : 'false')
}

/** @returns {boolean} TTS for trailer GPS move + proximity (default true). */
export function isTrailerGpsTtsEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  return window.localStorage.getItem(TRAILER_GPS_TTS_KEY) !== 'false'
}

/** @param {boolean} enabled */
export function setTrailerGpsTtsEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(TRAILER_GPS_TTS_KEY, enabled ? 'true' : 'false')
}

export function getTripBellSoundUrl() {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}sounds/trip-ready-bell.mp3`
}

/** True for typical phones / touch-primary tablets (mobile autoplay / speech policies). */
export function tripVoiceLikelyNeedsUserGesture() {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches
    )
  } catch {
    return false
  }
}

let lastFingerprint = ''
let lastPrePlanFingerprint = ''
/** @type {{ fp: string, text: string, bell: boolean } | null} */
let pendingAnnouncement = null

let gestureRuleEvaluated = false
/** On touch-primary devices, false until {@link unlockTripVoiceFromUserGesture}. */
let gestureUnlocked = true

function evaluateGestureGate() {
  if (gestureRuleEvaluated || typeof window === 'undefined') return
  gestureRuleEvaluated = true
  if (tripVoiceLikelyNeedsUserGesture()) gestureUnlocked = false
}

/**
 * Preview sample text using current trip alert mode (Settings Test buttons).
 * Uses direct speech (bypasses queue) for user-initiated tests.
 * @param {string} text
 */
export function previewTripAlertSample(text) {
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') return
  speakDirect(text, { bell: mode === 'both' })
}

function flushPendingTripAlert() {
  if (typeof window === 'undefined' || !pendingAnnouncement) return
  const { fp, text, bell } = pendingAnnouncement
  pendingAnnouncement = null
  lastFingerprint = fp
  pushLiveLog({ type: 'info', message: `[TripVoice] flushing pending: ${text}`, ts: Date.now() })
  enqueueAnnouncement(text, { bell, category: `newTrip:${fp}` })
}

/**
 * Call from a click / pointer handler so the first announcement can play on iOS / Android.
 * This MUST call speechSynthesis.speak() directly to prime the browser.
 */
export function unlockTripVoiceFromUserGesture() {
  if (typeof window === 'undefined') return
  gestureUnlocked = true

  const mode = getTripAlertMode()
  const bell = mode === 'both'

  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null
  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    speakDirect('TTS alerts active.', { bell })
    flushPendingTripAlert()
    return
  }

  geo.getCurrentPosition(
    () => {
      speakDirect('TTS alerts and GPS active.', { bell })
      flushPendingTripAlert()
    },
    () => {
      speakDirect('TTS alerts active.', { bell })
      flushPendingTripAlert()
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
  )
}

/** Whether to show "tap to enable" UI (touch-primary and not yet unlocked). */
export function tripVoiceShowUnlockHint() {
  if (typeof window === 'undefined') return false
  if (!isTripAlertEnabled()) return false
  evaluateGestureGate()
  return tripVoiceLikelyNeedsUserGesture() && !gestureUnlocked
}

/**
 * Normalize display strings for clearer speech (middle dot → pause).
 * @param {string} s
 */
function toSpeechPhrase(s) {
  return String(s)
    .replace(/·/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Call when `linehaulTripsBody` / `linehaulTripsNoActive` updates (e.g. after poll).
 * Announces once per distinct origin+destination until trip clears.
 *
 * @param {unknown} tripsBody
 * @param {boolean} noActiveTrip
 */
export function maybeAnnounceNewTrip(tripsBody, noActiveTrip) {
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') return

  evaluateGestureGate()

  if (noActiveTrip || tripsBody == null) {
    lastFingerprint = ''
    pendingAnnouncement = null
    return
  }

  if (!hasTripOriginAndDestination(tripsBody)) return

  const { origin, destination } = extractOriginDest(tripsBody)
  const fp = `${origin}|||${destination}`
  if (fp === lastFingerprint) return

  const o = toSpeechPhrase(origin)
  const d = toSpeechPhrase(destination)
  const text = `New trip ready from ${o} to ${d}.`
  const bell = mode === 'both'

  if (!gestureUnlocked) {
    if (pendingAnnouncement?.fp === fp) return
    pendingAnnouncement = { fp, text, bell }
    pushLiveLog({ type: 'warn', message: `[TripVoice] queued pending (gesture locked): ${text}`, ts: Date.now() })
    return
  }

  lastFingerprint = fp
  pushLiveLog({ type: 'info', message: `[TripVoice] announcing new trip: ${text}`, ts: Date.now() })
  enqueueAnnouncement(text, { bell, category: `newTrip:${fp}` })
}

/**
 * Announce a pre-plan trip (second trip queued while current is ENRT).
 * @param {unknown} prePlanBody
 */
export function maybeAnnouncePrePlanTrip(prePlanBody) {
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') return
  evaluateGestureGate()
  if (prePlanBody == null) {
    lastPrePlanFingerprint = ''
    return
  }
  if (!hasTripOriginAndDestination(prePlanBody)) return

  const { origin, destination } = extractOriginDest(prePlanBody)
  const fp = `preplan:${origin}|||${destination}`
  if (fp === lastPrePlanFingerprint) return

  const o = toSpeechPhrase(origin)
  const d = toSpeechPhrase(destination)
  const text = `New pre-plan trip assigned from ${o} to ${d}.`
  const bell = mode === 'both'

  if (!gestureUnlocked) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] pre-plan queued (gesture locked): ${text}`, ts: Date.now() })
    return
  }

  lastPrePlanFingerprint = fp
  pushLiveLog({ type: 'info', message: `[TripVoice] announcing pre-plan trip: ${text}`, ts: Date.now() })
  enqueueAnnouncement(text, { bell, category: `prePlanTrip:${fp}` })
}

/** Stop any in-flight announcement (e.g. on unmount). */
export function cancelTripVoiceAnnouncement() {
  cancelAllAlerts()
}

/** Settings: test speech (same voice as trip alert). */
export function speakTripTtsTest() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const text = 'TTS alerts active.'
  pushLiveLog({ type: 'info', message: `[TripVoice] test triggered: ${text}`, ts: Date.now() })
  speakDirect(text)
}

/** Settings: test bell sound. */
export function playTripBellTest() {
  pushLiveLog({ type: 'info', message: `[TripVoice] bell test triggered`, ts: Date.now() })
  if (typeof window === 'undefined') return
  const url = getTripBellSoundUrl()
  try {
    const audio = new Audio(url)
    audio.play().catch((e) => {
      pushLiveLog({ type: 'error', message: `[Bell] play rejected: ${e.message || e}`, ts: Date.now() })
    })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Bell] exception: ${e.message || e}`, ts: Date.now() })
  }
}

/** @deprecated Use setTripAlertMode instead */
export function setTripTtsEnabled(enabled) {
  setTripAlertMode(enabled ? 'tts' : 'off')
}

let lastTripPhase = ''

/**
 * Announce trip status phase changes (none → assigned → dispatched → none).
 * @param {'none' | 'assigned' | 'dispatched'} phase
 */
export function maybeAnnounceStatusChange(phase) {
  if (typeof window === 'undefined') return
  pushLiveLog({ type: 'info', message: `[TripVoice] maybeAnnounceStatusChange: ${lastTripPhase} -> ${phase}`, ts: Date.now() })
  if (phase === lastTripPhase) return
  const prev = lastTripPhase
  lastTripPhase = phase
  if (!prev) {
    pushLiveLog({ type: 'info', message: `[TripVoice] skipping: no previous phase`, ts: Date.now() })
    return
  }

  const mode = getTripAlertMode()
  if (mode === 'off') {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping status change: mode is off`, ts: Date.now() })
    return
  }
  if (!isTripStatusChangeEnabled()) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping status change: disabled in prefs`, ts: Date.now() })
    return
  }

  let text = ''
  if (phase === 'assigned' && prev !== 'assigned') {
    text = 'Trip status changed to assigned.'
  } else if (phase === 'dispatched' && prev !== 'dispatched') {
    text = 'Trip status changed to dispatched.'
  } else if (phase === 'none' && prev !== 'none') {
    text = 'Trip completed.'
  }

  if (text) {
    pushLiveLog({ type: 'info', message: `[TripVoice] announcing status change: ${text}`, ts: Date.now() })
    enqueueAnnouncement(text, { bell: mode === 'both', category: `statusChange:${phase}` })
  }
}

/** @type {Map<string, string>} */
const prevTrailerStatuses = new Map()

/**
 * Announce trailer load status changes (LDNG → CLSD).
 * @param {unknown[]} trailers
 */
export function maybeAnnounceTrailerStatusChange(trailers) {
  if (typeof window === 'undefined') return
  if (!Array.isArray(trailers)) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] maybeAnnounceTrailerStatusChange: not an array`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[TripVoice] checking ${trailers.length} trailer(s) for status change`, ts: Date.now() })

  const mode = getTripAlertMode()
  if (mode === 'off') {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping trailer status: mode is off`, ts: Date.now() })
    return
  }
  if (!isTrailerStatusChangeEnabled()) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping trailer status: disabled in prefs`, ts: Date.now() })
    return
  }

  for (const t of trailers) {
    if (!t || typeof t !== 'object') continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    const order = String(tr.trlrOrder ?? '')
    if (!order) continue

    const status = String(tr.detlCodeLoadStatus ?? '').toUpperCase()
    const prev = prevTrailerStatuses.get(order)

    if (prev === 'LDNG' && status === 'CLSD') {
      const text = `Trailer ${order} has finished loading and is now closed.`
      pushLiveLog({ type: 'info', message: `[TripVoice] trailer status change: ${text}`, ts: Date.now() })
      enqueueAnnouncement(text, { bell: mode === 'both', category: `trailer:${order}` })
    }

    prevTrailerStatuses.set(order, status)
  }
}

/**
 * Reset trailer status tracking (call when trip clears).
 */
export function clearTrailerStatusTracking() {
  prevTrailerStatuses.clear()
}

/** @type {Map<string, string>} key: trlrOrder → "lat,lng" rounded */
const prevTrailerGps = new Map()

/** @type {Map<string, number>} trlrOrder → last near-announce timestamp */
const nearTrailerCooldown = new Map()

const RELOC_MIN_MOVE_M = 12
const NEAR_RADIUS_M = 95
const NEAR_COOLDOWN_MS = 110_000

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function gpsKey(lat, lng) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

/**
 * After trailers finish loading, announce when a trailer's lat/lng changes meaningfully.
 * @param {unknown[]} trailers
 */
export function maybeAnnounceTrailerRelocated(trailers) {
  if (typeof window === 'undefined') return
  if (!Array.isArray(trailers)) return
  const mode = getTripAlertMode()
  if (mode === 'off' || !isTrailerGpsTtsEnabled()) return
  evaluateGestureGate()
  if (!gestureUnlocked) return

  for (const t of trailers) {
    if (!t || typeof t !== 'object') continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    const order = String(tr.trlrOrder ?? '').trim()
    if (!order) continue
    const lat = tr.latitude != null ? Number(tr.latitude) : NaN
    const lng = tr.longitude != null ? Number(tr.longitude) : NaN
    if (isNaN(lat) || isNaN(lng)) continue

    const key = gpsKey(lat, lng)
    const prev = prevTrailerGps.get(order)
    prevTrailerGps.set(order, key)

    if (prev == null) continue
    if (prev === key) continue
    const [plat, plng] = prev.split(',').map(Number)
    if (isNaN(plat) || isNaN(plng)) continue
    if (haversineM(plat, plng, lat, lng) < RELOC_MIN_MOVE_M) continue

    const nbr = String(tr.trlrNbr ?? '').trim() || order
    const text = `Trailer ${nbr} has been relocated.`
    pushLiveLog({ type: 'info', message: `[TripVoice] ${text}`, ts: Date.now() })
    enqueueAnnouncement(text, { bell: mode === 'both', category: `trailerReloc:${order}` })
  }
}

/**
 * When user position is known, announce proximity to trailers with GPS.
 * @param {number} userLat
 * @param {number} userLng
 * @param {unknown[]} trailers
 */
export function maybeAnnounceNearTrailer(userLat, userLng, trailers) {
  if (typeof window === 'undefined') return
  if (!Array.isArray(trailers)) return
  if (isNaN(userLat) || isNaN(userLng)) return
  const mode = getTripAlertMode()
  if (mode === 'off' || !isTrailerGpsTtsEnabled()) return
  evaluateGestureGate()
  if (!gestureUnlocked) return

  const now = Date.now()
  for (const t of trailers) {
    if (!t || typeof t !== 'object') continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    const order = String(tr.trlrOrder ?? '').trim()
    if (!order) continue
    const lat = tr.latitude != null ? Number(tr.latitude) : NaN
    const lng = tr.longitude != null ? Number(tr.longitude) : NaN
    if (isNaN(lat) || isNaN(lng)) continue

    const d = haversineM(userLat, userLng, lat, lng)
    if (d > NEAR_RADIUS_M) continue

    const last = nearTrailerCooldown.get(order) ?? 0
    if (now - last < NEAR_COOLDOWN_MS) continue
    nearTrailerCooldown.set(order, now)

    const nbr = String(tr.trlrNbr ?? '').trim() || order
    const text = `You are near trailer ${nbr}.`
    pushLiveLog({ type: 'info', message: `[TripVoice] ${text}`, ts: Date.now() })
    enqueueAnnouncement(text, { bell: mode === 'both', category: `nearTrailer:${order}` })
  }
}

export function clearTrailerGpsTracking() {
  prevTrailerGps.clear()
  nearTrailerCooldown.clear()
}

/**
 * Reset trip phase tracking (call on unmount).
 */
export function clearTripPhaseTracking() {
  lastTripPhase = ''
}

/**
 * Announce successful arrival at destination.
 */
export function announceArrivalSuccess() {
  pushLiveLog({ type: 'info', message: `[TripVoice] announceArrivalSuccess called`, ts: Date.now() })
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping arrival success: mode is off`, ts: Date.now() })
    return
  }
  if (!isArrivalAlertsEnabled()) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping arrival success: disabled in prefs`, ts: Date.now() })
    return
  }
  enqueueAnnouncement('Arrived at destination successfully.', { bell: mode === 'both', category: 'arrivalSuccess' })
}

/**
 * Announce that tractor was already arrived by geofence.
 */
export function announceGeofenceArrival() {
  pushLiveLog({ type: 'info', message: `[TripVoice] announceGeofenceArrival called`, ts: Date.now() })
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping geofence arrival: mode is off`, ts: Date.now() })
    return
  }
  if (!isArrivalAlertsEnabled()) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipping geofence arrival: disabled in prefs`, ts: Date.now() })
    return
  }
  enqueueAnnouncement('Tractor already arrived by geofence.', { bell: mode === 'both', category: 'geofenceArrival' })
}
