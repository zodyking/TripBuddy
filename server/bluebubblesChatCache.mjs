import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'
import {
  readBlueBubblesThreadHistory,
  upsertBlueBubblesChatMeta,
  upsertBlueBubblesMessages,
} from './bluebubbles-chat-history-pg.mjs'
import {
  applyBlueBubblesPrefsForAccount,
  clearAccountBlueBubblesPrefs,
  getBlueBubblesChatMessages,
  queryBlueBubblesChats,
  setAccountBlueBubblesPassword,
  setAccountBlueBubblesUrl,
} from './bluebubbles-client.mjs'

export {
  applyBlueBubblesPrefsForAccount,
  clearAccountBlueBubblesPrefs,
  setAccountBlueBubblesUrl,
  setAccountBlueBubblesPassword,
}

const CACHE_DIR = path.join(LOCAL_DIR, 'bluebubbles-chat-cache')

/** @type {Map<string, { updatedAt: number, messages: unknown[] }>} */
const memoryCache = new Map()

function cacheKey(chatGuid, accountKey = '') {
  const ak = String(accountKey || '').trim()
  const id = String(chatGuid || '').trim()
  return ak ? `${ak}:${id}` : id
}

function safeFileName(chatGuid, accountKey = '') {
  const raw = cacheKey(chatGuid, accountKey)
  return String(raw).replace(/[^a-zA-Z0-9@._-]/g, '_') + '.json'
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true })
}

/**
 * @param {string} chatGuid
 * @param {string} [accountKey]
 */
export async function readBbThreadCache(chatGuid, accountKey = '') {
  const id = String(chatGuid || '').trim()
  if (!id) return null
  const key = cacheKey(id, accountKey)
  const pgHistory = accountKey
    ? await readBlueBubblesThreadHistory(accountKey, id, { limit: 1000 }).catch(() => null)
    : null
  if (pgHistory?.messages?.length) {
    memoryCache.set(key, { updatedAt: pgHistory.updatedAt, messages: pgHistory.messages })
    return pgHistory
  }
  const mem = memoryCache.get(key)
  if (mem) return { ...mem, chatGuid: id, fromMemory: true }
  try {
    await ensureCacheDir()
    const raw = await fs.readFile(path.join(CACHE_DIR, safeFileName(id, accountKey)), 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const payload = {
      chatGuid: id,
      updatedAt: Number(data.updatedAt) || 0,
      messages: Array.isArray(data.messages) ? data.messages : [],
      displayName: String(data.displayName || ''),
      participants: Array.isArray(data.participants) ? data.participants : [],
    }
    memoryCache.set(key, { updatedAt: payload.updatedAt, messages: payload.messages })
    return payload
  } catch {
    return null
  }
}

/**
 * @param {string} chatGuid
 * @param {{ updatedAt?: number, messages: unknown[], displayName?: string, participants?: unknown[], accountKey?: string }} payload
 */
export async function writeBbThreadCache(chatGuid, payload) {
  const id = String(chatGuid || '').trim()
  if (!id) return
  const accountKey = String(payload.accountKey || '').trim()
  const key = cacheKey(id, accountKey)
  const updatedAt = Number(payload.updatedAt) || Date.now()
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const displayName = String(payload.displayName || '')
  const participants = Array.isArray(payload.participants) ? payload.participants : []
  memoryCache.set(key, { updatedAt, messages })
  if (accountKey) {
    await Promise.all([
      upsertBlueBubblesMessages(accountKey, id, messages),
      upsertBlueBubblesChatMeta(accountKey, id, { displayName, participants }),
    ]).catch(() => {})
  }
  try {
    await ensureCacheDir()
    await fs.writeFile(
      path.join(CACHE_DIR, safeFileName(id, accountKey)),
      JSON.stringify({ chatGuid: id, updatedAt, messages, displayName, participants }),
      'utf8',
    )
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} chatGuid
 * @param {{ limit?: number, accountKey?: string, displayName?: string, participants?: unknown[] }} [opts]
 */
export async function syncBbThreadCache(chatGuid, opts = {}) {
  const id = String(chatGuid || '').trim()
  const r = await getBlueBubblesChatMessages(id, {
    limit: opts.limit ?? 60,
    sort: 'DESC',
  })
  const list = Array.isArray(r.body) ? r.body : []
  if (!r.ok) {
    return { ok: false, status: r.status, messages: [], updatedAt: 0, error: r.error }
  }
  const messages = [...list].reverse()
  const updatedAt = Date.now()
  await writeBbThreadCache(id, {
    updatedAt,
    messages,
    displayName: opts.displayName,
    participants: opts.participants,
    accountKey: opts.accountKey,
  })
  return { ok: true, status: r.status, messages, updatedAt }
}

/** @param {{ limit?: number }} [opts] */
export async function fetchBbChats(opts = {}) {
  return queryBlueBubblesChats({ limit: opts.limit ?? 50, with: ['lastMessage'] })
}
