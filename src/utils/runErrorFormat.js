/**
 * Short user-facing copy for common automation failures (full detail stays in server logs).
 * @param {string} message
 * @returns {string}
 */
export function formatRunErrorForUser(message) {
  if (message == null || typeof message !== 'string') {
    return String(message)
  }
  if (/locator\.waitFor:\s*Timeout/i.test(message)) {
    return 'The app took too long to load. Check your connection and try again.'
  }
  if (/Timeout \d+ms exceeded/i.test(message) && /locator|waiting for/i.test(message)) {
    return 'The app took too long to load. Check your connection and try again.'
  }
  if (/waiting for locator/i.test(message) && /xpath=/i.test(message)) {
    return 'The app took too long to load. Check your connection and try again.'
  }
  return message
}
