import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'

const WAHA_INTERNAL_URL = (process.env.WAHA_BASE_URL || 'http://waha:3000').replace(/\/+$/, '')
const WAHA_SESSION = process.env.WAHA_SESSION_NAME || 'default'
const CACHE_DIR = path.join(LOCAL_DIR, 'waha-chat-cache')

/** @type {Map<string, { updatedAt: number, messages: unknown[] }>} */
const memoryCache = new Map()

function safeFileName(chatId) {
  return String(chatId).replace(/[^a-zA-Z0-9@._-]/g, '_') + '.json'
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

/**
 * @param {string} chatId
 */
export async function readThreadCache(chatId) {
  const id = String(chatId || '').trim()
  if (!id) return null
  const mem = memoryCache.get(id)
  if (mem) return { ...mem, chatId: id, fromMemory: true }
  try {
    await ensureCacheDir()
    const raw = await fs.readFile(path.join(CACHE_DIR, safeFileName(id)), 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const payload = {
      chatId: id,
      updatedAt: Number(data.updatedAt) || 0,
      messages: Array.isArray(data.messages) ? data.messages : [],
      contacts: Array.isArray(data.contacts) ? data.contacts : [],
    }
    memoryCache.set(id, { updatedAt: payload.updatedAt, messages: payload.messages })
    return payload
  } catch {
    return null
  }
}

/**
 * @param {string} chatId
 * @param {{ updatedAt?: number, messages: unknown[], contacts?: unknown[] }} payload
 */
export async function writeThreadCache(chatId, payload) {
  const id = String(chatId || '').trim()
  if (!id) return
  const updatedAt = Number(payload.updatedAt) || Date.now()
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : []
  memoryCache.set(id, { updatedAt, messages })
  try {
    await ensureCacheDir()
    await fs.writeFile(
      path.join(CACHE_DIR, safeFileName(id)),
      JSON.stringify({ chatId: id, updatedAt, messages, contacts }),
      'utf8',
    )
  } catch {
    /* disk full etc. */
  }
}

async function wahaFetch(urlPath, query = '') {
  const headers = { Accept: 'application/json' }
  const key = process.env.WAHA_API_KEY
  if (key) headers['X-Api-Key'] = key
  const url = `${WAHA_INTERNAL_URL}${urlPath}${query}`
  const r = await fetch(url, { headers })
  const text = await r.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { ok: r.ok, status: r.status, body }
}

/**
 * @param {string} chatId
 * @param {{ limit?: number, downloadMedia?: boolean }} [opts]
 */
export async function fetchWahaChatMessages(chatId, opts = {}) {
  const id = encodeURIComponent(String(chatId || '').trim())
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50))
  const downloadMedia = opts.downloadMedia === true
  const q = `?limit=${limit}&downloadMedia=${downloadMedia}`
  return wahaFetch(`/api/${encodeURIComponent(WAHA_SESSION)}/chats/${id}/messages`, q)
}

/**
 * @param {string} chatId
 * @param {string} messageId
 */
export async function fetchWahaMessageMedia(chatId, messageId) {
  const c = encodeURIComponent(String(chatId || '').trim())
  const m = encodeURIComponent(String(messageId || '').trim())
  return wahaFetch(`/api/${encodeURIComponent(WAHA_SESSION)}/chats/${c}/messages/${m}`, '?downloadMedia=true')
}

/**
 * @param {string} chatId
 * @param {{ limit?: number, downloadMedia?: boolean, contacts?: unknown[] }} [opts]
 */
export async function syncThreadCache(chatId, opts = {}) {
  const r = await fetchWahaChatMessages(chatId, {
    limit: opts.limit ?? 60,
    downloadMedia: opts.downloadMedia ?? false,
  })
  if (!r.ok || !Array.isArray(r.body)) {
    return { ok: false, status: r.status, messages: [], updatedAt: 0 }
  }
  const updatedAt = Date.now()
  const messages = r.body
  await writeThreadCache(chatId, {
    updatedAt,
    messages,
    contacts: opts.contacts,
  })
  return { ok: true, status: r.status, messages, updatedAt }
}

/** @param {{ limit?: number }} [opts] */
export async function fetchWahaContacts(opts = {}) {
  const limit = Math.min(1000, Math.max(1, Number(opts.limit) || 500))
  const q = `?session=${encodeURIComponent(WAHA_SESSION)}&limit=${limit}&offset=0`
  return wahaFetch('/api/contacts/all', q)
}
