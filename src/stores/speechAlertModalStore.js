import { ref } from 'vue'

/** @type {import('vue').Ref<boolean>} */
export const speechAlertModalOpen = ref(false)
/** @type {import('vue').Ref<string>} */
export const speechAlertModalText = ref('')
/** @type {import('vue').Ref<number>} */
export const speechAlertWordIndex = ref(-1)

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeSpeechWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * @param {string} text
 * @param {number} charIndex
 */
export function wordIndexFromCharIndex(text, charIndex) {
  const body = String(text || '')
  const words = tokenizeSpeechWords(body)
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
 * Show floating speech subtitles while TTS is playing.
 * @param {string} text
 */
export function showSpeechAlertModal(text) {
  const t = String(text ?? '').trim()
  if (!t) return
  speechAlertModalText.value = t
  speechAlertWordIndex.value = -1
  speechAlertModalOpen.value = true
}

/** @param {number} index */
export function setSpeechAlertWordIndex(index) {
  speechAlertWordIndex.value = Number.isFinite(index) ? index : -1
}

export function hideSpeechAlertModal() {
  speechAlertModalOpen.value = false
  speechAlertWordIndex.value = -1
}
