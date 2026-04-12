/**
 * Sequential audio alert queue system.
 * Uses direct speechSynthesis.speak() (fire and forget) like the working trip-ready approach.
 */

import { pushLiveLog } from '../stores/liveLogStore.js'

const PREFS_KEY = 'fedexAlertPrefs'

const PRIORITY = {
  error: 4,
  tripReady: 3,
  change: 2,
  info: 1,
}

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

/** @typedef {'tripReady' | 'tractorChange' | 'driverChange' | 'checkInSuccess' | 'checkInFail' | 'apiReconnect'} AlertType */

/**
 * @typedef {Object} QueuedAlert
 * @property {AlertType} type
 * @property {number} priority
 * @property {string} [text] - TTS text
 * @property {string} [soundUrl] - Sound file URL (only for trip-ready bell)
 * @property {number} ts - Enqueue timestamp for dedup
 */

/** @type {QueuedAlert[]} */
let alertQueue = []
let isPlaying = false
let currentAudio = null

const DEDUP_WINDOW_MS = 2000

function getSoundUrl(filename) {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}sounds/${filename}`
}

export const ALERT_SOUNDS = {
  tripReady: getSoundUrl('trip-ready-bell.mp3'),
}

/**
 * Play audio (fire and forget - don't wait for completion).
 * @param {string} url
 */
function playAudioAsync(url) {
  if (typeof window === 'undefined') return
  pushLiveLog({ type: 'info', message: `[Audio] triggered: ${url}`, ts: Date.now() })
  try {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    const audio = new Audio(url)
    currentAudio = audio
    audio.addEventListener('ended', () => {
      if (currentAudio === audio) currentAudio = null
      pushLiveLog({ type: 'info', message: `[Audio] success: ${url}`, ts: Date.now() })
    }, { once: true })
    audio.addEventListener('error', () => {
      pushLiveLog({ type: 'error', message: `[Audio] failed: ${url}`, ts: Date.now() })
    }, { once: true })
    audio.play()
      .then(() => {
        pushLiveLog({ type: 'info', message: `[Audio] started: ${url}`, ts: Date.now() })
      })
      .catch((e) => {
        pushLiveLog({ type: 'error', message: `[Audio] play rejected: ${e.message || e}`, ts: Date.now() })
      })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Audio] exception: ${e.message || e}`, ts: Date.now() })
  }
}

/**
 * Speak TTS (fire and forget - don't wait for completion).
 * This matches the working trip-ready approach.
 * @param {string} text
 */
