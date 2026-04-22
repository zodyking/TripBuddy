import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { API_PORT, UPLOADS_DIR, PERSISTENCE_DATA_ROOT, LOCAL_DIR } from './config.mjs'
import { runDataMigrationOnStartup } from './data-migration.mjs'
import {
  isAuthEnabled,
  createSession,
  destroySession,
  isValidSession,
  getSessionAccountKey,
} from './auth-session.mjs'
import { registerSseConnection } from './session-sse.mjs'
import { verifyAppLoginWithBearerCapture } from './auth-probe.mjs'
import {
  requestAsyncLocalStorage,
  runWithCredentialAccountKey,
} from './request-context.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
import { logBus, emitLog } from './log-bus.mjs'
import {
  runScenario,
  cancelRun,
  openSession,
  closeSession,
  isRunnerBusy,
  getAutomationPreview,
  submitCheckInRetryLocation,
  cancelCheckInRetry,
} from './playwright/runner.mjs'
import { readFlowScripts, writeFlowScripts } from './flow-scripts-store.mjs'
import {
  readAutomations,
  listAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  duplicateAutomation,
  BLOCK_CATEGORIES,
  BLOCK_DEFINITIONS,
  TRIGGER_DEFINITIONS,
  CONDITION_DEFINITIONS,
} from './automations-store.mjs'
import {
  runAutomation,
  isBlockRunnerBusy,
  submitBlockRetryLocation,
  cancelBlockRetry,
  submitBlockInspectField,
  cancelBlockInspectField,
  cancelBlockRun,
} from './playwright/blocks.mjs'
import { listPresets, getPreset } from './automation-presets.mjs'
import {
  getCheckInFlowPayload,
  writeCheckInFlowFromMerged,
} from './check-in-flow-store.mjs'
import { startPoll, stopPoll, getPollStatus } from './poll.mjs'
import { readAssignment, writeAssignment } from './assignment-store.mjs'
import {
  getCredentialsMeta,
  saveCredentials,
  clearCredentials,
  getTractorNumber,
  getLinehaulDriverId,
  getDecryptedLinehaulBearer,
  accountKeyForUsername,
  isAppLoginVerifiedForAccountKey,
  verifyPasswordForAccountKey,
  getUsernameForAccountKey,
  setLastActiveAccountKey,
  writeUserMeta,
} from './credentials-store.mjs'
import {
  captureAndSaveLinehaulBearer,
  isLinehaulCaptureBusy,
} from './playwright/linehaulBearerCapture.mjs'
import {
  linehaulGet,
  linehaulTripStatusByReferenceId,
  linehaulTripsGet,
  linehaulTransportationNetworkLocationGet,
} from './fedex-linehaul-api.mjs'
import { TOOL_SECRET_HINT } from './config.mjs'
import { maybeUpdateAssignmentFromContext } from './assignment-logic.mjs'
import {
  listLocations,
  upsertLocation,
  updateLocationPhone,
} from './locations-directory-store.mjs'
import { appendAccessEntry, listAccessEntries } from './access-log-store.mjs'
import { getClientIp, isPrivateOrLocalIp } from './client-ip.mjs'
import { readGeoFence, writeGeoFence } from './geo-fence-store.mjs'
import {
  getGeoFenceRedirectUrl,
  pointInPolygon,
} from './geo-fence-check.mjs'
import { lookupIpLatLng, reverseGeocodeNominatim } from './ip-geolocation.mjs'

await fs.mkdir(UPLOADS_DIR, { recursive: true })

const app = Fastify({ logger: false })

// origin: true reflects request Origin — needed for EventSource from Vite dev (e.g. localhost:5173) to API :3847/SSE.
await app.register(cors, { origin: true, credentials: true })
await app.register(cookie, {
  secret:
    process.env.FEDEX_TOOL_COOKIE_SECRET ||
    process.env.FEDEX_TOOL_SECRET ||
    'fedextool-cookie-dev-only',
})
await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024 },
})

const COOKIE_NAME = 'fedextool_sid'

/** Propagate Fastify request through AsyncLocalStorage for per-user credential files. */
app.addHook('onRequest', (req, reply, done) => {
  requestAsyncLocalStorage.run(req, done)
})

function shouldSkipGeoFenceForPath(urlPath) {
  const p = urlPath.split('?')[0] || ''
  if (p.startsWith('/assets/')) return true
  const last = p.split('/').pop() || ''
  if (/\.[a-z0-9]{1,10}$/i.test(last)) return true
  return false
}

