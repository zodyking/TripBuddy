/**
 * In-memory + sessionStorage cache for WhatsApp chat UI (instant reopen).
 * v2 stores raw WAHA payloads so sender names can be re-resolved when contacts/LIDs load.
 */

const SESSION_PREFIX_V2 = 'waha-thread-v2:'
const SESSION_PREFIX_V1 = 'waha-thread-v1:'
const CHATS_KEY = 'waha-chats-v1'
const CONTACTS_KEY = 'waha-contacts-v1'
const LIDS_KEY = 'waha-lids-v1'
const PARTICIPANTS_PREFIX = 'waha-participants-v1:'

/** @type {Map<string, { rawMessages: unknown[], updatedAt: number }>} */
const threadMemory = new Map()

/** @type {unknown[]} */
let chatsMemory = []
/** @type {Record<string, string>} */
let contactsMemory = {}
/** @type {Record<string, string>} */
let lidsMemory = {}

function readJson(key, fallback) {
  if (typeof sessionStorage === 'undefined') return fallback
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota */
  }
}

/**
 * @param {unknown[]} messages
 * @returns {unknown[]}
 */
function pickRawMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return []
  if (messages.every((m) => m && typeof m === 'object' && ('body' in m || '_data' in m))) {
    return messages
  }
  return []
}

/**
 * @param {string} chatId
 * @returns {{ rawMessages: unknown[], messages?: unknown[], updatedAt: number } | null}
 */
export function getCachedThread(chatId) {
  const id = String(chatId || '').trim()
  if (!id) return null
  const mem = threadMemory.get(id)
  if (mem?.rawMessages?.length) {
    return { rawMessages: mem.rawMessages, updatedAt: mem.updatedAt }
  }
  const storedV2 = readJson(`${SESSION_PREFIX_V2}${id}`, null)
  if (storedV2?.rawMessages?.length) {
    const payload = {
      rawMessages: storedV2.rawMessages,
      updatedAt: Number(storedV2.updatedAt) || Date.now(),
    }
    threadMemory.set(id, payload)
    return payload
  }
  const storedV1 = readJson(`${SESSION_PREFIX_V1}${id}`, null)
  if (storedV1?.messages?.length) {
    const raw = pickRawMessages(storedV1.messages)
    const payload = {
      rawMessages: raw,
      messages: storedV1.messages,
      updatedAt: Number(storedV1.updatedAt) || Date.now(),
    }
    if (raw.length) threadMemory.set(id, { rawMessages: raw, updatedAt: payload.updatedAt })
    return payload
  }
  return null
}

/**
 * @param {string} chatId
 * @param {unknown[]} rawMessages
 * @param {number} [updatedAt]
 */
export function setCachedThread(chatId, rawMessages, updatedAt = Date.now()) {
  const id = String(chatId || '').trim()
  if (!id) return
  const payload = {
    rawMessages: Array.isArray(rawMessages) ? rawMessages : [],
    updatedAt: Number(updatedAt) || Date.now(),
  }
  threadMemory.set(id, payload)
  writeJson(`${SESSION_PREFIX_V2}${id}`, payload)
}

export function getCachedChats() {
  if (chatsMemory.length) return chatsMemory
  const stored = readJson(CHATS_KEY, [])
  chatsMemory = Array.isArray(stored) ? stored : []
  return chatsMemory
}

/** @param {unknown[]} chats */
export function setCachedChats(chats) {
  chatsMemory = Array.isArray(chats) ? chats : []
  writeJson(CHATS_KEY, chatsMemory)
}

export function getCachedContactsMap() {
  if (Object.keys(contactsMemory).length) return contactsMemory
  contactsMemory = readJson(CONTACTS_KEY, {})
  return contactsMemory
}

/** @param {Record<string, string>} map */
export function setCachedContactsMap(map) {
  contactsMemory = map && typeof map === 'object' ? map : {}
  writeJson(CONTACTS_KEY, contactsMemory)
}

export function getCachedLidMap() {
  if (Object.keys(lidsMemory).length) return lidsMemory
  lidsMemory = readJson(LIDS_KEY, {})
  return lidsMemory
}

/** @param {Record<string, string>} map lid -> pn */
export function setCachedLidMap(map) {
  lidsMemory = map && typeof map === 'object' ? map : {}
  writeJson(LIDS_KEY, lidsMemory)
}

/**
 * @param {string} chatId
 * @returns {Record<string, string>}
 */
export function getCachedParticipantNames(chatId) {
  const id = String(chatId || '').trim()
  if (!id) return {}
  return readJson(`${PARTICIPANTS_PREFIX}${id}`, {})
}

/**
 * @param {string} chatId
 * @param {Record<string, string>} map
 */
export function setCachedParticipantNames(chatId, map) {
  const id = String(chatId || '').trim()
  if (!id) return
  writeJson(`${PARTICIPANTS_PREFIX}${id}`, map && typeof map === 'object' ? map : {})
}
