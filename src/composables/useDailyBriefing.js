/**
 * Once per browser session: offer a spoken daily WhatsApp briefing (OpenRouter).
 */
import { ref } from 'vue'
import { postWhatsAppDailyBriefing } from '../api.js'
import {
  getWahaChatId,
  isWahaConfigured,
  isWahaDailyBriefingEnabled,
  isWahaTtsEnabled,
} from '../utils/wahaApi.js'
import {
  speakDailyBriefing,
  cancelDailyBriefingPlayback,
} from '../utils/dailyBriefingPlayback.js'

const SESSION_KEY = 'tripbuddy_daily_briefing_offered_v1'

export function useDailyBriefing() {
  const modalOpen = ref(false)
  const loading = ref(false)
  const briefingText = ref('')
  const messageCount = ref(0)
  const error = ref('')
  const narratorActive = ref(false)
  const narratorWordIndex = ref(-1)

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

  function stopNarrator() {
    cancelDailyBriefingPlayback()
    narratorActive.value = false
    narratorWordIndex.value = -1
  }

  function playBriefing() {
    const text = briefingText.value.trim()
    if (!text) {
      dismiss()
      return
    }
    markOffered()
    modalOpen.value = false
    narratorActive.value = true
    narratorWordIndex.value = -1

    speakDailyBriefing(text, {
      onWordIndex: (i) => {
        narratorWordIndex.value = i
      },
      onEnd: () => {
        narratorActive.value = false
        narratorWordIndex.value = -1
      },
      onError: () => {
        narratorActive.value = false
        narratorWordIndex.value = -1
      },
    })
  }

  function offerBriefingNow() {
    if (wasOfferedThisSession()) return
    if (!isWahaConfigured()) return
    if (!getWahaChatId()) return
    modalOpen.value = true
  }

  async function acceptBriefing(opts = {}) {
    markOffered()
    modalOpen.value = false
    loading.value = true
    error.value = ''
    briefingText.value = ''

    const chatId = getWahaChatId()
    if (!chatId) { loading.value = false; return }

    try {
      const result = await postWhatsAppDailyBriefing({
        chatId,
        chatLabel: opts.chatLabel || 'WhatsApp chat',
      })
      loading.value = false
      if (!result.ok) {
        error.value = typeof result.error === 'string' ? result.error : 'Briefing failed.'
        return
      }
      if (result.empty || !result.briefing) return
      briefingText.value = result.briefing
      messageCount.value = Number(result.messageCount) || 0
      narratorActive.value = true
      narratorWordIndex.value = -1
      speakDailyBriefing(result.briefing, {
        onWordIndex: (i) => { narratorWordIndex.value = i },
        onEnd: () => { narratorActive.value = false; narratorWordIndex.value = -1 },
        onError: () => { narratorActive.value = false; narratorWordIndex.value = -1 },
      })
    } catch (e) {
      loading.value = false
      error.value = e instanceof Error ? e.message : 'Briefing failed.'
    }
  }

  /**
   * @param {{ chatLabel?: string }} [opts]
   */
  async function maybeOfferDailyBriefing(opts = {}) {
    if (wasOfferedThisSession()) return
    if (!isWahaDailyBriefingEnabled()) return
    if (!isWahaTtsEnabled()) return
    if (!isWahaConfigured()) return

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
      if (!result.ok) {
        error.value = typeof result.error === 'string' ? result.error : 'Briefing failed.'
        return
      }
      if (result.empty || !result.briefing) {
        markOffered()
        return
      }
      briefingText.value = result.briefing
      messageCount.value = Number(result.messageCount) || 0
      modalOpen.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Briefing failed.'
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
    narratorActive,
    narratorWordIndex,
    maybeOfferDailyBriefing,
    offerBriefingNow,
    acceptBriefing,
    playBriefing,
    dismiss,
    stopNarrator,
  }
}
