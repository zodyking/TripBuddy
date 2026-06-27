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
 * Notify browser still holding an old session cookie (signed in elsewhere or idle timeout).
 * @param {string} sessionId
 * @param {{ code?: string, message?: string }} [opts]
 */
export function notifySessionRevoked(sessionId, opts = {}) {
  const entry = sendBySessionId.get(sessionId)
  if (!entry) return
  const code = opts.code === 'SESSION_IDLE_TIMEOUT' ? 'SESSION_IDLE_TIMEOUT' : 'SESSION_REVOKED'
  const message =
    typeof opts.message === 'string' && opts.message.trim()
      ? opts.message.trim()
      : code === 'SESSION_IDLE_TIMEOUT'
        ? 'Signed out after 3 hours of inactivity'
        : 'Signed in on another device'
  try {
    entry.send({
      type: 'session',
      code,
      message,
      ts: Date.now(),
    })
  } catch {
    /* ignore */
  }
  sendBySessionId.delete(sessionId)
}
