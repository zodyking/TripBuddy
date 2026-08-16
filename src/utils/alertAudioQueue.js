/**
 * Unified sequential audio/TTS queue system.
 * All announcements go through this queue to prevent canceling each other.
 * Waits for each utterance to finish (via onend) before starting the next.
 */

import { pushLiveLog } from '../stores/liveLogStore.js'
import {
  showSpeechAlertModal,
  hideSpeechAlertModal,
  setSpeechAlertWordIndex,
  tokenizeSpeechWords,
  wordIndexFromCharIndex,
} from '../stores/speechAlertModalStore.js'
import { closeChatMessageSpeech, focusChatMessageSpeechByCategory } from '../stores/chatMessageSpeechStore.js'
import { isWhatsAppTapToReadCategory } from './chatMessageSpeech.js'
import { speakUtterance } from './speechSynthesisSpeak.js'

const PREFS_KEY = 'fedexAlertPrefs'

const DEFAULT_PREFS = {
  tripReady: true,
  tractorChange: true,
  driverChange: true,
  checkIn: true,
  inspectCheckout: true,
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
/** @type {string} */
let currentSpeechCategory = ''

const DEDUP_WINDOW_MS = 2000

function shouldShowSpeechSubtitles(category) {
  return !isWhatsAppTapToReadCategory(category)
}

/**
 * Process next item in queue. Waits for current speech to finish via onend.
 */
function processNextSpeech() {
  if (typeof window === 'undefined') return
  if (isSpeaking || speechQueue.length === 0) return

  const item = speechQueue.shift()
  if (!item) return

  isSpeaking = true
  currentSpeechCategory = String(item.category || '')
  pushLiveLog({ type: 'info', message: `[Queue] processing: ${item.text}`, ts: Date.now() })

  if (item.bell) {
    playBellThenSpeak(item.text, item.category)
  } else {
    speakText(item.text, item.category)
  }
}

/**
 * Play bell sound, then speak text after bell ends.
 * @param {string} text
 */
function playBellThenSpeak(text, category = '') {
  if (typeof window === 'undefined') {
    isSpeaking = false
    processNextSpeech()
    return
  }

  const url = ALERT_SOUNDS.tripReady
  pushLiveLog({ type: 'info', message: `[Queue] bell triggered: ${url}`, ts: Date.now() })

  let handedOff = false
  const speakAfterBell = (reason) => {
    if (handedOff) return
    handedOff = true
    pushLiveLog({ type: 'info', message: `[Queue] ${reason}: ${text}`, ts: Date.now() })
    speakText(text, category)
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
      setTimeout(() => speakAfterBell('bell ended, speaking'), 300)
    }, { once: true })

    audio.addEventListener('error', () => {
      if (currentAudio === audio) currentAudio = null
      speakAfterBell('bell failed, speaking anyway')
    }, { once: true })

    audio.play().catch((e) => {
      pushLiveLog({ type: 'error', message: `[Queue] bell play rejected: ${e.message || e}`, ts: Date.now() })
      speakAfterBell('bell play rejected, speaking anyway')
    })
  } catch (e) {
    pushLiveLog({ type: 'error', message: `[Queue] bell exception: ${e.message || e}`, ts: Date.now() })
    speakAfterBell('bell exception, speaking anyway')
  }
}

/**
 * Speak text and wait for completion via onend before processing next.
 * @param {string} text
 * @param {string} [category]
 */
function speakText(text, category = '') {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    pushLiveLog({ type: 'warn', message: `[Queue] skipped (no speechSynthesis): ${text}`, ts: Date.now() })
    isSpeaking = false
    processNextSpeech()
    return
  }

  const spoken = String(text || '').trim()
  if (!spoken) {
    isSpeaking = false
    processNextSpeech()
    return
  }

  const words = tokenizeSpeechWords(spoken)
  let boundarySeen = false
  /** @type {ReturnType<typeof setInterval> | null} */
  let fallbackTimer = null
  let finished = false

  const finish = (kind, errorName) => {
    if (finished) return
    finished = true
    if (fallbackTimer) {
      clearInterval(fallbackTimer)
      fallbackTimer = null
    }
    if (kind === 'error') {
      pushLiveLog({
        type: 'error',
        message: `[Queue] TTS error: ${text} - ${errorName || 'unknown'}`,
        ts: Date.now(),
      })
    } else {
      pushLiveLog({ type: 'info', message: `[Queue] TTS ended: ${text}`, ts: Date.now() })
    }
    const cat = category || currentSpeechCategory
    if (shouldShowSpeechSubtitles(cat)) hideSpeechAlertModal()
    currentUtterance = null
    currentSpeechCategory = ''
    isSpeaking = false
    processNextSpeech()
  }

  try {
    const u = speakUtterance(spoken, {
      onboundary: (e) => {
        if (e.name !== 'word' || e.charIndex == null) return
        boundarySeen = true
        const idx = wordIndexFromCharIndex(spoken, e.charIndex)
        if (idx >= 0) setSpeechAlertWordIndex(idx)
      },
      onstart: () => {
        pushLiveLog({ type: 'info', message: `[Queue] TTS started: ${text}`, ts: Date.now() })
        const cat = category || currentSpeechCategory
        if (isWhatsAppTapToReadCategory(cat)) {
          focusChatMessageSpeechByCategory(cat)
        } else if (shouldShowSpeechSubtitles(cat)) {
          showSpeechAlertModal(spoken)
          setSpeechAlertWordIndex(0)
          const stepMs = Math.max(120, Math.max(3000, words.length * 380) / Math.max(1, words.length))
          let i = 0
          fallbackTimer = setInterval(() => {
            if (boundarySeen) return
            i += 1
            if (i < words.length) setSpeechAlertWordIndex(i)
          }, stepMs)
        }
      },
      onend: () => finish('end'),
      onerror: (e) => finish('error', e.error),
    })
    currentUtterance = u
    if (!u) {
      finish('error', 'speak failed')
      return
    }
    pushLiveLog({ type: 'info', message: `[Queue] TTS triggered: ${text}`, ts: Date.now() })
  } catch (e) {
    if (fallbackTimer) {
      clearInterval(fallbackTimer)
      fallbackTimer = null
    }
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
    let handedOff = false
    const speakOnce = () => {
      if (handedOff) return
      handedOff = true
      speakDirectTts(text)
    }
    try {
      const audio = new Audio(url)
      audio.addEventListener('ended', () => {
        setTimeout(speakOnce, 300)
      }, { once: true })
      audio.addEventListener('error', speakOnce, { once: true })
      audio.play().catch(speakOnce)
    } catch {
      speakOnce()
    }
  } else {
    speakDirectTts(text)
  }
}

