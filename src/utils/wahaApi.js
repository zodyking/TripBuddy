/**
 * WAHA (WhatsApp HTTP API) client.
 * Connects to a co-hosted WAHA container for sending/receiving WhatsApp group messages.
 * The WAHA instance runs alongside the app via docker-compose (service: waha).
 * @see https://github.com/devlikeapro/waha
 */

const WAHA_GROUP_ID_KEY = 'wahaGroupId'
const WAHA_TTS_ENABLED_KEY = 'wahaTtsEnabled'
const WAHA_POLL_INTERVAL_KEY = 'wahaPollIntervalMs'

const DEFAULT_SESSION = 'default'
const DEFAULT_POLL_INTERVAL = 10_000

/**
 * WAHA base URL — proxied through the app server at /api/waha,
 * or directly at the WAHA container URL for local dev.
 */
export function getWahaBaseUrl() {
  if (typeof window === 'undefined') return ''
  const base = (import.meta.env.VITE_WAHA_URL || '').trim()
  if (base) return base
  return `${window.location.origin}/api/waha`
}

export function getWahaApiKey() {
  return ''
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
  const h = { 'Content-Type': 'application/json' }
  const key = getWahaApiKey()
  if (key) h['Authorization'] = `Bearer ${key}`
  return h
}

function wahaUrl(path) {
  const base = getWahaBaseUrl().replace(/\/+$/, '')
  return `${base}${path}`
}

/**
 * Start a WAHA session.
 */
export async function startSession() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl('/api/sessions/start'), {
    method: 'POST',
    headers: wahaHeaders(),
    body: JSON.stringify({ name: session }),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

/**
 * Get session status.
 */
export async function getSessionStatus() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl(`/api/sessions/${encodeURIComponent(session)}`), {
    headers: wahaHeaders(),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

/**
 * Get QR code for linking.
 */
export async function getQr() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl(`/api/${encodeURIComponent(session)}/auth/qr`), {
    headers: wahaHeaders(),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}

/**
 * List groups for the session.
 */
export async function listGroups() {
  const session = getWahaSessionName()
  const r = await fetch(wahaUrl(`/api/${encodeURIComponent(session)}/groups`), {
    headers: wahaHeaders(),
  })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
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
    wahaUrl(`/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`),
    { headers: wahaHeaders() },
  )
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) }
}
