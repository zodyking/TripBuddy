/**
 * Sequential audio alert queue system.
 * Uses direct speechSynthesis.speak() (fire and forget) like the working trip-ready approach.
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
  try {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio = null
    }
    const audio = new Audio(url)
    currentAudio = audio
    audio.play().catch((e) => {
      console.error('[Audio] play error:', e)
    })
    audio.addEventListener('ended', () => {
      if (currentAudio === audio) currentAudio = null
    }, { once: true })
  } catch (e) {
    console.error('[Audio] error:', e)
  }
}

/**
 * Speak TTS (fire and forget - don't wait for completion).
 * This matches the working trip-ready approach.
 * @param {string} text
 */
function speakTts(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.05
    utterance.pitch = 1
    utterance.volume = 1
    window.speechSynthesis.speak(utterance)
    console.log('[TTS] speaking:', text)
  } catch (e) {
    console.error('[TTS] speak error:', e)
  }
}

function processQueue() {
  if (isPlaying || alertQueue.length === 0) return

  alertQueue.sort((a, b) => b.priority - a.priority)
  const alert = alertQueue.shift()
  if (!alert) return

  isPlaying = true
  console.log('[AlertQueue] playing:', alert.type, { text: alert.text, soundUrl: alert.soundUrl })

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
    text: 'Tractor details updated.',
    priority: PRIORITY.change,
  })
}

export function announceDriverChange() {
  enqueueAlert('driverChange', {
    text: 'Driver details updated.',
    priority: PRIORITY.change,
  })
}

export function announceCheckInSuccess() {
  console.log('[AlertQueue] announceCheckInSuccess called')
  enqueueAlert('checkInSuccess', {
    text: 'Check-in successful.',
    priority: PRIORITY.info,
  })
}

export function announceCheckInFail() {
  console.log('[AlertQueue] announceCheckInFail called')
  enqueueAlert('checkInFail', {
    text: 'Check-in failed.',
    priority: PRIORITY.error,
  })
}

export function announceCheckInTripReady() {
  console.log('[AlertQueue] announceCheckInTripReady called')
  enqueueAlert('checkInSuccess', {
    text: 'Check in successful. Trip ready and acknowledged.',
    priority: PRIORITY.tripReady,
  })
}

export function announceApiReconnect() {
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

export function testTractorChangeAlert() {
  enqueueAlert('tractorChange', {
    text: 'Test: Tractor details updated.',
    priority: PRIORITY.change,
  })
}

export function testDriverChangeAlert() {
  enqueueAlert('driverChange', {
    text: 'Test: Driver details updated.',
    priority: PRIORITY.change,
  })
}

export function testSuccessAlert() {
  enqueueAlert('checkInSuccess', {
    text: 'Test: Check-in successful.',
    priority: PRIORITY.info,
  })
}

export function testErrorAlert() {
  enqueueAlert('checkInFail', {
    text: 'Test: Check-in failed.',
    priority: PRIORITY.error,
  })
}
