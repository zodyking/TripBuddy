/**
 * App-wide iMessage inbox listener — same fetch path as the iMessage chat UI.
 * Polls every 2s from AppShell so per-contact read-aloud works on any page.
 */
import {
  isBlueBubblesConfigured,
  getBlueBubblesPollInterval,
  fetchBlueBubblesRecentMessages,
  fetchBlueBubblesContacts,
  normalizeBlueBubblesMessage,
  buildBlueBubblesContactMap,
} from './blueBubblesApi.js'
import { ensureBlueBubblesPrefsHydrated, blueBubblesPrefsHydrated } from './blueBubblesPrefs.js'
import { handleNewIncomingIMessageBatch } from './blueBubblesAutoResponder.js'
import { getCachedBbContactMap, setCachedBbContactMap } from '../stores/blueBubblesChatStore.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let startRetryTimer = null
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

function trimSeenIds() {
  if (seenInboxIds.size <= SEEN_CAP) return
  for (const id of [...seenInboxIds].slice(0, SEEN_TRIM)) seenInboxIds.delete(id)
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
    const r = await fetchBlueBubblesRecentMessages({ limit: 40 })
    if (!r.ok || !Array.isArray(r.body)) {
      logPollError(r.error || `Inbox poll failed (${r.status || 'unknown'})`)
      return
    }

    const normalized = r.body
      .map((m) => normalizeBlueBubblesMessage(m, { contactMap }))
      .filter(Boolean)

    if (!inboxSeeded) {
      for (const m of normalized) seenInboxIds.add(m.id)
      inboxSeeded = true
      pushLiveLog({
        type: 'info',
        message: `[iMessage] Listening on all pages (${seenInboxIds.size} messages seeded)`,
        ts: Date.now(),
      })
      return
    }

    const incoming = normalized.filter((m) => !seenInboxIds.has(m.id))
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
  await pollOnce()
  if (!pollTimer) {
    pollTimer = setInterval(pollOnce, getBlueBubblesPollInterval())
  }
}

/** Start global iMessage inbox listener (idempotent). */
export function startBlueBubblesBackgroundPoll() {
  if (pollTimer) return
  void attemptStart()
}

/** Stop global listener. */
export function stopBlueBubblesBackgroundPoll() {
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

export function restartBlueBubblesBackgroundPoll() {
  stopBlueBubblesBackgroundPoll()
  startBlueBubblesBackgroundPoll()
}

/** Retry start after prefs hydrate. */
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
