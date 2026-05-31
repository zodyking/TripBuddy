/**
 * Resolve BlueBubbles server URL + password for a request (headers → account prefs → env).
 */

/**
 * @param {import('fastify').FastifyRequest} req
 * @param {{ serverUrl?: string, password?: string } | null | undefined} [accountPrefs]
 */
export function resolveBlueBubblesCredentials(req, accountPrefs = null) {
  const headerUrl = String(req.headers['x-bluebubbles-server-url'] ?? '').trim().replace(/\/+$/, '')
  const headerPw = String(req.headers['x-bluebubbles-password'] ?? '').trim()
  const envUrl = String(process.env.BLUEBUBBLES_BASE_URL || '').trim().replace(/\/+$/, '')
  const envPw = String(process.env.BLUEBUBBLES_PASSWORD || '').trim()
  const prefs = accountPrefs && typeof accountPrefs === 'object' ? accountPrefs : {}

  const serverUrl = headerUrl || String(prefs.serverUrl || '').trim().replace(/\/+$/, '') || envUrl
  const password = headerPw || String(prefs.password || '').trim() || envPw

  return { serverUrl, password }
}

/**
 * Public HTTPS URL for webhooks (respect reverse proxy).
 * @param {import('fastify').FastifyRequest} req
 */
export function getPublicAppUrl(req) {
  const env = (process.env.APP_PUBLIC_URL || process.env.VITE_APP_URL || '').trim().replace(/\/+$/, '')
  if (env) return env
  const protoRaw = req.headers['x-forwarded-proto'] || req.protocol || 'https'
  const proto = String(Array.isArray(protoRaw) ? protoRaw[0] : protoRaw)
    .split(',')[0]
    .trim() || 'https'
  const hostRaw = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const host = String(Array.isArray(hostRaw) ? hostRaw[0] : hostRaw).split(',')[0].trim()
  return `${proto}://${host}`.replace(/\/+$/, '')
}
