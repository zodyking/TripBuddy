/**
 * WAHA (WhatsApp HTTP API) client.
 * Connects to a WAHA instance for sending/receiving WhatsApp group messages.
 * Deploy WAHA as a separate service (Dokploy service or docker-compose).
 *
 * Recommended (API key on server only): set TripBuddy env `WAHA_BASE_URL` + `WAHA_API_KEY`,
 * leave URL empty in Settings — requests go through `/api/waha` proxy.
 * @see https://github.com/devlikeapro/waha
 */

const WAHA_URL_KEY = 'wahaBaseUrl'
const WAHA_API_KEY_KEY = 'wahaApiKey'
const WAHA_GROUP_ID_KEY = 'wahaGroupId'
const WAHA_TTS_ENABLED_KEY = 'wahaTtsEnabled'
const WAHA_POLL_INTERVAL_KEY = 'wahaPollIntervalMs'

const DEFAULT_SESSION = 'default'
const DEFAULT_POLL_INTERVAL = 10_000

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

export function getWahaGroupId() {
  if (typeof window === 'undefined' || !window.localStorage) return ''
  return (window.localStorage.getItem(WAHA_GROUP_ID_KEY) ?? '').trim()
}

export function setWahaGroupId(id) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(WAHA_GROUP_ID_KEY, String(id ?? '').trim())
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
  return !!(getWahaBaseUrl() && getWahaGroupId())
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
 * List groups for the session.
 */
export async function listGroups() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl(`/api/${encodeURIComponent(session)}/groups`), {
    headers: wahaHeaders(),
  })
  if (!r.ok) return { ok: false, status: r.status, body: null }
  const body = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, body: Array.isArray(body) ? body : [] }
}

/**
 * Send text message to configured group.
 * @param {string} text
 */
export async function sendGroupMessage(text) {
  const session = getWahaSessionName()
  const chatId = getWahaGroupId()
  if (!chatId) throw new Error('No WhatsApp group configured')
  const r = await fetch(wahaUrl('/api/sendText'), {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({ session, chatId, text }),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

/**
 * Fetch recent messages from the configured group.
 * @param {number} [limit]
 */
export async function fetchGroupMessages(limit = 20) {
  const session = getWahaSessionName()
  const chatId = getWahaGroupId()
  if (!chatId) return { ok: false, status: 0, body: null }
  const r = await fetch(
    wahaUrl(`/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&downloadMedia=false`),
    { headers: wahaHeaders() },
  )
  if (!r.ok) return { ok: false, status: r.status, body: null }
  const body = await r.json().catch(() => null)
  return { ok: true, status: r.status, body: Array.isArray(body) ? body : [] }
}
