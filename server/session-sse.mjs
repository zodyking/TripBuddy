/** Live EventSource connections keyed by session id (for SESSION_REVOKED on login elsewhere). */

/** @type {Map<string, (payload: object) => void>} */
const sendBySessionId = new Map()

/**
 * @param {string} sessionId
 * @param {(payload: object) => void} send
 * @returns {() => void} unregister
 */
export function registerSseConnection(sessionId, send) {
  sendBySessionId.set(sessionId, send)
  return () => {
    sendBySessionId.delete(sessionId)
  }
}

/**
 * Notify browser still holding an old session cookie (signed in elsewhere).
 * @param {string} sessionId
 */
export function notifySessionRevoked(sessionId) {
  const send = sendBySessionId.get(sessionId)
  if (!send) return
  try {
    send({
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
