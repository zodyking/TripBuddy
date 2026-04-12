/**
 * Sequential audio alert queue system.
 * Ensures alerts play one at a time (no overlapping) with priority ordering.
 */

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
 * @property {string} [soundUrl] - Sound file URL
 * @property {number} ts - Enqueue timestamp for dedup
 */

/** @type {QueuedAlert[]} */
let alertQueue = []
let isPlaying = false
let currentTtsUtterance = null
let currentAudio = null

const DEDUP_WINDOW_MS = 2000

function getSoundUrl(filename) {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}sounds/${filename}`
}

export const ALERT_SOUNDS = {
  tripReady: getSoundUrl('trip-ready-bell.mp3'),
  tractorChange: getSoundUrl('tractor-change.mp3'),
  driverChange: getSoundUrl('driver-change.mp3'),
  success: getSoundUrl('success.mp3'),
  error: getSoundUrl('error.mp3'),
  reconnect: getSoundUrl('reconnect.mp3'),
}

/**
 * Play audio and return a promise that resolves when finished.
 * @param {string} url
 * @returns {Promise<void>}
 */
function playAudioAsync(url) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }
    try {
      if (currentAudio) {
        currentAudio.pause()
        currentAudio = null
      }
      const audio = new Audio(url)
      currentAudio = audio
      audio.addEventListener('ended', () => {
        if (currentAudio === audio) currentAudio = null
        resolve()
      }, { once: true })
      audio.addEventListener('error', () => {
        if (currentAudio === audio) currentAudio = null
        resolve()
      }, { once: true })
      audio.play().catch(() => {
        if (currentAudio === audio) currentAudio = null
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

/**
 * Speak TTS and return a promise that resolves when finished.
 * @param {string} text
 * @returns {Promise<void>}
 */
function speakTtsAsync(text) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve()
      return
    }
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.05
      utterance.pitch = 1
      utterance.volume = 1
      currentTtsUtterance = utterance
      utterance.onend = () => {
        if (currentTtsUtterance === utterance) currentTtsUtterance = null
        resolve()
      }
      utterance.onerror = () => {
        if (currentTtsUtterance === utterance) currentTtsUtterance = null
        resolve()
      }
      window.speechSynthesis.speak(utterance)
    } catch {
      resolve()
    }
  })
}

async function processQueue() {
  if (isPlaying || alertQueue.length === 0) {
    console.log('[AlertQueue] processQueue: skip', { isPlaying, queueLen: alertQueue.length })
    return
  }

  alertQueue.sort((a, b) => b.priority - a.priority)
  const alert = alertQueue.shift()
  if (!alert) return

  isPlaying = true
  console.log('[AlertQueue] playing:', alert.type, { text: alert.text, soundUrl: alert.soundUrl })

  try {
    if (alert.soundUrl) {
      console.log('[AlertQueue] playAudioAsync start:', alert.soundUrl)
      await playAudioAsync(alert.soundUrl)
      console.log('[AlertQueue] playAudioAsync done')
    }
    if (alert.text) {
      console.log('[AlertQueue] speakTtsAsync start:', alert.text)
      await speakTtsAsync(alert.text)
      console.log('[AlertQueue] speakTtsAsync done')
    }
  } finally {
    isPlaying = false
    console.log('[AlertQueue] processQueue: finished alert, checking next')
    processQueue()
  }
}

/**
 * Enqueue an alert. Deduplicates rapid same-type alerts.
 * @param {AlertType} type
 * @param {{ text?: string, soundUrl?: string, priority?: number }} options
 */
export function enqueueAlert(type, options = {}) {
  if (typeof window === 'undefined') return
  console.log('[AlertQueue] enqueueAlert called:', type, options)

  const prefs = getAlertPrefs()
  
  if (type === 'tractorChange' && !prefs.tractorChange) {
    console.log('[AlertQueue] blocked by prefs: tractorChange disabled')
    return
  }
  if (type === 'driverChange' && !prefs.driverChange) {
    console.log('[AlertQueue] blocked by prefs: driverChange disabled')
    return
  }
  if ((type === 'checkInSuccess' || type === 'checkInFail') && !prefs.checkIn) {
    console.log('[AlertQueue] blocked by prefs: checkIn disabled')
    return
  }
  if (type === 'apiReconnect' && !prefs.apiReconnect) {
    console.log('[AlertQueue] blocked by prefs: apiReconnect disabled')
    return
  }

  const now = Date.now()
  const existingIndex = alertQueue.findIndex(
    (a) => a.type === type && now - a.ts < DEDUP_WINDOW_MS
  )
  if (existingIndex !== -1) {
    console.log('[AlertQueue] dedup: updating existing alert at index', existingIndex)
    alertQueue[existingIndex] = {
      type,
      priority: options.priority ?? PRIORITY.change,
      text: options.text,
      soundUrl: options.soundUrl,
      ts: now,
    }
  } else {
    console.log('[AlertQueue] adding new alert to queue, current length:', alertQueue.length)
    alertQueue.push({
      type,
      priority: options.priority ?? PRIORITY.change,
      text: options.text,
      soundUrl: options.soundUrl,
      ts: now,
    })
  }

  processQueue()
}

export function announceTractorChange() {
  enqueueAlert('tractorChange', {
    soundUrl: ALERT_SOUNDS.tractorChange,
    text: 'Tractor details updated.',
    priority: PRIORITY.change,
  })
}

export function announceDriverChange() {
  enqueueAlert('driverChange', {
    soundUrl: ALERT_SOUNDS.driverChange,
    text: 'Driver details updated.',
    priority: PRIORITY.change,
  })
}

export function announceCheckInSuccess() {
  console.log('[AlertQueue] announceCheckInSuccess called')
  enqueueAlert('checkInSuccess', {
    soundUrl: ALERT_SOUNDS.success,
    text: 'Check-in successful.',
    priority: PRIORITY.info,
  })
}

export function announceCheckInFail() {
  console.log('[AlertQueue] announceCheckInFail called')
  enqueueAlert('checkInFail', {
    soundUrl: ALERT_SOUNDS.error,
    text: 'Check-in failed.',
    priority: PRIORITY.error,
  })
}

export function announceCheckInTripReady() {
  console.log('[AlertQueue] announceCheckInTripReady called')
  enqueueAlert('checkInSuccess', {
    soundUrl: ALERT_SOUNDS.success,
    text: 'Check in successful. Trip ready and acknowledged.',
    priority: PRIORITY.tripReady,
  })
}

export function announceApiReconnect() {
  enqueueAlert('apiReconnect', {
    soundUrl: ALERT_SOUNDS.reconnect,
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
  currentTtsUtterance = null
}

export function testTractorChangeAlert() {
  enqueueAlert('tractorChange', {
    soundUrl: ALERT_SOUNDS.tractorChange,
    text: 'Test: Tractor details updated.',
    priority: PRIORITY.change,
  })
}

export function testDriverChangeAlert() {
  enqueueAlert('driverChange', {
    soundUrl: ALERT_SOUNDS.driverChange,
    text: 'Test: Driver details updated.',
    priority: PRIORITY.change,
  })
}

export function testSuccessAlert() {
  enqueueAlert('checkInSuccess', {
    soundUrl: ALERT_SOUNDS.success,
    text: 'Test: Check-in successful.',
    priority: PRIORITY.info,
  })
}

export function testErrorAlert() {
  enqueueAlert('checkInFail', {
    soundUrl: ALERT_SOUNDS.error,
    text: 'Test: Check-in failed.',
    priority: PRIORITY.error,
  })
}
