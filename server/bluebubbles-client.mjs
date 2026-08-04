/**
 * BlueBubbles REST API client (iMessage bridge).
 * @see https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks
 */

let _accountUrl = ''
let _accountPassword = ''

export function setAccountBlueBubblesUrl(url) {
  _accountUrl = String(url || '').trim().replace(/\/+$/, '')
}

export function setAccountBlueBubblesPassword(password) {
  _accountPassword = String(password || '').trim()
}

/**
 * @param {{ serverUrl?: string, password?: string } | null | undefined} prefs
 */
export function applyBlueBubblesPrefsForAccount(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {}
  if (p.serverUrl) setAccountBlueBubblesUrl(p.serverUrl)
  if (p.password) setAccountBlueBubblesPassword(p.password)
}

export function clearAccountBlueBubblesPrefs() {
  setAccountBlueBubblesUrl('')
  setAccountBlueBubblesPassword('')
}

function getServerUrl() {
  if (_accountUrl) return _accountUrl
  return String(process.env.BLUEBUBBLES_BASE_URL || '').trim().replace(/\/+$/, '')
}

function getPassword() {
  if (_accountPassword) return _accountPassword
  return String(process.env.BLUEBUBBLES_PASSWORD || '').trim()
}

function authQuery() {
  const password = getPassword()
  if (!password) return ''
  return `password=${encodeURIComponent(password)}`
}

/** @see https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks */
function formatBlueBubblesApiError(body, httpStatus) {
  if (!body || typeof body !== 'object') {
    return httpStatus ? `HTTP ${httpStatus}` : 'Request failed'
  }
  const b = /** @type {Record<string, unknown>} */ (body)
  const errObj = b.error && typeof b.error === 'object'
    ? /** @type {Record<string, unknown>} */ (b.error)
    : null
  const nested = String(errObj?.message ?? errObj?.error ?? '').trim()
  const top = String(b.message ?? (typeof b.error === 'string' ? b.error : '') ?? '').trim()
  const statusCode = Number(b.status)
  const prefix = Number.isFinite(statusCode) && statusCode >= 400 ? `[${statusCode}] ` : ''
  const msg = nested || top
  return msg ? `${prefix}${msg}` : (httpStatus ? `HTTP ${httpStatus}` : 'Request failed')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** BlueBubbles docs use raw chatGuid in path segments (semicolons not encoded). */
function chatGuidPathSegment(chatGuid) {
  return String(chatGuid || '').trim()
}

const DEFAULT_FETCH_TIMEOUT_MS = 55_000
const SEND_TIMEOUT_MS = 45_000
const SEND_VERIFY_MS = 12_000

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, string | number>, timeoutMs?: number }} [opts]
 */
export async function blueBubblesFetch(path, opts = {}) {
  const base = getServerUrl()
  if (!base) {
    return { ok: false, status: 0, body: null, error: 'BlueBubbles server URL not configured.' }
  }
  const password = getPassword()
  if (!password) {
    return { ok: false, status: 0, body: null, error: 'BlueBubbles password not configured.' }
  }

  const params = new URLSearchParams()
  // Official auth: guid/password/token query param (@see BlueBubbles REST API docs)
  params.set('password', password)
  params.set('guid', password)
  if (opts.query && typeof opts.query === 'object') {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '' && k !== 'password' && k !== 'guid') params.set(k, String(v))
    }
  }
  const url = `${base}${path}?${params.toString()}`
  const method = opts.method || 'GET'
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_FETCH_TIMEOUT_MS
  /** @type {RequestInit} */
  const init = {
    method,
    headers: { Accept: 'application/json' },
  }
  if (method !== 'GET' && method !== 'HEAD' && opts.body != null) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  init.signal = ctrl.signal

  try {
    const r = await fetch(url, init)
    const text = await r.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    const apiStatus = body && typeof body === 'object' ? Number(/** @type {Record<string, unknown>} */ (body).status) : NaN
    const data = body?.data ?? body
    const ok = r.ok && (!Number.isFinite(apiStatus) || apiStatus === 200)
    const error = ok ? '' : formatBlueBubblesApiError(body, r.status)
    return { ok, status: r.status, body: data, raw: body, error, timedOut: false }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      status: timedOut ? 504 : 0,
      body: null,
      error: timedOut ? 'BlueBubbles send timed out' : (e instanceof Error ? e.message : String(e)),
      timedOut,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function pingBlueBubbles() {
  return blueBubblesFetch('/api/v1/ping')
}

export async function getBlueBubblesServerInfo() {
  return blueBubblesFetch('/api/v1/server')
}

/** @param {{ limit?: number, offset?: number, with?: string[] }} [opts] */
export async function queryBlueBubblesChats(opts = {}) {
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50))
  const offset = Math.max(0, Number(opts.offset) || 0)
  return blueBubblesFetch('/api/v1/chat/query', {
    method: 'POST',
    body: {
      limit,
      offset,
      with: opts.with || ['lastMessage'],
    },
  })
}

/**
 * @param {string} chatGuid
 * @param {{ limit?: number, offset?: number, sort?: 'ASC' | 'DESC' }} [opts]
 */
