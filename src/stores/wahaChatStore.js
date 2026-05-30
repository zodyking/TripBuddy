/**
 * In-memory + sessionStorage cache for WhatsApp chat UI (instant reopen).
 */

const SESSION_PREFIX = 'waha-thread-v1:'
const CHATS_KEY = 'waha-chats-v1'
const CONTACTS_KEY = 'waha-contacts-v1'

/** @type {Map<string, { messages: unknown[], updatedAt: number }>} */
const threadMemory = new Map()

/** @type {unknown[]} */
let chatsMemory = []
/** @type {Record<string, string>} */
let contactsMemory = {}

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
 * @param {string} chatId
 * @returns {{ messages: unknown[], updatedAt: number } | null}
 */
export function getCachedThread(chatId) {
  const id = String(chatId || '').trim()
  if (!id) return null
  const mem = threadMemory.get(id)
  if (mem?.messages?.length) return mem
  const stored = readJson(`${SESSION_PREFIX}${id}`, null)
  if (stored?.messages?.length) {
    threadMemory.set(id, stored)
    return stored
  }
  return null
}

/**
 * @param {string} chatId
 * @param {unknown[]} messages
 * @param {number} [updatedAt]
 */
export function setCachedThread(chatId, messages, updatedAt = Date.now()) {
  const id = String(chatId || '').trim()
  if (!id) return
  const payload = {
    messages: Array.isArray(messages) ? messages : [],
    updatedAt: Number(updatedAt) || Date.now(),
  }
  threadMemory.set(id, payload)
  writeJson(`${SESSION_PREFIX}${id}`, payload)
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
