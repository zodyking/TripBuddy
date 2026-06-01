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

const DEFAULT_POLL_INTERVAL = 2_000
const MIN_POLL_INTERVAL = 2_000
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
  // Browser always uses TripBuddy proxy — BlueBubbles does not allow cross-origin browser calls.
  return defaultProxyUrl()
}

/** URL stored in settings (forwarded to server via proxy headers). */
export function getBlueBubblesRemoteUrl() {
  if (typeof window === 'undefined') return ''
  const stored = getBlueBubblesUrlForSettings()
  if (stored) return stored.replace(/\/+$/, '')
  return (import.meta.env.VITE_BLUEBUBBLES_URL || '').trim().replace(/\/+$/, '')
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
  return typeof window !== 'undefined'
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
  return Number.isFinite(v) && v >= MIN_POLL_INTERVAL ? v : DEFAULT_POLL_INTERVAL
}

export function setBlueBubblesPollInterval(ms) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(
    BB_POLL_INTERVAL_KEY,
    String(Math.max(MIN_POLL_INTERVAL, Number(ms) || DEFAULT_POLL_INTERVAL)),
  )
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

export function isBlueBubblesConnected() {
  return !!(getBlueBubblesRemoteUrl() && getBlueBubblesPassword())
}

/** True when signed-in account has BlueBubbles creds on the server (password not in localStorage). */
let blueBubblesServerBacked = false

export function setBlueBubblesServerBacked(enabled) {
  blueBubblesServerBacked = Boolean(enabled)
}

export function isBlueBubblesServerBacked() {
  return blueBubblesServerBacked
}

/** True when BlueBubbles can be used (local creds or server-stored creds for this account). */
export function isBlueBubblesConfigured() {
  return isBlueBubblesConnected() || blueBubblesServerBacked
}

function bbHeaders() {
  const headers = { Accept: 'application/json' }
  const url = getBlueBubblesRemoteUrl()
  const password = getBlueBubblesPassword()
  if (url) headers['X-BlueBubbles-Server-Url'] = url
  if (password) headers['X-BlueBubbles-Password'] = password
  return headers
}

function authQuery() {
  return ''
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
  const init = { method, headers: bbHeaders(), credentials: 'include', cache: 'no-store' }
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

/** Server-side ping with optional unsaved credentials (Settings test). */
export async function pingBlueBubblesViaServer(opts = {}) {
  const r = await fetch('/api/imessage/ping', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      serverUrl: String(opts.serverUrl ?? getBlueBubblesRemoteUrl() ?? '').trim(),
      password: String(opts.password ?? getBlueBubblesPassword() ?? '').trim(),
    }),
  })
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      error: data?.error || data?.message || r.statusText || 'Ping failed',
    }
  }
  return { ok: true, status: r.status, body: data?.data ?? data }
}

/** @param {{ limit?: number }} [opts] */
export async function listBlueBubblesChats(opts = {}) {
  const limit = Math.min(DEFAULT_CHATS_LIMIT, Math.max(1, Number(opts.limit) || 50))
  return blueBubblesRequest('/api/v1/chat/query', {
    method: 'POST',
    body: { limit, offset: 0, with: ['lastMessage', 'participants'] },
  })
}

/** Load Mac Contacts address book via BlueBubbles (may be empty without iCloud sync). */
export async function fetchBlueBubblesContacts() {
  return blueBubblesRequest('/api/v1/contact', { method: 'POST', body: {} })
}

/** Recent messages across all chats (for inbox polling + automation). */
export async function fetchBlueBubblesRecentMessages(opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30))
  const direct = await blueBubblesRequest('/api/v1/message', {
    query: { limit, offset: 0, sort: 'DESC' },
  })
  if (direct.ok && Array.isArray(direct.body)) return direct
  if (direct.status !== 404 && direct.status !== 405) return direct

  const chatsR = await listBlueBubblesChats({ limit: Math.min(DEFAULT_CHATS_LIMIT, limit * 2) })
  if (!chatsR.ok || !Array.isArray(chatsR.body)) {
    return {
      ok: false,
      status: chatsR.status || direct.status,
      body: null,
      error: chatsR.error || direct.error || 'Failed to fetch recent iMessages',
    }
  }

  /** @type {unknown[]} */
  const messages = []
  for (const chat of chatsR.body) {
    if (!chat || typeof chat !== 'object') continue
    const c = /** @type {Record<string, unknown>} */ (chat)
    const lm = c.lastMessage
    if (!lm || typeof lm !== 'object') continue
    const m = /** @type {Record<string, unknown>} */ ({ ...lm })
    if (!Array.isArray(m.chats) || !m.chats.length) {
      m.chats = [{ guid: c.guid, displayName: c.displayName, chatIdentifier: c.chatIdentifier }]
    }
    messages.push(m)
  }

  messages.sort((a, b) => {
    const ta = Number(/** @type {Record<string, unknown>} */ (a).dateCreated ?? 0)
    const tb = Number(/** @type {Record<string, unknown>} */ (b).dateCreated ?? 0)
    return tb - ta
  })

  return { ok: true, status: 200, body: messages.slice(0, limit), raw: chatsR.raw }
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

/** @param {string} raw */
export function looksLikeAddress(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return false
  if (s.includes('@')) return true
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 7 && digits.length / s.replace(/\s/g, '').length > 0.6) return true
  return false
}

/** @param {string} addr */
export function addressLookupKeys(addr) {
  const s = String(addr ?? '').trim()
  if (!s) return []
  /** @type {string[]} */
  const keys = [s, s.toLowerCase()]
  const digits = s.replace(/\D/g, '')
  if (!digits) return [...new Set(keys)]
  keys.push(digits)
  if (digits.length === 11 && digits.startsWith('1')) {
    keys.push(`+${digits}`, digits.slice(1), `+1${digits.slice(1)}`)
  } else if (digits.length === 10) {
    keys.push(`+1${digits}`, `1${digits}`, digits)
  } else if (s.startsWith('+')) {
    keys.push(digits)
  }
  return [...new Set(keys.filter(Boolean))]
}

