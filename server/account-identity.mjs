import crypto from 'node:crypto'

/**
 * Stable per-user id from username (SHA-256 hex, no PII in raw form beyond hash).
 * @param {string} username
 * @returns {string | null}
 */
export function accountKeyForUsername(username) {
  const t = typeof username === 'string' ? username.trim() : ''
  if (!t) return null
  return crypto.createHash('sha256').update(t.toLowerCase()).digest('hex')
}
