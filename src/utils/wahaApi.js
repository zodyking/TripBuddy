import { englishDisplayName } from './senderNameLocale.js'

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
const WAHA_DAILY_BRIEFING_KEY = 'wahaDailyBriefingEnabled'
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

/** Spoken summary of today’s monitored chat once per login (OpenRouter). */
export function isWahaDailyBriefingEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  const raw = window.localStorage.getItem(WAHA_DAILY_BRIEFING_KEY)
  if (raw === null) return isWahaTtsEnabled()
  return raw !== 'false'
}

/** @param {boolean} enabled */
export function setWahaDailyBriefingEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(WAHA_DAILY_BRIEFING_KEY, enabled ? 'true' : 'false')
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

function messageKeyObject(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  if (msg?.key && typeof msg.key === 'object') return msg.key
  if (data?.key && typeof data.key === 'object') return data.key
  return {}
}

/**
 * True when payload is a WAHA API message (not our normalized shape).
 * @param {unknown} msg
 */
export function isRawWahaMessage(msg) {
  if (!msg || typeof msg !== 'object') return false
  const m = /** @type {Record<string, unknown>} */ (msg)
  if ('isGroupChat' in m && 'senderName' in m && 'text' in m) return false
  return (
    'body' in m
    || '_data' in m
    || m.id != null && typeof m.id === 'object'
    || 'participant' in m
    || 'author' in m
  )
}

function extractParticipantJid(msg) {
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const key = messageKeyObject(msg)

  const phoneJid = [
    msg?.participantPn,
    data?.participantPn,
    key?.participantPn,
  ]
    .map((v) => normalizeParticipantJid(normalizeWahaChatId(v)))
    .find((j) => j && j.endsWith('@c.us'))
  if (phoneJid) return phoneJid

  const raw =
    msg?.author
    || msg?.participant
    || key?.participant
    || data?.author
    || data?.participant
    || data?.id?.participant
    || ''
  const jid = normalizeParticipantJid(normalizeWahaChatId(raw))
  if (jid) return jid

  const from = normalizeParticipantJid(normalizeWahaChatId(msg?.from || data?.from))
  if (from && (from.endsWith('@c.us') || from.endsWith('@lid'))) return from
  return ''
}

/** @param {string} jid */
function normalizeParticipantJid(jid) {
  const id = String(jid || '').trim()
  if (id.endsWith('@s.whatsapp.net')) return id.replace(/@s\.whatsapp\.net$/i, '@c.us')
  return id
}

/**
 * @param {string} jid
 * @param {Map<string, string>} [contactMap]
 * @param {Map<string, string>} [lidMap] lid @lid -> pn @c.us
 */
function resolveJidToDisplayName(jid, contactMap, lidMap) {
  if (!jid) return ''
  const direct = contactMap?.get(jid)
  if (direct) return direct
  if (jid.endsWith('@lid') && lidMap?.size) {
    const pn = lidMap.get(jid)
    if (pn) {
      const fromPn = contactMap?.get(pn)
      if (fromPn) return fromPn
      if (pn.endsWith('@c.us')) {
        const phone = pn.split('@')[0]
        if (phone && /^\d{6,}$/.test(phone)) return phone
      }
    }
  }
  if (jid.endsWith('@c.us')) {
    const phone = jid.split('@')[0]
    if (phone && /^\d{6,}$/.test(phone)) return phone
  }
  return ''
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
 * Display name embedded on this message (notifyName / pushName).
 * @param {Record<string, unknown>} msg
 * @param {string} [activeChatId]
 */
export function extractInlineSenderName(msg, activeChatId = '') {
  if (!msg || msg.fromMe) return ''
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const candidates = [
    msg?.notifyName,
    data?.notifyName,
    data?.pushName,
    msg?.pushName,
    msg?.senderName,
    data?.verifiedName,
    data?.senderName,
  ]
  for (const c of candidates) {
    const name = String(c ?? '').trim()
    if (name && !isWhatsAppJid(name) && name !== activeChatId) return name
  }
  return ''
}

/**
 * Learn display names from a batch of raw messages (participant JID → name).
 * @param {unknown[]} messages
 * @param {{ contactMap?: Map<string, string>, lidMap?: Map<string, string>, activeChatId?: string }} [opts]
 */
export function buildParticipantNameMap(messages, opts = {}) {
  const { contactMap, lidMap, activeChatId = '' } = opts
  const map = new Map()
  if (!Array.isArray(messages)) return map
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || msg.fromMe) continue
    const participant = extractParticipantJid(msg)
    if (!participant) continue
    const inline = extractInlineSenderName(msg, activeChatId)
    const resolved = inline
      || resolveWahaSenderName(msg, contactMap, activeChatId, lidMap, map)
    if (!resolved) continue
    map.set(participant, resolved)
    if (participant.endsWith('@lid') && lidMap?.get(participant)) {
      const pn = lidMap.get(participant)
      if (pn) map.set(pn, resolved)
    }
  }
  return map
}