/**
 * @param {Map<string, string>} contactMap
 * @param {string} address
 */
export function resolveContactName(contactMap, address) {
  if (!contactMap?.size || !address) return ''
  for (const key of addressLookupKeys(address)) {
    const hit = contactMap.get(key)
    if (hit && !looksLikeAddress(hit)) return hit
  }
  return ''
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function bbContactDisplayName(raw) {
  if (!raw || typeof raw !== 'object') return ''
  const c = /** @type {Record<string, unknown>} */ (raw)
  const display = String(c.displayName ?? '').trim()
  if (display && !looksLikeAddress(display)) return display
  const first = String(c.firstName ?? '').trim()
  const last = String(c.lastName ?? '').trim()
  const combined = [first, last].filter(Boolean).join(' ').trim()
  if (combined) return combined
  const nick = String(c.nickname ?? '').trim()
  if (nick && !looksLikeAddress(nick)) return nick
  return display || combined || nick
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function extractContactAddresses(raw) {
  if (!raw || typeof raw !== 'object') return []
  const c = /** @type {Record<string, unknown>} */ (raw)
  /** @type {string[]} */
  const out = []
  const lists = [c.phoneNumbers, c.emails, c.addresses, c.ims]
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (typeof entry === 'string') {
        out.push(entry.trim())
        continue
      }
      if (entry && typeof entry === 'object') {
        const addr = String(/** @type {Record<string, unknown>} */ (entry).address ?? '').trim()
        if (addr) out.push(addr)
      }
    }
  }
  return out.filter(Boolean)
}

/**
 * @param {unknown} contacts
 * @returns {Map<string, string>}
 */
export function buildBlueBubblesContactMap(contacts) {
  /** @type {Map<string, string>} */
  const map = new Map()
  const list = Array.isArray(contacts) ? contacts : []
  for (const raw of list) {
    const name = bbContactDisplayName(raw)
    if (!name) continue
    for (const addr of extractContactAddresses(raw)) {
      for (const key of addressLookupKeys(addr)) {
        map.set(key, name)
      }
    }
  }
  return map
}

/**
 * @param {unknown} participant
 * @param {Map<string, string>} [contactMap]
 */
function participantLabel(participant, contactMap) {
  if (!participant || typeof participant !== 'object') return ''
  const p = /** @type {Record<string, unknown>} */ (participant)
  const display = String(p.displayName ?? p.name ?? '').trim()
  const address = String(p.address ?? '').trim()
  if (display && !looksLikeAddress(display)) return display
  const resolved = resolveContactName(contactMap, address)
  if (resolved) return resolved
  return address || display
}

/**
 * @param {string} name
 * @param {{ chatIdentifier?: string, participants?: unknown[], isGroup?: boolean }} ctx
 * @param {Map<string, string>} [contactMap]
 */
function resolveChatDisplayName(name, ctx, contactMap) {
  let resolved = String(name ?? '').trim()
  if (resolved && !looksLikeAddress(resolved)) return resolved

  if (!ctx.isGroup && ctx.participants?.length) {
    const labels = ctx.participants
      .map((p) => participantLabel(p, contactMap))
      .filter(Boolean)
    const human = labels.filter((l) => !looksLikeAddress(l))
    if (human.length === 1) return human[0]
    if (human.length > 1) return human.join(', ')
    if (labels.length === 1) return labels[0]
  }

  const fromId = resolveContactName(contactMap, ctx.chatIdentifier || '')
  if (fromId) return fromId

  if (looksLikeAddress(resolved)) {
    const fromResolved = resolveContactName(contactMap, resolved)
    if (fromResolved) return fromResolved
  }

  return resolved
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
  if (!id) return null
  const resolvedTs = ts || Date.now()

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

  let senderName = String(handleObj?.displayName ?? chat0?.displayName ?? '').trim()
  if ((!senderName || looksLikeAddress(senderName)) && handle && opts.contactMap) {
    const resolved = resolveContactName(opts.contactMap, handle)
    if (resolved) senderName = resolved
  }
  if (!senderName) senderName = fromMe ? 'You' : handle || 'Unknown'

  const text = String(m.text ?? m.body ?? m.subject ?? '').trim()
  const attachments = Array.isArray(m.attachments) ? m.attachments : []
  const hasMedia = attachments.length > 0

  return {
    id,
    ts: resolvedTs,
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
 * @param {{ contactMap?: Map<string, string> }} [opts]
 */
export function normalizeBlueBubblesChat(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null
  const c = /** @type {Record<string, unknown>} */ (raw)
  const guid = String(c.guid ?? c.chatGuid ?? '').trim()
  if (!guid) return null
  const displayName = String(c.displayName ?? c.title ?? '').trim()
  const chatIdentifier = String(c.chatIdentifier ?? '').trim()
  const participants = Array.isArray(c.participants) ? c.participants : []
  const isGroup = guid.includes(';+;') || participants.length > 2
  const lastMsg = c.lastMessage && typeof c.lastMessage === 'object' ? c.lastMessage : null
  const contactMap = opts.contactMap
  let name = displayName
  if (!name && participants.length) {
    name = participants
      .map((p) => participantLabel(p, contactMap))
      .filter(Boolean)
      .join(', ')
  }
  if (!name) name = chatIdentifier || guid
  name = resolveChatDisplayName(name, { chatIdentifier, participants, isGroup }, contactMap)
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
