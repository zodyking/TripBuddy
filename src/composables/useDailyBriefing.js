/**
 * Once per browser session: offer a spoken daily WhatsApp briefing (OpenRouter).
 */
import { ref } from 'vue'
import { postWhatsAppDailyBriefing } from '../api.js'
import { getWahaChatId, isWahaConfigured, isWahaTtsEnabled } from '../utils/wahaApi.js'
import { isTripAlertEnabled } from '../utils/tripVoiceAnnouncement.js'
import { getOpenrouterKeyEffective } from '../stores/trafficTileKey.js'
import { enqueueAnnouncement } from '../utils/alertAudioQueue.js'

const SESSION_KEY = 'tripbuddy_daily_briefing_offered_v1'

export function useDailyBriefing() {
  const modalOpen = ref(false)
  const loading = ref(false)
  const briefingText = ref('')
  const messageCount = ref(0)
  const error = ref('')

  function markOffered() {
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  function wasOfferedThisSession() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1'
    } catch {
      return false
    }
  }

  function dismiss() {
    modalOpen.value = false
    markOffered()
  }

  async function playBriefing() {
    const text = briefingText.value.trim()
    if (!text) {
      dismiss()
      return
    }
    markOffered()
    modalOpen.value = false
    enqueueAnnouncement(`Daily briefing. ${text}`, { category: 'daily-briefing' })
  }

  /**
   * @param {{ chatLabel?: string }} [opts]
   */
  async function maybeOfferDailyBriefing(opts = {}) {
    if (wasOfferedThisSession()) return
    if (!isTripAlertEnabled() && !isWahaTtsEnabled()) return
    if (!isWahaConfigured()) return
    if (!getOpenrouterKeyEffective().trim()) return

    const chatId = getWahaChatId()
    if (!chatId) return

    loading.value = true
    error.value = ''
    briefingText.value = ''
    messageCount.value = 0

    try {
      const result = await postWhatsAppDailyBriefing({
        chatId,
        chatLabel: opts.chatLabel || 'WhatsApp chat',
      })
      markOffered()
      if (!result.ok) {
        return
      }
      if (result.empty || !result.briefing) {
        return
      }
      briefingText.value = result.briefing
      messageCount.value = Number(result.messageCount) || 0
      modalOpen.value = true
    } catch {
      markOffered()
    } finally {
      loading.value = false
    }
  }

  return {
    modalOpen,
    loading,
    briefingText,
    messageCount,
    error,
    maybeOfferDailyBriefing,
    playBriefing,
    dismiss,
  }
}
