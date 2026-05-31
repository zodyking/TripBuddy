import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'
import {
  readWahaThreadHistory,
  upsertWahaChatMeta,
  upsertWahaMessages,
} from './waha-chat-history-pg.mjs'

const WAHA_SESSION = process.env.WAHA_SESSION_NAME || 'default'
const CACHE_DIR = path.join(LOCAL_DIR, 'waha-chat-cache')

/** Resolve WAHA URL: env var > user account pref > fallback */
let _accountWahaUrl = ''
export function setAccountWahaUrl(url) {
  _accountWahaUrl = String(url || '').trim().replace(/\/+$/, '')
}
function getWahaUrl() {
  const env = (process.env.WAHA_BASE_URL || '').trim().replace(/\/+$/, '')
  if (env) return env
  if (_accountWahaUrl) return _accountWahaUrl
  return 'http://waha:3000'
}

/** @type {Map<string, { updatedAt: number, messages: unknown[] }>} */
const memoryCache = new Map()

function cacheKey(chatId, accountKey = '') {
  const ak = String(accountKey || '').trim()
  const id = String(chatId || '').trim()
  return ak ? `${ak}:${id}` : id
}

function safeFileName(chatId, accountKey = '') {
  const raw = cacheKey(chatId, accountKey)
  return String(raw).replace(/[^a-zA-Z0-9@._-]/g, '_') + '.json'
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

/**
 * @param {string} chatId
 * @param {string} [accountKey]
 */
export async function readThreadCache(chatId, accountKey = '') {
  const id = String(chatId || '').trim()
  if (!id) return null
  const key = cacheKey(id, accountKey)
  const pgHistory = accountKey
    ? await readWahaThreadHistory(accountKey, id, { limit: 1000 }).catch(() => null)
    : null
  if (pgHistory?.messages?.length) {
    memoryCache.set(key, { updatedAt: pgHistory.updatedAt, messages: pgHistory.messages })
    return pgHistory
  }
  const mem = memoryCache.get(key)
  if (mem) return { ...mem, chatId: id, fromMemory: true }
  try {
    await ensureCacheDir()
    let raw
    try {
      raw = await fs.readFile(path.join(CACHE_DIR, safeFileName(id, accountKey)), 'utf8')
    } catch (e) {
      if (!accountKey) throw e
      raw = await fs.readFile(path.join(CACHE_DIR, safeFileName(id)), 'utf8')
    }
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const payload = {
      chatId: id,
      updatedAt: Number(data.updatedAt) || 0,
      messages: Array.isArray(data.messages) ? data.messages : [],
      contacts: Array.isArray(data.contacts) ? data.contacts : [],
      lids: Array.isArray(data.lids) ? data.lids : [],
    }
    memoryCache.set(key, { updatedAt: payload.updatedAt, messages: payload.messages })
    return payload
  } catch {
    return null
  }
}

/**
 * @param {string} chatId
 * @param {{ updatedAt?: number, messages: unknown[], contacts?: unknown[], lids?: unknown[], accountKey?: string }} payload
 */
export async function writeThreadCache(chatId, payload) {
  const id = String(chatId || '').trim()
  if (!id) return
  const accountKey = String(payload.accountKey || '').trim()
  const key = cacheKey(id, accountKey)
  const updatedAt = Number(payload.updatedAt) || Date.now()
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : []
  const lids = Array.isArray(payload.lids) ? payload.lids : []
  memoryCache.set(key, { updatedAt, messages })
  if (accountKey) {
    await Promise.all([
      upsertWahaMessages(accountKey, id, messages),
      upsertWahaChatMeta(accountKey, id, { contacts, lids }),
    ]).catch(() => {})
  }
  try {
    await ensureCacheDir()
    await fs.writeFile(
      path.join(CACHE_DIR, safeFileName(id, accountKey)),
      JSON.stringify({ chatId: id, updatedAt, messages, contacts, lids }),
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
  const url = `${getWahaUrl()}${urlPath}${query}`
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
 * @param {{ limit?: number, downloadMedia?: boolean, contacts?: unknown[], lids?: unknown[], accountKey?: string }} [opts]
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
    lids: opts.lids,
    accountKey: opts.accountKey,
  })
  return { ok: true, status: r.status, messages, updatedAt }
}

/** @param {{ limit?: number }} [opts] */
export async function fetchWahaContacts(opts = {}) {
  const limit = Math.min(1000, Math.max(1, Number(opts.limit) || 500))
  const q = `?session=${encodeURIComponent(WAHA_SESSION)}&limit=${limit}&offset=0`
  return wahaFetch('/api/contacts/all', q)
}

/** @param {{ limit?: number, offset?: number }} [opts] */
export async function fetchWahaLids(opts = {}) {
  const limit = Math.min(1000, Math.max(1, Number(opts.limit) || 500))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const q = `?limit=${limit}&offset=${offset}`
  return wahaFetch(`/api/${encodeURIComponent(WAHA_SESSION)}/lids`, q)
}

/**
 * @param {Array<{ lid?: string, pn?: string | null }>} entries
 * @returns {Map<string, string>}
 */
export function buildLidPhoneMap(entries) {
  const map = new Map()
  if (!Array.isArray(entries)) return map
  for (const row of entries) {
    const lid = String(row?.lid ?? '').trim()
    const pn = String(row?.pn ?? '').trim()
    if (lid && pn) map.set(lid, pn)
  }
  return map
}
