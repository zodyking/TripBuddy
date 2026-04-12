/**
 * Trip-ready alerts on **this device** (TTS and/or bell). Not the Node server.
 * Bell: `public/sounds/trip-ready-bell.mp3` (Mixkit preview SFX, royalty-free — mixkit.co).
 */
import { extractOriginDest, hasTripOriginAndDestination } from './tripDetailsDisplay.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

const OLD_TTS_KEY = 'fedexTripTtsEnabled'
const MODE_KEY = 'fedexTripAlertMode'
const TRIP_STATUS_CHANGE_KEY = 'fedexTripStatusChangeEnabled'
const TRAILER_STATUS_CHANGE_KEY = 'fedexTrailerStatusChangeEnabled'
const ARRIVAL_ALERTS_KEY = 'fedexArrivalAlertsEnabled'

/** 
 * Audio mode: off = no alerts, tts = speech only, both = bell chime before speech
 * Note: 'bell' (standalone) is deprecated - bell is now only a chime prefix for TTS
 * @typedef {'off' | 'tts' | 'both'} TripAlertMode 
 */

/** @returns {TripAlertMode} */
export function getTripAlertMode() {
  if (typeof window === 'undefined' || !window.localStorage) return 'tts'
  const raw = window.localStorage.getItem(MODE_KEY)
  // Migrate old 'bell' mode to 'tts' (bell-only no longer supported)
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

/**
 * Play bell sound (fire and forget).
 */
function playBellSound() {
  if (typeof window === 'undefined') return
  const url = getTripBellSoundUrl()
  pushLiveLog({ type: 'info', message: `[Bell] triggered: ${url}`, ts: Date.now() })
  try {
    if (currentBellAudio) {
      currentBellAudio.pause()
      currentBellAudio = null
    }
    const a = new Audio(url)
    currentBellAudio = a
    a.addEventListener('ended', () => {
      if (currentBellAudio === a) currentBellAudio = null
      pushLiveLog({ type: 'info', message: `[Bell] success: ${url}`, ts: Date.now() })
    }, { once: true })
    a.addEventListener('error', () => {
      pushLiveLog({ type: 'error', message: `[Bell] failed: ${url}`, ts: Date.now() })
    }, { once: true })
    a.play()
      .then(() => {
        pushLiveLog({ type: 'info', message: `[Bell] started: ${url}`, ts: Date.now() })
      })
      .catch((e) => {
        pushLiveLog({ type: 'error', message: `[Bell] play rejected: ${e.message || e}`, ts: Date.now() })
      })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Bell] exception: ${e.message || e}`, ts: Date.now() })
  }
}

/**
 * Play bell sound, then speak TTS after 2-second delay.
 * @param {string} text
 */
function playBellThenSpeak(text) {
  playBellSound()
  setTimeout(() => {
    speakUtterance(text)
  }, 2000)
}

function flushPendingTripAlert() {
  if (typeof window === 'undefined' || !pendingAnnouncement) return
  const { fp, text, wantTts, wantBell } = pendingAnnouncement
  pendingAnnouncement = null
  lastFingerprint = fp
  pushLiveLog({ type: 'info', message: `[TripVoice] flushing pending: ${text}`, ts: Date.now() })
  
  if (wantBell && wantTts) {
    playBellThenSpeak(text)
  } else if (wantTts && window.speechSynthesis) {
    speakUtterance(text)
  } else if (wantBell) {
    playBellSound()
  }
}

/**
 * Shared utterance speaker with logging.
 * @param {string} text
 */
function speakUtterance(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] skipped: no speechSynthesis`, ts: Date.now() })
    return
  }
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.08
    u.pitch = 1
    u.volume = 1

    u.onstart = () => {
      pushLiveLog({ type: 'info', message: `[TripVoice] started: ${text}`, ts: Date.now() })
    }
    u.onend = () => {
      pushLiveLog({ type: 'info', message: `[TripVoice] success: ${text}`, ts: Date.now() })
    }
    u.onerror = (e) => {
      pushLiveLog({ type: 'error', message: `[TripVoice] failed: ${text} - ${e.error || 'unknown'}`, ts: Date.now() })
    }

    window.speechSynthesis.speak(u)
    pushLiveLog({ type: 'info', message: `[TripVoice] triggered: ${text}`, ts: Date.now() })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[TripVoice] exception: ${e.message || e}`, ts: Date.now() })
  }
}

/**
 * Call from a click / pointer handler so the first announcement can play on iOS / Android.
 * This MUST call speechSynthesis.speak() directly to prime the browser - just setting a flag doesn't work on iOS.
 */
export function unlockTripVoiceFromUserGesture() {
  if (typeof window === 'undefined') return
  gestureUnlocked = true
  
  const mode = getTripAlertMode()
  
  // Play bell + TTS with delay, or just TTS immediately
  if (mode === 'both') {
    playBellThenSpeak('Text to speech alerts active.')
  } else if (window.speechSynthesis) {
    speakUtterance('Text to speech alerts active.')
  }
  
  flushPendingTripAlert()
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

  if (!window.speechSynthesis) return

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
  const wantBell = mode === 'both'

  if (!gestureUnlocked) {
    if (pendingAnnouncement?.fp === fp) return
    pendingAnnouncement = { fp, text, wantTts: true, wantBell }
    pushLiveLog({ type: 'warn', message: `[TripVoice] queued pending (gesture locked): ${text}`, ts: Date.now() })
    return
  }

  lastFingerprint = fp
  pushLiveLog({ type: 'info', message: `[TripVoice] announcing new trip: ${text}`, ts: Date.now() })
  
  // Bell + TTS with delay, or just TTS immediately
  if (wantBell) {
    playBellThenSpeak(text)
  } else {
    speakUtterance(text)
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
  const text = 'Text to speech alerts active.'
  pushLiveLog({ type: 'info', message: `[TripVoice] test triggered: ${text}`, ts: Date.now() })
  speakUtterance(text)
}

/** Settings: test bell sound. */
export function playTripBellTest() {
  pushLiveLog({ type: 'info', message: `[TripVoice] bell test triggered`, ts: Date.now() })
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
 * Shared announcement logic for TTS with optional bell chime prefix.
 * Bell plays BEFORE TTS as a chime prefix (2-second delay).
 * @param {string} text
 * @param {TripAlertMode} mode
 * @param {{ force?: boolean }} [opts] - If force is true, bypass gesture gate (use for user-initiated actions)
 */
function announceText(text, mode, opts = {}) {
  if (typeof window === 'undefined') return
  if (mode === 'off') return

  evaluateGestureGate()

  const wantBell = mode === 'both'

  if (!gestureUnlocked && !opts.force) {
    pushLiveLog({ type: 'warn', message: `[TripVoice] blocked by gesture gate: ${text}`, ts: Date.now() })
    return
  }

  pushLiveLog({ type: 'info', message: `[TripVoice] announceText: ${text} (bell=${wantBell})`, ts: Date.now() })

  // Bell + TTS with 2-second delay, or just TTS immediately
  if (wantBell) {
    playBellThenSpeak(text)
  } else if (window.speechSynthesis) {
    speakUtterance(text)
  }
}

/**
 * Announce successful arrival at destination.
 * Uses force mode since this is triggered by user-initiated automation.
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
  announceText('Arrived at destination successfully.', mode, { force: true })
}

/**
 * Announce that tractor was already arrived by geofence.
 * Uses force mode since this is triggered by user-initiated automation.
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
  announceText('Tractor already arrived by geofence.', mode, { force: true })
}