function speakDirectTts(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const spoken = String(text || '').trim()
  if (!spoken) return
  try {
    speakUtterance(spoken, {
      onstart: () => pushLiveLog({ type: 'info', message: `[Direct] TTS started: ${spoken}`, ts: Date.now() }),
      onend: () => pushLiveLog({ type: 'info', message: `[Direct] TTS ended: ${spoken}`, ts: Date.now() }),
      onerror: (e) =>
        pushLiveLog({ type: 'error', message: `[Direct] TTS error: ${spoken} - ${e.error}`, ts: Date.now() }),
    })
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

export function announceCheckInNewTrip() {
  const prefs = getAlertPrefs()
  if (!prefs.checkIn) {
    pushLiveLog({ type: 'warn', message: `[Alert] checkIn blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceCheckInNewTrip called`, ts: Date.now() })
  enqueueAnnouncement('Check-in successful, new trip found', { category: 'checkInNewTrip' })
}

export function announceInspectCheckoutCancelled() {
  const prefs = getAlertPrefs()
  if (!prefs.inspectCheckout) {
    pushLiveLog({ type: 'warn', message: `[Alert] inspectCheckout blocked by prefs`, ts: Date.now() })
    return
  }
  pushLiveLog({ type: 'info', message: `[Alert] announceInspectCheckoutCancelled called`, ts: Date.now() })
  enqueueAnnouncement('Inspect & check out cancelled, no trip to inspect', {
    category: 'inspectCheckoutCancelled',
  })
}

/** @param {string} message */
export function announceInspectDollyConfirm(message) {
  const prefs = getAlertPrefs()
  if (!prefs.inspectCheckout) {
    pushLiveLog({ type: 'warn', message: `[Alert] inspectCheckout blocked by prefs`, ts: Date.now() })
    return
  }
  const text = String(message ?? '').trim()
  if (!text) return
  pushLiveLog({ type: 'info', message: `[Alert] announceInspectDollyConfirm: ${text}`, ts: Date.now() })
  enqueueAnnouncement(text, { category: 'inspectDollyConfirm', bell: true })
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
  hideSpeechAlertModal()
  closeChatMessageSpeech()
  speechQueue = []
  currentSpeechCategory = ''
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

export function announceInspectCheckoutNewTripDetails() {
  announceInspectCheckoutFailure(
    'Inspect and checkout failed. New trip details were added. Begin a new check-in.',
    'inspectCheckoutNewTrip',
  )
}

/**
 * Speak an inspect/checkout failure or error (dolly, seal, trailer, dispatch).
 * @param {string} message
 * @param {string} [category]
 */
export function announceInspectCheckoutFailure(message, category = 'inspectCheckoutFail') {
  const prefs = getAlertPrefs()
  if (!prefs.inspectCheckout) {
    pushLiveLog({ type: 'warn', message: `[Alert] inspectCheckout blocked by prefs`, ts: Date.now() })
    return
  }
  const text = String(message ?? '').trim()
  if (!text) return
  pushLiveLog({ type: 'info', message: `[Alert] announceInspectCheckoutFailure called`, ts: Date.now() })
  enqueueAnnouncement(text, { category, bell: true })
}

/**
 * Mid-run step error (invalid dolly / seal / trailer / data). Deduped by category.
 * @param {string} message
 * @param {string} [category]
 */
export function announceInspectCheckoutStepError(message, category = 'inspectCheckoutStep') {
  announceInspectCheckoutFailure(message, category)
}

/**
 * Successful inspect/checkout.
 * @param {string} [message]
 */
export function announceInspectCheckoutSuccess(message) {
  const prefs = getAlertPrefs()
  if (!prefs.inspectCheckout) return
  const text = String(message ?? '').trim() || 'Inspect and checkout complete. You are dispatched.'
  pushLiveLog({ type: 'info', message: `[Alert] Inspect & Checkout success: ${text}`, ts: Date.now() })
  enqueueAnnouncement(text, { category: 'inspectCheckoutSuccess' })
}
