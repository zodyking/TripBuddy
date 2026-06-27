/** Live EventSource connections keyed by session id. */

/**
 * @typedef {{ send: (payload: object) => void, accountKey: string | null }} SseConnection
 */

/** @type {Map<string, SseConnection>} */
const sendBySessionId = new Map()

/**
 * @param {string} sessionId
 * @param {string | null} accountKey
 * @param {(payload: object) => void} send
 * @returns {() => void} unregister
 */
export function registerSseConnection(sessionId, accountKey, send) {
  sendBySessionId.set(sessionId, {
    send,
    accountKey: accountKey && typeof accountKey === 'string' ? accountKey : null,
  })
  return () => {
    sendBySessionId.delete(sessionId)
  }
}

/**
 * @param {string} accountKey
 * @param {object} payload
 */
export function broadcastToAccount(accountKey, payload) {
  const ak = String(accountKey ?? '').trim()
  if (!ak) return
  for (const entry of sendBySessionId.values()) {
    if (entry.accountKey !== ak) continue
    try {
      entry.send(payload)
    } catch {
      /* client gone */
    }
  }
}

/**
 * Notify browser still holding an old session cookie (signed in elsewhere).
 * @param {string} sessionId
 */
export function notifySessionRevoked(sessionId) {
  const entry = sendBySessionId.get(sessionId)
  if (!entry) return
  try {
    entry.send({
      type: 'session',
      code: 'SESSION_REVOKED',
      message: 'Signed in on another device',
      ts: Date.now(),
    })
  } catch {
    /* ignore */
  }
  sendBySessionId.delete(sessionId)
}
