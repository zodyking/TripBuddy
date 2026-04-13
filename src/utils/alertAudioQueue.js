/**
 * Unified sequential audio/TTS queue system.
 * All announcements go through this queue to prevent canceling each other.
 * Waits for each utterance to finish (via onend) before starting the next.
 */

import { pushLiveLog } from '../stores/liveLogStore.js'

const PREFS_KEY = 'fedexAlertPrefs'

const DEFAULT_PREFS = {
  tripReady: true,
  tractorChange: true,
  driverChange: true,
  checkIn: true,
  apiReconnect: false,
}

/** @returns {typeof DEFAULT_PREFS} */
export function getAlertPrefs() {
  if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_PREFS }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/** @param {Partial<typeof DEFAULT_PREFS>} prefs */
export function setAlertPrefs(prefs) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const current = getAlertPrefs()
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }))
  } catch {
    /* ignore */
  }
}

function getSoundUrl(filename) {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}sounds/${filename}`
}

export const ALERT_SOUNDS = {
  tripReady: getSoundUrl('trip-ready-bell.mp3'),
}

/**
 * @typedef {Object} QueuedItem
 * @property {string} text - TTS text to speak
 * @property {boolean} [bell] - Play bell chime before TTS
 * @property {string} [category] - For dedup (e.g. 'tractorChange', 'newTrip')
 * @property {number} ts - Enqueue timestamp
 */

/** @type {QueuedItem[]} */
let speechQueue = []
let isSpeaking = false
let currentAudio = null
let currentUtterance = null

const DEDUP_WINDOW_MS = 2000

/**
 * Process next item in queue. Waits for current speech to finish via onend.
 */
function processNextSpeech() {
  if (typeof window === 'undefined') return
  if (isSpeaking || speechQueue.length === 0) return

  const item = speechQueue.shift()
  if (!item) return

  isSpeaking = true
  pushLiveLog({ type: 'info', message: `[Queue] processing: ${item.text}`, ts: Date.now() })

  if (item.bell) {
    playBellThenSpeak(item.text)
  } else {
    speakText(item.text)
  }
}

/**
 * Play bell sound, then speak text after bell ends.
 * @param {string} text
 */
function playBellThenSpeak(text) {
  if (typeof window === 'undefined') {
    isSpeaking = false
    processNextSpeech()
    return
  }

  const url = ALERT_SOUNDS.tripReady
  pushLiveLog({ type: 'info', message: `[Queue] bell triggered: ${url}`, ts: Date.now() })

  try {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    const audio = new Audio(url)
    currentAudio = audio

    audio.addEventListener('ended', () => {
      if (currentAudio === audio) currentAudio = null
      pushLiveLog({ type: 'info', message: `[Queue] bell ended, speaking: ${text}`, ts: Date.now() })
      setTimeout(() => speakText(text), 300)
    }, { once: true })

    audio.addEventListener('error', () => {
      pushLiveLog({ type: 'error', message: `[Queue] bell failed, speaking anyway: ${text}`, ts: Date.now() })
      if (currentAudio === audio) currentAudio = null
      speakText(text)
    }, { once: true })

    audio.play().catch((e) => {
      pushLiveLog({ type: 'error', message: `[Queue] bell play rejected: ${e.message || e}`, ts: Date.now() })
      speakText(text)
    })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Queue] bell exception: ${e.message || e}`, ts: Date.now() })
    speakText(text)
  }
}

/**
 * Speak text and wait for completion via onend before processing next.
 * @param {string} text
 */
