/**
 * Spoken daily briefing with live on-screen word highlighting (speechSynthesis).
 */
import { pushLiveLog } from '../stores/liveLogStore.js'

const BRIEFING_PREFIX = 'Daily briefing.'

/** @type {(() => void) | null} */
let activeCancel = null

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeBriefingWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Map utterance charIndex (full spoken string) to word index in briefing body only.
 * @param {string} body
 * @param {number} charIndex
 */
function wordIndexFromCharIndex(body, charIndex) {
  const words = tokenizeBriefingWords(body)
  if (!words.length || charIndex < 0) return -1
  let pos = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const idx = body.indexOf(w, pos)
    if (idx < 0) continue
    const end = idx + w.length
    if (charIndex >= idx && charIndex <= end) return i
    pos = end
  }
  const ratio = charIndex / Math.max(1, body.length)
  return Math.min(words.length - 1, Math.floor(ratio * words.length))
}

/**
 * @param {string} text
 */
function estimateSpeechMs(text) {
  const words = tokenizeBriefingWords(text).length
  return Math.max(3000, words * 380)
}

/**
 * @param {string} bodyText — briefing summary (no prefix)
 * @param {{
 *   onStart?: () => void,
 *   onWordIndex?: (index: number) => void,
 *   onEnd?: () => void,
 *   onError?: (err?: string) => void,
 * }} [callbacks]
 */
export function speakDailyBriefing(bodyText, callbacks = {}) {
  const body = String(bodyText || '').trim()
  if (!body || typeof window === 'undefined' || !window.speechSynthesis) {
    callbacks.onError?.('no-speech')
    return () => {}
  }

  cancelDailyBriefingPlayback()

  const words = tokenizeBriefingWords(body)
  const utterText = `${BRIEFING_PREFIX} ${body}`
  const prefixLen = BRIEFING_PREFIX.length + 1

  let boundarySeen = false
  /** @type {ReturnType<typeof setInterval> | null} */
  let fallbackTimer = null
  /** @type {SpeechSynthesisUtterance | null} */
  let utterance = null

  function cleanup() {
    if (fallbackTimer) {
      clearInterval(fallbackTimer)
      fallbackTimer = null
    }
    utterance = null
    if (activeCancel === cancel) activeCancel = null
  }

  function cancel() {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
    cleanup()
    callbacks.onEnd?.()
  }

  activeCancel = cancel

  try {
    const u = new SpeechSynthesisUtterance(utterText)
    u.rate = 1.02
    u.pitch = 1
    u.volume = 1
    utterance = u

    u.onboundary = (e) => {
      if (e.name !== 'word' || e.charIndex == null) return
      boundarySeen = true
      const bodyChar = e.charIndex - prefixLen
      if (bodyChar < 0) return
      const idx = wordIndexFromCharIndex(body, bodyChar)
      if (idx >= 0) callbacks.onWordIndex?.(idx)
    }

    u.onstart = () => {
      pushLiveLog({ type: 'info', message: '[Briefing] TTS started', ts: Date.now() })
      callbacks.onStart?.()
      callbacks.onWordIndex?.(0)

      const durationMs = estimateSpeechMs(utterText)
      const stepMs = Math.max(120, durationMs / Math.max(1, words.length))
      let i = 0
      fallbackTimer = setInterval(() => {
        if (boundarySeen) return
        i += 1
        if (i < words.length) callbacks.onWordIndex?.(i)
      }, stepMs)
    }

    u.onend = () => {
      pushLiveLog({ type: 'info', message: '[Briefing] TTS ended', ts: Date.now() })
      cleanup()
      callbacks.onWordIndex?.(Math.max(0, words.length - 1))
      callbacks.onEnd?.()
    }

    u.onerror = (e) => {
      pushLiveLog({
        type: 'error',
        message: `[Briefing] TTS error: ${e?.error || 'unknown'}`,
        ts: Date.now(),
      })
      cleanup()
      callbacks.onError?.(e?.error || 'error')
    }

    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch (e) {
    cleanup()
    callbacks.onError?.(e instanceof Error ? e.message : String(e))
  }

  return cancel
}

export function cancelDailyBriefingPlayback() {
  if (activeCancel) {
    const fn = activeCancel
    activeCancel = null
    fn()
  } else if (typeof window !== 'undefined') {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
  }
}

export function isDailyBriefingPlaybackActive() {
  return activeCancel != null
}
