const THREAD_PREFIX = 'fedextool-bb-thread:'
const CHATS_KEY = 'fedextool-bb-chats'
const CONTACTS_KEY = 'fedextool-bb-contact-map'

/**
 * @param {string} chatGuid
 */
export function getCachedBbThread(chatGuid) {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  try {
    const raw = window.sessionStorage.getItem(`${THREAD_PREFIX}${chatGuid}`)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.messages)) return null
    return data
  } catch {
    return null
  }
}

/**
 * @param {string} chatGuid
 * @param {unknown[]} messages
 * @param {number} [updatedAt]
 */
export function setCachedBbThread(chatGuid, messages, updatedAt = Date.now()) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.setItem(
      `${THREAD_PREFIX}${chatGuid}`,
      JSON.stringify({ messages, updatedAt }),
    )
  } catch {
    /* quota */
  }
}

/** @returns {unknown[]} */
export function getCachedBbChats() {
  if (typeof window === 'undefined' || !window.sessionStorage) return []
  try {
    const raw = window.sessionStorage.getItem(CHATS_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/** @param {unknown[]} chats */
export function setCachedBbChats(chats) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.setItem(CHATS_KEY, JSON.stringify(chats))
  } catch {
    /* ignore */
  }
}

/** @returns {Record<string, string>} */
export function getCachedBbContactMap() {
  if (typeof window === 'undefined' || !window.sessionStorage) return {}
  try {
    const raw = window.sessionStorage.getItem(CONTACTS_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/** @param {Map<string, string>} map */
export function setCachedBbContactMap(map) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.setItem(CONTACTS_KEY, JSON.stringify(Object.fromEntries(map.entries())))
  } catch {
    /* ignore */
  }
}
