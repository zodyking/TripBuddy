/**
 * BlueBubbles (Open Bubbles / iMessage) client.
 * @see https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks
 */

const BB_URL_KEY = 'blueBubblesServerUrl'
const BB_PASSWORD_KEY = 'blueBubblesPassword'
const BB_CHAT_GUID_KEY = 'blueBubblesChatGuid'
const BB_TTS_ENABLED_KEY = 'blueBubblesTtsEnabled'
const BB_AUTO_REPLY_KEY = 'blueBubblesAutoReplyEnabled'
const BB_POLL_INTERVAL_KEY = 'blueBubblesPollIntervalMs'
const BB_CONTACT_RULES_KEY = 'blueBubblesContactRules'

const DEFAULT_POLL_INTERVAL = 12_000
const DEFAULT_CHATS_LIMIT = 80

function defaultProxyUrl() {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api/bluebubbles`
}

export function getBlueBubblesUrlForSettings() {
  if (typeof window === 'undefined') return ''
  return (window.localStorage.getItem(BB_URL_KEY) ?? '').trim()
}

export function getBlueBubblesBaseUrl() {
  if (typeof window === 'undefined') return ''
  const stored = getBlueBubblesUrlForSettings()
  if (stored) return stored.replace(/\/+$/, '')
  const env = (import.meta.env.VITE_BLUEBUBBLES_URL || '').trim().replace(/\/+$/, '')
  if (env) return env
  return defaultProxyUrl()
}

export function setBlueBubblesBaseUrl(url) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = String(url ?? '').trim()
  if (!trimmed) window.localStorage.removeItem(BB_URL_KEY)
  else window.localStorage.setItem(BB_URL_KEY, trimmed)
}

export function getBlueBubblesPasswordForSettings() {
  if (typeof window === 'undefined') return ''
  return (window.localStorage.getItem(BB_PASSWORD_KEY) ?? '').trim()
}

export function getBlueBubblesPassword() {
  const stored = getBlueBubblesPasswordForSettings()
  if (stored) return stored
  return (import.meta.env.VITE_BLUEBUBBLES_PASSWORD || '').trim()
}

export function setBlueBubblesPassword(password) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = String(password ?? '').trim()
  if (!trimmed) window.localStorage.removeItem(BB_PASSWORD_KEY)
  else window.localStorage.setItem(BB_PASSWORD_KEY, trimmed)
}

export function isBlueBubblesProxyMode() {
  const base = getBlueBubblesBaseUrl().replace(/\/+$/, '')
  return base === defaultProxyUrl().replace(/\/+$/, '')
}

export function getBlueBubblesChatGuid() {
  if (typeof window === 'undefined' || !window.localStorage) return ''
  return (window.localStorage.getItem(BB_CHAT_GUID_KEY) ?? '').trim()
}

export function setBlueBubblesChatGuid(guid) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = String(guid ?? '').trim()
  if (!trimmed) window.localStorage.removeItem(BB_CHAT_GUID_KEY)
  else window.localStorage.setItem(BB_CHAT_GUID_KEY, trimmed)
}

export function isBlueBubblesTtsEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  return window.localStorage.getItem(BB_TTS_ENABLED_KEY) !== 'false'
}

export function setBlueBubblesTtsEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(BB_TTS_ENABLED_KEY, enabled ? 'true' : 'false')
}

export function isBlueBubblesAutoReplyEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  return window.localStorage.getItem(BB_AUTO_REPLY_KEY) === 'true'
}

export function setBlueBubblesAutoReplyEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(BB_AUTO_REPLY_KEY, enabled ? 'true' : 'false')
}

export function getBlueBubblesPollInterval() {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_POLL_INTERVAL
  const v = Number(window.localStorage.getItem(BB_POLL_INTERVAL_KEY))
  return Number.isFinite(v) && v >= 3000 ? v : DEFAULT_POLL_INTERVAL
}

export function setBlueBubblesPollInterval(ms) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(BB_POLL_INTERVAL_KEY, String(Math.max(3000, Number(ms) || DEFAULT_POLL_INTERVAL)))
}

/** @returns {import('../constants/blueBubblesContactRules.js').ContactRule[]} */
export function getBlueBubblesContactRules() {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(BB_CONTACT_RULES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** @param {unknown[]} rules */
export function setBlueBubblesContactRules(rules) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const list = Array.isArray(rules) ? rules : []
  window.localStorage.setItem(BB_CONTACT_RULES_KEY, JSON.stringify(list))
}

export function isBlueBubblesConfigured() {
  return !!(getBlueBubblesBaseUrl() && getBlueBubblesChatGuid())
}

function bbHeaders() {
  const headers = { Accept: 'application/json' }
  if (!isBlueBubblesProxyMode()) {
    const password = getBlueBubblesPassword()
    if (password) headers['X-BlueBubbles-Password'] = password
  }
  return headers
}

function authQuery() {
  if (isBlueBubblesProxyMode()) return ''
  const password = getBlueBubblesPassword()
  return password ? `password=${encodeURIComponent(password)}` : ''
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, string | number> }} [opts]
 */
export async function blueBubblesRequest(path, opts = {}) {
  const base = getBlueBubblesBaseUrl().replace(/\/+$/, '')
  if (!base) return { ok: false, status: 0, body: null }

  const params = new URLSearchParams()
  const q = authQuery()
  if (q) {
    for (const part of q.split('&')) {
      const [k, v] = part.split('=')
      if (k) params.set(k, decodeURIComponent(v || ''))
    }
  }
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') params.set(k, String(v))
    }
  }
  const qs = params.toString()
  const url = `${base}${path}${qs ? `?${qs}` : ''}`
  const method = opts.method || 'GET'
  /** @type {RequestInit} */
  const init = { method, headers: bbHeaders(), credentials: 'include' }
  if (method !== 'GET' && method !== 'HEAD' && opts.body != null) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }
  try {
    const r = await fetch(url, init)
    const text = await r.text()
    let parsed = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    const data = parsed?.data ?? parsed
    const ok = r.ok && (parsed?.status == null || parsed.status === 200)
    return { ok, status: r.status, body: data, raw: parsed }
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pingBlueBubblesClient() {
  return blueBubblesRequest('/api/v1/ping')
}

/** @param {{ limit?: number }} [opts] */
export async function listBlueBubblesChats(opts = {}) {
  const limit = Math.min(DEFAULT_CHATS_LIMIT, Math.max(1, Number(opts.limit) || 50))
  return blueBubblesRequest('/api/v1/chat/query', {
    method: 'POST',
    body: { limit, offset: 0, with: ['lastMessage'] },
  })
}

/**
 * @param {string} chatGuid
 * @param {{ limit?: number }} [opts]
 */
export async function fetchBlueBubblesChatMessages(chatGuid, opts = {}) {
  const guid = encodeURIComponent(String(chatGuid || '').trim())
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50))
  return blueBubblesRequest(`/api/v1/chat/${guid}/message`, {
    query: { limit, offset: 0, sort: 'DESC' },
  })
}

/**
 * @param {string} chatGuid
 * @param {string} text
 */
export async function sendBlueBubblesMessage(chatGuid, text) {
  const guid = String(chatGuid || '').trim()
  const message = String(text || '').trim()
  if (!guid || !message) return { ok: false, status: 400, body: null }
  const tempGuid = `temp-${crypto.randomUUID()}`
  return blueBubblesRequest('/api/v1/message/text', {
    method: 'POST',
    body: { chatGuid: guid, tempGuid, message },
  })
}

export function bbMessageTimestampMs(msg) {
  const ts = Number(msg?.dateCreated ?? msg?.date ?? msg?.ts ?? 0)
  if (!Number.isFinite(ts) || ts <= 0) return 0
  return ts < 1e12 ? ts * 1000 : ts
}

export function bbMessageId(msg) {
  return String(msg?.guid ?? msg?.id ?? '').trim()
}

/**
 * @param {unknown} raw
 * @param {{ chatGuid?: string, contactMap?: Map<string, string> }} [opts]
 */
export function normalizeBlueBubblesMessage(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null
  const m = /** @type {Record<string, unknown>} */ (raw)
  const ts = bbMessageTimestampMs(m)
  const id = bbMessageId(m)
  if (!id || !ts) return null

  const handleObj = m.handle && typeof m.handle === 'object'
    ? /** @type {Record<string, unknown>} */ (m.handle)
    : null
  const handle = String(handleObj?.address ?? '').trim()
  const chats = Array.isArray(m.chats) ? m.chats : []
  const chat0 = chats[0] && typeof chats[0] === 'object'
    ? /** @type {Record<string, unknown>} */ (chats[0])
    : null
  const chatGuid = String(chat0?.guid ?? opts.chatGuid ?? '').trim()
  const fromMe = m.isFromMe === true

  let senderName = String(chat0?.displayName ?? '').trim()
  if (!senderName && handle && opts.contactMap?.has(handle)) {
    senderName = opts.contactMap.get(handle) || handle
  }
  if (!senderName) senderName = fromMe ? 'You' : handle || 'Unknown'

  const text = String(m.text ?? m.body ?? m.subject ?? '').trim()
  const attachments = Array.isArray(m.attachments) ? m.attachments : []
  const hasMedia = attachments.length > 0

  return {
    id,
    ts,
    text,
    fromMe,
    senderName,
    senderHandle: handle,
    chatGuid,
    hasMedia,
    media: hasMedia
      ? { kind: 'attachment', count: attachments.length }
      : null,
    service: String(handleObj?.service ?? 'iMessage'),
    raw: m,
  }
}

/**
 * @param {unknown} raw
 */
export function normalizeBlueBubblesChat(raw) {
  if (!raw || typeof raw !== 'object') return null
  const c = /** @type {Record<string, unknown>} */ (raw)
  const guid = String(c.guid ?? c.chatGuid ?? '').trim()
  if (!guid) return null
  const displayName = String(c.displayName ?? c.title ?? '').trim()
  const chatIdentifier = String(c.chatIdentifier ?? '').trim()
  const participants = Array.isArray(c.participants) ? c.participants : []
  const isGroup = guid.includes(';+;') || participants.length > 2
  const lastMsg = c.lastMessage && typeof c.lastMessage === 'object' ? c.lastMessage : null
  let name = displayName
  if (!name && participants.length) {
    name = participants
      .map((p) => (p && typeof p === 'object' ? String(p.address || p.displayName || '') : ''))
      .filter(Boolean)
      .join(', ')
  }
  if (!name) name = chatIdentifier || guid
  return {
    id: guid,
    guid,
    name,
    kind: isGroup ? 'group' : 'dm',
    chatIdentifier,
    participants,
    lastMessageText: lastMsg && typeof lastMsg === 'object' ? String(lastMsg.text ?? '') : '',
    lastMessageTs: lastMsg ? bbMessageTimestampMs(lastMsg) : 0,
  }
}

export function bbChatKindLabel(kind) {
  if (kind === 'group') return 'Group'
  return 'iMessage'
}