function speakTts(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    pushLiveLog({ type: 'warn', message: `[TTS] skipped: no speechSynthesis available`, ts: Date.now() })
    return
  }
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.05
    utterance.pitch = 1
    utterance.volume = 1

    utterance.onstart = () => {
      pushLiveLog({ type: 'info', message: `[TTS] started: ${text}`, ts: Date.now() })
    }
    utterance.onend = () => {
      pushLiveLog({ type: 'info', message: `[TTS] success: ${text}`, ts: Date.now() })
    }
    utterance.onerror = (e) => {
      pushLiveLog({ type: 'error', message: `[TTS] failed: ${text} - ${e.error || 'unknown'}`, ts: Date.now() })
    }

    window.speechSynthesis.speak(utterance)
    pushLiveLog({ type: 'info', message: `[TTS] triggered: ${text}`, ts: Date.now() })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[TTS] exception: ${e.message || e}`, ts: Date.now() })
  }
}

function processQueue() {
  if (isPlaying || alertQueue.length === 0) return

  alertQueue.sort((a, b) => b.priority - a.priority)
  const alert = alertQueue.shift()
  if (!alert) return

  isPlaying = true
  pushLiveLog({ type: 'info', message: `[AlertQueue] playing: ${alert.type} - ${alert.text || '(no text)'}`, ts: Date.now() })

  if (alert.soundUrl) {
    playAudioAsync(alert.soundUrl)
  }
  if (alert.text) {
    speakTts(alert.text)
  }

  setTimeout(() => {
    isPlaying = false
    processQueue()
  }, 100)
}

/**
 * Enqueue an alert. Deduplicates rapid same-type alerts.
 * @param {AlertType} type
 * @param {{ text?: string, soundUrl?: string, priority?: number }} options
 */
export function enqueueAlert(type, options = {}) {
  if (typeof window === 'undefined') return

  const prefs = getAlertPrefs()
  
  if (type === 'tractorChange' && !prefs.tractorChange) {
    pushLiveLog({ type: 'warn', message: `[AlertQueue] blocked: tractorChange disabled in prefs`, ts: Date.now() })
    return
  }
  if (type === 'driverChange' && !prefs.driverChange) {
    pushLiveLog({ type: 'warn', message: `[AlertQueue] blocked: driverChange disabled in prefs`, ts: Date.now() })
    return
  }
  if ((type === 'checkInSuccess' || type === 'checkInFail') && !prefs.checkIn) {
    pushLiveLog({ type: 'warn', message: `[AlertQueue] blocked: checkIn disabled in prefs`, ts: Date.now() })
    return
  }
  if (type === 'apiReconnect' && !prefs.apiReconnect) {
    pushLiveLog({ type: 'warn', message: `[AlertQueue] blocked: apiReconnect disabled in prefs`, ts: Date.now() })
    return
  }

  const now = Date.now()
  const existingIndex = alertQueue.findIndex(
    (a) => a.type === type && now - a.ts < DEDUP_WINDOW_MS
  )
  if (existingIndex !== -1) {
    alertQueue[existingIndex] = {
      type,
      priority: options.priority ?? PRIORITY.change,
      text: options.text,
      soundUrl: options.soundUrl,
      ts: now,
    }
    pushLiveLog({ type: 'info', message: `[AlertQueue] dedup updated: ${type}`, ts: Date.now() })
  } else {
    alertQueue.push({
      type,
      priority: options.priority ?? PRIORITY.change,
      text: options.text,
      soundUrl: options.soundUrl,
      ts: now,
    })
    pushLiveLog({ type: 'info', message: `[AlertQueue] enqueued: ${type} - ${options.text || '(no text)'}`, ts: Date.now() })
  }

  processQueue()
}

export function announceTractorChange() {
  pushLiveLog({ type: 'info', message: `[Alert] announceTractorChange called`, ts: Date.now() })
  enqueueAlert('tractorChange', {
    text: 'Tractor details updated.',
    priority: PRIORITY.change,
  })
}

export function announceDriverChange() {
  pushLiveLog({ type: 'info', message: `[Alert] announceDriverChange called`, ts: Date.now() })
  enqueueAlert('driverChange', {
    text: 'Driver details updated.',
    priority: PRIORITY.change,
  })
}

export function announceCheckInSuccess() {
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInSuccess called`, ts: Date.now() })
  enqueueAlert('checkInSuccess', {
    text: 'Check-in successful.',
    priority: PRIORITY.info,
  })
}

export function announceCheckInFail() {
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInFail called`, ts: Date.now() })
  enqueueAlert('checkInFail', {
    text: 'Check-in failed.',
    priority: PRIORITY.error,
  })
}

export function announceCheckInTripReady() {
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInTripReady called`, ts: Date.now() })
  enqueueAlert('checkInSuccess', {
    text: 'Check in successful. Trip ready and acknowledged.',
    priority: PRIORITY.tripReady,
  })
}

export function announceApiReconnect() {
  pushLiveLog({ type: 'info', message: `[Alert] announceApiReconnect called`, ts: Date.now() })
  enqueueAlert('apiReconnect', {
    text: 'API reconnected.',
    priority: PRIORITY.info,
  })
}

export function cancelAllAlerts() {
  alertQueue = []
  isPlaying = false
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
}

/**
 * Test functions call speechSynthesis directly (not through queue) to work on iOS.
 * The queue doesn't work on iOS because it's not triggered by a user gesture.
 */
export function testTractorChangeAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testTractorChangeAlert called`, ts: Date.now() })
  speakTts('Tractor details updated.')
}

export function testDriverChangeAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testDriverChangeAlert called`, ts: Date.now() })
  speakTts('Driver details updated.')
}

export function testSuccessAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testSuccessAlert called`, ts: Date.now() })
  speakTts('Check-in successful.')
}

export function testErrorAlert() {
  pushLiveLog({ type: 'info', message: `[Test] testErrorAlert called`, ts: Date.now() })
  speakTts('Check-in failed.')
}
