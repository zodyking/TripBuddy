/**
 * Trip-ready alerts on **this device** (TTS and/or bell). Not the Node server.
 * Bell: `public/sounds/trip-ready-bell.mp3` (Mixkit preview SFX, royalty-free — mixkit.co).
 */
import { extractOriginDest, hasTripOriginAndDestination } from './tripDetailsDisplay.js'

const OLD_TTS_KEY = 'fedexTripTtsEnabled'
const MODE_KEY = 'fedexTripAlertMode'
const TRIP_STATUS_CHANGE_KEY = 'fedexTripStatusChangeEnabled'
const TRAILER_STATUS_CHANGE_KEY = 'fedexTrailerStatusChangeEnabled'
const ARRIVAL_ALERTS_KEY = 'fedexArrivalAlertsEnabled'

/** @typedef {'off' | 'tts' | 'bell' | 'both'} TripAlertMode */

/** @returns {TripAlertMode} */
export function getTripAlertMode() {
  if (typeof window === 'undefined' || !window.localStorage) return 'tts'
  const raw = window.localStorage.getItem(MODE_KEY)
  if (raw === 'off' || raw === 'tts' || raw === 'bell' || raw === 'both') return raw
  const legacy = window.localStorage.getItem(OLD_TTS_KEY)
  if (legacy === 'false') return 'off'
  return 'tts'
}

/** @param {TripAlertMode} mode */
export function setTripAlertMode(mode) {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (mode !== 'off' && mode !== 'tts' && mode !== 'bell' && mode !== 'both') return
  window.localStorage.setItem(MODE_KEY, mode)
  try {
    window.localStorage.removeItem(OLD_TTS_KEY)
  } catch {
    /* ignore */
  }
}

/** @returns {boolean} Legacy name: true when TTS should run (tts or both). */
export function isTripTtsEnabled() {
  const m = getTripAlertMode()
  return m === 'tts' || m === 'both'
}

/** @returns {boolean} Bell should play for trip-ready (bell or both). */
export function isTripBellEnabled() {
  const m = getTripAlertMode()
  return m === 'bell' || m === 'both'
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
/** @type {{ fp: string, text: string, wantTts: boolean, wantBell: boolean } | null} */
let pendingAnnouncement = null

let gestureRuleEvaluated = false
/** On touch-primary devices, false until {@link unlockTripVoiceFromUserGesture}. */
let gestureUnlocked = true

/** @type {HTMLAudioElement | null} */
let currentBellAudio = null

function evaluateGestureGate() {
  if (gestureRuleEvaluated || typeof window === 'undefined') return
  gestureRuleEvaluated = true
  if (tripVoiceLikelyNeedsUserGesture()) gestureUnlocked = false
}

function playBellSound() {
  if (typeof window === 'undefined') return
  try {
    if (currentBellAudio) {
      currentBellAudio.pause()
      currentBellAudio = null
    }
    const a = new Audio(getTripBellSoundUrl())
    currentBellAudio = a
    void a.play().catch(() => {})
    a.addEventListener(
      'ended',
      () => {
        if (currentBellAudio === a) currentBellAudio = null
      },
      { once: true },
    )
  } catch {
    /* ignore */
  }
}

function flushPendingTripAlert() {
  if (typeof window === 'undefined' || !pendingAnnouncement) return
  const { fp, text, wantTts, wantBell } = pendingAnnouncement
  pendingAnnouncement = null
  lastFingerprint = fp
  if (wantTts && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.08
      u.pitch = 1
      u.volume = 1
      window.speechSynthesis.speak(u)
    } catch {
      /* ignore */
    }
  }
  if (wantBell) {
    playBellSound()
  }
}

/**
 * Call from a click / pointer handler so the first announcement can play on iOS / Android
 * (browsers may block speech / audio until there is a user gesture).
 */
export function unlockTripVoiceFromUserGesture() {
  if (typeof window === 'undefined') return
  gestureUnlocked = true
  flushPendingTripAlert()
}

