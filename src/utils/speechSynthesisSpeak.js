/**
 * Single WebKit-safe speechSynthesis.speak().
 * Safari / iOS speaks the same utterance twice when voice is unset, and when
 * cancel() and speak() run in the same turn (the original alert queue did both).
 */

/** @type {SpeechSynthesisVoice | null} */
let cachedEnglishVoice = null
let voicesHooked = false

/**
 * @returns {SpeechSynthesisVoice | null}
 */
export function pickEnglishVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  if (cachedEnglishVoice) return cachedEnglishVoice
  const voices = window.speechSynthesis.getVoices() || []
  if (!voices.length) {
    if (!voicesHooked) {
      voicesHooked = true
      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => {
          cachedEnglishVoice = null
          pickEnglishVoice()
        },
        { once: true },
      )
    }
    return null
  }
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''))
  const pool = en.length ? en : voices
  cachedEnglishVoice =
    pool.find((v) => v.default) ||
    pool.find((v) => /samantha|enhanced|premium|neural/i.test(v.name || '')) ||
    pool[0] ||
    null
  return cachedEnglishVoice
}

/**
 * @param {string} text
 * @param {{
 *   rate?: number,
 *   volume?: number,
 *   lang?: string,
 *   onstart?: (ev: SpeechSynthesisEvent) => void,
 *   onend?: (ev: SpeechSynthesisEvent) => void,
 *   onerror?: (ev: SpeechSynthesisErrorEvent) => void,
 *   onboundary?: (ev: SpeechSynthesisEvent) => void,
 * }} [opts]
 * @returns {SpeechSynthesisUtterance | null}
 */
export function speakUtterance(text, opts = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const spoken = String(text ?? '').trim()
  if (!spoken) return null

  const u = new SpeechSynthesisUtterance(spoken)
  u.lang = opts.lang || 'en-US'
  u.rate = opts.rate ?? 1.05
  u.pitch = 1
  u.volume = opts.volume ?? 1
  const voice = pickEnglishVoice()
  if (voice) u.voice = voice
  if (opts.onstart) u.onstart = opts.onstart
  if (opts.onend) u.onend = opts.onend
  if (opts.onerror) u.onerror = opts.onerror
  if (opts.onboundary) u.onboundary = opts.onboundary

  window.speechSynthesis.speak(u)
  return u
}
