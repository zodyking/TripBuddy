import crypto from 'node:crypto'
import { notifySessionRevoked } from './session-sse.mjs'

/** @typedef {{ exp: number, accountKey: string | null, deviceId?: string | null, lastActivityAt: number }} SessionEntry */

/** @type {Map<string, SessionEntry>} */
const sessions = new Map()

/** Active session ids per account (max {@link MAX_SESSIONS_PER_ACCOUNT}). */
/** @type {Map<string, string[]>} */
const accountKeyToSessionIds = new Map()

export const MAX_SESSIONS_PER_ACCOUNT = 2
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
/** Sign out after this much time without an authenticated request. */
export const SESSION_IDLE_MS = 3 * 60 * 60 * 1000

export function isAuthEnabled() {
  const v = process.env.FEDEX_TOOL_AUTH_ENABLED
  if (v === undefined || v === '') return true
  return !/^(0|false|no|off)$/i.test(String(v).trim())
}

/**
 * @param {string} accountKey
 * @returns {string[]}
 */
export function getActiveSessionIdsForAccount(accountKey) {
  if (!accountKey) return []
  pruneSessions()
  const ids = accountKeyToSessionIds.get(accountKey) || []
  return ids.filter((id) => isValidSession(id))
}

/**
 * @param {string | undefined} id
 * @returns {SessionEntry | null}
 */
export function getSessionEntry(id) {
  if (!id || typeof id !== 'string') return null
  pruneSessions()
  const s = sessions.get(id)
  if (!s || s.exp < Date.now()) return null
  if (destroySessionIfIdle(id, s)) return null
  return s
}

/**
 * @param {string | null} [accountKey]
 * @param {string | null} [deviceId]
 * @param {{ enforceLimit?: boolean }} [opts]
 * @returns {string | null} session id, or null when account is at session limit
 */
export function createSession(accountKey = null, deviceId = null, opts = {}) {
  const enforceLimit = opts.enforceLimit !== false
  pruneSessions()
  if (accountKey && typeof accountKey === 'string' && enforceLimit) {
    const active = getActiveSessionIdsForAccount(accountKey)
    if (active.length >= MAX_SESSIONS_PER_ACCOUNT) {
      return null
    }
  }
  const id = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  sessions.set(id, {
    exp: now + SESSION_MS,
    accountKey: accountKey && typeof accountKey === 'string' ? accountKey : null,
    deviceId: deviceId && typeof deviceId === 'string' ? deviceId : null,
    lastActivityAt: now,
  })
  if (accountKey && typeof accountKey === 'string') {
    const prev = getActiveSessionIdsForAccount(accountKey)
    accountKeyToSessionIds.set(accountKey, [...prev, id])
  }
  return id
}

/**
 * @param {string} accountKey
 * @param {string[]} sessionIds
 */
export function revokeSessionsForAccount(accountKey, sessionIds) {
  if (!accountKey || !Array.isArray(sessionIds)) return
  for (const sid of sessionIds) {
    if (typeof sid !== 'string' || !sid.trim()) continue
    destroySession(sid.trim())
  }
}

/**
 * @param {string} accountKey
 */
export function revokeAllSessionsForAccount(accountKey) {
  if (!accountKey) return
  const ids = [...getActiveSessionIdsForAccount(accountKey)]
  for (const sid of ids) {
    destroySession(sid)
  }
}

/**
 * @param {string} id
 * @param {{ code?: string, message?: string }} [opts]
 */
export function destroySession(id, opts = {}) {
  if (!id) return
  const s = sessions.get(id)
  if (s?.accountKey) {
    const ak = s.accountKey
    const mapped = accountKeyToSessionIds.get(ak) || []
    accountKeyToSessionIds.set(
      ak,
      mapped.filter((sid) => sid !== id),
    )
    if (accountKeyToSessionIds.get(ak)?.length === 0) {
      accountKeyToSessionIds.delete(ak)
    }
  }
  notifySessionRevoked(id, opts)
  sessions.delete(id)
}

/**
 * @param {string | undefined} id
 * @returns {string | null}
 */
export function getSessionAccountKey(id) {
  const s = getSessionEntry(id)
  return s?.accountKey ?? null
}

export function isValidSession(id) {
  if (!id || typeof id !== 'string') return false
  const s = getSessionEntry(id)
  if (!s) {
    sessions.delete(id)
    return false
  }
  return true
}

/**
 * Record authenticated activity so idle timeout resets.
 * @param {string | undefined} id
 */
export function touchSessionActivity(id) {
  if (!id || typeof id !== 'string') return
  const s = sessions.get(id)
  if (!s || s.exp < Date.now() || isSessionIdleExpired(s)) return
  s.lastActivityAt = Date.now()
}

/**
 * @param {SessionEntry} s
 * @returns {boolean}
 */
function isSessionIdleExpired(s) {
  const last = typeof s.lastActivityAt === 'number' ? s.lastActivityAt : 0
  return last > 0 && Date.now() - last >= SESSION_IDLE_MS
}

/**
 * @param {string} id
 * @param {SessionEntry} s
 */
function destroySessionIfIdle(id, s) {
  if (!isSessionIdleExpired(s)) return false
  destroySession(id, {
    code: 'SESSION_IDLE_TIMEOUT',
    message: 'Signed out after 3 hours of inactivity',
  })
  return true
}

function pruneSessions() {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (destroySessionIfIdle(k, s)) continue
    if (s.exp < now) {
      if (s.accountKey) {
        const mapped = accountKeyToSessionIds.get(s.accountKey) || []
        const next = mapped.filter((sid) => sid !== k)
        if (next.length > 0) accountKeyToSessionIds.set(s.accountKey, next)
        else accountKeyToSessionIds.delete(s.accountKey)
      }
      sessions.delete(k)
    }
  }
}

/** @internal testing */
export function setSessionLastActivityAtForTest(id, ts) {
  const s = sessions.get(id)
  if (s && typeof ts === 'number') s.lastActivityAt = ts
}

setInterval(pruneSessions, 5 * 60 * 1000).unref()
