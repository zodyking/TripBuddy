/**
 * Client IP from X-Forwarded-For or socket (shared by access log, geo fence).
 * @param {import('fastify').FastifyRequest} req
 */
export function getClientIp(req) {
  const xf = req.headers['x-forwarded-for']
  const raw = typeof xf === 'string' ? xf.split(',')[0].trim() : ''
  if (raw) return raw
  return req.ip || req.socket?.remoteAddress || ''
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrLocalIp(ip) {
  if (!ip || typeof ip !== 'string') return true
  const s = ip.trim()
  if (s === '::1' || s === '::ffff:127.0.0.1') return true
  if (s.startsWith('127.')) return true
  if (s === 'localhost') return true
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return false
}