/**
 * Guests only: redirect on first HTML request for any app route (including `/`, `/login`)
 * if IP is outside the allowed polygon. Skips static assets only.
 */
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'OPTIONS') return
  const path = req.url.split('?')[0] || ''
  if (path.startsWith('/api')) return
  if (shouldSkipGeoFenceForPath(path)) return
  if (!isAuthEnabled()) return
  const sid = req.cookies?.[COOKIE_NAME]
  if (isValidSession(sid)) return
  try {
    const redirectTo = await getGeoFenceRedirectUrl(getClientIp(req))
    if (redirectTo) return reply.redirect(302, redirectTo)
  } catch {
    /* fail open */
  }
})

app.addHook('preHandler', async (req) => {
  const path = req.url.split('?')[0] || ''
  if (!path.startsWith('/api')) return
  if (!isAuthEnabled()) return
  if (path.startsWith('/api/auth/')) return
  if (path === '/api/health') return
  const sid = req.cookies?.[COOKIE_NAME]
  if (isValidSession(sid)) {
    const ak = getSessionAccountKey(sid)
    if (ak) req.credentialAccountKey = ak
    setLastActiveAccountKey(ak)
  }
})

app.addHook('preHandler', async (req, reply) => {
  const path = req.url.split('?')[0] || ''
  if (!path.startsWith('/api')) return
  if (!isAuthEnabled()) return
  if (path === '/api/health') return
  if (path.startsWith('/api/auth/')) return
  if (path === '/api/login/access-log' && req.method === 'POST') return
  if (path === '/api/visit' && req.method === 'POST') return
  if (path === '/api/public/geo-fence-check') return
  const sid = req.cookies?.[COOKIE_NAME]
  if (isValidSession(sid)) return
  return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
})

/**
 * SPA-only geo-fence check (Vite dev has no server hook on HTML).
 * Authenticated clients call this once; returns redirect URL or null.
 */
app.get('/api/public/geo-fence-check', async (req) => {
  if (!isAuthEnabled()) {
    return { ok: true, redirectTo: null }
  }
  const sid = req.cookies?.[COOKIE_NAME]
  if (isValidSession(sid)) {
    return { ok: true, redirectTo: null }
  }
  try {
    const redirectTo = await getGeoFenceRedirectUrl(getClientIp(req))
    return { ok: true, redirectTo }
  } catch {
    return { ok: true, redirectTo: null }
  }
})

app.get('/api/auth/status', async (req) => {
  if (!isAuthEnabled()) {
    return { authEnabled: false, authenticated: true }
  }
  const sid = req.cookies?.[COOKIE_NAME]
  return {
    authEnabled: true,
    authenticated: isValidSession(sid),
  }
})

app.post('/api/auth/login', async (req, reply) => {
  if (!isAuthEnabled()) {
    return { ok: true, authDisabled: true }
  }
  const body = req.body ?? {}
  const usernameRaw = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const username = usernameRaw.trim()
  if (!username || !password) {
    return reply.code(400).send({
      ok: false,
      error: 'Username and password are required.',
    })
  }

  const accountKey = accountKeyForUsername(username)
  if (!accountKey) {
    return reply.code(400).send({ ok: false, error: 'Invalid username.' })
  }

  const alreadyVerified = await isAppLoginVerifiedForAccountKey(accountKey)
  if (alreadyVerified) {
    const pwdOk = await verifyPasswordForAccountKey(accountKey, password)
    const fileUser = (await getUsernameForAccountKey(accountKey)).trim()
    const userMatch = fileUser && fileUser.toLowerCase() === username.toLowerCase()
    if (!pwdOk || !userMatch) {
      return reply.code(401).send({
        ok: false,
        error: 'Wrong username or password.',
      })
    }
    const tokenOk = await runWithCredentialAccountKey(accountKey, async () => {
      const bearer = await getDecryptedLinehaulBearer()
      if (!bearer) return false
      const driverId = await getLinehaulDriverId()
      if (driverId && /^\d+$/.test(driverId)) {
        const r = await linehaulGet('driver', driverId, bearer)
        if (r.status === 200 && r.ok) return true
      }
      const tractor = await getTractorNumber()
      if (tractor && /^\d+$/.test(tractor)) {
        const r = await linehaulGet('tractor', tractor, bearer)
        if (r.status === 200 && r.ok) return true
      }
      return false
    })
    if (tokenOk) {
      await writeUserMeta(accountKey, { appLoginVerified: true })
      setLastActiveAccountKey(accountKey)
      try {
        await runWithCredentialAccountKey(accountKey, () =>
          saveCredentials({ linehaulPollMinutes: 1 }),
        )
      } catch {
        /* non-fatal */
      }
      const id = createSession(accountKey)
      reply.setCookie(COOKIE_NAME, id, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      })
      return { ok: true, fastLogin: true }
    }
    /* Verified user but token expired — refresh via background sign-in below. */
  }

  const result = await runWithCredentialAccountKey(accountKey, () =>
    verifyAppLoginWithBearerCapture({ username, password }),
  )
  if (!result.ok) {
    return reply
      .code(401)
      .send({ ok: false, error: result.error || 'Sign-in failed' })
  }
  await writeUserMeta(accountKey, { appLoginVerified: true })
  setLastActiveAccountKey(accountKey)
  try {
    await runWithCredentialAccountKey(accountKey, () =>
      saveCredentials({ linehaulPollMinutes: 1 }),
    )
  } catch {
    /* non-fatal */
  }
  const id = createSession(accountKey)
  reply.setCookie(COOKIE_NAME, id, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
  })
  return { ok: true }
})

