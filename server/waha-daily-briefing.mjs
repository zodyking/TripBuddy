import {
  readThreadCache,
  syncThreadCache,
  fetchWahaContacts,
  fetchWahaLids,
  buildLidPhoneMap,
} from './wahaChatCache.mjs'
import { translateSenderNamesToEnglish } from './google-translate.mjs'
import { needsEnglishSenderNameTranslation } from '../src/utils/senderNameLocale.js'
import {
  getSenderNameTranslationsForAccount,
  mergeSenderNameTranslationsForAccount,
} from './user-profile-pg.mjs'
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

function messageKeyObject(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  if (msg?.key && typeof msg.key === 'object') return msg.key
  if (data?.key && typeof data.key === 'object') return data.key
  return {}
}

function isFromMe(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const key = messageKeyObject(msg)
  return Boolean(msg?.fromMe ?? data?.fromMe ?? key?.fromMe)
}

/**
 * @param {unknown} msg
 */
function messageTimestampMs(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const candidates = [
    msg?.timestamp,
    msg?.ts,
    msg?.t,
    data?.timestamp,
    data?.ts,
    data?.t,
  ]
  let ts = candidates.map((v) => Number(v)).find((v) => Number.isFinite(v) && v > 0)
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
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d)
    const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]))
    if (byType.year && byType.month && byType.day) {
      return `${byType.year}-${byType.month}-${byType.day}`
    }
  } catch {
    /* fall through */
  }
  return d.toISOString().slice(0, 10)
}

/**
 * @param {unknown} msg
 * @param {Map<string, string>} contactMap
 * @param {string} activeChatId
 */
function resolveJidName(jid, contactMap, lidMap) {
  if (!jid) return ''
  if (contactMap.has(jid)) return contactMap.get(jid) || ''
  if (jid.endsWith('@lid') && lidMap.has(jid)) {
    const pn = lidMap.get(jid)
    if (pn && contactMap.has(pn)) return contactMap.get(pn) || ''
    if (pn?.endsWith('@c.us')) {
      const phone = pn.split('@')[0]
      if (phone && /^\d{6,}$/.test(phone)) return phone
    }
  }
  if (jid.endsWith('@c.us')) {
    const phone = jid.split('@')[0]
    if (phone && /^\d{6,}$/.test(phone)) return phone
  }
  return ''
}

function resolveSenderName(msg, contactMap, activeChatId, lidMap) {
  if (isFromMe(msg)) return 'You'
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const key = messageKeyObject(msg)
  const candidates = [
    msg?.notifyName,
    data?.notifyName,
    data?.pushName,
    msg?.pushName,
    msg?.senderName,
    data?.verifiedName,
  ]
  for (const c of candidates) {
    const name = String(c ?? '').trim()
    if (name && !name.includes('@')) return name
  }
  const pnJid = [msg?.participantPn, data?.participantPn, key?.participantPn]
    .map((v) => String(v ?? '').trim())
    .find((j) => j.endsWith('@c.us'))
  if (pnJid) {
    const n = resolveJidName(pnJid, contactMap, lidMap)
    if (n) return n
  }
  const participant = String(
    msg?.author || msg?.participant || key?.participant || data?.participant || '',
  ).trim()
  const fromParticipant = resolveJidName(participant, contactMap, lidMap)
  if (fromParticipant) return fromParticipant
  const from = String(msg?.from || data?.from || '').trim()
  if (from && from !== activeChatId) {
    const fromName = resolveJidName(from, contactMap, lidMap)
    if (fromName) return fromName
  }
  return ''
}

/**
 * @param {unknown} msg
 */
export function cleanChatText(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function messageBody(msg) {
  const text = cleanChatText(msg?.body ?? msg?.text ?? msg?.caption ?? '')
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
    const num = String(c?.number ?? '').replace(/\D/g, '')
    if (num && name) map.set(`${num}@c.us`, name)
  }
  return map
}

function rawMessageDedupeKey(msg) {
  const id = getMessageId(msg)
  if (id) return `id:${id}`
  return [
    'fallback',
    messageTimestampMs(msg),
    isFromMe(msg) ? 'me' : 'them',
    messageBody(msg).slice(0, 120),
  ].join(':')
}

function mergeRawMessages(...lists) {
  const byKey = new Map()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const msg of list) {
      if (!msg || typeof msg !== 'object') continue
      byKey.set(rawMessageDedupeKey(msg), msg)
    }
  }
  return [...byKey.values()]
}

