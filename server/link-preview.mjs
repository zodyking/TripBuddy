const META_RE =
  /<meta\s+[^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi
const META_RE_ALT =
  /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*>/gi
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i

/**
 * @param {string} urlString
 */
export function isAllowedLinkPreviewUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (!host || host === 'localhost' || host.endsWith('.local')) return false
    if (
      /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^0\./.test(host)
    ) {
      return false
    }
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (a === 172 && b >= 16 && b <= 31) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} html
 * @param {string} key
 */
function readMeta(html, key) {
  const want = key.toLowerCase()
  for (const re of [META_RE, META_RE_ALT]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(html)) !== null) {
      const k = String(m[1] || '').toLowerCase()
      const v = String(m[2] || '').trim()
      if (k === want && v) return v
      const k2 = String(m[2] || '').toLowerCase()
      const v2 = String(m[1] || '').trim()
      if (k2 === want && v2) return v2
    }
  }
  return ''
}

/**
 * @param {string} baseUrl
 * @param {string} maybeRelative
 */
function absolutizeUrl(baseUrl, maybeRelative) {
  const raw = String(maybeRelative || '').trim()
  if (!raw) return ''
  try {
    return new URL(raw, baseUrl).href
  } catch {
    return raw
  }
}

/**
 * @param {string} url
 */
export async function fetchLinkPreview(url) {
  if (!isAllowedLinkPreviewUrl(url)) {
    return { ok: false, error: 'URL not allowed' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 9000)
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; TripBuddyLinkPreview/1.0)',
      },
    })
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.status}` }
    }
    const ct = String(r.headers.get('content-type') || '').toLowerCase()
    if (ct && !ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return {
        ok: true,
        url,
        title: '',
        description: '',
        image: '',
        siteName: '',
      }
    }
    const html = (await r.text()).slice(0, 512_000)
    const title = readMeta(html, 'og:title') || readMeta(html, 'twitter:title')
    const description =
      readMeta(html, 'og:description') || readMeta(html, 'twitter:description')
    const image =
      absolutizeUrl(url, readMeta(html, 'og:image') || readMeta(html, 'twitter:image'))
    const siteName = readMeta(html, 'og:site_name')
    const titleMatch = html.match(TITLE_RE)
    const fallbackTitle = titleMatch ? String(titleMatch[1] || '').trim() : ''
    return {
      ok: true,
      url,
      title: title || fallbackTitle,
      description,
      image,
      siteName,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}
