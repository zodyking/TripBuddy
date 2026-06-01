/**
 * App-wide iMessage / BlueBubbles inbox polling for per-contact TTS and auto-reply.
 * Runs on every page (not only Chats → iMessage).
 */
import {
  isBlueBubblesConfigured,
  getBlueBubblesPollInterval,
  fetchBlueBubblesContacts,
  normalizeBlueBubblesMessage,
  buildBlueBubblesContactMap,
} from './blueBubblesApi.js'
import { ensureBlueBubblesPrefsHydrated, blueBubblesPrefsHydrated } from './blueBubblesPrefs.js'
import { fetchIMessageRecentMessages } from '../api.js'
import { handleNewIncomingIMessageBatch } from './blueBubblesAutoResponder.js'
import { getCachedBbContactMap, setCachedBbContactMap } from '../stores/blueBubblesChatStore.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let startRetryTimer = null
let pollActive = false
let inboxSeeded = false
/** @type {Set<string>} */
const seenInboxIds = new Set()
/** @type {Map<string, string>} */
let contactMap = new Map()
let contactsLoaded = false
let lastPollErrorAt = 0

const SEEN_CAP = 1200
const SEEN_TRIM = 400
const START_RETRY_MS = 4_000
const POLL_ERROR_LOG_COOLDOWN_MS = 20_000

export function isBlueBubblesBackgroundPollActive() {
  return pollActive
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

function trimSeenIds() {
  if (seenInboxIds.size <= SEEN_CAP) return
  const drop = [...seenInboxIds].slice(0, SEEN_TRIM)
  for (const id of drop) seenInboxIds.delete(id)
}

function logPollError(message) {
  const now = Date.now()
  if (now - lastPollErrorAt < POLL_ERROR_LOG_COOLDOWN_MS) return
  lastPollErrorAt = now
  pushLiveLog({ type: 'warn', message: `[iMessage] ${message}`, ts: now })
}

async function pollOnce() {
  if (!isBlueBubblesConfigured()) return
  await ensureContacts()
  try {
    const r = await fetchIMessageRecentMessages({ limit: 40 })
    if (!r?.ok || !Array.isArray(r.messages)) {
      logPollError(r?.error || 'Background poll failed — check iMessage settings')
      return
    }

    const normalized = r.messages
      .map((m) => normalizeBlueBubblesMessage(m, { contactMap }))
      .filter(Boolean)

    if (!inboxSeeded) {
      for (const m of normalized) seenInboxIds.add(m.id)
      inboxSeeded = true
      pushLiveLog({
        type: 'info',
        message: `[iMessage] Background listener ready (${seenInboxIds.size} recent messages seeded)`,
        ts: Date.now(),
      })
      return
    }

    const incoming = normalized.filter((m) => !m.fromMe && !seenInboxIds.has(m.id))
    for (const m of normalized) seenInboxIds.add(m.id)
    trimSeenIds()

    if (incoming.length) {
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
  pollActive = true
  await pollOnce()
  if (!pollActive) return
  if (!pollTimer) {
    pollTimer = setInterval(pollOnce, getBlueBubblesPollInterval())
  }
}

/**
 * Start global iMessage inbox polling (idempotent, retries until configured).
 */
export function startBlueBubblesBackgroundPoll() {
  if (pollTimer) return
  void attemptStart()
}

/**
 * Stop global polling (e.g. logout). Resets seed state so the next start does not announce history.
 */
export function stopBlueBubblesBackgroundPoll() {
  pollActive = false
  inboxSeeded = false
  seenInboxIds.clear()
  if (startRetryTimer) {
    clearTimeout(startRetryTimer)
    startRetryTimer = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * Restart after iMessage credentials change (Settings save).
 */
export function restartBlueBubblesBackgroundPoll() {
  stopBlueBubblesBackgroundPoll()
  startBlueBubblesBackgroundPoll()
}

/**
 * Call once from AppShell — retries background poll when prefs hydrate completes.
 */
export function watchBlueBubblesBackgroundPoll() {
  if (typeof window === 'undefined') return () => {}
  const onHydrated = () => {
    if (!pollTimer && isBlueBubblesConfigured()) {
      startBlueBubblesBackgroundPoll()
    }
  }
  if (blueBubblesPrefsHydrated.value) onHydrated()
  const id = setInterval(() => {
    if (blueBubblesPrefsHydrated.value) {
      onHydrated()
      clearInterval(id)
    }
  }, 500)
  return () => clearInterval(id)
}
