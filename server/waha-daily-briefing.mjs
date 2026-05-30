import { readThreadCache, syncThreadCache, fetchWahaContacts } from './wahaChatCache.mjs'
import {
  openRouterComplete,
  buildBriefingPrompt,
  trimBriefingForSpeech,
} from './openrouter-briefing.mjs'

/**
 * @param {unknown} msg
 */
function getMessageId(msg) {
  if (!msg || typeof msg !== 'object') return ''
  const id = msg.id
  if (typeof id === 'string') return id
  if (id && typeof id === 'object') {
    return String(id._serialized || id.id || '')
  }
  return ''
}

/**
 * @param {unknown} msg
 */
function messageTimestampMs(msg) {
  let ts = Number(msg?.timestamp)
  if (!Number.isFinite(ts)) return 0
  if (ts < 1e12) ts *= 1000
  return ts
}

/**
 * @param {Date} d
 * @param {string} timeZone
 */
function calendarDayInTz(d, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/**
 * @param {unknown} msg
 * @param {Map<string, string>} contactMap
 * @param {string} activeChatId
 */
function resolveSenderName(msg, contactMap, activeChatId) {
  if (msg?.fromMe) return ''
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const candidates = [data?.notifyName, data?.pushName, msg?.pushName, msg?.senderName, data?.verifiedName]
  for (const c of candidates) {
    const name = String(c ?? '').trim()
    if (name && !name.includes('@')) return name
  }
  const participant = String(msg?.author || msg?.participant || '').trim()
  if (participant && contactMap.has(participant)) {
    return contactMap.get(participant) || ''
  }
  const from = String(msg?.from || '').trim()
  if (from && from !== activeChatId && contactMap.has(from)) {
    return contactMap.get(from) || ''
  }
  return ''
}

/**
 * @param {unknown} msg
 */
function messageBody(msg) {
  const text = String(msg?.body ?? msg?.text ?? msg?.caption ?? '').trim()
  if (text) return text
  if (msg?.hasMedia) return '[attachment]'
  return ''
}

/**
 * @param {unknown[]} contacts
 */
function buildContactMap(contacts) {
  const map = new Map()
  if (!Array.isArray(contacts)) return map
  for (const c of contacts) {
    const id = String(c?.id ?? '').trim()
    if (!id) continue
    const name = String(c?.name || c?.pushname || c?.pushName || c?.shortName || '').trim()
    if (name) map.set(id, name)
  }
  return map
}

/**
 * @param {string} chatId
 * @param {string} timeZone
 * @param {{ limit?: number }} [opts]
 */
export async function collectTodayMessages(chatId, timeZone, opts = {}) {
  const id = String(chatId || '').trim()
  if (!id) return { messages: [], contacts: [] }

  let rawMessages = []
  let contacts = []

  const sync = await syncThreadCache(id, { limit: opts.limit ?? 80, downloadMedia: false })
  if (sync.ok && Array.isArray(sync.messages)) {
    rawMessages = sync.messages
  } else {
    const cache = await readThreadCache(id)
    rawMessages = Array.isArray(cache?.messages) ? cache.messages : []
    contacts = Array.isArray(cache?.contacts) ? cache.contacts : []
  }

  try {
    const cr = await fetchWahaContacts({ limit: 500 })
    if (cr.ok && Array.isArray(cr.body)) contacts = cr.body
  } catch {
    /* optional */
  }

  const contactMap = buildContactMap(contacts)
  const today = calendarDayInTz(new Date(), timeZone)

  const todayMsgs = rawMessages
    .filter((m) => !m?.fromMe)
    .map((m) => ({
      id: getMessageId(m),
      ts: messageTimestampMs(m),
      sender: resolveSenderName(m, contactMap, id),
      text: messageBody(m),
    }))
    .filter((m) => m.text && m.ts > 0)
    .filter((m) => calendarDayInTz(new Date(m.ts), timeZone) === today)
    .sort((a, b) => a.ts - b.ts)

  return { messages: todayMsgs, contacts }
}

/**
 * @param {Array<{ sender: string, text: string, ts: number }>} messages
 */
export function formatTranscript(messages) {
  return messages
    .map((m) => {
      const time = new Date(m.ts).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      const who = m.sender || 'Unknown'
      return `[${time}] ${who}: ${m.text}`
    })
    .join('\n')
}

/**
 * @param {{
 *   chatId: string,
 *   chatLabel?: string,
 *   timeZone: string,
 *   openRouterApiKey: string,
 * }} opts
 */
export async function generateDailyBriefing(opts) {
  const chatId = String(opts.chatId || '').trim()
  const timeZone = String(opts.timeZone || 'UTC').trim() || 'UTC'
  const chatLabel = String(opts.chatLabel || chatId).trim()

  const { messages } = await collectTodayMessages(chatId, timeZone)
  if (!messages.length) {
    return { ok: true, empty: true, messageCount: 0, briefing: '' }
  }

  const transcript = formatTranscript(messages)
  const prompt = buildBriefingPrompt(transcript, chatLabel)
  const ai = await openRouterComplete(opts.openRouterApiKey, prompt)
  if (!ai.ok) {
    return { ok: false, error: ai.error || 'Briefing generation failed.', messageCount: messages.length }
  }

  const briefing = trimBriefingForSpeech(ai.text, 500)
  return {
    ok: true,
    empty: false,
    messageCount: messages.length,
    briefing,
  }
}
