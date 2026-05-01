/**
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeTomtomApiKey(raw) {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  if (s.length < 8 || s.length > 256) return ''
  if (!/^[A-Za-z0-9._~-]+$/.test(s)) return ''
  return s
}