app.post('/api/auth/logout', async (req, reply) => {
  const sid = req.cookies?.[COOKIE_NAME]
  const ak = getSessionAccountKey(sid)
  destroySession(sid)
  reply.clearCookie(COOKIE_NAME, { path: '/' })
  if (ak) {
    try {
      await runWithCredentialAccountKey(ak, () =>
        saveCredentials({ linehaulPollMinutes: 0 }),
      )
    } catch {
      /* non-fatal */
    }
  }
  return { ok: true }
})

/**
 * Pre-login: record client IP + optional browser geolocation for security audit.
 * Does not require session (login page calls this after user shares location).
 */
app.post('/api/login/access-log', async (req, reply) => {
  try {
    const body = req.body ?? {}
    const xf = req.headers['x-forwarded-for']
    const forwardedFor = typeof xf === 'string' ? xf.slice(0, 512) : null
    const ua = req.headers['user-agent']
    const entry = await appendAccessEntry({
      ip: getClientIp(req),
      forwardedFor,
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyM: body.accuracyM,
      locationDenied: body.locationDenied === true,
      userAgent: typeof ua === 'string' ? ua : null,
      source: 'login_ack',
    })
    return { ok: true, id: entry.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

/** First load / SPA entry: record IP only (no session). One row per visit ping from client. */
app.post('/api/visit', async (req) => {
  const xf = req.headers['x-forwarded-for']
  const forwardedFor = typeof xf === 'string' ? xf.slice(0, 512) : null
  const ua = req.headers['user-agent']
  const entry = await appendAccessEntry({
    ip: getClientIp(req),
    forwardedFor,
    latitude: null,
    longitude: null,
    accuracyM: null,
    locationDenied: false,
    userAgent: typeof ua === 'string' ? ua : null,
    source: 'page_visit',
  })
  return { ok: true, id: entry.id }
})

app.get('/api/health', async () => ({
  ok: true,
  busy:
    isRunnerBusy() || isBlockRunnerBusy() || isLinehaulCaptureBusy(),
  /** When null, API uses ephemeral `server/.local` — set FEDEX_TOOL_DATA_DIR for durable shared storage. */
  dataDir: PERSISTENCE_DATA_ROOT,
  localDataPath: LOCAL_DIR,
}))

app.get('/api/status', async () => ({
  busy:
    isRunnerBusy() || isBlockRunnerBusy() || isLinehaulCaptureBusy(),
  poll: getPollStatus(),
}))

app.get('/api/events', async (req, reply) => {
  if (!isAuthEnabled()) {
    return reply.code(503).send({ error: 'Auth disabled' })
  }
  const sid = req.cookies?.[COOKIE_NAME]
  if (!isValidSession(sid)) {
    return reply.code(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
  }
  reply.hijack()
  // Hijacked responses skip @fastify/cors hooks — EventSource from Vite (another origin/port) needs these.
  const origin = req.headers.origin
  /** @type {Record<string, string>} */
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  } else {
    headers['Access-Control-Allow-Origin'] = '*'
  }
  reply.raw.writeHead(200, headers)
  const send = (payload) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    } catch {
      /* client gone */
    }
  }
  send({ type: 'connected', message: 'stream ready', ts: Date.now() })
  const onEntry = (payload) => send(payload)
  logBus.on('entry', onEntry)
  let unregisterSse = () => {}
  if (sid) {
    unregisterSse = registerSseConnection(sid, send)
  }
  req.raw.on('close', () => {
    logBus.off('entry', onEntry)
    unregisterSse()
  })
})

app.get('/api/assignment', async () => {
  await maybeUpdateAssignmentFromContext({ source: 'get' })
  return readAssignment()
})

app.put('/api/assignment', async (req, reply) => {
  try {
    const next = await writeAssignment(req.body ?? {})
    emitLog('assignment', 'Dispatch instructions updated', { source: 'save' })
    return next
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/settings/credentials', async (req) => {
  const meta = await getCredentialsMeta()
  const includeBearer = req.query?.includeLinehaulBearer === '1'
  let fedexLinehaulBearer = null
  if (includeBearer) {
    fedexLinehaulBearer = await getDecryptedLinehaulBearer()
  }
  return {
    ...meta,
    ...(includeBearer ? { fedexLinehaulBearer } : {}),
    secretHint: process.env.FEDEX_TOOL_SECRET ? null : TOOL_SECRET_HINT,
  }
})

app.put('/api/settings/credentials', async (req, reply) => {
  try {
    const meta = await saveCredentials(req.body ?? {})
    return meta
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.delete('/api/settings/credentials', async () => {
  await clearCredentials()
  return { ok: true }
})

app.get('/api/settings/access-log', async () => {
  const entries = await listAccessEntries()
  return { ok: true, entries }
})

function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

app.get('/api/settings/geo-fence', async () => {
  const cfg = await readGeoFence()
  return { ok: true, ...cfg }
})

app.put('/api/settings/geo-fence', async (req, reply) => {
  try {
    const body = req.body ?? {}
    const enabled = body.enabled === true
    const redirectUrl =
      typeof body.redirectUrl === 'string' ? body.redirectUrl.trim() : ''
    if (enabled) {
      if (!isValidHttpUrl(redirectUrl)) {
        return reply.code(400).send({
          error: 'When enabled, provide a valid http(s) redirect URL.',
        })
      }
      if (!Array.isArray(body.polygon)) {
        return reply.code(400).send({ error: 'Polygon array is required when enabled.' })
      }
      const n = body.polygon.filter(
        (p) =>
          p &&
          Number.isFinite(Number(p.lat)) &&
          Number.isFinite(Number(p.lng)),
      ).length
      if (n < 3) {
        return reply.code(400).send({
          error: 'Polygon must have at least three points.',
        })
      }
    }
    const next = await writeGeoFence({
      enabled: body.enabled,
      redirectUrl: body.redirectUrl,
      polygon: body.polygon,
    })
    return { ok: true, ...next }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/settings/geo-fence/preview', async (req, reply) => {
  const body = req.body ?? {}
  const ipRaw =
    typeof body.ip === 'string' && body.ip.trim()
      ? body.ip.trim()
      : getClientIp(req)
  const cfg = await readGeoFence()
  if (cfg.polygon.length < 3) {
    return {
      ok: true,
      ip: ipRaw,
      inside: null,
      reason: 'no_polygon',
      address: null,
      lat: null,
      lng: null,
    }
  }
  if (isPrivateOrLocalIp(ipRaw)) {
    return {
      ok: true,
      ip: ipRaw,
      inside: null,
      reason: 'private_ip',
      address: null,
      lat: null,
      lng: null,
    }
  }
  const pos = await lookupIpLatLng(ipRaw)
  if (!pos) {
    return {
      ok: true,
      ip: ipRaw,
      inside: null,
      reason: 'lookup_failed',
      address: null,
      lat: null,
      lng: null,
    }
  }
  const inside = pointInPolygon(pos.lat, pos.lng, cfg.polygon)
  const address = await reverseGeocodeNominatim(pos.lat, pos.lng)
  return {
    ok: true,
    ip: ipRaw,
    inside,
    reason: 'ok',
    address,
    lat: pos.lat,
    lng: pos.lng,
  }
})

const DIGITS_RE = /^\d+$/

app.get('/api/fedex/linehaul/tractor', async (req, reply) => {
  const tractor =
    typeof req.query?.tractor === 'string' && req.query.tractor.trim()
      ? req.query.tractor.trim()
      : await getTractorNumber()
  if (!tractor || !DIGITS_RE.test(tractor)) {
    return reply.code(400).send({
      error:
        'Set tractor number in Settings (digits only), or pass ?tractor= for a one-off test.',
    })
  }
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return reply.code(401).send({
      error:
        'No FedEx Linehaul bearer token on file. Use Settings → Capture Linehaul token, or save a token under Driver Credentials.',
    })
  }
  const result = await linehaulGet('tractor', tractor, bearer)
  return reply.code(result.status).send({
    ok: result.ok,
    status: result.status,
    body: result.body,
  })
})

app.get('/api/fedex/linehaul/driver', async (req, reply) => {
  const driverId =
    typeof req.query?.driver === 'string' && req.query.driver.trim()
      ? req.query.driver.trim()
      : await getLinehaulDriverId()
  if (!driverId || !DIGITS_RE.test(driverId)) {
    return reply.code(400).send({
      error:
        'Set Username / Driver ID in Settings (digits only), or pass ?driver= for a one-off test.',
    })
  }
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return reply.code(401).send({
      error:
        'No FedEx Linehaul bearer token on file. Use Settings → Capture Linehaul token, or save a token under Driver Credentials.',
    })
  }
  const result = await linehaulGet('driver', driverId, bearer)
  return reply.code(result.status).send({
    ok: result.ok,
    status: result.status,
    body: result.body,
  })
})

app.get('/api/fedex/linehaul/trip-status', async (req, reply) => {
  const referenceId =
    typeof req.query?.referenceId === 'string' && req.query.referenceId.trim()
      ? req.query.referenceId.trim()
      : ''
  if (!referenceId || !DIGITS_RE.test(referenceId)) {
    return reply.code(400).send({
      error:
        'Pass referenceId (digits only), e.g. from driver id + tractor NBR + location id.',
    })
  }
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return reply.code(401).send({
      error:
        'No FedEx Linehaul bearer token on file. Use Settings → Capture Linehaul token, or save a token under Driver Credentials.',
    })
  }
  const result = await linehaulTripStatusByReferenceId(referenceId, bearer)
  return reply.code(result.status).send({
    ok: result.ok,
    status: result.status,
    body: result.body,
  })
})

app.get('/api/fedex/linehaul/trips', async (req, reply) => {
  const q = req.query ?? {}
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return reply.code(401).send({
      error:
        'No FedEx Linehaul bearer token on file. Use Settings → Capture Linehaul token, or save a token under Driver Credentials.',
    })
  }

  const legSeqRaw =
    typeof q.dailyTripLegSequence === 'string' && q.dailyTripLegSequence.trim()
      ? q.dailyTripLegSequence.trim()
      : ''
  const alreadyCalledRaw = q.alreadyCalled
  const alreadyCalled =
    alreadyCalledRaw === undefined || alreadyCalledRaw === ''
      ? 'false'
      : String(alreadyCalledRaw)

  /** Dispatch-era trip snapshot: same upstream path, query `dailyTripLegSequence` + `alreadyCalled` only. */
  if (legSeqRaw && DIGITS_RE.test(legSeqRaw)) {
    const sp = new URLSearchParams()
    sp.set('dailyTripLegSequence', legSeqRaw)
    sp.set('alreadyCalled', alreadyCalled)

    let originIdHeader =
      typeof q.originId === 'string' && q.originId.trim() ? q.originId.trim() : ''
    if (!originIdHeader) {
      let tractorNbr =
        typeof q.tractorNbr === 'string' && q.tractorNbr.trim()
          ? q.tractorNbr.trim()
          : await getTractorNumber()
      if (tractorNbr && DIGITS_RE.test(tractorNbr)) {
        const tr = await linehaulGet('tractor', tractorNbr, bearer)
        const lid = tr.body?.locationId
        if (lid != null && String(lid).trim() !== '') {
          originIdHeader = String(lid).trim()
        }
      }
    }

    const result = await linehaulTripsGet(sp.toString(), bearer, {
      originId: originIdHeader || undefined,
    })

    if (result.status === 204) {
      return reply.code(200).send({
        ok: true,
        status: 204,
        body: null,
        noActiveTrip: true,
      })
    }

    return reply.code(result.status).send({
      ok: result.ok,
      status: result.status,
      body: result.body,
    })
  }

  let driverId =
    typeof q.driverId === 'string' && q.driverId.trim()
      ? q.driverId.trim()
      : await getLinehaulDriverId()
  let tractorNbr =
    typeof q.tractorNbr === 'string' && q.tractorNbr.trim()
      ? q.tractorNbr.trim()
      : await getTractorNumber()
  let locationId =
    typeof q.locationId === 'string' && q.locationId.trim()
      ? q.locationId.trim()
      : ''

  if (!driverId || !DIGITS_RE.test(driverId)) {
    return reply.code(400).send({
      error:
        'Set Username / Driver ID (digits) in Settings, or pass ?driverId= for tests.',
    })
  }
  if (!tractorNbr || !DIGITS_RE.test(tractorNbr)) {
    return reply.code(400).send({
      error:
        'Set tractor number in Settings (digits), or pass ?tractorNbr= for tests.',
    })
  }

  if (!locationId) {
    const tr = await linehaulGet('tractor', tractorNbr, bearer)
    const lid = tr.body?.locationId
    if (lid != null && String(lid).trim() !== '') {
      locationId = String(lid).trim()
    }
  }
  if (!locationId || !DIGITS_RE.test(locationId)) {
    return reply.code(400).send({
      error:
        'Need locationId (pass ?locationId= or ensure tractor API returns locationId for your tractor).',
    })
  }

  const status =
    typeof q.status === 'string' && q.status.trim() ? q.status.trim() : 'APRVD'

  const sp = new URLSearchParams()
  sp.set('driverId', driverId)
  sp.set('locationId', locationId)
  sp.set('tractorNbr', tractorNbr)
  sp.set('status', status)
  sp.set('alreadyCalled', alreadyCalled)

  const originIdHeader =
    typeof q.originId === 'string' && q.originId.trim()
      ? q.originId.trim()
      : locationId

  const result = await linehaulTripsGet(sp.toString(), bearer, {
    originId: originIdHeader,
  })

  // Upstream returns 204 when there is no trip payload (no active trip). Fastify cannot attach JSON to
  // 204 — normalize to 200 so the UI can show "no active trip" without treating it as an error.
  if (result.status === 204) {
    return reply.code(200).send({
      ok: true,
      status: 204,
      body: null,
      noActiveTrip: true,
    })
  }

  return reply.code(result.status).send({
    ok: result.ok,
    status: result.status,
    body: result.body,
  })
})

app.get('/api/fedex/linehaul/locations/:locationId', async (req, reply) => {
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return reply.code(401).send({
      error:
        'No FedEx Linehaul bearer token on file. Use Settings → Capture Linehaul token, or save a token under Driver Credentials.',
    })
  }

  const rawId = req.params?.locationId
  const locationId =
    typeof rawId === 'string' ? rawId.trim() : rawId != null ? String(rawId).trim() : ''
  if (!locationId || !DIGITS_RE.test(locationId)) {
    return reply.code(400).send({
      error: 'locationId must be digits only.',
    })
  }

  const q = req.query ?? {}
  let originId =
    typeof q.originId === 'string' && q.originId.trim() ? q.originId.trim() : ''

  if (!originId) {
    const tractorNbr = await getTractorNumber()
    if (tractorNbr && DIGITS_RE.test(String(tractorNbr).trim())) {
      const tr = await linehaulGet('tractor', String(tractorNbr).trim(), bearer)
      const lid = tr.body?.locationId
      if (lid != null && String(lid).trim() !== '') {
        originId = String(lid).trim()
      }
    }
  }

  const result = await linehaulTransportationNetworkLocationGet(locationId, bearer, {
    originId,
  })
  return reply.code(result.status).send({
    ok: result.ok,
    status: result.status,
    body: result.body,
  })
})

// ---------------------------------------------------------------------------
// Location Directory
// ---------------------------------------------------------------------------
app.get('/api/directory', async () => {
  const locations = await listLocations()
  return { ok: true, locations }
})

app.post('/api/directory', async (req, reply) => {
  try {
    const data = req.body ?? {}
    if (!data.locationId) {
      return reply.code(400).send({ error: 'locationId is required' })
    }
    const result = await upsertLocation(data)
    return { ok: true, ...result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.patch('/api/directory/:locationId', async (req, reply) => {
  try {
    const rawId = req.params?.locationId
    const locationId =
      typeof rawId === 'string'
        ? rawId.trim()
        : rawId != null
          ? String(rawId).trim()
          : ''
    if (!locationId) {
      return reply.code(400).send({ error: 'locationId is required' })
    }
    const body = req.body ?? {}
    const phone = typeof body.phone === 'string' ? body.phone : ''
    const result = await updateLocationPhone(locationId, phone)
    return { ok: true, ...result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = /not found/i.test(msg) ? 404 : 400
    return reply.code(code).send({ error: msg })
  }
})

app.post('/api/fedex/linehaul/capture-bearer', async (req, reply) => {
  if (isRunnerBusy() || isBlockRunnerBusy() || isLinehaulCaptureBusy()) {
    return reply.code(409).send({
      error: 'Runner or Linehaul capture busy — try again shortly.',
    })
  }
  const body = req.body ?? {}
  const headless = body.headless !== false
  const tryOktaLogin = body.tryOktaLogin !== false
  const clearSession = body.clearSession !== false
  const bypassValidityProbe = body.bypassValidityProbe === true
  const sid = req.cookies?.[COOKIE_NAME]
  const ak = getSessionAccountKey(sid)
  try {
    const runCapture = () =>
      captureAndSaveLinehaulBearer({
        headless,
        tryOktaLogin,
        clearSession,
        bypassValidityProbe,
      })
    const result = ak
      ? await runWithCredentialAccountKey(ak, runCapture)
      : await runCapture()
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitLog('error', msg)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.get('/api/settings/check-in-flow', async () => getCheckInFlowPayload())

app.put('/api/settings/check-in-flow', async (req, reply) => {
  try {
    await writeCheckInFlowFromMerged(req.body ?? {})
    return await getCheckInFlowPayload()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/session/open', async (req, reply) => {
  if (isRunnerBusy()) {
    return reply.code(409).send({ error: 'Runner busy' })
  }
  const { headless = false, slowMo = 0, tryOktaLogin = false } = req.body ?? {}
  try {
    await openSession({ headless, slowMo, tryOktaLogin })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitLog('error', msg)
    return reply.code(500).send({ error: msg })
  }
})

app.post('/api/session/close', async () => {
  await closeSession()
  return { ok: true }
})

app.post('/api/run', async (req, reply) => {
  if (isRunnerBusy()) {
    return reply.code(409).send({ error: 'Runner busy' })
  }
  const {
    scenario,
    headless = true,
    slowMo = 0,
    values = {},
    valueOrder,
    tryOktaLogin = false,
  } = req.body ?? {}
  if (!scenario || typeof scenario !== 'string') {
    return reply.code(400).send({ error: 'scenario required' })
  }
  if (scenario === 'check_in') {
    const tractor = await getTractorNumber()
    if (!tractor) {
      return reply
        .code(400)
        .send({ error: 'Set tractor number in Settings' })
    }
    const a = await readAssignment()
    if (!(a.driverPhone || '').trim()) {
      return reply.code(400).send({
        error: 'Set driver phone (Driver Credentials in Settings) before Check in',
      })
    }
  }
  try {
    const result = await runScenario({
      scenario,
      headless,
      slowMo,
      values,
      valueOrder,
      closeAfter: true,
      tryOktaLogin: Boolean(tryOktaLogin),
    })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(500).send({ error: msg })
  }
})

app.post('/api/run/cancel', async () => {
  cancelRun()
  return { ok: true }
})

/** In-browser check-in: supply new location while POST /api/run is waiting (same Playwright session). */
app.post('/api/run/retry-location', async (req, reply) => {
  const { runId, location } = req.body ?? {}
  if (!runId || typeof runId !== 'string') {
    return reply.code(400).send({ error: 'runId required' })
  }
  const loc = typeof location === 'string' ? location.trim() : ''
  if (!loc) {
    return reply.code(400).send({ error: 'location required' })
  }
  try {
    await writeAssignment({ tractorLocation: loc })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
  let r = submitCheckInRetryLocation(runId, loc)
  if (!r.ok) {
    r = submitBlockRetryLocation(runId, loc)
  }
  if (!r.ok) return reply.code(400).send(r)
  return { ok: true }
})

/** In-browser Inspect & Check Out: supply dolly / seal / trailer value while automation waits. */
app.post('/api/run/retry-inspect-field', async (req, reply) => {
  const { runId, value } = req.body ?? {}
  if (!runId || typeof runId !== 'string') {
    return reply.code(400).send({ error: 'runId required' })
  }
  const r = submitBlockInspectField(runId, typeof value === 'string' ? value : String(value ?? ''))
  if (!r.ok) return reply.code(400).send(r)
  return { ok: true }
})

/** Cancel waiting for in-browser location retry; aborts the run. */
app.post('/api/run/cancel-retry', async (req, reply) => {
  const { runId } = req.body ?? {}
  if (!runId || typeof runId !== 'string') {
    return reply.code(400).send({ error: 'runId required' })
  }
  let r = cancelCheckInRetry(runId)
  if (!r.ok) {
    r = cancelBlockRetry(runId)
    if (!r.ok) {
      r = cancelBlockInspectField(runId)
      if (r.ok) cancelBlockRun()
    } else {
      cancelBlockRun()
    }
  } else {
    cancelRun()
  }
  if (!r.ok) return reply.code(400).send(r)
  return { ok: true }
})

app.post('/api/poll/start', async (req, reply) => {
  const { headless = true } = req.body ?? {}
  const r = startPoll({ headless })
  if (!r.ok) return reply.code(400).send(r)
  return r
})

app.post('/api/poll/stop', async () => stopPoll())

app.get('/api/poll/status', async () => getPollStatus())

app.get('/api/settings/flow-scripts', async () => readFlowScripts())

app.put('/api/settings/flow-scripts', async (req, reply) => {
  try {
    return await writeFlowScripts(req.body ?? {})
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/automation/preview', async () => getAutomationPreview())

app.get('/api/automations/schema', async () => ({
  categories: BLOCK_CATEGORIES,
  blocks: BLOCK_DEFINITIONS,
  triggers: TRIGGER_DEFINITIONS,
  conditions: CONDITION_DEFINITIONS,
}))

app.get('/api/automations', async () => listAutomations())

app.post('/api/automations', async (req, reply) => {
  try {
    const auto = await createAutomation(req.body ?? {})
    return auto
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/automations/:id', async (req, reply) => {
  const auto = await getAutomation(req.params.id)
  if (!auto) return reply.code(404).send({ error: 'Automation not found' })
  return auto
})

app.put('/api/automations/:id', async (req, reply) => {
  try {
    const auto = await updateAutomation(req.params.id, req.body ?? {})
    return auto
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.delete('/api/automations/:id', async (req, reply) => {
  try {
    return await deleteAutomation(req.params.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/automations/:id/duplicate', async (req, reply) => {
  try {
    return await duplicateAutomation(req.params.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/automations/:id/run', async (req, reply) => {
  if (isRunnerBusy() || isBlockRunnerBusy()) {
    return reply.code(409).send({ error: 'Runner busy' })
  }
  const auto = await getAutomation(req.params.id)
  if (!auto) return reply.code(404).send({ error: 'Automation not found' })
  const { headless = true, slowMo = 0 } = req.body ?? {}
  try {
    const result = await runAutomation(auto, { headless, slowMo })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    emitLog('error', msg)
    return reply.code(500).send({ error: msg })
  }
})

app.get('/api/automations/presets', async () => listPresets())

app.post('/api/automations/presets/:presetId/install', async (req, reply) => {
  console.log(`[presets/install] presetId=${req.params.presetId}`)
  const preset = getPreset(req.params.presetId)
  if (!preset) {
    console.log(`[presets/install] preset not found: ${req.params.presetId}`)
    return reply.code(404).send({ error: 'Preset not found' })
  }
  try {
    console.log(`[presets/install] creating automation from preset:`, preset.name)
    const auto = await createAutomation(preset)
    console.log(`[presets/install] created automation id=${auto.id}`)
    return auto
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[presets/install] error:`, msg)
    return reply.code(400).send({ error: msg })
  }
})

// ---------------------------------------------------------------------------
// Production static UI serving (after all /api routes)
// ---------------------------------------------------------------------------
console.log(`DIST_DIR resolved to: ${DIST_DIR}`)
const distExists = await fs.stat(DIST_DIR).then(() => true, () => false)
console.log(`dist folder exists: ${distExists}`)

if (distExists) {
  await app.register(fastifyStatic, {
    root: DIST_DIR,
    prefix: '/',
  })
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ error: 'Not found' })
  })
} else {
  console.error(`WARNING: dist folder not found at ${DIST_DIR}`)
  app.get('/', async (req, reply) => {
    return reply.code(503).send({
      error: 'UI not available',
      detail: `dist folder not found at ${DIST_DIR}`,
      hint: 'The Vue build may have failed or the Dockerfile did not copy dist correctly',
    })
  })
}

const host = process.env.FEDEX_TOOL_API_HOST ?? '127.0.0.1'

try {
  await runDataMigrationOnStartup()
} catch (e) {
  console.error('[data-migration]', e)
}

try {
  await app.listen({ port: API_PORT, host })
  const url = `http://${host}:${API_PORT}`
  console.log(`FedEx tool API listening on ${url}`)
  emitLog('info', `FedEx tool API listening on ${url}`)
} catch (e) {
  console.error(e)
  process.exit(1)
}