/** Whether to show “tap to enable” UI (touch-primary and not yet unlocked). */
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

  const wantTts = mode === 'tts' || mode === 'both'
  const wantBell = mode === 'bell' || mode === 'both'
  if (!wantTts && !wantBell) return

  if (wantTts && !window.speechSynthesis) return

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

  if (!gestureUnlocked) {
    if (pendingAnnouncement?.fp === fp) return
    pendingAnnouncement = { fp, text, wantTts, wantBell }
    return
  }

  lastFingerprint = fp
  if (wantTts && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.08
      u.pitch = 1
      u.volume = 1
      window.speechSynthesis.speak(u)
    } catch {
      /* ignore */
    }
  }
  if (wantBell) {
    playBellSound()
  }
}

/** Stop any in-flight announcement (e.g. on unmount). */
export function cancelTripVoiceAnnouncement() {
  if (typeof window === 'undefined') return
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
  if (currentBellAudio) {
    try {
      currentBellAudio.pause()
    } catch {
      /* ignore */
    }
    currentBellAudio = null
  }
}

/** Settings: test speech (same voice as trip alert). */
export function speakTripTtsTest() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(
      'Trip status changed to assigned. Trailer 1 has finished loading and is now closed.',
    )
    u.rate = 1.08
    u.pitch = 1
    u.volume = 1
    window.speechSynthesis.speak(u)
  } catch {
    /* ignore */
  }
}

/** Settings: test bell sound. */
export function playTripBellTest() {
  playBellSound()
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
  if (phase === lastTripPhase) return
  const prev = lastTripPhase
  lastTripPhase = phase
  if (!prev) return

  const mode = getTripAlertMode()
  if (mode === 'off') return
  if (!isTripStatusChangeEnabled()) return

  let text = ''
  if (phase === 'assigned' && prev !== 'assigned') {
    text = 'Trip status changed to assigned.'
  } else if (phase === 'dispatched' && prev !== 'dispatched') {
    text = 'Trip status changed to dispatched.'
  } else if (phase === 'none' && prev !== 'none') {
    text = 'Trip completed.'
  }

  if (text) {
    announceText(text, mode)
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
  if (!Array.isArray(trailers)) return

  const mode = getTripAlertMode()
  if (mode === 'off') return
  if (!isTrailerStatusChangeEnabled()) return

  for (const t of trailers) {
    if (!t || typeof t !== 'object') continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    const order = String(tr.trlrOrder ?? '')
    if (!order) continue

    const status = String(tr.detlCodeLoadStatus ?? '').toUpperCase()
    const prev = prevTrailerStatuses.get(order)

    if (prev === 'LDNG' && status === 'CLSD') {
      const text = `Trailer ${order} has finished loading and is now closed.`
      announceText(text, mode)
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

/**
 * Reset trip phase tracking (call on unmount).
 */
export function clearTripPhaseTracking() {
  lastTripPhase = ''
}

/**
 * Shared announcement logic for TTS and/or bell.
 * @param {string} text
 * @param {TripAlertMode} mode
 */
function announceText(text, mode) {
  if (typeof window === 'undefined') return

  evaluateGestureGate()

  const wantTts = mode === 'tts' || mode === 'both'
  const wantBell = mode === 'bell' || mode === 'both'

  if (!gestureUnlocked) {
    return
  }

  if (wantTts && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.08
      u.pitch = 1
      u.volume = 1
      window.speechSynthesis.speak(u)
    } catch {
      /* ignore */
    }
  }

  if (wantBell) {
    playBellSound()
  }
}

/**
 * Announce successful arrival at destination.
 */
export function announceArrivalSuccess() {
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') return
  if (!isArrivalAlertsEnabled()) return
  announceText('Arrived at destination successfully.', mode)
}

/**
 * Announce that tractor was already arrived by geofence.
 */
export function announceGeofenceArrival() {
  if (typeof window === 'undefined') return
  const mode = getTripAlertMode()
  if (mode === 'off') return
  if (!isArrivalAlertsEnabled()) return
  announceText('Tractor already arrived by geofence.', mode)
}
