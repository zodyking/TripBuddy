import crypto from 'node:crypto'

/** @type {Map<string, number>} sessionId -> expiry unix ms */
const sessions = new Map()

const SESSION_MS = 7 * 24 * 60 * 60 * 1000

export function isAuthEnabled() {
  const v = process.env.FEDEX_TOOL_AUTH_ENABLED
  if (v === undefined || v === '') return true
  return !/^(0|false|no|off)$/i.test(String(v).trim())
}

export function createSession() {
  pruneSessions()
  const id = crypto.randomBytes(32).toString('hex')
  sessions.set(id, Date.now() + SESSION_MS)
  return id
}

export function destroySession(id) {
  if (id) sessions.delete(id)
}

export function isValidSession(id) {
  if (!id || typeof id !== 'string') return false
  pruneSessions()
  const exp = sessions.get(id)
  if (!exp || exp < Date.now()) {
    sessions.delete(id)
    return false
  }
  return true
}

function pruneSessions() {
  const now = Date.now()
  for (const [k, exp] of sessions) {
    if (exp < now) sessions.delete(k)
  }
}

setInterval(pruneSessions, 60 * 60 * 1000).unref()
