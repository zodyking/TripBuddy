import crypto from 'node:crypto'
import { notifySessionRevoked } from './session-sse.mjs'

/** @typedef {{ exp: number, accountKey: string | null }} SessionEntry */

/** @type {Map<string, SessionEntry>} */
const sessions = new Map()

/** One active session id per account (new login revokes the previous device). */
/** @type {Map<string, string>} */
const accountKeyToSessionId = new Map()

const SESSION_MS = 7 * 24 * 60 * 60 * 1000

export function isAuthEnabled() {
  const v = process.env.FEDEX_TOOL_AUTH_ENABLED
  if (v === undefined || v === '') return true
  return !/^(0|false|no|off)$/i.test(String(v).trim())
}

/**
 * @param {string | null} [accountKey] SHA-256 hex of normalized username; ties session to credential file
 */
export function createSession(accountKey = null) {
  pruneSessions()
  if (accountKey && typeof accountKey === 'string') {
    const prevId = accountKeyToSessionId.get(accountKey)
    if (prevId) {
      notifySessionRevoked(prevId)
      sessions.delete(prevId)
      accountKeyToSessionId.delete(accountKey)
    }
  }
  const id = crypto.randomBytes(32).toString('hex')
  sessions.set(id, {
    exp: Date.now() + SESSION_MS,
    accountKey: accountKey && typeof accountKey === 'string' ? accountKey : null,
  })
  if (accountKey && typeof accountKey === 'string') {
    accountKeyToSessionId.set(accountKey, id)
  }
  return id
}

export function destroySession(id) {
  if (!id) return
  const s = sessions.get(id)
  if (s?.accountKey) {
    const mapped = accountKeyToSessionId.get(s.accountKey)
    if (mapped === id) {
      accountKeyToSessionId.delete(s.accountKey)
    }
  }
  sessions.delete(id)
}

/**
 * @param {string | undefined} id
 * @returns {string | null}
 */
export function getSessionAccountKey(id) {
  if (!id || typeof id !== 'string') return null
  pruneSessions()
  const s = sessions.get(id)
  if (!s || s.exp < Date.now()) return null
  return s.accountKey ?? null
}

export function isValidSession(id) {
  if (!id || typeof id !== 'string') return false
  pruneSessions()
  const s = sessions.get(id)
  if (!s || s.exp < Date.now()) {
    sessions.delete(id)
    return false
  }
  return true
}

function pruneSessions() {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (s.exp < now) {
      sessions.delete(k)
      if (s.accountKey) {
        const mapped = accountKeyToSessionId.get(s.accountKey)
        if (mapped === k) accountKeyToSessionId.delete(s.accountKey)
      }
    }
  }
}

setInterval(pruneSessions, 60 * 60 * 1000).unref()
