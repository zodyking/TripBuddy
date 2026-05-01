/**
 * Normalize TomTom JSON error bodies (Route Monitoring, Routing, etc.)
 * @param {unknown} data
 * @param {number} httpStatus
 * @returns {string}
 */
export function formatTomTomApiError(data, httpStatus) {
  if (typeof data === 'string') {
    const t = data.trim()
    if (t.startsWith('{')) {
      try {
        const parsed = JSON.parse(t)
        if (parsed && typeof parsed === 'object') {
          return formatTomTomApiError(parsed, httpStatus)
        }
      } catch {
        /* use raw slice below */
      }
    }
    return t.slice(0, 500)
  }

  if (Array.isArray(data)) {
    const parts = data
      .map((x) => formatTomTomApiError(x, httpStatus))
      .filter(Boolean)
    if (parts.length) return parts.join(' · ')
  }

  if (data && typeof data === 'object') {
    const o = /** @type {Record<string, unknown>} */ (data)
    const tracking =
      typeof o.trackingId === 'string'
        ? o.trackingId
        : typeof o.tracking_id === 'string'
          ? o.tracking_id
          : ''
    const code = typeof o.code === 'string' ? o.code.trim() : ''
    const msg = typeof o.message === 'string' ? o.message.trim() : ''
    if (code === 'Forbidden' || httpStatus === 403) {
      const detail = msg || 'You are not allowed to access this endpoint'
      return `TomTom denied access (403): ${detail}. Your API key must include the right products — for Corridors, enable Route Monitoring (and Routing for map preview) in the TomTom developer portal, or use a trial key that includes those APIs.`
    }

    const detailed =
      typeof o.detailedError === 'string'
        ? o.detailedError.trim()
        : o.detailedError && typeof o.detailedError === 'object'
          ? JSON.stringify(o.detailedError).slice(0, 200)
          : ''
    const err = typeof o.error === 'string' ? o.error.trim() : ''
    const errDesc =
      o.error && typeof o.error === 'object'
        ? formatTomTomApiError(o.error, httpStatus)
        : ''
    const errText = o.errorText != null ? String(o.errorText) : ''
    const dev = typeof o.developerMessage === 'string' ? o.developerMessage.trim() : ''

    const core = detailed || msg || errDesc || err || dev || errText
    if (core) {
      const tid = tracking ? ` (trackingId: ${tracking})` : ''
      return `${core}${tid}`
    }

    const raw = o.raw
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 300)
  }

  if (httpStatus === 403) {
    return `HTTP ${httpStatus}: forbidden — this API may not be enabled for your TomTom key (Route Monitoring often needs a separate product / Move trial).`
  }
  if (httpStatus === 401) {
    return `HTTP ${httpStatus}: invalid or expired API key.`
  }
  return `HTTP ${httpStatus}: TomTom request failed`
}
