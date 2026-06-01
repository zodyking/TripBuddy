/**
 * App-wide iMessage listener — polls chat list every 2s (same data as iMessage inbox).
 * Detects new messages when a chat's lastMessage ID changes.
 */
import {
  isBlueBubblesConfigured,
  getBlueBubblesPollInterval,
  listBlueBubblesChats,
  fetchBlueBubblesContacts,
  normalizeBlueBubblesMessage,
  buildBlueBubblesContactMap,
} from './blueBubblesApi.js'
import { ensureBlueBubblesPrefsHydrated, blueBubblesPrefsHydrated } from './blueBubblesPrefs.js'
import { handleNewIncomingIMessageBatch } from './blueBubblesAutoResponder.js'
import { resetInboxTracker } from './blueBubblesInboxTracker.js'
import { getCachedBbContactMap, setCachedBbContactMap } from '../stores/blueBubblesChatStore.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let startRetryTimer = null
/** @type {Map<string, string>} */
let contactMap = new Map()
/** chatGuid -> last seen lastMessage id */
/** @type {Map<string, string>} */
const lastMsgIdByChat = new Map()
let listenerSeeded = false
let contactsLoaded = false
let lastPollErrorAt = 0

const START_RETRY_MS = 4_000
const POLL_ERROR_LOG_COOLDOWN_MS = 30_000

export function isBlueBubblesBackgroundPollActive() {
  return pollTimer != null
}

async function ensureContacts() {
  if (contactsLoaded) return
  const cached = getCachedBbContactMap()
  if (cached && Object.keys(cached).length) {
    contactMap = new Map(Object.entries(cached))
    contactsLoaded = true
    return
  }
  try {
    const r = await fetchBlueBubblesContacts()
    if (r.ok && Array.isArray(r.body) && r.body.length) {
      contactMap = buildBlueBubblesContactMap(r.body)
      setCachedBbContactMap(contactMap)
    }
  } catch {
    /* optional */
  }
  contactsLoaded = true
}

function logPollError(message) {
  const now = Date.now()
  if (now - lastPollErrorAt < POLL_ERROR_LOG_COOLDOWN_MS) return
  lastPollErrorAt = now
  pushLiveLog({ type: 'warn', message: `[iMessage] ${message}`, ts: now })
}

/**
 * @param {unknown[]} rawChats
 * @returns {ReturnType<typeof normalizeBlueBubblesMessage>[]}
 */
function collectNewFromChats(rawChats) {
  /** @type {ReturnType<typeof normalizeBlueBubblesMessage>[]} */
  const incoming = []

  for (const raw of rawChats) {
    if (!raw || typeof raw !== 'object') continue
    const c = /** @type {Record<string, unknown>} */ (raw)
    const chatGuid = String(c.guid ?? c.chatGuid ?? '').trim()
    if (!chatGuid) continue

    const lm = c.lastMessage
    if (!lm || typeof lm !== 'object') continue

    const norm = normalizeBlueBubblesMessage(lm, { chatGuid, contactMap })
    if (!norm?.id) continue

    const prevId = lastMsgIdByChat.get(chatGuid)

    if (!listenerSeeded) {
      lastMsgIdByChat.set(chatGuid, norm.id)
      continue
    }

    if (prevId !== norm.id) {
      lastMsgIdByChat.set(chatGuid, norm.id)
      incoming.push(norm)
    }
  }

  return incoming
}

async function pollOnce() {
  if (!isBlueBubblesConfigured()) return
  await ensureContacts()
  try {
    const r = await listBlueBubblesChats({ limit: 80 })
    if (!r.ok || !Array.isArray(r.body)) {
      logPollError(r.error || `Chat poll failed (${r.status || 'unknown'})`)
      return
    }

    const wasSeeded = listenerSeeded
    const incoming = collectNewFromChats(r.body)

    if (!wasSeeded) {
      listenerSeeded = true
      pushLiveLog({
        type: 'info',
        message: `[iMessage] Listening for new messages on all pages (${lastMsgIdByChat.size} chats)`,
        ts: Date.now(),
      })
      return
    }

    if (incoming.length) {
      pushLiveLog({
        type: 'info',
        message: `[iMessage] ${incoming.length} new message(s) detected`,
        ts: Date.now(),
      })
      handleNewIncomingIMessageBatch(incoming, {
        hadPriorMessages: true,
        skipIfNoPriorMessages: false,
      })
    }
  } catch (e) {
    logPollError(e instanceof Error ? e.message : String(e))
  }
}

function scheduleStartRetry() {
  if (pollTimer || startRetryTimer) return
  startRetryTimer = setTimeout(() => {
    startRetryTimer = null
    void attemptStart()
  }, START_RETRY_MS)
}

async function attemptStart() {
  await ensureBlueBubblesPrefsHydrated()
  if (pollTimer) return
  if (!isBlueBubblesConfigured()) {
    scheduleStartRetry()
    return
  }
  await pollOnce()
  if (!pollTimer) {
    pollTimer = setInterval(pollOnce, getBlueBubblesPollInterval())
  }
}

export function startBlueBubblesBackgroundPoll() {
  if (pollTimer) return
  void attemptStart()
}

export function stopBlueBubblesBackgroundPoll() {
  listenerSeeded = false
  lastMsgIdByChat.clear()
  resetInboxTracker()
  if (startRetryTimer) {
    clearTimeout(startRetryTimer)
    startRetryTimer = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function restartBlueBubblesBackgroundPoll() {
  stopBlueBubblesBackgroundPoll()
  startBlueBubblesBackgroundPoll()
}

export function watchBlueBubblesBackgroundPoll() {
  if (typeof window === 'undefined') return () => {}
  const tick = () => {
    if (blueBubblesPrefsHydrated.value && !pollTimer && isBlueBubblesConfigured()) {
      startBlueBubblesBackgroundPoll()
    }
  }
  tick()
  const id = setInterval(() => {
    tick()
    if (pollTimer) clearInterval(id)
  }, 500)
  return () => clearInterval(id)
}

/** Mark a chat's current last message as seen (UI opened a thread). */
export function markChatLastMessageSeen(chatGuid, messageId) {
  const guid = String(chatGuid ?? '').trim()
  const id = String(messageId ?? '').trim()
  if (guid && id) lastMsgIdByChat.set(guid, id)
}
