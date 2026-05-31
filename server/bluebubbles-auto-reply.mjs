/**
 * BlueBubbles per-contact OpenRouter auto-replies (server-side, webhook + sync).
 */
import {
  getOpenrouterApiKeyForAccount,
  getOpenrouterModelForAccount,
  getBlueBubblesPrefsForAccount,
} from './user-profile-pg.mjs'
import { openRouterComplete } from './openrouter-briefing.mjs'
import { sendBlueBubblesText } from './bluebubbles-client.mjs'
import { applyBlueBubblesPrefsForAccount, clearAccountBlueBubblesPrefs } from './bluebubblesChatCache.mjs'
import { emitLog } from './log-bus.mjs'

/** @typedef {{
 *   id: string,
 *   label?: string,
 *   handle?: string,
 *   chatGuid?: string,
 *   enabled?: boolean,
 *   ttsEnabled?: boolean | null,
 *   autoReplyEnabled?: boolean,
 *   systemPrompt?: string,
 *   replyModel?: string,
 *   includeTripContext?: boolean,
 *   keywordTriggers?: string[],
 *   ignoreKeywords?: string[],
 *   quietHoursStart?: string,
 *   quietHoursEnd?: string,
 *   cooldownSeconds?: number,
 *   maxRepliesPerHour?: number,
 *   onlyWhenMonitoredChat?: boolean,
 * }} ContactRule */

/** @type {Map<string, { count: number, windowStart: number }>} */
const hourlyReplyCounts = new Map()

/** @type {Map<string, number>} */
const lastReplyAt = new Map()

/** @type {Set<string>} */
const respondedMessageIds = new Set()
const RESPONDED_CAP = 800

function ruleKey(accountKey, messageId) {
  return `${accountKey}:${messageId}`
}

function markResponded(accountKey, messageId) {
  const k = ruleKey(accountKey, messageId)
  respondedMessageIds.add(k)
  if (respondedMessageIds.size > RESPONDED_CAP) {
    const first = respondedMessageIds.values().next().value
    if (first) respondedMessageIds.delete(first)
  }
}

function hasResponded(accountKey, messageId) {
  return respondedMessageIds.has(ruleKey(accountKey, messageId))
}

/**
 * @param {unknown} raw
 * @returns {ContactRule[]}
 */
export function normalizeContactRules(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row, i) => {
      if (!row || typeof row !== 'object') return null
      const r = /** @type {Record<string, unknown>} */ (row)
      const id = String(r.id ?? r.handle ?? r.chatGuid ?? `rule-${i}`).trim()
      if (!id) return null
      return {
        id,
        label: String(r.label ?? '').trim(),
        handle: String(r.handle ?? '').trim(),
        chatGuid: String(r.chatGuid ?? '').trim(),
        enabled: r.enabled !== false,
        ttsEnabled: r.ttsEnabled == null ? null : r.ttsEnabled === true,
        autoReplyEnabled: r.autoReplyEnabled === true,
        systemPrompt: String(r.systemPrompt ?? '').trim(),
        replyModel: String(r.replyModel ?? '').trim(),
        includeTripContext: r.includeTripContext === true,
        keywordTriggers: Array.isArray(r.keywordTriggers)
          ? r.keywordTriggers.map((k) => String(k).trim()).filter(Boolean)
          : [],
        ignoreKeywords: Array.isArray(r.ignoreKeywords)
          ? r.ignoreKeywords.map((k) => String(k).trim()).filter(Boolean)
          : [],
        quietHoursStart: String(r.quietHoursStart ?? '').trim(),
        quietHoursEnd: String(r.quietHoursEnd ?? '').trim(),
        cooldownSeconds: Math.max(0, Number(r.cooldownSeconds) || 15),
        maxRepliesPerHour: Math.max(0, Number(r.maxRepliesPerHour) || 20),
        onlyWhenMonitoredChat: r.onlyWhenMonitoredChat !== false,
      }
    })
    .filter(Boolean)
}

/**
 * @param {ContactRule[]} rules
 * @param {{ handle?: string, chatGuid?: string }} ctx
 */
