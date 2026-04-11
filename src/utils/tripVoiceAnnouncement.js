/**
 * Lightweight in-browser TTS when Linehaul trip details show origin + destination.
 * Uses `window.speechSynthesis` — audio plays on **this device** (PC, tablet, phone),
 * not on the Node server. No audio files or network TTS.
 *
 * Optional future: server `GET /api/tts` + `<audio>` if browser TTS is insufficient
 * (see Agent-Files/tts-cloud-deferred.md).
 */
import { extractOriginDest, hasTripOriginAndDestination } from './tripDetailsDisplay.js'

const STORAGE_KEY = 'fedexTripTtsEnabled'

/** @returns {boolean} */
export function isTripTtsEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  return window.localStorage.getItem(STORAGE_KEY) !== 'false'
}

/** @param {boolean} enabled */
export function setTripTtsEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
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
/** @type {{ fp: string, text: string } | null} */
let pendingAnnouncement = null

let gestureRuleEvaluated = false
/** On touch-primary devices, false until {@link unlockTripVoiceFromUserGesture}. */
let gestureUnlocked = true

function evaluateGestureGate() {
  if (gestureRuleEvaluated || typeof window === 'undefined') return
  gestureRuleEvaluated = true
  if (tripVoiceLikelyNeedsUserGesture()) gestureUnlocked = false
}

function flushPendingTripVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis || !pendingAnnouncement) return
  const { text, fp } = pendingAnnouncement
  pendingAnnouncement = null
  lastFingerprint = fp
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

/**
 * Call from a click / pointer handler so the first announcement can play on iOS / Android
 * (browsers may block speech until there is a user gesture).
 */
export function unlockTripVoiceFromUserGesture() {
  if (typeof window === 'undefined') return
  gestureUnlocked = true
  flushPendingTripVoice()
}

/** Whether to show “tap to enable” UI (touch-primary and not yet unlocked). */
export function tripVoiceShowUnlockHint() {
  if (typeof window === 'undefined') return false
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
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  if (!isTripTtsEnabled()) return

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
    pendingAnnouncement = { fp, text }
    return
  }

  lastFingerprint = fp
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

/** Stop any in-flight announcement (e.g. on unmount). */
export function cancelTripVoiceAnnouncement() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
}
