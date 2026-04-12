/**
 * Trip-ready alerts on **this device** (TTS and/or bell). Not the Node server.
 * Bell: `public/sounds/trip-ready-bell.mp3` (Mixkit preview SFX, royalty-free — mixkit.co).
 */
import { extractOriginDest, hasTripOriginAndDestination } from './tripDetailsDisplay.js'

const OLD_TTS_KEY = 'fedexTripTtsEnabled'
const MODE_KEY = 'fedexTripAlertMode'

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
      'New trip ready from Example Origin to Example Destination.',
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