export function matchContactRule(rules, ctx) {
  const handle = String(ctx.handle ?? '').trim().toLowerCase()
  const chatGuid = String(ctx.chatGuid ?? '').trim()
  const enabled = rules.filter((r) => r.enabled !== false)

  for (const r of enabled) {
    if (r.chatGuid && r.chatGuid === chatGuid) return r
  }
  for (const r of enabled) {
    const h = String(r.handle ?? '').trim().toLowerCase()
    if (h && handle && (h === handle || handle.includes(h) || h.includes(handle))) return r
  }
  return null
}

/**
 * @param {string} start - "HH:MM"
 * @param {string} end - "HH:MM"
 * @param {Date} [now]
 */
function isInQuietHours(start, end, now = new Date()) {
  if (!start || !end) return false
  const parse = (s) => {
    const m = String(s).match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    return Number(m[1]) * 60 + Number(m[2])
  }
  const a = parse(start)
  const b = parse(end)
  if (a == null || b == null) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  if (a <= b) return cur >= a && cur < b
  return cur >= a || cur < b
}

/**
 * @param {string} text
 * @param {ContactRule} rule
 */
function passesKeywordFilters(text, rule) {
  const lower = String(text ?? '').toLowerCase()
  if (rule.ignoreKeywords?.length) {
    for (const kw of rule.ignoreKeywords) {
      if (kw && lower.includes(kw.toLowerCase())) return false
    }
  }
  if (rule.keywordTriggers?.length) {
    return rule.keywordTriggers.some((kw) => kw && lower.includes(kw.toLowerCase()))
  }
  return true
}

function canReplyNow(accountKey, rule, handleKey) {
  const cooldownMs = (rule.cooldownSeconds ?? 15) * 1000
  const lastKey = `${accountKey}:${handleKey}`
  const last = lastReplyAt.get(lastKey) || 0
  if (Date.now() - last < cooldownMs) return false

  const maxHour = rule.maxRepliesPerHour ?? 20
  if (maxHour <= 0) return true
  const hourKey = `${accountKey}:${handleKey}:${Math.floor(Date.now() / 3600000)}`
  const bucket = hourlyReplyCounts.get(hourKey) || { count: 0, windowStart: Date.now() }
  if (bucket.count >= maxHour) return false
  return true
}

function recordReply(accountKey, handleKey) {
  const lastKey = `${accountKey}:${handleKey}`
  lastReplyAt.set(lastKey, Date.now())
  const hourKey = `${accountKey}:${handleKey}:${Math.floor(Date.now() / 3600000)}`
  const bucket = hourlyReplyCounts.get(hourKey) || { count: 0, windowStart: Date.now() }
  bucket.count += 1
  hourlyReplyCounts.set(hourKey, bucket)
}

const DEFAULT_SYSTEM_PROMPT = `You are replying on iMessage as a helpful assistant. Keep replies concise (1-3 sentences), natural, and suitable for texting. Do not use markdown. Match the sender's language when obvious. Never reveal you are an AI unless asked.`

/**
 * @param {string} accountKey
 * @param {{ text: string, handle: string, chatGuid: string, senderLabel?: string, messageId: string }} msg
 * @param {{ tripContext?: string }} [opts]
 */
