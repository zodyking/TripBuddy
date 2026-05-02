/**
 * Messages that should never appear in the in-app notification inbox or as SSE toasts.
 * (Bridge/tunnel *traffic* updates use different wording / sources.)
 */
export function isSkippableInAppNotification(message, source) {
  const m = String(message || '')
    .trim()
    .toLowerCase()
  const s = String(source || '')
    .trim()
    .toLowerCase()
  if (!m) return false
  if (m.includes('crossing times were refreshed')) return true
  if (m.includes('bridge') && m.includes('tunnel') && m.includes('refreshed')) return true
  if (s === 'bridges' && m.includes('refreshed')) return true
  return false
}
