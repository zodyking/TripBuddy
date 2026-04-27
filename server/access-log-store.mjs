import crypto from 'node:crypto'
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { G, getDataAccountKey, keyForLoginAccessLog, keyForUser, userScopeKey } from './scope-kv.mjs'
import { accountKeyForUsername } from './account-identity.mjs'
import { getUsername } from './credentials-store.mjs'

const GLOBAL_VISIT_KEY = G('access:log:visit')
/** Migrated access rows with unknown account (one-time import from pre-PG `access-log.json`) */
const LEGACY_UNSCOPED_KEY = G('access:log:unscoped-legacy')
const MAX_ENTRIES = 5000

/**
 * @typedef {Object} AccessLogEntry
 * @property {string} id
 * @property {string} at
 * @property {string} ip
 * @property {string|null} forwardedFor
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {number|null} accuracyM
 * @property {boolean} locationDenied
 * @property {string|null} userAgent
 * @property {string} source
 * @property {string|null} [dataAccountId]
 */

/**
 * @param {string} key
 * @returns {Promise<AccessLogEntry[]>}
 */
async function readList(key) {
  const doc = await readKeyJson(key, () => ({ entries: [] }))
  if (!doc || typeof doc !== 'object' || !Array.isArray(/** @type {any} */ (doc).entries)) {
    return []
  }
  return /** @type {AccessLogEntry[]} */ (/** @type {any} */ (doc).entries)
}

/**
 * @param {string} key
 * @param {AccessLogEntry[]} list
 */
async function writeList(key, list) {
  await writeKeyJson(key, { entries: list.slice(0, MAX_ENTRIES) })
}

/**
 * @param {string} key
 * @param {Omit<AccessLogEntry, 'id' | 'at' | 'source'> & { id?: string, at?: string, source: string, dataAccountId?: string | null }} row
 */
export async function appendToAccessKey(key, row) {
  const list = await readList(key)
  const entry = /** @type {AccessLogEntry} */ ({
    id: row.id || crypto.randomBytes(8).toString('hex'),
    at: row.at || new Date().toISOString(),
    ip: String(row.ip || ''),
    forwardedFor: row.forwardedFor ?? null,
    latitude:
      row.latitude != null && Number.isFinite(Number(row.latitude))
        ? Number(row.latitude)
        : null,
    longitude:
      row.longitude != null && Number.isFinite(Number(row.longitude))
        ? Number(row.longitude)
        : null,
    accuracyM:
      row.accuracyM != null && Number.isFinite(Number(row.accuracyM))
        ? Number(row.accuracyM)
        : null,
    locationDenied: row.locationDenied === true,
    userAgent: typeof row.userAgent === 'string' ? row.userAgent.slice(0, 512) : null,
    source: String(row.source || 'event').slice(0, 64),
  })
  if (row.dataAccountId !== undefined) {
    entry.dataAccountId =
      row.dataAccountId == null
        ? null
        : typeof row.dataAccountId === 'string'
          ? row.dataAccountId
          : null
  } else if (getDataAccountKey()) {
    entry.dataAccountId = getDataAccountKey()
  } else {
    entry.dataAccountId = null
  }
  list.unshift(entry)
  await writeList(key, list)
  return entry
}

/**
 * @param {object} body
 */
export async function appendLoginAccessFromBody(body) {
  const u = body && typeof body.username === 'string' ? body.username.trim() : ''
  const { username: _drop, ...rest } =
    body && typeof body === 'object' && body != null
      ? /** @type {Record<string, unknown>} */ (body)
      : {}
  const key = u ? keyForLoginAccessLog(u) : G('access:log:anonymous')
  const accId = u ? accountKeyForUsername(u) : null
  return appendToAccessKey(key, {
    ...rest,
    source: 'login_ack',
    dataAccountId: accId,
  })
}

export async function appendPageVisitLog(row) {
  return appendToAccessKey(GLOBAL_VISIT_KEY, {
    ...row,
    source: 'page_visit',
    dataAccountId: null,
  })
}

/**
 * Merged: per-user in-app log, pre-login rows for same saved username, global visit pings
 */
/**
 * Move rows from pre-login `keyForLoginAccessLog` into the signed-in user’s log (once per login).
 * @param {string} username
 * @param {string} dataAccountId
 */
export async function mergePreLoginAccessToUser(username, dataAccountId) {
  const u = String(username || '').trim()
  if (!u || !dataAccountId) return
  const fromKey = keyForLoginAccessLog(u)
  const toKey = keyForUser(dataAccountId, 'access:log')
  if (fromKey === toKey) return
  const from = await readList(fromKey)
  if (!from.length) return
  const to = await readList(toKey)
  const byId = new Set(to.map((e) => e && e.id).filter(Boolean))
  for (let i = from.length - 1; i >= 0; i--) {
    const e = from[i]
    if (e && e.id && !byId.has(e.id)) {
      e.dataAccountId = dataAccountId
      to.unshift(e)
      byId.add(e.id)
    }
  }
  await writeList(toKey, to)
  await writeList(fromKey, [])
}

export async function listAccessEntries() {
  const u = (await getUsername()) || ''
  const kSess = userScopeKey('access:log')
  const kPre = u.trim() ? keyForLoginAccessLog(u.trim()) : null
  const a = await readList(kSess)
  const b =
    kPre && kPre !== kSess ? await readList(kPre) : []
  const c = await readList(GLOBAL_VISIT_KEY)
  const d = await readList(LEGACY_UNSCOPED_KEY)
  const byId = new Map()
  for (const e of [...a, ...b, ...c, ...d]) {
    if (e && e.id && !byId.has(e.id)) {
      byId.set(e.id, e)
    }
  }
  return Array.from(byId.values()).sort(
    (x, y) => new Date(y.at).getTime() - new Date(x.at).getTime(),
  )
}
