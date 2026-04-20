/**
 * Same-origin reverse proxy for Trip Buddy iframe.
 * FedEx sends X-Frame-Options / CSP that block third-party iframes; serving under our
 * origin strips those headers so the app can embed. HTML/CSS/JS URLs are rewritten to
 * stay on /embed/trip-buddy/...
 */

import { DISPATCH_ENTRY_URL } from './config.mjs'

const DEFAULT_UPSTREAM = (() => {
  try {
    return new URL(DISPATCH_ENTRY_URL).origin
  } catch {
    return 'https://fdxtools.fedex.com'
  }
})()

const DEFAULT_ENTRY_PATH = (() => {
  try {
    const u = new URL(DISPATCH_ENTRY_URL)
    return u.pathname + u.search || '/grdlhldispatch/home'
  } catch {
    return '/grdlhldispatch/home'
  }
})()

/** Upstream origin (no trailing slash). */
export const TRIP_BUDDY_UPSTREAM = (
  process.env.FEDEX_TRIP_BUDDY_UPSTREAM || DEFAULT_UPSTREAM
).replace(/\/$/, '')

/** Public path prefix on our server (no trailing slash). */
export const TRIP_BUDDY_PROXY_PREFIX = (
  process.env.FEDEX_TRIP_BUDDY_PROXY_PREFIX || '/embed/trip-buddy'
).replace(/\/$/, '')

/** When the iframe loads /embed/trip-buddy, fetch this FedEx path. */
export const TRIP_BUDDY_ENTRY_PATH =
  (process.env.FEDEX_TRIP_BUDDY_ENTRY_PATH || DEFAULT_ENTRY_PATH).trim() || '/grdlhldispatch/home'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function stripHop(name) {
  return HOP_BY_HOP.has(name.toLowerCase())
}

/**
 * @param {string} path
 */
export function isTripBuddyProxyPath(path) {
  const p = path.split('?')[0] || ''
  return p === TRIP_BUDDY_PROXY_PREFIX || p.startsWith(`${TRIP_BUDDY_PROXY_PREFIX}/`)
}

/**
 * @param {string} proxyPath path only (no query)
 * @param {string} searchWithQuestion e.g. ?a=1 or ''
 */
export function upstreamUrlFromProxyPath(proxyPath, searchWithQuestion) {
  let rest = proxyPath.slice(TRIP_BUDDY_PROXY_PREFIX.length)
  if (rest === '' || rest === '/') {
    rest = TRIP_BUDDY_ENTRY_PATH.startsWith('/') ? TRIP_BUDDY_ENTRY_PATH : `/${TRIP_BUDDY_ENTRY_PATH}`
  } else if (!rest.startsWith('/')) {
    rest = `/${rest}`
  }
  return `${TRIP_BUDDY_UPSTREAM}${rest}${searchWithQuestion}`
}

const FEDEX_TOOL_HOSTS = [
  'fdxtools.fedex.com',
  'www.fdxtools.fedex.com',
]

/**
 * Root-relative FedEx paths (e.g. `/grdlhldispatch/...`) must go under the proxy prefix
 * or the browser loads them from our SPA origin and assets 404 / hydrate wrong → blank iframe.
 * @param {string} text
 * @param {string} prefix
 */
export function rewriteRootRelativeFedExPaths(text, prefix) {
  const esc = '\uE000TRIPBUDDY\uE001'
  const already = `${prefix}/grdlhldispatch`
  let s = text
  s = s.split(already).join(esc)
  s = s.replace(/\/grdlhldispatch/g, `${prefix}/grdlhldispatch`)
  s = s.split(esc).join(already)
  return s
}

/**
 * Inline CSP in HTML can still block scripts/styles inside the iframe.
 * @param {string} html
 */
