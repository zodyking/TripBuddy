/**
 * WAHA (WhatsApp HTTP API) client.
 * Connects to a WAHA instance for sending/receiving WhatsApp chat messages.
 * Deploy WAHA as a separate service (Dokploy service or docker-compose).
 *
 * Recommended (API key on server only): set TripBuddy env `WAHA_BASE_URL` + `WAHA_API_KEY`,
 * leave URL empty in Settings — requests go through `/api/waha` proxy.
 * @see https://github.com/devlikeapro/waha
 */

const WAHA_URL_KEY = 'wahaBaseUrl'
const WAHA_API_KEY_KEY = 'wahaApiKey'
const WAHA_CHAT_ID_KEY = 'wahaChatId'
/** @deprecated legacy key — migrated on read */
const WAHA_CHAT_ID_LEGACY_KEY = 'wahaGroupId'
const WAHA_TTS_ENABLED_KEY = 'wahaTtsEnabled'
const WAHA_POLL_INTERVAL_KEY = 'wahaPollIntervalMs'

const DEFAULT_SESSION = 'default'
const DEFAULT_POLL_INTERVAL = 10_000
const DEFAULT_CHATS_LIMIT = 100

function defaultWahaProxyUrl() {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api/waha`
}

/**
 * User override stored in localStorage (empty = use env or server proxy).
 */
export function getWahaUrlForSettings() {
  if (typeof window === 'undefined') return ''
  return (window.localStorage.getItem(WAHA_URL_KEY) ?? '').trim()
}

/**
 * WAHA base URL for API calls.
 * Priority: localStorage override > VITE env > same-origin `/api/waha` proxy.
 */
export function getWahaBaseUrl() {
  if (typeof window === 'undefined') return ''
  const stored = getWahaUrlForSettings()
  if (stored) return stored
  const env = (import.meta.env.VITE_WAHA_URL || '').trim()
  if (env) return env
  return defaultWahaProxyUrl()
}

export function setWahaBaseUrl(url) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = String(url ?? '').trim()
  if (!trimmed) window.localStorage.removeItem(WAHA_URL_KEY)
  else window.localStorage.setItem(WAHA_URL_KEY, trimmed)
}

export function getWahaApiKeyForSettings() {
  if (typeof window === 'undefined') return ''
  return (window.localStorage.getItem(WAHA_API_KEY_KEY) ?? '').trim()
}

export function getWahaApiKey() {
  if (typeof window === 'undefined') return ''
  const stored = getWahaApiKeyForSettings()
  if (stored) return stored
  return (import.meta.env.VITE_WAHA_API_KEY || '').trim()
}

export function setWahaApiKey(key) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = String(key ?? '').trim()
  if (!trimmed) window.localStorage.removeItem(WAHA_API_KEY_KEY)
  else window.localStorage.setItem(WAHA_API_KEY_KEY, trimmed)
}

/** True when the browser talks to TripBuddy's server proxy (key is injected server-side). */
export function isWahaProxyMode() {
  const base = getWahaBaseUrl().replace(/\/+$/, '')
  return base === defaultWahaProxyUrl().replace(/\/+$/, '')
}

export function getWahaSessionName() {
  return DEFAULT_SESSION
}

export function getWahaChatId() {
  if (typeof window === 'undefined' || !window.localStorage) return ''
  const current = (window.localStorage.getItem(WAHA_CHAT_ID_KEY) ?? '').trim()
  if (current) return current
  const legacy = (window.localStorage.getItem(WAHA_CHAT_ID_LEGACY_KEY) ?? '').trim()
  if (legacy) {
    window.localStorage.setItem(WAHA_CHAT_ID_KEY, legacy)
    window.localStorage.removeItem(WAHA_CHAT_ID_LEGACY_KEY)
    return legacy
  }
  return ''
}

export function setWahaChatId(id) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const trimmed = String(id ?? '').trim()
  if (!trimmed) {
    window.localStorage.removeItem(WAHA_CHAT_ID_KEY)
    window.localStorage.removeItem(WAHA_CHAT_ID_LEGACY_KEY)
  } else {
    window.localStorage.setItem(WAHA_CHAT_ID_KEY, trimmed)
    window.localStorage.removeItem(WAHA_CHAT_ID_LEGACY_KEY)
  }
}

/** @deprecated use getWahaChatId */
export function getWahaGroupId() {
  return getWahaChatId()
}

/** @deprecated use setWahaChatId */
export function setWahaGroupId(id) {
  setWahaChatId(id)
}

export function isWahaTtsEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  return window.localStorage.getItem(WAHA_TTS_ENABLED_KEY) !== 'false'
}

export function setWahaTtsEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(WAHA_TTS_ENABLED_KEY, enabled ? 'true' : 'false')
}

export function getWahaPollInterval() {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_POLL_INTERVAL
  const v = Number(window.localStorage.getItem(WAHA_POLL_INTERVAL_KEY))
  return Number.isFinite(v) && v >= 3000 ? v : DEFAULT_POLL_INTERVAL
}

export function setWahaPollInterval(ms) {
  if (typeof window === 'undefined' || !window.localStorage) return
  const v = Math.max(3000, Number(ms) || DEFAULT_POLL_INTERVAL)
  window.localStorage.setItem(WAHA_POLL_INTERVAL_KEY, String(v))
}

export function isWahaConfigured() {
  return !!(getWahaBaseUrl() && getWahaChatId())
}

function wahaHeaders() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (isWahaProxyMode()) return h
  const key = getWahaApiKey()
  if (key) h['X-Api-Key'] = key
  return h
}

function wahaUrl(path) {
  const base = getWahaBaseUrl().replace(/\/+$/, '')
  return `${base}${path}`
}

/** Human-readable hint when WAHA returns 401/403. */
export function wahaAuthErrorHint(status) {
  if (status !== 401 && status !== 403) return ''
  if (isWahaProxyMode()) {
    return 'Unauthorized — set WAHA_API_KEY on the TripBuddy server (same plain key as WAHA) and WAHA_BASE_URL to your WAHA service URL.'
  }
  return 'Unauthorized — enter your WAHA API key below (X-Api-Key), or clear the URL to use the server proxy.'
}

export function normalizeWahaChatId(raw) {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'object') {
    return String(raw._serialized || raw.id || raw.user || '').trim()
  }
  return String(raw).trim()
}

export function getWahaChatKind(chatId) {
  const id = normalizeWahaChatId(chatId)
  if (id.endsWith('@g.us')) return 'group'
  if (id.endsWith('@c.us')) return 'direct'
  if (id.endsWith('@broadcast')) return 'broadcast'
  return 'chat'
}

export function wahaChatKindLabel(kind) {
  if (kind === 'group') return 'Group'
  if (kind === 'direct') return 'Direct'
  if (kind === 'broadcast') return 'Broadcast'
  return 'Chat'
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {{ id: string, name: string, kind: string }}
 */
export function normalizeWahaChat(entry) {
  const id = normalizeWahaChatId(
    entry?.id ?? entry?.chatId ?? entry?._chat?.id ?? entry?._chat?.chatId,
  )
  const name = String(
    entry?.name
    || entry?.subject
    || entry?._chat?.name
    || entry?._chat?.subject
    || entry?.lastMessage?._data?.notifyName
    || '',
  ).trim()
  return {
    id,
    name: name || id,
    kind: getWahaChatKind(id),
  }
}

/**
 * Create + start the default WAHA session (idempotent — WAHA ignores if already running).
 */
export async function ensureSession() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl('/api/sessions/'), {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({ name: session, start: true }),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

/**
 * Get session status (list all sessions, find ours).
 */
export async function getSessionStatus() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl('/api/sessions?all=true'), {
    headers: wahaHeaders(),
  })
  if (!r.ok) return { ok: false, status: r.status, body: null }
  const list = await r.json().catch(() => [])
  if (!Array.isArray(list)) return { ok: false, status: r.status, body: null }
  const found = list.find((s) => s.name === session)
  if (!found) return { ok: true, status: 200, body: { name: session, status: 'NOT_FOUND' } }
  return { ok: true, status: 200, body: found }
}

/**
 * Get QR code for linking (scan with phone).
 */
export async function getQr() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl(`/api/${encodeURIComponent(session)}/auth/qr`), {
    headers: wahaHeaders(),
  })
  if (!r.ok) return { ok: false, status: r.status, body: null }
  const body = await r.json().catch(() => null)
  return { ok: true, status: r.status, body }
}

/**
 * List chats (groups and direct) for the session.
 * Uses overview endpoint when available; falls back to full chats list.
 * @param {{ limit?: number, offset?: number }} [opts]
 */
export async function listChats(opts = {}) {
  const limit = opts.limit ?? DEFAULT_CHATS_LIMIT
  const offset = opts.offset ?? 0
  const session = getWahaSessionName()
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })

  let r = await fetch(
    wahaUrl(`/api/${encodeURIComponent(session)}/chats/overview?${qs}`),
    { headers: wahaHeaders() },
  )

  if (r.status === 404 || r.status === 501) {
    qs.set('sortBy', 'messageTimestamp')
    qs.set('sortOrder', 'desc')
    r = await fetch(
      wahaUrl(`/api/${encodeURIComponent(session)}/chats?${qs}`),
      { headers: wahaHeaders() },
    )
  }

  if (!r.ok) return { ok: false, status: r.status, body: null }
  const body = await r.json().catch(() => null)
  const list = Array.isArray(body) ? body : []
  return {
    ok: true,
    status: r.status,
    body: list.map(normalizeWahaChat).filter((c) => c.id),
  }
}

/** @deprecated use listChats */
export async function listGroups() {
  return listChats()
}

/**
 * Send text message to configured chat.
 * @param {string} text
 */
export async function sendChatMessage(text) {
  const session = getWahaSessionName()
  const chatId = getWahaChatId()
  if (!chatId) throw new Error('No WhatsApp chat configured')
  const r = await fetch(wahaUrl('/api/sendText'), {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({ session, chatId, text }),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

/** @deprecated use sendChatMessage */
export const sendGroupMessage = sendChatMessage

export function getWahaMessageId(msg) {
  if (!msg) return ''
  if (typeof msg.id === 'string') return msg.id
  if (msg.id && typeof msg.id === 'object') {
    return String(msg.id._serialized || msg.id.id || '').trim()
  }
  return ''
}

function isWhatsAppJid(value) {
  const s = String(value ?? '').trim()
  return /@(c\.us|g\.us|lid|broadcast)$/i.test(s)
}

function extractParticipantJid(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const raw =
    msg?.author
    || msg?.participant
    || data?.author
    || data?.participant
    || data?.id?.participant
    || ''
  return normalizeWahaChatId(raw)
}

/**
 * Rewrite WAHA file URLs so the browser can load them (proxy or direct base).
 * @param {string} mediaUrl
 */
export function resolveWahaMediaUrl(mediaUrl) {
  const raw = String(mediaUrl ?? '').trim()
  if (!raw) return ''
  const base = getWahaBaseUrl().replace(/\/+$/, '')
  if (raw.startsWith('/')) return `${base}${raw}`
  try {
    const parsed = new URL(raw)
    if (parsed.pathname.startsWith('/api/')) {
      return `${base}${parsed.pathname}${parsed.search}`
    }
    return raw
  } catch {
    return raw
  }
}

/**
 * @param {Record<string, unknown>} msg
 * @returns {{ url: string, mimetype: string, filename: string, kind: string, error: string | null } | null}
 */
export function normalizeWahaMedia(msg) {
  if (!msg?.hasMedia && !msg?.media) return null
  const m = msg?.media && typeof msg.media === 'object' ? msg.media : {}
  const url = resolveWahaMediaUrl(m.url || m.URL || '')
  const mimetype = String(m.mimetype || m.mimeType || '').toLowerCase()
  const filename = String(m.filename || m.fileName || '').trim()
  if (!url && !msg?.hasMedia) return null
  let kind = 'file'
  if (mimetype.startsWith('image/')) kind = 'image'
  else if (mimetype.startsWith('video/')) kind = 'video'
  else if (mimetype.startsWith('audio/') || mimetype === 'audio/ogg') kind = 'audio'
  return {
    url,
    mimetype,
    filename,
    kind,
    error: m.error ? String(m.error) : null,
  }
}

/**
 * @param {Record<string, unknown>} msg
 * @param {Map<string, string>} [contactMap]
 * @param {string} [activeChatId]
 */
export function resolveWahaSenderName(msg, contactMap, activeChatId = '') {
  if (msg?.fromMe) return ''
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const candidates = [
    data?.notifyName,
    data?.pushName,
    msg?.pushName,
    msg?.senderName,
    data?.verifiedName,
  ]
  for (const c of candidates) {
    const name = String(c ?? '').trim()
    if (name && !isWhatsAppJid(name) && name !== activeChatId) return name
  }
  const participant = extractParticipantJid(msg)
  if (participant && contactMap?.get(participant)) {
    return contactMap.get(participant) || ''
  }
  if (participant && participant.endsWith('@c.us')) {
    const phone = participant.split('@')[0]
    if (phone && /^\d{6,}$/.test(phone)) return phone
  }
  const from = normalizeWahaChatId(msg?.from)
  if (from && from !== activeChatId && contactMap?.get(from)) {
    return contactMap.get(from) || ''
  }
  return ''
}

/**
 * @param {Record<string, unknown>} msg
 * @param {{ contactMap?: Map<string, string>, activeChatId?: string }} [opts]
 * @returns {{
 *   id: string,
 *   text: string,
 *   fromMe: boolean,
 *   ts: number,
 *   senderName: string,
 *   hasMedia: boolean,
 *   media: ReturnType<typeof normalizeWahaMedia>,
 *   isGroupChat: boolean,
 * }}
 */
export function normalizeWahaMessage(msg, opts = {}) {
  const { contactMap, activeChatId = '' } = opts
  const id = getWahaMessageId(msg)
  const text = String(msg?.body ?? msg?.text ?? msg?.caption ?? '').trim()
  const fromMe = Boolean(msg?.fromMe)
  let ts = Number(msg?.timestamp)
  if (!Number.isFinite(ts)) ts = Date.now()
  else if (ts < 1e12) ts *= 1000
  const media = normalizeWahaMedia(msg)
  const hasMedia = Boolean(msg?.hasMedia || media?.url)
  const senderName = resolveWahaSenderName(msg, contactMap, activeChatId)
  const isGroupChat = activeChatId.endsWith('@g.us')
  return {
    id,
    text,
    fromMe,
    ts,
    senderName,
    hasMedia,
    media,
    isGroupChat,
  }
}

/**
 * @param {Array<Record<string, unknown>>} contacts
 * @returns {Map<string, string>}
 */
export function buildContactNameMap(contacts) {
  const map = new Map()
  if (!Array.isArray(contacts)) return map
  for (const c of contacts) {
    const id = normalizeWahaChatId(c?.id)
    if (!id) continue
    const name = String(c?.name || c?.pushname || c?.pushName || c?.shortName || '').trim()
    if (name) map.set(id, name)
  }
  return map
}

/** @param {{ limit?: number, offset?: number }} [opts] */
export async function listContacts(opts = {}) {
  const session = getWahaSessionName()
  const qs = new URLSearchParams({
    session,
    limit: String(opts.limit ?? 500),
    offset: String(opts.offset ?? 0),
  })
  const r = await fetch(wahaUrl(`/api/contacts/all?${qs}`), { headers: wahaHeaders() })
  if (!r.ok) return { ok: false, status: r.status, body: [] }
  const body = await r.json().catch(() => [])
  return { ok: true, status: r.status, body: Array.isArray(body) ? body : [] }
}

/**
 * Fetch recent messages for a chat.
 * @param {string} chatId
 * @param {number} [limit]
 */
export async function fetchChatMessagesForChat(chatId, limit = 50, opts = {}) {
  const session = getWahaSessionName()
  const id = normalizeWahaChatId(chatId)
  if (!id) return { ok: false, status: 0, body: null }
  const downloadMedia = opts.downloadMedia === true
  const r = await fetch(
    wahaUrl(`/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(id)}/messages?limit=${limit}&downloadMedia=${downloadMedia}`),
    { headers: wahaHeaders() },
  )
  if (!r.ok) return { ok: false, status: r.status, body: null }
  const body = await r.json().catch(() => null)
  return { ok: true, status: r.status, body: Array.isArray(body) ? body : [] }
}

/**
 * Fetch recent messages from the configured chat.
 * @param {number} [limit]
 */
export async function fetchChatMessages(limit = 20) {
  return fetchChatMessagesForChat(getWahaChatId(), limit)
}

/** @deprecated use fetchChatMessages */
export const fetchGroupMessages = fetchChatMessages
