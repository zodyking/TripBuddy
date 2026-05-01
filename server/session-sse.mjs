/** Live EventSource connections keyed by session id (for SESSION_REVOKED + in-app fan-out). */

/**
 * @typedef {{ send: (payload: object) => void, accountKey: string }} SseConn
 */

/** @type {Map<string, SseConn>} */
const connectionsBySessionId = new Map()

/**
 * @param {string} sessionId
 * @param {(payload: object) => void} send
 * @param {string} [accountKey] credential account key for this session (for targeted in-app push)
 * @returns {() => void} unregister
 */
export function registerSseConnection(sessionId, send, accountKey = '') {
  connectionsBySessionId.set(sessionId, {
    send,
    accountKey: typeof accountKey === 'string' ? accountKey : '',
  })
  return () => {
    connectionsBySessionId.delete(sessionId)
  }
}

/**
 * Notify browser still holding an old session cookie (signed in elsewhere).
 * @param {string} sessionId
 */
export function notifySessionRevoked(sessionId) {
  const c = connectionsBySessionId.get(sessionId)
  if (!c) return
  try {
    c.send({
      type: 'session',
      code: 'SESSION_REVOKED',
      message: 'Signed in on another device',
      ts: Date.now(),
    })
  } catch {
    /* ignore */
  }
  connectionsBySessionId.delete(sessionId)
}

/**
 * Push an in-app notification to every open EventSource whose session matches `accountKey`.
 * @param {string} accountKey
 * @param {Record<string, unknown>} payload must include `type: 'inapp'` fields the client expects
 */
export function broadcastInAppToAccountSessions(accountKey, payload) {
  const ak = String(accountKey || '').trim()
  if (!ak) return
  for (const [, c] of connectionsBySessionId) {
    if (c.accountKey !== ak) continue
    try {
      c.send(payload)
    } catch {
      /* client gone */
    }
  }
}
