/** Detect http(s) URLs in message text (trailing punctuation trimmed). */
const URL_IN_TEXT_RE =
  /https?:\/\/[^\s<>"']+/gi

const TRAILING_PUNCT_RE = /[.,;:!?)}\]]+$/

/**
 * @param {string} raw
 */
export function normalizeUrlToken(raw) {
  return String(raw || '').replace(TRAILING_PUNCT_RE, '')
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractUrlsFromText(text) {
  const src = String(text || '')
  if (!src.trim()) return []
  const found = src.match(URL_IN_TEXT_RE) || []
  const seen = new Set()
  const out = []
  for (const token of found) {
    const url = normalizeUrlToken(token)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/**
 * @param {string} text
 */
export function isLinkOnlyMessage(text) {
  const src = String(text || '').trim()
  if (!src) return false
  const urls = extractUrlsFromText(src)
  if (!urls.length) return false
  let rest = src
  for (const u of urls) {
    rest = rest.split(u).join(' ')
  }
  rest = rest.replace(URL_IN_TEXT_RE, '').trim()
  return !rest
}

/**
 * @param {string} text
 */
export function primaryUrlFromText(text) {
  return extractUrlsFromText(text)[0] || ''
}

/**
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'url', value: string }>}
 */
export function parseMessageTextSegments(text) {
  const src = String(text || '')
  if (!src) return []
  /** @type {Array<{ type: 'text' | 'url', value: string }>} */
  const segments = []
  let last = 0
  const re = new RegExp(URL_IN_TEXT_RE.source, 'gi')
  let match
  while ((match = re.exec(src)) !== null) {
    const raw = match[0]
    const url = normalizeUrlToken(raw)
    const start = match.index
    if (start > last) {
      segments.push({ type: 'text', value: src.slice(last, start) })
    }
    segments.push({ type: 'url', value: url })
    last = start + raw.length
  }
  if (last < src.length) {
    segments.push({ type: 'text', value: src.slice(last) })
  }
  return segments
}

/**
 * @param {string} url
 */
export function linkPreviewHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}