/**
 * Scan entire thread for participant JIDs and display names (for translation cache).
 * @param {unknown[]} messages
 * @param {{ contactMap?: Map<string, string>, lidMap?: Map<string, string>, activeChatId?: string }} [opts]
 */
export function collectParticipantRawNamesFromMessages(messages, opts = {}) {
  const { contactMap, lidMap, activeChatId = '' } = opts
  /** @type {Map<string, string>} */
  const byJid = new Map()
  /** @type {Set<string>} */
  const orphanTexts = new Set()
  if (!Array.isArray(messages)) return { byJid, orphanTexts }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || msg.fromMe) continue
    const participant = extractParticipantJid(msg)
    const inline = extractInlineSenderName(msg, activeChatId)
    let name = inline
    if (!name && participant) {
      name = resolveJidToDisplayName(participant, contactMap, lidMap)
    }
    if (!name) continue
    if (participant) {
      const prev = byJid.get(participant)
      if (!prev || (inline && inline !== prev)) byJid.set(participant, name)
    } else {
      orphanTexts.add(name)
    }
  }
  return { byJid, orphanTexts }
}

/**
 * @param {Record<string, unknown>} msg
 * @param {Map<string, string>} [contactMap]
 * @param {string} [activeChatId]
 * @param {Map<string, string>} [lidMap]
 * @param {Map<string, string>} [participantMap] learned JID → display name
 */
export function resolveWahaSenderName(msg, contactMap, activeChatId = '', lidMap, participantMap) {
  if (msg?.fromMe) return ''
  const data = msg?._data && typeof msg._data === 'object' ? msg._data : {}
  const participant = extractParticipantJid(msg)
  if (participant && participantMap?.get(participant)) {
    return participantMap.get(participant) || ''
  }
  const inline = extractInlineSenderName(msg, activeChatId)
  if (inline) return inline
  const fromParticipant = resolveJidToDisplayName(participant, contactMap, lidMap)
  if (fromParticipant) return fromParticipant
  const from = normalizeParticipantJid(normalizeWahaChatId(msg?.from || data?.from))
  if (from && from !== activeChatId && from !== normalizeWahaChatId(activeChatId)) {
    if (participantMap?.get(from)) return participantMap.get(from) || ''
    const fromName = resolveJidToDisplayName(from, contactMap, lidMap)
    if (fromName) return fromName
  }
  return ''
}

/**
 * @param {Record<string, unknown>} msg
 * @param {{ contactMap?: Map<string, string>, lidMap?: Map<string, string>, participantMap?: Map<string, string>, senderTextEn?: Record<string, string>, activeChatId?: string }} [opts]
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
  const { contactMap, lidMap, participantMap, senderTextEn, activeChatId = '' } = opts
  const raw = isRawWahaMessage(msg) ? msg : null
  const src = raw || msg
  const id = getWahaMessageId(src)
  const text = String(src?.body ?? src?.text ?? src?.caption ?? '').trim()
  const fromMe = Boolean(src?.fromMe)
  let ts = Number(src?.timestamp ?? src?.ts)
  if (!Number.isFinite(ts)) ts = Date.now()
  else if (ts < 1e12) ts *= 1000
  const media = normalizeWahaMedia(src)
  const hasMedia = Boolean(src?.hasMedia || media?.url)
  let senderName = resolveWahaSenderName(src, contactMap, activeChatId, lidMap, participantMap)
  if (senderName && senderTextEn && typeof senderTextEn === 'object') {
    senderName = englishDisplayName(senderName, senderTextEn)
  }
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
    if (!name) continue
    map.set(id, name)
    if (id.endsWith('@c.us')) {
      const digits = id.split('@')[0]
      if (digits) map.set(`${digits}@c.us`, name)
    }
    const num = String(c?.number ?? '').replace(/\D/g, '')
    if (num) map.set(`${num}@c.us`, name)
  }
  return map
}

/**
 * @param {Array<{ lid?: string, pn?: string | null }>} entries
 * @returns {Map<string, string>} lid @lid -> pn @c.us
 */
export function buildLidPhoneMap(entries) {
  const map = new Map()
  if (!Array.isArray(entries)) return map
  for (const row of entries) {
    const lid = normalizeWahaChatId(row?.lid)
    const pn = normalizeWahaChatId(row?.pn)
    if (lid && pn) map.set(lid, pn)
  }
  return map
}

/** @param {{ limit?: number, offset?: number }} [opts] */
export async function listLids(opts = {}) {
  const session = getWahaSessionName()
  const qs = new URLSearchParams({
    limit: String(opts.limit ?? 500),
    offset: String(opts.offset ?? 0),
  })
  const r = await fetch(
    wahaUrl(`/api/${encodeURIComponent(session)}/lids?${qs}`),
    { headers: wahaHeaders() },
  )
  if (!r.ok) return { ok: false, status: r.status, body: [] }
  const body = await r.json().catch(() => [])
  return { ok: true, status: r.status, body: Array.isArray(body) ? body : [] }
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