function speakText(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    pushLiveLog({ type: 'warn', message: `[Queue] skipped (no speechSynthesis): ${text}`, ts: Date.now() })
    isSpeaking = false
    processNextSpeech()
    return
  }

  try {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    u.pitch = 1
    u.volume = 1
    currentUtterance = u

    u.onstart = () => {
      pushLiveLog({ type: 'info', message: `[Queue] TTS started: ${text}`, ts: Date.now() })
    }

    u.onend = () => {
      pushLiveLog({ type: 'info', message: `[Queue] TTS ended: ${text}`, ts: Date.now() })
      currentUtterance = null
      isSpeaking = false
      processNextSpeech()
    }

    u.onerror = (e) => {
      pushLiveLog({ type: 'error', message: `[Queue] TTS error: ${text} - ${e.error || 'unknown'}`, ts: Date.now() })
      currentUtterance = null
      isSpeaking = false
      processNextSpeech()
    }

    window.speechSynthesis.speak(u)
    pushLiveLog({ type: 'info', message: `[Queue] TTS triggered: ${text}`, ts: Date.now() })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Queue] TTS exception: ${e.message || e}`, ts: Date.now() })
    currentUtterance = null
    isSpeaking = false
    processNextSpeech()
  }
}

/**
 * Unified announcement entry point. All TTS goes through here.
 * @param {string} text - Text to speak
 * @param {{ bell?: boolean, category?: string }} [opts]
 */
export function enqueueAnnouncement(text, opts = {}) {
  if (typeof window === 'undefined') return
  if (!text || typeof text !== 'string') return

  const now = Date.now()
  const category = opts.category || text

  const existingIndex = speechQueue.findIndex(
    (item) => item.category === category && now - item.ts < DEDUP_WINDOW_MS
  )

  if (existingIndex !== -1) {
    speechQueue[existingIndex] = { text, bell: opts.bell, category, ts: now }
    pushLiveLog({ type: 'info', message: `[Queue] dedup updated: ${text}`, ts: Date.now() })
  } else {
    speechQueue.push({ text, bell: opts.bell, category, ts: now })
    pushLiveLog({ type: 'info', message: `[Queue] enqueued: ${text}`, ts: Date.now() })
  }

  processNextSpeech()
}

/**
 * Direct speech for user-initiated tests (bypasses queue, works on iOS).
 * @param {string} text
 * @param {{ bell?: boolean }} [opts]
 */
export function speakDirect(text, opts = {}) {
  if (typeof window === 'undefined') return

  if (opts.bell) {
    const url = ALERT_SOUNDS.tripReady
    try {
      const audio = new Audio(url)
      audio.addEventListener('ended', () => {
        setTimeout(() => speakDirectTts(text), 300)
      }, { once: true })
      audio.addEventListener('error', () => speakDirectTts(text), { once: true })
      audio.play().catch(() => speakDirectTts(text))
    } catch {
      speakDirectTts(text)
    }
  } else {
    speakDirectTts(text)
  }
}

function speakDirectTts(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    u.pitch = 1
    u.volume = 1
    u.onstart = () => pushLiveLog({ type: 'info', message: `[Direct] TTS started: ${text}`, ts: Date.now() })
    u.onend = () => pushLiveLog({ type: 'info', message: `[Direct] TTS ended: ${text}`, ts: Date.now() })
    u.onerror = (e) => pushLiveLog({ type: 'error', message: `[Direct] TTS error: ${text} - ${e.error}`, ts: Date.now() })
    window.speechSynthesis.speak(u)
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Direct] TTS exception: ${e.message || e}`, ts: Date.now() })
  }
}

export function announceTractorChange() {
  const prefs = getAlertPrefs()
  if (!prefs.tractorChange) {
    pushLiveLog({ type: 'warn', message: `[Alert] tractorChange blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceTractorChange called`, ts: Date.now() })
  enqueueAnnouncement('Tractor details updated.', { category: 'tractorChange' })
}

export function announceDriverChange() {
  const prefs = getAlertPrefs()
  if (!prefs.driverChange) {
    pushLiveLog({ type: 'warn', message: `[Alert] driverChange blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceDriverChange called`, ts: Date.now() })
  enqueueAnnouncement('Driver details updated.', { category: 'driverChange' })
}

export function announceCheckInSuccess() {
  const prefs = getAlertPrefs()
  if (!prefs.checkIn) {
    pushLiveLog({ type: 'warn', message: `[Alert] checkIn blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInSuccess called`, ts: Date.now() })
  enqueueAnnouncement('Check-in successful.', { category: 'checkInSuccess' })
}

export function announceCheckInFail() {
  const prefs = getAlertPrefs()
  if (!prefs.checkIn) {
    pushLiveLog({ type: 'warn', message: `[Alert] checkIn blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInFail called`, ts: Date.now() })
  enqueueAnnouncement('Check-in failed.', { category: 'checkInFail' })
}

export function announceCheckInTripReady() {
  const prefs = getAlertPrefs()
  if (!prefs.checkIn) {
    pushLiveLog({ type: 'warn', message: `[Alert] checkIn blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInTripReady called`, ts: Date.now() })
  enqueueAnnouncement('Check in successful. Trip ready and acknowledged.', { category: 'checkInTripReady' })
}

export function announceApiReconnect() {
  const prefs = getAlertPrefs()
  if (!prefs.apiReconnect) {
    pushLiveLog({ type: 'warn', message: `[Alert] apiReconnect blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceApiReconnect called`, ts: Date.now() })
  enqueueAnnouncement('API reconnected.', { category: 'apiReconnect' })
}

export function cancelAllAlerts() {
  speechQueue = []
  isSpeaking = false
  if (typeof window !== 'undefined') {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    if (currentAudio) {
      try {
        currentAudio.pause()
      } catch {
        /* ignore */
      }
      currentAudio = null
    }
  }
  currentUtterance = null
  pushLiveLog({ type: 'info', message: `[Queue] all alerts cancelled`, ts: Date.now() })
}

export function testTractorChangeAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testTractorChangeAlert called`, ts: Date.now() })
  speakDirect('Tractor details updated.')
}

export function testDriverChangeAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testDriverChangeAlert called`, ts: Date.now() })
  speakDirect('Driver details updated.')
}

export function testSuccessAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testSuccessAlert called`, ts: Date.now() })
  speakDirect('Check-in successful.')
}

export function testErrorAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testErrorAlert called`, ts: Date.now() })
  speakDirect('Check-in failed.')
}
