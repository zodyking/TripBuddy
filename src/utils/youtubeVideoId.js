/**
 * Extract an 11-character YouTube video id from a pasted URL or raw id.
 * Supports watch, embed, live, shorts, and youtu.be links.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function extractYoutubeVideoIdFromInput(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\./i, '').toLowerCase()

    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0]?.split('?')[0] ?? ''
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v')
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v

      const parts = u.pathname.split('/').filter(Boolean)
      const embedI = parts.indexOf('embed')
      if (embedI >= 0 && parts[embedI + 1]) {
        const id = parts[embedI + 1].split('?')[0]
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id
      }
      const liveI = parts.indexOf('live')
      if (liveI >= 0 && parts[liveI + 1]) {
        const id = parts[liveI + 1].split('?')[0]
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id
      }
      const shortsI = parts.indexOf('shorts')
      if (shortsI >= 0 && parts[shortsI + 1]) {
        const id = parts[shortsI + 1].split('?')[0]
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id
      }
    }
  } catch {
    return null
  }
  return null
}
