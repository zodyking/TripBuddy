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

/**
 * @param {string} path - e.g. `/api/v1/ping`
 * @param {{ method?: string, body?: unknown, query?: Record<string, string | number> }} [opts]
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
  params.set('password', password)
  if (opts.query && typeof opts.query === 'object') {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') params.set(k, String(v))
    }
  }
  const url = `${base}${path}?${params.toString()}`
  const method = opts.method || 'GET'
  /** @type {RequestInit} */
  const init = {
    method,
    headers: { Accept: 'application/json' },
  }
  if (method !== 'GET' && method !== 'HEAD' && opts.body != null) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }

  try {
    const r = await fetch(url, init)
    const text = await r.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    const data = body?.data ?? body
    const ok = r.ok && (body?.status == null || body.status === 200)
    return { ok, status: r.status, body: data, raw: body, error: ok ? '' : String(body?.message || body?.error || `HTTP ${r.status}`) }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: e instanceof Error ? e.message : String(e),
    }
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
  const guid = encodeURIComponent(String(chatGuid || '').trim())
  if (!guid) return { ok: false, status: 400, body: null, error: 'chatGuid required' }
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 50))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const sort = opts.sort === 'ASC' ? 'ASC' : 'DESC'
  return blueBubblesFetch(`/api/v1/chat/${guid}/message`, {
    query: { limit, offset, sort },
  })
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
 * @param {string} chatGuid
 * @param {string} message
 * @param {string} [tempGuid]
 */
export async function sendBlueBubblesText(chatGuid, message, tempGuid) {
  const guid = String(chatGuid || '').trim()
  const text = String(message || '').trim()
  if (!guid || !text) {
    return { ok: false, status: 400, body: null, error: 'chatGuid and message required' }
  }
  const crypto = await import('node:crypto')
  const temp = tempGuid || `temp-${crypto.randomUUID()}`
  return blueBubblesFetch('/api/v1/message/text', {
    method: 'POST',
    body: { chatGuid: guid, tempGuid: temp, message: text },
  })
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
