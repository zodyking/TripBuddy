import { ref } from 'vue'

/** @type {import('vue').Ref<boolean>} */
export const speechAlertModalOpen = ref(false)
/** @type {import('vue').Ref<string>} */
export const speechAlertModalText = ref('')

/**
 * Show the global speech-alert overlay while TTS is playing.
 * @param {string} text
 */
export function showSpeechAlertModal(text) {
  const t = String(text ?? '').trim()
  if (!t) return
  speechAlertModalText.value = t
  speechAlertModalOpen.value = true
}

export function hideSpeechAlertModal() {
  speechAlertModalOpen.value = false
}