export async function getBlueBubblesChatMessages(chatGuid, opts = {}) {
  const guid = chatGuidPathSegment(chatGuid)
  if (!guid) return { ok: false, status: 400, body: null, error: 'chatGuid required' }
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 50))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const sort = opts.sort === 'ASC' ? 'ASC' : 'DESC'
  return blueBubblesFetch(`/api/v1/chat/${guid}/message`, {
    query: { limit, offset, sort },
  })
}

/**
 * BlueBubbles may return 500/timeout even when the message was sent (server issue #801).
 * @param {string} chatGuid
 * @param {{ text: string, tempGuid?: string, sinceMs?: number }} opts
 */
async function verifyOutgoingMessage(chatGuid, opts) {
  const guid = chatGuidPathSegment(chatGuid)
  const text = String(opts.text ?? '').trim()
  const tempGuid = String(opts.tempGuid ?? '').trim()
  const sinceMs = Number(opts.sinceMs) || Date.now() - 15_000
  const deadline = Date.now() + SEND_VERIFY_MS

  while (Date.now() < deadline) {
    const r = await getBlueBubblesChatMessages(guid, { limit: 20, sort: 'DESC' })
    if (r.ok && Array.isArray(r.body)) {
      for (const raw of r.body) {
        if (!raw || typeof raw !== 'object') continue
        const m = /** @type {Record<string, unknown>} */ (raw)
        if (m.isFromMe !== true) continue
        const bodyText = String(m.text ?? '').trim()
        const msgGuid = String(m.guid ?? m.id ?? '').trim()
        const ts = Number(m.dateCreated ?? m.date ?? 0)
        const tsMs = ts > 0 && ts < 1e12 ? ts * 1000 : ts
        if (tsMs && tsMs < sinceMs - 2000) continue
        if (tempGuid && msgGuid === tempGuid) return { ok: true, body: m }
        if (text && bodyText === text) return { ok: true, body: m }
      }
    }
    await sleep(1500)
  }
  return { ok: false, body: null }
}

/** Recent messages across all chats (inbox polling). */
export async function getBlueBubblesRecentMessages(opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const direct = await blueBubblesFetch('/api/v1/message', {
    query: { limit, offset, sort: 'DESC' },
  })
  if (direct.ok && Array.isArray(direct.body)) return direct

  // Some BlueBubbles versions return 404 for the global message endpoint — use chat lastMessage.
  if (direct.status !== 404 && direct.status !== 405) return direct

  const chatsR = await queryBlueBubblesChats({
    limit: Math.min(80, limit * 2),
    with: ['lastMessage'],
  })
  if (!chatsR.ok) {
    return {
      ok: false,
      status: chatsR.status,
      body: null,
      error: chatsR.error || direct.error || 'Failed to fetch recent iMessages',
    }
  }

  const chats = Array.isArray(chatsR.body) ? chatsR.body : []
  /** @type {unknown[]} */
  const messages = []
  for (const chat of chats) {
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
 * Send text per BlueBubbles REST API:
 * POST /api/v1/message/text?password=… body: { chatGuid, tempGuid, message [, method] }
 * @see https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks
 * @param {string} chatGuid
 * @param {string} message
 * @param {string} [tempGuid]
 */
export async function sendBlueBubblesText(chatGuid, message, tempGuid) {
  const guid = chatGuidPathSegment(chatGuid)
  const text = String(message || '').trim()
  if (!guid || !text) {
    return { ok: false, status: 400, body: null, error: 'chatGuid and message required' }
  }
  const crypto = await import('node:crypto')
  const temp = tempGuid || `temp-${crypto.randomUUID()}`
  const sinceMs = Date.now()
  const payloadBase = { chatGuid: guid, tempGuid: temp, message: text }

  /** @type {Array<Record<string, unknown>>} */
  const attempts = [
    { ...payloadBase, method: 'private-api' },
    payloadBase,
  ]

  /** @type {{ ok: boolean, status: number, body: unknown, raw?: unknown, error: string, timedOut?: boolean } | null} */
  let last = null

  for (const payload of attempts) {
    const result = await blueBubblesFetch('/api/v1/message/text', {
      method: 'POST',
      body: payload,
      timeoutMs: SEND_TIMEOUT_MS,
    })
    if (result.ok) return result
    last = result

    const errText = String(result.error || '').toLowerCase()
    const maybeSentDespiteError =
      result.timedOut ||
      result.status === 500 ||
      result.status === 504 ||
      errText.includes('message send error') ||
      errText.includes('timed out')

    if (maybeSentDespiteError) {
      const verified = await verifyOutgoingMessage(guid, { text, tempGuid: temp, sinceMs })
      if (verified.ok) {
        return {
          ok: true,
          status: 200,
          body: verified.body,
          raw: result.raw,
          error: '',
          verifiedAfterTimeout: true,
        }
      }
    }
  }

  return last || { ok: false, status: 0, body: null, error: 'Send failed' }
}

/** @param {{ url: string, events?: string[] }} body */
export async function registerBlueBubblesWebhook(body) {
  return blueBubblesFetch('/api/v1/webhook', {
    method: 'POST',
    body: {
      url: body.url,
      events: body.events || ['new-message', 'updated-message', 'typing-indicator'],
    },
  })
}

export async function listBlueBubblesWebhooks() {
  return blueBubblesFetch('/api/v1/webhook')
}

/** @param {number | string} id */
export async function deleteBlueBubblesWebhook(id) {
  return blueBubblesFetch(`/api/v1/webhook/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
  })
}
