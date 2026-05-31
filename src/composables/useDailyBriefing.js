/**
 * Daily WhatsApp briefing (OpenRouter + TTS). Module-level singleton shared by AppShell + Chat.
 */
import { ref } from 'vue'
import { postWhatsAppDailyBriefing } from '../api.js'
import {
  getWahaChatId,
  isWahaConfigured,
  isWahaDailyBriefingEnabled,
} from '../utils/wahaApi.js'
import { enableSpeechAlertsForBriefing } from '../utils/briefingSpeech.js'
import { getOpenrouterKeyEffective } from '../stores/trafficTileKey.js'
import {
  speakDailyBriefing,
  cancelDailyBriefingPlayback,
} from '../utils/dailyBriefingPlayback.js'

const SESSION_KEY = 'tripbuddy_daily_briefing_offered_v1'
const BRIEFING_MAX_ATTEMPTS = 3

const modalOpen = ref(false)
const loading = ref(false)
const briefingText = ref('')
const messageCount = ref(0)
const error = ref('')
const narratorActive = ref(false)
const narratorWordIndex = ref(-1)

let fetchInFlight = false

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

/**
 * @param {string} msg
 */
function isRetryableBriefingError(msg) {
  const s = String(msg || '').toLowerCase()
  return (
    s.includes('request failed') ||
    s.includes('timed out') ||
    s.includes('timeout') ||
    s.includes('network') ||
    s.includes('fetch') ||
    s.includes('502') ||
    s.includes('503') ||
    s.includes('504') ||
    s.includes('429') ||
    s.includes('rate limit') ||
    s.includes('openrouter') ||
    s.includes('econnreset') ||
    s.includes('socket')
  )
}

/**
 * @param {{ chatId: string, chatLabel?: string, skipThreadSync?: boolean }} payload
 */
async function fetchBriefingWithRetry(payload) {
  let lastError = 'Briefing failed.'
  for (let attempt = 0; attempt < BRIEFING_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1200 * attempt))
    }
    const result = await postWhatsAppDailyBriefing(payload)
    if (result.ok || result.empty) return result
    lastError = typeof result.error === 'string' ? result.error : lastError
    if (!isRetryableBriefingError(lastError)) break
  }
  return { ok: false, error: lastError }
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

/**
 * @param {{ chatLabel?: string, force?: boolean, openOnError?: boolean, skipSessionGate?: boolean, skipThreadSync?: boolean, showModal?: boolean }} [opts]
 */
async function maybeOfferDailyBriefing(opts = {}) {
  if (!opts.force && !opts.skipSessionGate && wasOfferedThisSession()) return
  if (!opts.force && !isWahaDailyBriefingEnabled()) return
  if (!isChatBriefingConfigured()) return

  const chatId = getWahaChatId()
  if (!chatId) return

  if (briefingText.value.trim() && !opts.force) {
    if (opts.showModal !== false) modalOpen.value = true
    return
  }

  if (fetchInFlight) return
  fetchInFlight = true

  if (opts.force || opts.openOnError) modalOpen.value = true
  loading.value = true
  error.value = ''
  if (opts.force) {
    briefingText.value = ''
    messageCount.value = 0
  }

  try {
    const result = await fetchBriefingWithRetry({
      chatId,
      chatLabel: opts.chatLabel || 'WhatsApp chat',
      skipThreadSync: opts.skipThreadSync === true,
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
    if (opts.autoPlay) {
      playBriefing()
      return
    }
    if (opts.showModal !== false) modalOpen.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Briefing failed.'
    if (opts.openOnError) modalOpen.value = true
  } finally {
    loading.value = false
    fetchInFlight = false
  }
}

async function offerBriefingNow(opts = {}) {
  await maybeOfferDailyBriefing({ ...opts, force: true, openOnError: true })
}

/** OpenRouter key + monitored chat required (Settings). */
export function isChatBriefingConfigured() {
  return isWahaConfigured() && !!String(getOpenrouterKeyEffective() || '').trim()
}

/**
 * Chat page: unlock speech, generate briefing, show modal / narrator.
 * @param {{ chatLabel?: string }} [opts]
 */
async function generateBriefingFromChat(opts = {}) {
  if (!isChatBriefingConfigured()) {
    error.value = 'Add an OpenRouter API key in Settings → API and choose a chat under WhatsApp.'
    modalOpen.value = true
    return
  }
  enableSpeechAlertsForBriefing()
  await maybeOfferDailyBriefing({
    force: true,
    openOnError: true,
    skipSessionGate: true,
    skipThreadSync: true,
    chatLabel: opts.chatLabel || 'WhatsApp chat',
    autoPlay: opts.autoPlay !== false,
  })
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
    const result = await fetchBriefingWithRetry({
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

export function useDailyBriefing() {
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
    generateBriefingFromChat,
    acceptBriefing,
    playBriefing,
    dismiss,
    stopNarrator,
    isChatBriefingConfigured,
  }
}
