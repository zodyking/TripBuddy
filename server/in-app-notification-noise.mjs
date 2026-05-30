/**
 * Messages that should never appear in the in-app notification inbox or as SSE toasts.
 * Bridge/tunnel traffic alerts are disabled until improved tier notifications return.
 */
export function isSkippableInAppNotification(message, source) {
  const m = String(message || '')
    .trim()
    .toLowerCase()
  const s = String(source || '')
    .trim()
    .toLowerCase()
  if (!m) return false
  if (s === 'session') return true
  if (m.startsWith('signed in')) return true
  if (m.includes('crossing times were refreshed')) return true
  if (m.includes('bridge') && m.includes('tunnel') && m.includes('refreshed')) return true
  if (s === 'bridges' && m.includes('refreshed')) return true
  if (s === 'bridges' || s === 'bridges-tier') return true
  if (m.includes('bridge alerts will follow')) return true
  if (/\bbridge\b/.test(m) && /\btraffic\b/.test(m) && (m.includes('→') || m.includes('->'))) {
    return true
  }
  return false
}
