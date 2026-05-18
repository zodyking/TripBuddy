/** Matches 511NY lane metadata objects when stringified in a single field. */
const JSON_LANE_KEY_RE = /"LanesAffectedCount"|"LanesTotalCount"|"LanesDetail"|"LanesStatus"/

/**
 * Turn noisy 511NY lane / direction strings into a short human line.
 * Upstream sometimes sends `{"Lanes…":null,…} - No Data - Southbound` instead of plain text.
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeNy511ImpactFootnote(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return ''
  const td = t.toLowerCase()
  if (td === 'unknown' || td === 'n/a' || td === 'none' || td === 'not applicable' || td === 'no data') {
    return ''
  }

  const mTail = /\}\s*[-–—]\s*No Data\s*[-–—]\s*(.+)$/i.exec(t)
  if (mTail) {
    const tail = mTail[1].trim()
    const tl = tail.toLowerCase()
    if (tail && tl !== 'no data' && tl !== 'unknown') return tail
    return ''
  }

  if (t.startsWith('{') && JSON_LANE_KEY_RE.test(t)) {
    try {
      const o = JSON.parse(t)
      if (o && typeof o === 'object') {
        for (const k of ['LanesStatus', 'lanesStatus', 'LanesAffected', 'lanesAffected', 'LanesDetail', 'lanesDetail']) {
          const v = /** @type {Record<string, unknown>} */ (o)[k]
          if (typeof v === 'string' && v.trim()) {
            const s = v.trim()
            const sl = s.toLowerCase()
            if (sl !== 'unknown' && sl !== 'no data') return s
          }
        }
      }
    } catch {
      /* ignore */
    }
    return ''
  }

  return t
}
