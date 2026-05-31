/**
 * Once per browser session: offer a spoken daily WhatsApp briefing (OpenRouter).
 */
import { ref } from 'vue'
import { postWhatsAppDailyBriefing, syncWhatsAppThread } from '../api.js'
import {
  getWahaChatId,
  isWahaConfigured,
  isWahaDailyBriefingEnabled,
} from '../utils/wahaApi.js'
import {
  speakDailyBriefing,
  cancelDailyBriefingPlayback,
} from '../utils/dailyBriefingPlayback.js'

const SESSION_KEY = 'tripbuddy_daily_briefing_offered_v1'
const BRIEFING_SYNC_LIMIT = 300

async function prepareBriefingMessages(chatId) {
  try {
    await syncWhatsAppThread(chatId, { limit: BRIEFING_SYNC_LIMIT })
  } catch {
    /* briefing endpoint also syncs server-side */
  }
}

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

  async function offerBriefingNow(opts = {}) {
    await maybeOfferDailyBriefing({ ...opts, force: true, openOnError: true })
  }

  async function acceptBriefing(opts = {}) {
    if (briefingText.value.trim()) {
      playBriefing()
      return
    }

    markOffered()
    loading.value = true
    error.value = ''
    briefingText.value = ''

    const chatId = getWahaChatId()
    if (!chatId) {
      loading.value = false
      error.value = 'No chat configured.'
      return
    }

    try {
      await prepareBriefingMessages(chatId)
      const result = await postWhatsAppDailyBriefing({
        chatId,
        chatLabel: opts.chatLabel || 'WhatsApp chat',
      })
      loading.value = false
      if (!result.ok) {
        error.value = typeof result.error === 'string' ? result.error : 'Briefing failed.'
        return
      }
      if (result.empty || !result.briefing) {
        error.value = 'No messages in the last 2 days to summarize.'
        return
      }
      briefingText.value = result.briefing
      messageCount.value = Number(result.messageCount) || 0
      modalOpen.value = false
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
   * @param {{ chatLabel?: string, force?: boolean, openOnError?: boolean }} [opts]
   */
  async function maybeOfferDailyBriefing(opts = {}) {
    if (!opts.force && wasOfferedThisSession()) return
    if (!isWahaDailyBriefingEnabled()) return
    if (!isWahaConfigured()) return

    const chatId = getWahaChatId()
    if (!chatId) return

    if (opts.force) modalOpen.value = true
    loading.value = true
    error.value = ''
    briefingText.value = ''
    messageCount.value = 0

    try {
      await prepareBriefingMessages(chatId)
      const result = await postWhatsAppDailyBriefing({
        chatId,
        chatLabel: opts.chatLabel || 'WhatsApp chat',
      })
      if (!result.ok) {
        error.value = typeof result.error === 'string' ? result.error : 'Briefing failed.'
        if (opts.openOnError) modalOpen.value = true
        return
      }
      if (result.empty || !result.briefing) {
        if (opts.force || opts.openOnError) {
          error.value = 'No messages in the last 2 days to summarize.'
          modalOpen.value = true
        } else {
          markOffered()
        }
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