export async function handleBlueBubblesAutoReply(accountKey, msg, opts = {}) {
  const ak = String(accountKey || '').trim()
  if (!ak || !msg?.messageId) return { replied: false }

  if (hasResponded(ak, msg.messageId)) return { replied: false }

  const prefs = await getBlueBubblesPrefsForAccount(ak)
  if (!prefs.autoReplyEnabled) return { replied: false }

  const rules = normalizeContactRules(prefs.contactRules)
  const rule = matchContactRule(rules, { handle: msg.handle, chatGuid: msg.chatGuid })
  if (!rule || !rule.autoReplyEnabled) return { replied: false }

  if (rule.onlyWhenMonitoredChat && prefs.chatGuid && msg.chatGuid !== prefs.chatGuid) {
    return { replied: false }
  }

  const text = String(msg.text ?? '').trim()
  if (!text) return { replied: false }
  if (!passesKeywordFilters(text, rule)) return { replied: false }
  if (isInQuietHours(rule.quietHoursStart, rule.quietHoursEnd)) return { replied: false }

  const handleKey = String(msg.handle || msg.chatGuid || 'unknown')
  if (!canReplyNow(ak, rule, handleKey)) return { replied: false }

  const apiKey = await getOpenrouterApiKeyForAccount(ak)
  if (!apiKey) {
    emitLog('imessage', `[iMessage] Auto-reply skipped — OpenRouter key not set (${handleKey})`)
    return { replied: false, error: 'no_openrouter_key' }
  }

  const model = rule.replyModel || (await getOpenrouterModelForAccount(ak)) || undefined
  const sender = String(msg.senderLabel || msg.handle || 'Contact').trim()
  const systemPrompt = rule.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT
  const tripBlock = rule.includeTripContext && opts.tripContext
    ? `\n\nCurrent trip context:\n${opts.tripContext}`
    : ''

  const messages = [
    { role: 'system', content: systemPrompt + tripBlock },
    {
      role: 'user',
      content: `Reply to this iMessage from ${sender}:\n\n${text}`,
    },
  ]

  const result = await openRouterComplete(apiKey, messages, {
    model,
    maxTokens: 280,
  })
  if (!result.ok || !result.text?.trim()) {
    emitLog('imessage', `[iMessage] OpenRouter auto-reply failed: ${result.error || 'empty'}`)
    return { replied: false, error: result.error }
  }

  let replyText = result.text.trim()
  if (replyText.length > 1200) replyText = `${replyText.slice(0, 1197)}…`

  try {
    applyBlueBubblesPrefsForAccount(prefs)
    const send = await sendBlueBubblesText(msg.chatGuid, replyText)
    clearAccountBlueBubblesPrefs()
    if (!send.ok) {
      emitLog('imessage', `[iMessage] Send auto-reply failed: ${send.error || send.status}`)
      return { replied: false, error: send.error }
    }
    markResponded(ak, msg.messageId)
    recordReply(ak, handleKey)
    emitLog('imessage', `[iMessage] Auto-reply to ${handleKey}: ${replyText.slice(0, 80)}`)
    return { replied: true, text: replyText }
  } catch (e) {
    clearAccountBlueBubblesPrefs()
    emitLog('imessage', `[iMessage] Auto-reply error: ${e instanceof Error ? e.message : String(e)}`)
    return { replied: false, error: String(e) }
  }
}

/**
 * Parse BlueBubbles webhook payload into normalized message.
 * @param {unknown} payload
 */
export function parseBlueBubblesWebhookMessage(payload) {
  if (!payload || typeof payload !== 'object') return null
  const p = /** @type {Record<string, unknown>} */ (payload)
  if (p.type !== 'new-message') return null
  const data = p.data && typeof p.data === 'object' ? /** @type {Record<string, unknown>} */ (p.data) : null
  if (!data) return null
  if (data.isFromMe === true) return null

  const text = String(data.text ?? '').trim()
  const handleObj = data.handle && typeof data.handle === 'object'
    ? /** @type {Record<string, unknown>} */ (data.handle)
    : null
  const handle = String(handleObj?.address ?? '').trim()
  const chats = Array.isArray(data.chats) ? data.chats : []
  const chat0 = chats[0] && typeof chats[0] === 'object'
    ? /** @type {Record<string, unknown>} */ (chats[0])
    : null
  const chatGuid = String(chat0?.guid ?? '').trim()
  const messageId = String(data.guid ?? '').trim()
  if (!messageId || !chatGuid) return null

  const ts = Number(data.dateCreated ?? Date.now())
  return {
    messageId,
    text,
    handle,
    chatGuid,
    senderLabel: String(chat0?.displayName ?? handle).trim() || handle,
    ts: ts < 1e12 ? ts * 1000 : ts,
    fromMe: false,
    raw: data,
  }
}

/**
 * @param {ContactRule[]} rules
 * @param {{ handle?: string, chatGuid?: string }} ctx
 */
export function shouldTtsForContact(rules, ctx, globalTtsEnabled) {
  const rule = matchContactRule(rules, ctx)
  if (rule?.ttsEnabled === true) return true
  if (rule?.ttsEnabled === false) return false
  return globalTtsEnabled
}