/**
 * @param {string} chatId
 * @param {string} timeZone
 * @param {{ limit?: number, now?: Date | number | string }} [opts]
 */
export async function collectTodayMessages(chatId, timeZone, opts = {}) {
  const id = String(chatId || '').trim()
  if (!id) return { messages: [], contacts: [] }

  const cachedBeforeSync = await readThreadCache(id)
  let rawMessages = Array.isArray(cachedBeforeSync?.messages) ? cachedBeforeSync.messages : []
  let contacts = []
  if (Array.isArray(cachedBeforeSync?.contacts)) contacts = cachedBeforeSync.contacts

  const sync = await syncThreadCache(id, { limit: opts.limit ?? 100, downloadMedia: false })
  if (sync.ok && Array.isArray(sync.messages)) {
    rawMessages = mergeRawMessages(rawMessages, sync.messages)
  } else if (!rawMessages.length) {
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

  let lidEntries = []
  try {
    const lr = await fetchWahaLids({ limit: 500 })
    if (lr.ok && Array.isArray(lr.body)) lidEntries = lr.body
  } catch {
    /* optional */
  }
  const cache = await readThreadCache(id)
  if (!lidEntries.length && Array.isArray(cache?.lids)) lidEntries = cache.lids

  const contactMap = buildContactMap(contacts)
  const lidMap = buildLidPhoneMap(lidEntries)
  const nowDate = opts.now ? new Date(opts.now) : new Date()
  const today = calendarDayInTz(Number.isFinite(nowDate.getTime()) ? nowDate : new Date(), timeZone)

  const todayMsgs = rawMessages
    .map((m) => ({
      id: getMessageId(m),
      ts: messageTimestampMs(m),
      sender: resolveSenderName(m, contactMap, id, lidMap),
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
export async function applyEnglishSenderLabels(messages, accountKey) {
  if (!Array.isArray(messages) || !messages.length) return
  const ak = String(accountKey || '').trim()
  const stored = ak ? await getSenderNameTranslationsForAccount(ak) : {}
  const items = []
  const seen = new Set()
  for (const m of messages) {
    const raw = String(m.sender || '').trim()
    if (!raw || !needsEnglishSenderNameTranslation(raw)) continue
    if (stored[raw]) {
      m.sender = stored[raw]
      continue
    }
    if (seen.has(raw)) continue
    seen.add(raw)
    items.push({ id: raw, text: raw })
  }
  if (!items.length) return
  const translated = await translateSenderNamesToEnglish(items)
  const additions = {}
  for (const item of items) {
    const en = translated[item.id] || item.text
    additions[item.text] = en
  }
  if (ak && Object.keys(additions).length) {
    await mergeSenderNameTranslationsForAccount(ak, additions)
  }
  const allEn = { ...stored, ...additions }
  for (const m of messages) {
    const raw = String(m.sender || '').trim()
    if (allEn[raw]) m.sender = allEn[raw]
  }
}

export function formatTranscript(messages, timeZone = 'UTC') {
  return messages
    .map((m) => {
      const time = new Date(m.ts).toLocaleTimeString('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      const who = m.sender || 'Unknown'
      return `[${time}] ${cleanChatText(who)}: ${cleanChatText(m.text)}`
    })
    .join('\n')
}

/**
 * @param {{
 *   chatId: string,
 *   chatLabel?: string,
 *   timeZone: string,
 *   openRouterApiKey: string,
 *   openRouterModel?: string,
 *   accountKey?: string,
 * }} opts
 */
export async function generateDailyBriefing(opts) {
  const chatId = String(opts.chatId || '').trim()
  const timeZone = String(opts.timeZone || 'UTC').trim() || 'UTC'
  const chatLabel = String(opts.chatLabel || chatId).trim()

  const now = new Date()
  const today = calendarDayInTz(now, timeZone)
  const { messages } = await collectTodayMessages(chatId, timeZone, { now })
  if (!messages.length) {
    return { ok: true, empty: true, messageCount: 0, briefing: '' }
  }

  await applyEnglishSenderLabels(messages, opts.accountKey)
  const transcript = formatTranscript(messages, timeZone)
  const prompt = buildBriefingPrompt(transcript, chatLabel, {
    dateLabel: today,
    timeZone,
  })
  const ai = await openRouterComplete(opts.openRouterApiKey, prompt, {
    model: opts.openRouterModel,
  })
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
