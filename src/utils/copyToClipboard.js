/**
 * Synchronous DOM copy — runs in the same user-gesture tick as the tap (required on
 * some mobile Safari / WebKit builds when async clipboard API fails or is gated).
 * @param {string} text
 * @returns {boolean}
 */
function copyViaHiddenTextarea(text) {
  const s = String(text ?? '')
  if (!s || typeof document === 'undefined') return false
  try {
    const ta = document.createElement('textarea')
    ta.value = s
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, s.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Synchronous clipboard copy — use inside click/tap handlers (mobile Safari).
 * @param {string} text
 * @returns {boolean}
 */
export function copyTextToClipboardSync(text) {
  const s = String(text ?? '')
  if (!s) return false
  return copyViaHiddenTextarea(s)
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyTextToClipboard(text) {
  const s = String(text ?? '')
  if (!s) return false
  // Prefer sync copy first so the stack stays inside the click/tap handler (mobile Safari).
  if (copyViaHiddenTextarea(s)) return true
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}
