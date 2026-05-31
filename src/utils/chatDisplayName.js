/**
 * Format WhatsApp chat / person labels with given name first (First Last).
 */

/**
 * @param {string} raw
 * @returns {{
 *   firstName: string,
 *   lastName: string,
 *   displayTitle: string,
 *   briefingLabel: string,
 * }}
 */
export function formatChatDisplayName(raw) {
  let s = String(raw ?? '').trim()
  s = s.replace(/^~+/, '').trim()
  if (!s) {
    return { firstName: '', lastName: '', displayTitle: '', briefingLabel: '' }
  }
  if (s.includes('@')) {
    const short = s.split('@')[0] || s
    return {
      firstName: short,
      lastName: '',
      displayTitle: short,
      briefingLabel: short,
    }
  }

  let first = ''
  let last = ''
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 2) {
      last = parts[0]
      first = parts.slice(1).join(' ')
    } else {
      first = parts[0] || ''
    }
  } else {
    const parts = s.split(/\s+/).filter(Boolean)
    first = parts[0] || ''
    last = parts.slice(1).join(' ')
  }

  const displayTitle = last ? `${first} ${last}`.trim() : first
  return {
    firstName: first,
    lastName: last,
    displayTitle: displayTitle || s,
    briefingLabel: displayTitle || first || s,
  }
}

/**
 * @param {string} raw
 */
export function chatAvatarInitial(raw) {
  const { firstName, displayTitle } = formatChatDisplayName(raw)
  const ch = (firstName || displayTitle || '?').charAt(0)
  return ch ? ch.toUpperCase() : '?'
}
