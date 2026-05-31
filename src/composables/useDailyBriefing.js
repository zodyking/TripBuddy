/**
 * Daily WhatsApp briefing (OpenRouter + TTS). Module-level singleton shared by AppShell + Chat.
 */
import { ref } from 'vue'
import { postWhatsAppDailyBriefing } from '../api.js'
import {
  getWahaChatId,
  isWahaConfigured,
} from '../utils/wahaApi.js'
import { enableSpeechAlertsForBriefing } from '../utils/briefingSpeech.js'
import { getOpenrouterKeyEffective } from '../stores/trafficTileKey.js'
import {
  speakDailyBriefing,
  cancelDailyBriefingPlayback,
} from '../utils/dailyBriefingPlayback.js'
import {
  getCachedBriefingIfValid,
  writeBriefingCacheEntry,
} from '../utils/dailyBriefingCache.js'

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
    error.value = 'No briefing to play yet.'
    modalOpen.value = true
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

/** Monitored chat + OpenRouter key (local or server-hydrated). */
export function isChatBriefingConfigured() {
  return isWahaConfigured()
}

/**
 * @param {{
 *   chatLabel?: string,
 *   lastMessageKey?: string,
 *   skipThreadSync?: boolean,
 *   openOnError?: boolean,
 * }} [opts]
 */
async function fetchAndStoreBriefing(opts = {}) {
  const chatId = getWahaChatId()
  if (!chatId) {
    error.value = 'No chat configured.'
    if (opts.openOnError) modalOpen.value = true
    return false
  }

  if (!String(getOpenrouterKeyEffective() || '').trim()) {
    error.value = 'Add an OpenRouter API key in Settings → API.'
    if (opts.openOnError) modalOpen.value = true
    return false
  }

  if (fetchInFlight) return false
  fetchInFlight = true
  loading.value = true
  error.value = ''

  try {
    const result = await fetchBriefingWithRetry({
      chatId,
      chatLabel: opts.chatLabel || 'WhatsApp chat',
      skipThreadSync: opts.skipThreadSync === true,
    })
    if (!result.ok) {
      error.value = typeof result.error === 'string' ? result.error : 'Briefing failed.'
      if (opts.openOnError) modalOpen.value = true
      return false
    }
    if (result.empty || !result.briefing) {
      error.value = 'No messages in the last 2 days to summarize.'
      if (opts.openOnError) modalOpen.value = true
      return false
    }
    briefingText.value = result.briefing
    messageCount.value = Number(result.messageCount) || 0
    const lastKey = String(opts.lastMessageKey ?? '').trim()
    if (lastKey) {
      writeBriefingCacheEntry(chatId, {
        briefing: result.briefing,
        messageCount: messageCount.value,
        lastMessageKey: lastKey,
      })
    }
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Briefing failed.'
    if (opts.openOnError) modalOpen.value = true
    return false
  } finally {
    loading.value = false
    fetchInFlight = false
  }
}

/**
 * Play cached briefing or fetch a new one, then speak.
 * @param {{
 *   chatLabel?: string,
 *   lastMessageKey?: string,
 *   skipThreadSync?: boolean,
 *   openOnError?: boolean,
 * }} [opts]
 */
async function playOrGenerateBriefing(opts = {}) {
  if (!isChatBriefingConfigured()) {
    error.value = 'Connect WhatsApp in Settings and choose a chat.'
    modalOpen.value = true
    return
  }

  enableSpeechAlertsForBriefing()

  const chatId = getWahaChatId()
  const lastKey = String(opts.lastMessageKey ?? '').trim()
  if (chatId && lastKey) {
    const cached = getCachedBriefingIfValid(chatId, lastKey)
    if (cached) {
      briefingText.value = cached.briefing
      messageCount.value = cached.messageCount
      error.value = ''
      playBriefing()
      return
    }
  }

  const ok = await fetchAndStoreBriefing({
    chatLabel: opts.chatLabel,
    lastMessageKey: lastKey,
    skipThreadSync: opts.skipThreadSync,
    openOnError: opts.openOnError,
  })
  if (ok) playBriefing()
}

/**
 * @param {{ chatLabel?: string, force?: boolean, openOnError?: boolean, skipSessionGate?: boolean }} [opts]
 */
async function maybeOfferDailyBriefing(opts = {}) {
  if (!opts.force && !opts.skipSessionGate && wasOfferedThisSession()) return
  if (!isChatBriefingConfigured()) return

  const chatId = getWahaChatId()
  if (!chatId) return

  if (briefingText.value.trim() && !opts.force) {
    if (opts.showModal !== false) modalOpen.value = true
    return
  }

  if (opts.force || opts.openOnError) modalOpen.value = true

  const ok = await fetchAndStoreBriefing({
    chatLabel: opts.chatLabel,
    openOnError: opts.openOnError,
  })
  if (ok && opts.showModal !== false) modalOpen.value = true
}

async function offerBriefingNow(opts = {}) {
  await playOrGenerateBriefing({
    ...opts,
    openOnError: true,
    skipThreadSync: true,
  })
}

/**
 * Chat Brief button and double-tap use chat.
 * @param {{ chatLabel?: string, lastMessageKey?: string }} [opts]
 */
async function generateBriefingFromChat(opts = {}) {
  await playOrGenerateBriefing({
    chatLabel: opts.chatLabel || 'WhatsApp chat',
    lastMessageKey: opts.lastMessageKey,
    skipThreadSync: true,
    openOnError: true,
  })
}

async function acceptBriefing(opts = {}) {
  if (briefingText.value.trim()) {
    playBriefing()
    return
  }
  await playOrGenerateBriefing({
    chatLabel: opts.chatLabel,
    openOnError: true,
  })
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
    playOrGenerateBriefing,
    acceptBriefing,
    playBriefing,
    dismiss,
    stopNarrator,
    isChatBriefingConfigured,
  }
}
