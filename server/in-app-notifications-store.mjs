import { randomUUID } from 'node:crypto'
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'
import { getLastActiveAccountKey } from './active-account.mjs'

const MAX = 100

/**
 * @typedef {{ id: string, ts: number, type: string, message: string, source: string, read: boolean, extra?: object }} InAppItem
 * @typedef {{ items: InAppItem[] }} InAppDoc
 */

/**
 * @param {string} accountKey
 * @param {InAppItem[]} items
 */
function trim(items) {
  return items.slice(0, MAX)
}

/** @param {InAppDoc} prev @param {InAppItem} item */
function isDuplicateOfNewest(prev, item) {
  const top = (prev.items && prev.items[0]) || null
  if (!top) return false
  if (top.message !== item.message) return false
  if (top.source !== item.source) return false
  return (item.ts || 0) - (top.ts || 0) < 20_000
}

/**
 * @param {string} [forceAccount]
 */
function keyFor(forceAccount) {
  if (forceAccount) return userScopeKey('notifications:inbox', forceAccount)
  return userScopeKey('notifications:inbox')
}

/**
 * @param {string} [forceAccount]
 */
export async function readInAppInbox(/** @type {string|undefined} */ forceAccount) {
  const d = await readKeyJson(
    keyFor(/** @type {string|undefined} */(forceAccount)),
    () => ({ items: [] }),
  )
  if (!d || typeof d !== 'object' || !Array.isArray(/** @type {any} */(d).items)) {
    return { items: [] }
  }
  return /** @type {InAppDoc} */ (d)
}

/**
 * @param {string} accountKey
 * @param {{ type?: string, message: string, source: string, extra?: object, forceAccount?: string }} payload
 * @returns {Promise<{ ok: boolean, skipped?: string, item?: InAppItem, inbox: InAppDoc }>}
 */
export async function appendInAppNotification(
  accountKey,
  { type = 'info', message, source, extra, forceAccount },
) {
  const t = String(message || '').trim()
  if (!t) return { ok: false, skipped: 'empty', inbox: { items: [] } }
  const ak = forceAccount || accountKey
  if (!ak) return { ok: false, skipped: 'no_account', inbox: { items: [] } }
  const prev = await readInAppInbox(ak)
  const now = Date.now()
  const item = /** @type {InAppItem} */({
    id: randomUUID(),
    ts: now,
    type: String(type || 'info'),
    message: t,
    source: String(source || 'app'),
    read: false,
    extra: extra && typeof extra === 'object' && !Array.isArray(extra) ? { ...extra } : undefined,
  })
  if (isDuplicateOfNewest(/** @type {InAppDoc} */(prev), item)) {
    return { ok: true, skipped: 'deduped', inbox: /** @type {InAppDoc} */(prev) }
  }
  const nextItems = [item, ...((/** @type {InAppDoc} */(prev).items) || [])].filter(
    (x) => x && x.id,
  )
  const inbox = {
    items: trim(nextItems),
  }
  await writeKeyJson(keyFor(ak), inbox)
  return { ok: true, item, inbox }
}

/**
 * Append for server-side events where request context has no user (e.g. poll) — uses last active account.
 */
export async function appendInAppForLastActive(payload) {
  const ak = getLastActiveAccountKey()
  if (!ak) return { ok: false, skipped: 'no_last_active' }
  return appendInAppNotification(ak, payload)
}

/**
 * @param {string} [ak]
 * @param {string[]} ids
 */
export async function markInAppRead(ak, ids) {
  if (!ak || !Array.isArray(ids) || !ids.length) {
    return readInAppInbox(ak)
  }
  const set = new Set(ids.map((x) => String(x)))
  const prev = await readInAppInbox(ak)
  const items = (prev.items || []).map((e) => {
    if (e && set.has(e.id)) return { ...e, read: true }
    return e
  })
  const inbox = { ...prev, items }
  await writeKeyJson(keyFor(ak), inbox)
  return inbox
}

/**
 * @param {string} [ak]
 */
export async function markInAppAllRead(ak) {
  if (!ak) return { items: [] }
  const prev = await readInAppInbox(ak)
  const items = (prev.items || []).map((e) => (e ? { ...e, read: true } : e))
  const inbox = { ...prev, items }
  await writeKeyJson(keyFor(ak), inbox)
  return inbox
}