function stripMetaContentSecurityPolicy(html) {
  return html.replace(
    /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?\s*Content-Security-Policy\s*["']?[^>]*>/gi,
    '',
  )
}

/**
 * FedEx SPA uses `<base href="/grdlhldispatch/">` so relative chunk URLs resolve from site root.
 * Under our proxy they must be `/embed/trip-buddy/grdlhldispatch/` or assets load from the wrong path → blank page.
 * @param {string} html
 * @param {string} prefix
 */
export function rewriteHtmlBaseHref(html, prefix) {
  const baseRe = /<base\s+([^>]*\bhref\s*=\s*)(["'])([^"']*)\2([^>]*)>/gi
  return html.replace(baseRe, (full, before, q, href, after) => {
    let h = String(href).trim()
    if (h.startsWith(prefix)) return full
    if (h === '/' || h === '') {
      h = `${prefix}/`
    } else if (h.startsWith('/')) {
      h = `${prefix}${h}`
    } else {
      h = `${prefix}/${h}`
    }
    if (!h.endsWith('/') && !h.includes('?')) h += '/'
    return `<base ${before}${q}${h}${q}${after}>`
  })
}

/**
 * Point same-origin links at our proxy path instead of https://fdxtools.fedex.com/...
 * @param {string} text
 * @param {string | undefined} contentType
 */
export function rewriteTripBuddyUrls(text, contentType) {
  const p = TRIP_BUDDY_PROXY_PREFIX
  let s = text
  for (const host of FEDEX_TOOL_HOSTS) {
    s = s.split(`https://${host}`).join(p)
    s = s.split(`http://${host}`).join(p)
    s = s.split(`//${host}`).join(p)
    const escHost = host.replace(/\./g, '\\.')
    s = s.replace(new RegExp(`https:\\\\/\\\\/${escHost}`, 'g'), p.replace(/\//g, '\\/'))
  }
  s = rewriteRootRelativeFedExPaths(s, p)
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('text/html')) {
    s = stripMetaContentSecurityPolicy(s)
    s = rewriteHtmlBaseHref(s, p)
  }
  return s
}

/** Cookie names to never forward to FedEx (our app session). */
const STRIP_OUTBOUND_COOKIE_NAMES = new Set(
  (process.env.FEDEX_TRIP_BUDDY_STRIP_COOKIES || 'fedextool_sid')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

/**
 * @param {string | undefined} cookieHeader
 */
export function sanitizeCookieHeaderForUpstream(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return undefined
  const pairs = cookieHeader.split(';').map((x) => x.trim()).filter(Boolean)
  const kept = []
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    const name = (eq === -1 ? pair : pair.slice(0, eq)).trim().toLowerCase()
    if (STRIP_OUTBOUND_COOKIE_NAMES.has(name)) continue
    kept.push(pair)
  }
  return kept.length ? kept.join('; ') : undefined
}

/**
 * Make upstream Set-Cookie work for our host (strip Domain) and align Path with /embed/trip-buddy/...
 * so the browser sends cookies on nested proxied paths.
 * @param {string} line
 */
export function rewriteSetCookieForProxy(line) {
  let s = String(line)
  s = s.replace(/;\s*Domain=[^;]*/gi, '')
  const prefix = TRIP_BUDDY_PROXY_PREFIX
  s = s.replace(/;\s*Path=([^;]*)/gi, (_m, p) => {
    const pathVal = String(p).trim()
    if (!pathVal || pathVal === '/') {
      return `; Path=${prefix}`
    }
    if (pathVal.startsWith(prefix)) {
      return `; Path=${pathVal}`
    }
    const tail = pathVal.startsWith('/') ? pathVal : `/${pathVal}`
    return `; Path=${prefix}${tail}`
  })
  if (!/;\s*Path=/i.test(s)) {
    s += `; Path=${prefix}`
  }
  return s
}

function shouldRewriteResponseBody(ct) {
  if (!ct) return false
  const low = ct.toLowerCase()
  return (
    low.includes('text/html') ||
    low.includes('text/css') ||
    low.includes('javascript') ||
    low.includes('application/json') ||
    low.includes('text/plain') ||
    low.includes('application/xml') ||
    low.includes('text/xml')
  )
}

function stripFrameBlocking(reply) {
  reply.removeHeader('x-frame-options')
  reply.removeHeader('content-security-policy')
  reply.removeHeader('content-security-policy-report-only')
}

function rewriteLocationHeader(loc) {
  const u = loc.trim()
  if (!u) return u
  try {
    const base = new URL(TRIP_BUDDY_UPSTREAM)
    const parsed = new URL(u, base)
    if (parsed.origin !== base.origin) return u
    return `${TRIP_BUDDY_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    if (u.startsWith('/')) return `${TRIP_BUDDY_PROXY_PREFIX}${u}`
    return u
  }
}

/**
 * Body for fetch: Fastify may have already parsed JSON into req.body.
 * @param {import('fastify').FastifyRequest} req
 */
async function bodyForUpstream(req) {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return undefined
  if (req.body !== undefined && req.body !== null) {
    const ct = (req.headers['content-type'] || '').toLowerCase()
    if (typeof req.body === 'string') return req.body
    if (Buffer.isBuffer(req.body)) return req.body
    if (ct.includes('application/json')) return JSON.stringify(req.body)
    if (typeof req.body === 'object') return JSON.stringify(req.body)
    return String(req.body)
  }
  const chunks = []
  for await (const chunk of req.raw) {
    chunks.push(chunk)
  }
  const buf = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))))
  return buf.length ? buf : undefined
}

/**
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @param {string} targetUrl
 */
async function proxyToUpstream(req, reply, targetUrl) {
  const method = req.method.toUpperCase()
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) {
    return reply.code(405).send({ error: 'Method not allowed' })
  }

  /** @type {Record<string, string>} */
  const outHeaders = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    const lk = k.toLowerCase()
    if (stripHop(lk) || lk === 'host') continue
    if (lk === 'cookie') {
      const raw = Array.isArray(v) ? v.join('; ') : String(v)
      const cleaned = sanitizeCookieHeaderForUpstream(raw)
      if (cleaned) outHeaders.cookie = cleaned
      continue
    }
    outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  outHeaders.host = new URL(TRIP_BUDDY_UPSTREAM).host

  /** @type {RequestInit} */
  const init = {
    method,
    headers: outHeaders,
    redirect: 'manual',
  }

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const b = await bodyForUpstream(req)
    if (b !== undefined) init.body = b
  }

  let res
  try {
    res = await fetch(targetUrl, init)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(502).send({ error: 'Upstream fetch failed', detail: msg })
  }

  const status = res.status
  stripFrameBlocking(reply)

  const setCookieList =
    typeof res.getSetCookie === 'function' ? res.getSetCookie() : null

  res.headers.forEach((value, key) => {
    const lk = key.toLowerCase()
    if (stripHop(lk)) return
    if (lk === 'set-cookie') {
      return
    }
    if (
      lk === 'x-frame-options' ||
      lk === 'content-security-policy' ||
      lk === 'content-security-policy-report-only'
    ) {
      return
    }
    if (lk === 'location') {
      reply.header(key, rewriteLocationHeader(value))
      return
    }
    reply.header(key, value)
  })

  if (setCookieList && setCookieList.length) {
    for (const c of setCookieList) {
      reply.header('set-cookie', rewriteSetCookieForProxy(c))
    }
  } else {
    const single = res.headers.get('set-cookie')
    if (single) reply.header('set-cookie', rewriteSetCookieForProxy(single))
  }

  reply.code(status)

  if (method === 'HEAD' || status === 204 || status === 304) {
    return reply.send()
  }

  const ct = res.headers.get('content-type') || ''
  if (!shouldRewriteResponseBody(ct)) {
    const buf = Buffer.from(await res.arrayBuffer())
    return reply.send(buf)
  }

  const text = await res.text()
  return reply.send(rewriteTripBuddyUrls(text, ct))
}

/**
 * Register proxy routes — must be registered before static file handler.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerTripBuddyProxy(app) {
  const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

  async function handler(req, reply) {
    const pathOnly = req.url.split('?')[0] || ''
    const search = req.url.includes('?') ? `?${req.url.split('?').slice(1).join('?')}` : ''
    if (!isTripBuddyProxyPath(pathOnly)) {
      return reply.code(404).send({ error: 'Not found' })
    }
    const target = upstreamUrlFromProxyPath(pathOnly, search)
    return proxyToUpstream(req, reply, target)
  }

  app.route({
    method: methods,
    url: TRIP_BUDDY_PROXY_PREFIX,
    handler,
  })
  app.route({
    method: methods,
    url: `${TRIP_BUDDY_PROXY_PREFIX}/*`,
    handler,
  })
}
