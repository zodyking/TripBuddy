/**
 * App-wide iMessage / BlueBubbles inbox polling for per-contact TTS and auto-reply.
 * Runs on every page (not only Chats → iMessage).
 */
import {
  isBlueBubblesConfigured,
  getBlueBubblesPollInterval,
  fetchBlueBubblesRecentMessages,
  fetchBlueBubblesContacts,
  normalizeBlueBubblesMessage,
  buildBlueBubblesContactMap,
} from './blueBubblesApi.js'
import { ensureBlueBubblesPrefsHydrated } from './blueBubblesPrefs.js'
import { handleNewIncomingIMessageBatch } from './blueBubblesAutoResponder.js'
import { getCachedBbContactMap, setCachedBbContactMap } from '../stores/blueBubblesChatStore.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null
let pollActive = false
let inboxSeeded = false
/** @type {Set<string>} */
const seenInboxIds = new Set()
/** @type {Map<string, string>} */
let contactMap = new Map()
let contactsLoaded = false

const SEEN_CAP = 1200
const SEEN_TRIM = 400

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

async function pollOnce() {
  if (!isBlueBubblesConfigured()) return
  await ensureContacts()
  try {
    const r = await fetchBlueBubblesRecentMessages({ limit: 40 })
    if (!r.ok || !Array.isArray(r.body)) return

    const normalized = r.body
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
  } catch {
    /* ignore transient poll errors */
  }
}

/**
 * Start global iMessage inbox polling (idempotent).
 */
export function startBlueBubblesBackgroundPoll() {
  if (pollTimer || pollActive) return
  void (async () => {
    await ensureBlueBubblesPrefsHydrated()
    if (!isBlueBubblesConfigured()) return
    pollActive = true
    await pollOnce()
    if (!pollActive) return
    pollTimer = setInterval(pollOnce, getBlueBubblesPollInterval())
  })()
}

/**
 * Stop global polling (e.g. logout). Resets seed state so the next start does not announce history.
 */
export function stopBlueBubblesBackgroundPoll() {
  pollActive = false
  inboxSeeded = false
  seenInboxIds.clear()
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
