/**
 * Per-chat daily briefing cache — replay when the latest message is unchanged.
 */

const CACHE_KEY = 'tripbuddy_daily_briefing_cache_v1'

function calendarDayKey(d = new Date()) {
  try {
    return d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

/**
 * @param {Array<{ id?: string, ts?: number }>} messages
 */
export function computeThreadLastMessageKey(messages) {
  if (!Array.isArray(messages) || !messages.length) return ''
  let last = messages[0]
  for (const m of messages) {
    if (Number(m?.ts) >= Number(last?.ts)) last = m
  }
  const id = String(last?.id ?? '').trim()
  const ts = Number(last?.ts) || 0
  if (!id && !ts) return ''
  return `${id}:${ts}`
}

/**
 * @param {string} chatId
 */
function getBriefingStorage() {
  if (typeof globalThis === 'undefined') return null
  return globalThis.localStorage ?? null
}

export function readBriefingCacheEntry(chatId) {
  const id = String(chatId || '').trim()
  const storage = getBriefingStorage()
  if (!id || !storage) return null
  try {
    const raw = storage.getItem(CACHE_KEY)
    const all = raw ? JSON.parse(raw) : {}
    const entry = all[id]
    if (!entry || typeof entry !== 'object') return null
    return entry
  } catch {
    return null
  }
}

/**
 * @param {string} chatId
 * @param {string} lastMessageKey
 * @returns {{ briefing: string, messageCount: number, day: string, lastMessageKey: string } | null}
 */
export function getCachedBriefingIfValid(chatId, lastMessageKey) {
  const entry = readBriefingCacheEntry(chatId)
  if (!entry) return null
  const briefing = String(entry.briefing ?? '').trim()
  if (!briefing) return null
  if (entry.day !== calendarDayKey()) return null
  const key = String(lastMessageKey ?? '').trim()
  if (!key || entry.lastMessageKey !== key) return null
  return {
    briefing,
    messageCount: Number(entry.messageCount) || 0,
    day: String(entry.day),
    lastMessageKey: String(entry.lastMessageKey),
  }
}

/**
 * @param {string} chatId
 * @param {{ briefing: string, messageCount?: number, lastMessageKey: string }} payload
 */
export function writeBriefingCacheEntry(chatId, payload) {
  const id = String(chatId || '').trim()
  const storage = getBriefingStorage()
  if (!id || !storage) return
  const briefing = String(payload.briefing ?? '').trim()
  if (!briefing) return
  try {
    const raw = storage.getItem(CACHE_KEY)
    const all = raw && typeof JSON.parse(raw) === 'object' ? JSON.parse(raw) : {}
    all[id] = {
      day: calendarDayKey(),
      lastMessageKey: String(payload.lastMessageKey ?? '').trim(),
      briefing,
      messageCount: Number(payload.messageCount) || 0,
      updatedAt: Date.now(),
    }
    storage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    /* quota */
  }
}
