import crypto from 'node:crypto'
import { notifySessionRevoked } from './session-sse.mjs'

/** @typedef {{ exp: number, accountKey: string | null, deviceId?: string | null }} SessionEntry */

/** @type {Map<string, SessionEntry>} */
const sessions = new Map()

/** Active session ids per account (max {@link MAX_SESSIONS_PER_ACCOUNT}). */
/** @type {Map<string, string[]>} */
const accountKeyToSessionIds = new Map()

export const MAX_SESSIONS_PER_ACCOUNT = 2
const SESSION_MS = 7 * 24 * 60 * 60 * 1000

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
  sessions.set(id, {
    exp: Date.now() + SESSION_MS,
    accountKey: accountKey && typeof accountKey === 'string' ? accountKey : null,
    deviceId: deviceId && typeof deviceId === 'string' ? deviceId : null,
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

export function destroySession(id) {
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
  notifySessionRevoked(id)
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

function pruneSessions() {
  const now = Date.now()
  for (const [k, s] of sessions) {
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

setInterval(pruneSessions, 60 * 60 * 1000).unref()
