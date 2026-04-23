/** @type {string | null} */
let lastActiveAccountKey = null

/**
 * Last user account for API-backed work when no HTTP request context (e.g. poll, runner after login).
 */
export function setLastActiveAccountKey(key) {
  lastActiveAccountKey = typeof key === 'string' && key.length > 0 ? key : null
}

export function getLastActiveAccountKey() {
  return lastActiveAccountKey
}
