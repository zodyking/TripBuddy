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
import { requirePostgresOrThrow } from './kv-pg.mjs'
import { getDataAccountKey } from './scope-kv.mjs'
import {
  ensureUserProfileTable,
  getTomtomApiKeyForAccount,
  setTomtomApiKeyForAccount,
  getHereApiKeyForAccount,
  setHereApiKeyForAccount,
  getNy511ApiKeyForAccount,
  setNy511ApiKeyForAccount,
  getOpenrouterApiKeyForAccount,
  setOpenrouterApiKeyForAccount,
  getOpenrouterModelForAccount,
  setOpenrouterModelForAccount,
  getSenderNameTranslationsForAccount,
  mergeSenderNameTranslationsForAccount,
  getGwbUpperCamYoutubeUrlForAccount,
  setGwbUpperCamYoutubeUrlForAccount,
  getHelpersAutoArrivePrefsForAccount,
  setHelpersAutoArrivePrefsForAccount,
  getWahaPrefsForAccount,
  setWahaPrefsForAccount,
  getBlueBubblesPrefsForAccount,
  setBlueBubblesPrefsForAccount,
  resolveBlueBubblesWebhookAccount,
  getSmtpPrefsForAccount,
  setSmtpPrefsForAccount,
} from './user-profile-pg.mjs'
import { sanitizeTomtomApiKey } from './tomtom-key.mjs'
import { sanitizeHereApiKey } from './here-traffic-api.mjs'
import { extractYoutubeVideoIdFromInput } from '../src/utils/youtubeVideoId.js'
import {
  isAuthEnabled,
  createSession,
  destroySession,
  isValidSession,
  getSessionAccountKey,
  getActiveSessionIdsForAccount,
  revokeSessionsForAccount,
  revokeAllSessionsForAccount,
  MAX_SESSIONS_PER_ACCOUNT,
  getSessionEntry,
} from './auth-session.mjs'
import {
  parseDevicePayload,
  upsertRegisteredDevice,
  listRegisteredDevices,
  listActiveSessionDevices,
  renameRegisteredDevice,
  revokeDeviceSession,
  clearDeviceSessionLink,
  registerDeviceOnly,
  deleteRegisteredDevice,
  touchCurrentDevice,
} from './device-store.mjs'
import { registerSseConnection } from './session-sse.mjs'
import { verifyAppLoginWithBearerCapture, tryFedexBearerReuseLogin } from './auth-probe.mjs'
import {
  requestAsyncLocalStorage,
  runWithCredentialAccountKey,
} from './request-context.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')

/** For deploy verification: hashes baked into Vite-built `dist/index.html`. */
async function getSpaDistFingerprints() {
  /** @type {Record<string, unknown>} */
  let buildMeta = {}
  try {
    const raw = await fs.readFile(path.join(DIST_DIR, 'build-meta.json'), 'utf8')
    buildMeta = JSON.parse(raw)
  } catch {
    /* optional — written by Dockerfile UI stage */
  }
  try {
    const htmlPath = path.join(DIST_DIR, 'index.html')
    const html = await fs.readFile(htmlPath, 'utf8')
    const js = html.match(/\/assets\/(index-[a-zA-Z0-9_-]+\.js)/)
    const css = html.match(/\/assets\/(index-[a-zA-Z0-9_-]+\.css)/)
    const gitCommit =
      typeof buildMeta.gitCommit === 'string' ? buildMeta.gitCommit : null
    const builtAt = typeof buildMeta.builtAt === 'string' ? buildMeta.builtAt : null
    return {
      indexHtmlExists: true,
      mainScript: js?.[1] ?? null,
      mainCss: css?.[1] ?? null,
      gitCommit,
      builtAt,
      buildLabel:
        gitCommit && builtAt
          ? `${gitCommit.slice(0, 7)} · ${builtAt}`
          : js?.[1] ?? null,
    }
  } catch {
    return {
      indexHtmlExists: false,
      mainScript: null,
      mainCss: null,
      gitCommit:
        typeof buildMeta.gitCommit === 'string' ? buildMeta.gitCommit : null,
      builtAt: typeof buildMeta.builtAt === 'string' ? buildMeta.builtAt : null,
      buildLabel: null,
    }
  }
}
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
  submitBlockInspectConfirm,
  cancelBlockInspectConfirm,
  cancelBlockRun,
} from './playwright/blocks.mjs'
import {
  cancelAllPlaywrightRuns,
  isAnyPlaywrightRunnerBusy,
  waitForPlaywrightIdle,
} from './playwright/run-control.mjs'
import { EMAIL_TEST_KINDS, sendTestEmailForKind } from './email-test-sender.mjs'
import { startEmailScheduler } from './email-scheduler.mjs'
import { listPresets, getPreset } from './automation-presets.mjs'
import {
  getCheckInFlowPayload,
  writeCheckInFlowFromMerged,
} from './check-in-flow-store.mjs'
import { startPoll, stopPoll, getPollStatus } from './poll.mjs'
import { fetchLinkPreview, isAllowedLinkPreviewUrl } from './link-preview.mjs'
import {
  readThreadCache,
  syncThreadCache,
  fetchWahaMessageMedia,
  fetchWahaContacts,
  fetchWahaLids,
  applyWahaPrefsForAccount,
  clearAccountWahaPrefs,
} from './wahaChatCache.mjs'
import { generateDailyBriefing } from './waha-daily-briefing.mjs'
import { sanitizeOpenrouterModel, OPENROUTER_DEFAULT_MODEL } from './openrouter-briefing.mjs'
import {
  fetchOpenrouterModelsCatalog,
  filterOpenrouterModels,
} from './openrouter-models.mjs'
import { ensureWahaChatHistoryTable } from './waha-chat-history-pg.mjs'
import { ensureBlueBubblesChatHistoryTable } from './bluebubbles-chat-history-pg.mjs'
import {
  readBbThreadCache,
  syncBbThreadCache,
  fetchBbChats,
  applyBlueBubblesPrefsForAccount,
  clearAccountBlueBubblesPrefs,
} from './bluebubblesChatCache.mjs'
import {
  pingBlueBubbles,
  applyBlueBubblesPrefsForAccount as applyBbClientPrefs,
  clearAccountBlueBubblesPrefs as clearBbClientPrefs,
  registerBlueBubblesWebhook,
  listBlueBubblesWebhooks,
  getBlueBubblesRecentMessages,
  sendBlueBubblesText,
} from './bluebubbles-client.mjs'
import {
  parseBlueBubblesWebhookMessage,
  handleBlueBubblesAutoReply,
} from './bluebubbles-auto-reply.mjs'
import {
  resolveBlueBubblesCredentials,
  getPublicAppUrl,
  validateBlueBubblesServerUrl,
} from './bluebubbles-request-context.mjs'
import { translateSenderNamesToEnglish } from './google-translate.mjs'
import { needsEnglishSenderNameTranslation } from '../src/utils/senderNameLocale.js'
import { readAssignment, writeAssignment } from './assignment-store.mjs'
import {
  getCredentialsMeta,
  saveCredentials,
  clearCredentials,
  getTractorNumber,
  getLinehaulDriverId,
  getDecryptedLinehaulBearer,
  getDriverPhone,
  accountKeyForUsername,
  setLastActiveAccountKey,
  writeUserMeta,
  getEmployeeNumber,
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
  linehaulViewTripInfoDetailsGet,
} from './fedex-linehaul-api.mjs'
import { TOOL_SECRET_HINT } from './config.mjs'
import { maybeUpdateAssignmentFromContext } from './assignment-logic.mjs'
import {
  listLocations,
  upsertLocation,
  patchLocation,
  bulkUpsertLocations,
} from './locations-directory-store.mjs'
import { mergeFedexGroundDirectorySeed } from './directory-fedex-ground-seed.mjs'
import {
  geocodeDirectoryLocationById,
  geocodeMissingDirectoryLocations,
  getDirectoryGeocodeStatus,
  startDirectoryGeocodeBackground,
} from './directory-geocode.mjs'
import {
  appendLoginAccessFromBody,
  appendPageVisitLog,
  listAccessEntries,
  mergePreLoginAccessToUser,
} from './access-log-store.mjs'
import { getClientIp, isPrivateOrLocalIp } from './client-ip.mjs'
import { readGeoFence, writeGeoFence } from './geo-fence-store.mjs'
import {
  readInAppInbox,
  markInAppRead,
  markInAppAllRead,
  purgeNoisyInAppItems,
} from './in-app-notifications-store.mjs'
import { isSkippableInAppNotification } from './in-app-notification-noise.mjs'
import { publishInAppForAccount } from './notification-publish.mjs'
import {
  addOrTouchDolly,
  readDollyRegistry,
  removeDollyFromRegistry,
  setDollyRating,
  syncDollyFromTrip,
} from './dolly-store.mjs'
import {
  getGeoFenceRedirectUrl,
  pointInPolygon,
} from './geo-fence-check.mjs'
import { lookupIpLatLng, reverseGeocodeNominatim } from './ip-geolocation.mjs'
import {
  getBridgesResponsePayload,
  refreshPanynjCrossingData,
  startPanynjBridgePoll,
} from './bridge-panynj.mjs'
import { getVerrazzanoResponsePayload } from './bridge-verrazzano-traffic.mjs'
import { buildBridgeTrafficExport } from './bridge-traffic-export.mjs'
import {
  readBridgeTrafficProfileOverrides,
  writeBridgeTrafficProfileOverrides,
} from './bridge-traffic-profiles-store.mjs'
import { getNy511TruckNycPayload } from './ny511-traffic-feeds.mjs'
import { resolveBridgeCamerasFrom511List } from './ny511-bridge-cameras.mjs'
import { registerTrafficMonitoredRoutes } from './traffic-monitored-routes-routes.mjs'
import {
  getApiQuotaSnapshot,
  setApiQuotaLimitOverrides,
  resetApiQuotaDayCounts,
  assertApiAllowed,
  recordApiCompletedCall,
  ApiQuotaError,
} from './api-quota.mjs'
await fs.mkdir(UPLOADS_DIR, { recursive: true })

const app = Fastify({ logger: false, trustProxy: true })

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
  if (path === '/api/health' || path === '/api/build-info') return
  if (path.startsWith('/api/bluebubbles/webhook/')) return
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
  if (path === '/api/health' || path === '/api/build-info') return
  if (path.startsWith('/api/auth/')) return
  if (path === '/api/login/access-log' && req.method === 'POST') return
  if (path === '/api/visit' && req.method === 'POST') return
  if (path === '/api/public/geo-fence-check') return
  if (path.startsWith('/api/bluebubbles/webhook/')) return
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

  /** Prefer instant re-login when stored password matches and Linehaul JWT still works. */
  const result = await runWithCredentialAccountKey(accountKey, async () => {
    const reused = await tryFedexBearerReuseLogin(accountKey, username, password)
    if (reused) return { ok: true }
    return verifyAppLoginWithBearerCapture({ username, password })
  })
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
  try {
    await mergePreLoginAccessToUser(username, accountKey)
  } catch {
    /* non-fatal */
  }

  if (body.deviceConsent !== true) {
    return reply.code(400).send({
      ok: false,
      error: 'Device information consent is required to sign in.',
    })
  }

  let devicePayload
  try {
    devicePayload = parseDevicePayload(body.device ?? {})
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }

  const revokeSessionIds = Array.isArray(body.revokeSessionIds)
    ? body.revokeSessionIds
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
    : []
  if (body.revokeAll === true) {
    const existing = getActiveSessionIdsForAccount(accountKey)
    revokeAllSessionsForAccount(accountKey)
    for (const sid of existing) {
      await clearDeviceSessionLink(sid, accountKey)
    }
  } else if (revokeSessionIds.length > 0) {
    revokeSessionsForAccount(accountKey, revokeSessionIds)
    for (const sid of revokeSessionIds) {
      await clearDeviceSessionLink(sid, accountKey)
    }
  }

  const existingForDevice = getActiveSessionIdsForAccount(accountKey).filter((sid) => {
    const entry = getSessionEntry(sid)
    return entry?.deviceId === devicePayload.deviceId
  })
  if (existingForDevice.length > 0) {
    revokeSessionsForAccount(accountKey, existingForDevice)
    for (const sid of existingForDevice) {
      await clearDeviceSessionLink(sid, accountKey)
    }
  }

  const activeCount = getActiveSessionIdsForAccount(accountKey).length
  if (activeCount >= MAX_SESSIONS_PER_ACCOUNT) {
    const activeSessions = await listActiveSessionDevices(accountKey)
    return reply.code(409).send({
      ok: false,
      code: 'SESSION_LIMIT',
      error: 'Two devices are already signed in. Sign out one to continue.',
      activeSessions,
      maxSessions: MAX_SESSIONS_PER_ACCOUNT,
    })
  }

  const id = createSession(accountKey, devicePayload.deviceId)
  if (!id) {
    const activeSessions = await listActiveSessionDevices(accountKey)
    return reply.code(409).send({
      ok: false,
      code: 'SESSION_LIMIT',
      error: 'Two devices are already signed in. Sign out one to continue.',
      activeSessions,
      maxSessions: MAX_SESSIONS_PER_ACCOUNT,
    })
  }

  try {
    await upsertRegisteredDevice(accountKey, devicePayload, {
      sessionId: id,
      ip: getClientIp(req),
    })
  } catch {
    /* non-fatal */
  }

  reply.setCookie(COOKIE_NAME, id, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
  })
  return { ok: true, deviceId: devicePayload.deviceId }
})

app.post('/api/auth/logout', async (req, reply) => {
  const sid = req.cookies?.[COOKIE_NAME]
  const ak = getSessionAccountKey(sid)
  if (sid && ak) {
    try {
      await clearDeviceSessionLink(sid, ak)
    } catch {
      /* non-fatal */
    }
  }
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
    const entry = await appendLoginAccessFromBody({
      ...body,
      ip: getClientIp(req),
      forwardedFor,
      userAgent: typeof ua === 'string' ? ua : null,
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
  const entry = await appendPageVisitLog({
    ip: getClientIp(req),
    forwardedFor,
    userAgent: typeof ua === 'string' ? ua : null,
  })
  return { ok: true, id: entry.id }
})

/** Internal WAHA URL for `/api/waha` proxy (separate Dokploy/docker service). */
function getWahaInternalUrl() {
  const env = (process.env.WAHA_BASE_URL || '').trim().replace(/\/+$/, '')
  if (env) return env
  return 'http://waha:3000'
}

app.get('/api/health', async () => {
  const dist = await getSpaDistFingerprints()
  return {
    ok: true,
    busy:
      isRunnerBusy() || isBlockRunnerBusy() || isLinehaulCaptureBusy(),
    /** When null, API uses ephemeral `server/.local` — set FEDEX_TOOL_DATA_DIR for durable shared storage. */
    dataDir: PERSISTENCE_DATA_ROOT,
    localDataPath: LOCAL_DIR,
    ui: {
      mainScript: dist.mainScript,
      gitCommit: dist.gitCommit,
      builtAt: dist.builtAt,
    },
    waha: {
      proxy: true,
      baseUrlConfigured: !!process.env.WAHA_BASE_URL,
      apiKeyConfigured: !!process.env.WAHA_API_KEY,
      internalUrl: getWahaInternalUrl(),
    },
    bluebubbles: {
      proxy: true,
      baseUrlConfigured: !!process.env.BLUEBUBBLES_BASE_URL,
      passwordConfigured: !!process.env.BLUEBUBBLES_PASSWORD,
    },
  }
})

/**
 * WAHA proxy — forward requests from /api/waha/* to the WAHA container.
 * The WAHA container runs as a sibling in docker-compose at http://waha:3000.
 */

async function wahaProxyHandler(req, reply) {
  const subPath = req.url.replace(/^\/api\/waha/, '') || '/'
  const target = `${getWahaInternalUrl()}${subPath}`
  try {
    const headers = { Accept: '*/*' }
    const wahaKey = process.env.WAHA_API_KEY
    if (wahaKey) headers['X-Api-Key'] = wahaKey
    const opts = { method: req.method, headers }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
      headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(req.body)
    }
    const r = await fetch(target, opts)
    const ct = r.headers.get('content-type') || 'application/octet-stream'
    reply.status(r.status).header('Content-Type', ct)
    const isFileDownload = /\/files\//.test(subPath)
    const isJson =
      !isFileDownload &&
      (ct.includes('application/json') || ct.includes('text/json'))
    if (isJson) {
      const body = await r.text()
      return reply.send(body)
    }
    const buf = Buffer.from(await r.arrayBuffer())
    return reply.send(buf)
  } catch (e) {
    return reply.code(502).send({ error: 'WAHA proxy error', message: e.message || String(e) })
  }
}

app.get('/api/waha/*', wahaProxyHandler)
app.post('/api/waha/*', wahaProxyHandler)
app.put('/api/waha/*', wahaProxyHandler)
app.delete('/api/waha/*', wahaProxyHandler)
app.patch('/api/waha/*', wahaProxyHandler)

/** Internal BlueBubbles URL for `/api/bluebubbles` proxy. */
function getBlueBubblesInternalUrl() {
  return String(process.env.BLUEBUBBLES_BASE_URL || '').trim().replace(/\/+$/, '')
}

async function blueBubblesProxyHandler(req, reply) {
  const subPath = req.url.replace(/^\/api\/bluebubbles/, '') || '/'
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  let accountPrefs = null
  if (ak) {
    try {
      accountPrefs = await getBlueBubblesPrefsForAccount(ak)
      applyBbClientPrefs(accountPrefs)
    } catch { /* ignore */ }
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const bodyUrl = String(body.serverUrl ?? body.blueBubblesUrl ?? '').trim()
  const bodyPw = String(body.password ?? body.blueBubblesPassword ?? '').trim()

  const { serverUrl, password } = resolveBlueBubblesCredentials(req, accountPrefs)
  const resolvedUrl = bodyUrl.replace(/\/+$/, '') || serverUrl
  const resolvedPw = bodyPw || password

  if (!resolvedUrl) {
    clearBbClientPrefs()
    return reply.code(502).send({ error: 'BlueBubbles server URL not configured.' })
  }
  if (!resolvedPw) {
    clearBbClientPrefs()
    return reply.code(502).send({ error: 'BlueBubbles password not configured.' })
  }
  try {
    const pathOnly = subPath.split('?')[0] || '/'
    const u = new URL(`${resolvedUrl}${pathOnly}`)
    const qIdx = subPath.indexOf('?')
    if (qIdx >= 0) {
      const incoming = new URLSearchParams(subPath.slice(qIdx + 1))
      for (const [k, v] of incoming.entries()) {
        if (k !== 'password') u.searchParams.set(k, v)
      }
    }
    u.searchParams.set('password', resolvedPw)
    u.searchParams.set('guid', resolvedPw)
    const headers = { Accept: 'application/json' }
    const opts = { method: req.method, headers }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body != null) {
      headers['Content-Type'] = 'application/json'
      const payload = { ...body }
      delete payload.serverUrl
      delete payload.blueBubblesUrl
      delete payload.password
      delete payload.blueBubblesPassword
      opts.body = JSON.stringify(payload)
    }
    const r = await fetch(u.toString(), opts)
    const ct = r.headers.get('content-type') || 'application/octet-stream'
    reply.status(r.status).header('Content-Type', ct)
    if (ct.includes('application/json') || ct.includes('text/json')) {
      return reply.send(await r.text())
    }
    return reply.send(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    return reply.code(502).send({ error: 'BlueBubbles proxy error', message: e.message || String(e) })
  } finally {
    clearBbClientPrefs()
  }
}

/** Public webhook — BlueBubbles POSTs new messages here (token in path). Must register before wildcard proxy. */
app.post('/api/bluebubbles/webhook/:token', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const token = String(req.params?.token ?? '').trim()
  if (!token) return reply.code(400).send({ ok: false, error: 'token required' })
  const accountKey = await resolveBlueBubblesWebhookAccount(token)
  if (!accountKey) return reply.code(404).send({ ok: false, error: 'Unknown webhook token' })

  const msg = parseBlueBubblesWebhookMessage(req.body)
  if (msg) {
    try {
      const prefs = await getBlueBubblesPrefsForAccount(accountKey)
      await upsertBlueBubblesMessagesFromWebhook(accountKey, msg, prefs)
      applyBbClientPrefs(prefs)
      emitLog('imessage-incoming', msg.text || 'New iMessage', {
        messageId: msg.messageId,
        text: msg.text,
        handle: msg.handle,
        chatGuid: msg.chatGuid,
        senderLabel: msg.senderLabel,
        ts: msg.ts,
      })
      await handleBlueBubblesAutoReply(accountKey, msg)
    } catch (e) {
      emitLog('imessage', `Webhook handler error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      clearBbClientPrefs()
    }
  }
  return { ok: true }
})

async function upsertBlueBubblesMessagesFromWebhook(accountKey, msg, prefs) {
  const { upsertBlueBubblesMessages, upsertBlueBubblesChatMeta } = await import('./bluebubbles-chat-history-pg.mjs')
  const raw = {
    guid: msg.messageId,
    text: msg.text,
    isFromMe: false,
    dateCreated: msg.ts,
    handle: { address: msg.handle },
    chats: [{ guid: msg.chatGuid, displayName: msg.senderLabel }],
  }
  await upsertBlueBubblesMessages(accountKey, msg.chatGuid, [raw])
  await upsertBlueBubblesChatMeta(accountKey, msg.chatGuid, {
    displayName: msg.senderLabel,
    participants: msg.handle ? [{ address: msg.handle }] : [],
  })
  const cache = await readBbThreadCache(msg.chatGuid, accountKey)
  const existing = Array.isArray(cache?.messages) ? cache.messages : []
  const ids = new Set(existing.map((m) => String(m?.guid || m?.id || '')))
  if (!ids.has(msg.messageId)) {
    await import('./bluebubblesChatCache.mjs').then(({ writeBbThreadCache }) =>
      writeBbThreadCache(msg.chatGuid, {
        updatedAt: Date.now(),
        messages: [...existing, raw],
        displayName: msg.senderLabel,
        accountKey,
      }),
    )
  }
  void prefs
}

app.get('/api/bluebubbles/*', blueBubblesProxyHandler)
app.post('/api/bluebubbles/*', blueBubblesProxyHandler)
app.put('/api/bluebubbles/*', blueBubblesProxyHandler)
app.delete('/api/bluebubbles/*', blueBubblesProxyHandler)
app.patch('/api/bluebubbles/*', blueBubblesProxyHandler)

app.get('/api/imessage/thread', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const chatGuid = String(req.query?.chatGuid ?? '').trim()
  if (!chatGuid) return reply.code(400).send({ ok: false, error: 'chatGuid required' })
  const accountKey = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  const cache = await readBbThreadCache(chatGuid, accountKey)
  return {
    ok: true,
    cached: Boolean(cache?.messages?.length),
    chatGuid,
    messages: cache?.messages ?? [],
    updatedAt: cache?.updatedAt ?? 0,
    displayName: cache?.displayName ?? '',
    participants: cache?.participants ?? [],
  }
})

app.post('/api/imessage/thread/sync', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const chatGuid = String(req.body?.chatGuid ?? '').trim()
  if (!chatGuid) return reply.code(400).send({ ok: false, error: 'chatGuid required' })
  const limit = Number(req.body?.limit) || 60
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (ak) {
    try {
      applyBlueBubblesPrefsForAccount(await getBlueBubblesPrefsForAccount(ak))
    } catch { /* ignore */ }
  }
  try {
    const r = await syncBbThreadCache(chatGuid, {
      limit,
      accountKey: ak,
      displayName: String(req.body?.displayName ?? ''),
      participants: Array.isArray(req.body?.participants) ? req.body.participants : [],
    })
    if (!r.ok) {
      const stale = await readBbThreadCache(chatGuid, ak)
      if (stale?.messages?.length) {
        return {
          ok: true,
          stale: true,
          warning: 'Using cached messages; live BlueBubbles sync unavailable.',
          chatGuid,
          messages: stale.messages,
          updatedAt: stale.updatedAt ?? 0,
          status: r.status,
        }
      }
      return reply.code(r.status || 502).send({
        ok: false,
        error: r.error || 'BlueBubbles sync failed',
        status: r.status,
        messages: [],
        updatedAt: 0,
      })
    }
    return {
      ok: true,
      chatGuid,
      messages: r.messages,
      updatedAt: r.updatedAt,
    }
  } finally {
    clearAccountBlueBubblesPrefs()
  }
})

app.get('/api/imessage/chats', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (ak) {
    try {
      applyBlueBubblesPrefsForAccount(await getBlueBubblesPrefsForAccount(ak))
    } catch { /* ignore */ }
  }
  try {
    const r = await fetchBbChats({ limit: Number(req.query?.limit) || 50 })
    if (!r.ok) {
      return reply.code(r.status || 502).send({ ok: false, error: r.error || 'Failed to list chats' })
    }
    const list = Array.isArray(r.body) ? r.body : []
    return { ok: true, chats: list }
  } finally {
    clearAccountBlueBubblesPrefs()
  }
})

app.get('/api/imessage/recent', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return reply.code(401).send({ ok: false, error: 'Sign in required.' })
  }
  try {
    applyBlueBubblesPrefsForAccount(await getBlueBubblesPrefsForAccount(ak))
  } catch { /* ignore */ }
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 40))
    const r = await getBlueBubblesRecentMessages({ limit })
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: r.error || 'Failed to fetch recent iMessages',
        status: r.status,
        messages: [],
      })
    }
    const messages = Array.isArray(r.body) ? r.body : []
    return { ok: true, messages }
  } finally {
    clearAccountBlueBubblesPrefs()
  }
})

app.post('/api/imessage/send', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const chatGuid = String(body.chatGuid ?? '').trim()
  const message = String(body.message ?? body.text ?? '').trim()
  const tempGuid = String(body.tempGuid ?? '').trim()
  if (!chatGuid || !message) {
    return reply.code(400).send({ ok: false, error: 'chatGuid and message required' })
  }

  let accountPrefs = null
  if (ak) {
    try {
      accountPrefs = await getBlueBubblesPrefsForAccount(ak)
    } catch { /* ignore */ }
  }
  const { serverUrl, password } = resolveBlueBubblesCredentials(req, accountPrefs)
  const urlError = validateBlueBubblesServerUrl(serverUrl)
  if (urlError) {
    return reply.code(502).send({ ok: false, error: urlError })
  }
  if (!serverUrl || !password) {
    return reply.code(502).send({ ok: false, error: 'BlueBubbles server URL and password required.' })
  }

  applyBbClientPrefs({ serverUrl, password })
  try {
    const r = await sendBlueBubblesText(chatGuid, message, tempGuid || undefined)
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: r.error || 'Failed to send iMessage',
        status: r.status,
        blueBubbles: r.raw ?? null,
      })
    }
    return {
      ok: true,
      data: r.body,
      verifiedAfterTimeout: r.verifiedAfterTimeout === true,
    }
  } finally {
    clearBbClientPrefs()
  }
})

app.post('/api/imessage/ping', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  let accountPrefs = null
  if (ak) {
    try {
      accountPrefs = await getBlueBubblesPrefsForAccount(ak)
    } catch { /* ignore */ }
  }
  const { serverUrl, password } = resolveBlueBubblesCredentials(req, accountPrefs)
  const testUrl = String(body.serverUrl ?? '').trim().replace(/\/+$/, '') || serverUrl
  const testPw = String(body.password ?? '').trim() || password
  if (!testUrl || !testPw) {
    return reply.code(400).send({ ok: false, error: 'BlueBubbles server URL and password required.' })
  }
  applyBbClientPrefs({ serverUrl: testUrl, password: testPw })
  try {
    const r = await pingBlueBubbles()
    if (!r.ok) {
      return reply.code(r.status || 502).send({ ok: false, error: r.error || 'Ping failed' })
    }
    return { ok: true, data: r.body }
  } finally {
    clearBbClientPrefs()
  }
})

app.post('/api/imessage/auto-reply', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  const body = req.body ?? {}
  const msg = {
    messageId: String(body.messageId ?? '').trim(),
    text: String(body.text ?? '').trim(),
    handle: String(body.handle ?? '').trim(),
    chatGuid: String(body.chatGuid ?? '').trim(),
    senderLabel: String(body.senderLabel ?? '').trim(),
  }
  if (!msg.messageId || !msg.chatGuid) {
    return reply.code(400).send({ ok: false, error: 'messageId and chatGuid required' })
  }
  const result = await handleBlueBubblesAutoReply(ak, msg)
  return { ok: true, ...result }
})

app.get('/api/whatsapp/thread', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const chatId = String(req.query?.chatId ?? '').trim()
  if (!chatId) return reply.code(400).send({ ok: false, error: 'chatId required' })
  const accountKey = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  const cache = await readThreadCache(chatId, accountKey)
  return {
    ok: true,
    cached: Boolean(cache?.messages?.length),
    chatId,
    messages: cache?.messages ?? [],
    updatedAt: cache?.updatedAt ?? 0,
    contacts: cache?.contacts ?? [],
    lids: cache?.lids ?? [],
  }
})

app.post('/api/whatsapp/thread/sync', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const chatId = String(req.body?.chatId ?? '').trim()
  if (!chatId) return reply.code(400).send({ ok: false, error: 'chatId required' })
  const limit = Number(req.body?.limit) || 60
  const downloadMedia = req.body?.downloadMedia === true
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (ak) {
    try {
      applyWahaPrefsForAccount(await getWahaPrefsForAccount(ak))
    } catch { /* ignore */ }
  }
  try {
    let contacts = []
    let lids = []
    try {
      const cr = await fetchWahaContacts({ limit: 500 })
      if (cr.ok && Array.isArray(cr.body)) contacts = cr.body
    } catch {
      /* optional */
    }
    try {
      const lr = await fetchWahaLids({ limit: 500 })
      if (lr.ok && Array.isArray(lr.body)) lids = lr.body
    } catch {
      /* optional */
    }
    const r = await syncThreadCache(chatId, {
      limit,
      downloadMedia,
      contacts,
      lids,
      accountKey: ak,
    })
    if (!r.ok) {
      const stale = await readThreadCache(chatId, ak)
      if (stale?.messages?.length) {
        return {
          ok: true,
          stale: true,
          warning: 'Using cached messages; live WAHA sync unavailable.',
          chatId,
          messages: stale.messages,
          updatedAt: stale.updatedAt ?? 0,
          contacts: stale.contacts?.length ? stale.contacts : contacts,
          lids: stale.lids?.length ? stale.lids : lids,
          status: r.status,
        }
      }
      return reply.code(r.status || 502).send({
        ok: false,
        error: 'WAHA sync failed',
        status: r.status,
        messages: [],
        updatedAt: 0,
        contacts,
        lids,
      })
    }
    return {
      ok: true,
      chatId,
      messages: r.messages,
      updatedAt: r.updatedAt,
      contacts,
      lids,
    }
  } finally {
    clearAccountWahaPrefs()
  }
})

app.get('/api/link-preview', async (req, reply) => {
  reply.header('Cache-Control', 'private, max-age=300')
  const url = String(req.query?.url ?? '').trim()
  if (!url || !isAllowedLinkPreviewUrl(url)) {
    return reply.code(400).send({ ok: false, error: 'Invalid URL' })
  }
  const preview = await fetchLinkPreview(url)
  if (!preview.ok) {
    return reply.code(502).send(preview)
  }
  return preview
})

app.post('/api/whatsapp/thread/media', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const chatId = String(req.body?.chatId ?? '').trim()
  const messageId = String(req.body?.messageId ?? '').trim()
  if (!chatId || !messageId) {
    return reply.code(400).send({ ok: false, error: 'chatId and messageId required' })
  }
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (ak) {
    try {
      applyWahaPrefsForAccount(await getWahaPrefsForAccount(ak))
    } catch { /* ignore */ }
  }
  try {
    const r = await fetchWahaMessageMedia(chatId, messageId)
    if (!r.ok) {
      return reply.code(r.status || 502).send({ ok: false, status: r.status, message: null })
    }
    return { ok: true, message: r.body }
  } finally {
    clearAccountWahaPrefs()
  }
})

/** Public: which Vite bundle the running container serves (compare after deploy / vs browser Sources). */
app.get('/api/build-info', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const dist = await getSpaDistFingerprints()
  return {
    ok: true,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    ...dist,
  }
})

app.get('/api/status', async () => ({
  busy:
    isRunnerBusy() || isBlockRunnerBusy() || isLinehaulCaptureBusy(),
  poll: getPollStatus(),
}))

app.get('/api/bridges/panynj', async () => {
  return getBridgesResponsePayload()
})

app.get('/api/bridges/verrazzano', async (req) => {
  const ak = req.credentialAccountKey
    ? String(req.credentialAccountKey)
    : ''
  return getVerrazzanoResponsePayload(ak)
})

/** 511NY: NYC-region truck-relevant events, construction, incidents, road conditions (cached). */
app.get('/api/511ny/traffic', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey ? String(req.credentialAccountKey) : ''
    let apiKey = ''
    if (typeof ak === 'string' && ak.trim()) {
      apiKey = (await getNy511ApiKeyForAccount(ak)) || ''
    }
    if (!apiKey) {
      const qk = typeof req.query?.key === 'string' ? req.query.key.trim() : ''
      if (qk) apiKey = qk.replace(/[^a-zA-Z0-9_-]/g, '')
    }
    if (!apiKey) {
      return reply.code(400).send({
        error: 'No 511NY API key configured. Add your key in Settings.',
        code: 'NO_API_KEY',
      })
    }

    if (typeof ak === 'string' && ak.trim()) {
      try {
        await assertApiAllowed(ak.trim(), 'ny511')
      } catch (e) {
        if (e instanceof ApiQuotaError) {
          return reply.code(429).send({
            error: e.message,
            code: e.code,
            bucket: e.bucket,
          })
        }
        throw e
      }
    }

    const payload = await getNy511TruckNycPayload(ak, apiKey)
    if (typeof ak === 'string' && ak.trim() && payload.ok && !payload.cached) {
      await recordApiCompletedCall(ak.trim(), 'ny511').catch(() => {})
    }
    return payload
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(500).send({ error: msg })
  }
})

const NY511_CAMERA_CACHE_TTL_MS = 5 * 60 * 1000
let ny511CamerasCache = { data: null, fetchedAt: 0 }

app.get('/api/511ny/cameras', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    let apiKey = ''
    if (typeof ak === 'string' && ak.trim()) {
      apiKey = await getNy511ApiKeyForAccount(ak)
    }
    if (!apiKey) {
      const qk = typeof req.query?.key === 'string' ? req.query.key.trim() : ''
      if (qk) apiKey = qk.replace(/[^a-zA-Z0-9_-]/g, '')
    }
    if (!apiKey) {
      return reply.code(400).send({
        error: 'No 511NY API key configured. Add your key in Settings.',
        code: 'NO_API_KEY',
      })
    }

    const now = Date.now()
    if (
      ny511CamerasCache.data &&
      now - ny511CamerasCache.fetchedAt < NY511_CAMERA_CACHE_TTL_MS
    ) {
      return { ok: true, cameras: ny511CamerasCache.data, cached: true }
    }

    if (typeof ak === 'string' && ak.trim()) {
      try {
        await assertApiAllowed(ak.trim(), 'ny511')
      } catch (e) {
        if (e instanceof ApiQuotaError) {
          return reply.code(429).send({
            error: e.message,
            code: e.code,
            bucket: e.bucket,
          })
        }
        throw e
      }
    }

    const url = `https://511ny.org/api/v2/get/cameras?key=${encodeURIComponent(apiKey)}&format=json`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return reply.code(res.status).send({
        error: `511NY API error: ${res.status} ${res.statusText}`,
        detail: text.slice(0, 500),
      })
    }
    const allCameras = await res.json()
    if (!Array.isArray(allCameras)) {
      return reply.code(502).send({ error: '511NY returned invalid data' })
    }

    const bridgeCameras = resolveBridgeCamerasFrom511List(allCameras)

    ny511CamerasCache = { data: bridgeCameras, fetchedAt: now }
    if (typeof ak === 'string' && ak.trim()) {
      await recordApiCompletedCall(ak.trim(), 'ny511').catch(() => {})
    }
    return { ok: true, cameras: bridgeCameras, cached: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(500).send({ error: msg })
  }
})

registerTrafficMonitoredRoutes(app)

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
    return next
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/notifications', async (req) => {
  const ak = /** @type {any} */(req).credentialAccountKey
  if (!ak) {
    return { ok: true, items: [], unreadCount: 0 }
  }
  const d = await purgeNoisyInAppItems(ak)
  const list = Array.isArray(d.items) ? d.items : []
  const unreadCount = list.filter((x) => x && !x.read).length
  return { ok: true, items: list, unreadCount }
})

app.post('/api/notifications', async (req, reply) => {
  const ak = /** @type {any} */(req).credentialAccountKey
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  const b = req.body ?? {}
  const message = typeof b.message === 'string' ? b.message.trim() : ''
  if (!message) {
    return reply.code(400).send({ error: 'message is required' })
  }
  const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim() : 'linehaul'
  const type = typeof b.type === 'string' && b.type.trim() ? b.type.trim() : 'info'
  const extra =
    b.extra && typeof b.extra === 'object' && !Array.isArray(b.extra) ? b.extra : undefined
  const r = await publishInAppForAccount(ak, { type, message, source, extra })
  if (!r?.item) {
    const list = (r?.inbox?.items || [])
    const unreadCount = list.filter((x) => x && !x.read).length
    return { ok: true, skipped: r?.skipped || 'deduped', items: list, unreadCount }
  }
  const list = (r.inbox?.items || [])
  const unreadCount = list.filter((x) => x && !x.read).length
  return { ok: true, item: r.item, items: list, unreadCount }
})

app.post('/api/notifications/read', async (req, reply) => {
  const ak = /** @type {any} */(req).credentialAccountKey
  if (!ak) {
    return reply.code(400).send({ error: 'Not signed in' })
  }
  const b = req.body ?? {}
  const id = b.id
  if (id && typeof id === 'string' && id.trim()) {
    const next = await markInAppRead(ak, [id.trim()])
    const list = next.items || []
    const u = list.filter((x) => x && !x.read).length
    return { ok: true, items: list, unreadCount: u }
  }
  if (b.all === true) {
    const next = await markInAppAllRead(ak)
    return { ok: true, items: next.items, unreadCount: 0 }
  }
  return reply.code(400).send({ error: 'Provide { id: string } or { all: true }' })
})

app.get('/api/dolly', async () => {
  const d = await readDollyRegistry()
  return { ok: true, ...d }
})

app.post('/api/dolly/sync', async (req, reply) => {
  try {
    const b = req.body ?? {}
    const leg =
      typeof b.legSeq === 'string' && /^\d+$/.test(b.legSeq) ? b.legSeq : ''
    const trip = b.trip
    const d = await syncDollyFromTrip(
      trip,
      leg || undefined,
    )
    return { ok: true, ...d }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.put('/api/dolly', async (req, reply) => {
  try {
    const b = req.body ?? {}
    const d = await addOrTouchDolly(
      /** @type {any} */ (b).dollyNbr,
      { legSeq: b.legSeq, manual: true },
    )
    return { ok: true, ...d }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.patch('/api/dolly', async (req, reply) => {
  try {
    const b = req.body ?? {}
    const n = b.dollyNbr
    const r = b.rating
    if (typeof r !== 'string') {
      return reply.code(400).send({ error: 'rating required' })
    }
    const d = await setDollyRating(/** @type {any} */ (n), /** @type {'none' | 'good' | 'bad'} */ (r))
    return { ok: true, ...d }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.delete('/api/dolly', async (req, reply) => {
  try {
    const b = req.body ?? {}
    const d = await removeDollyFromRegistry(/** @type {any} */ (b).dollyNbr)
    return { ok: true, ...d }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.get('/api/settings/credentials', async (req) => {
  const meta = await getCredentialsMeta()
  const includeBearer = req.query?.includeLinehaulBearer === '1'
  let fedexLinehaulBearer = null
  if (includeBearer) {
    fedexLinehaulBearer = await getDecryptedLinehaulBearer()
  }
  const includeTomtom = req.query?.includeTomtomApiKey === '1'
  const includeHere = req.query?.includeHereApiKey === '1'
  const includeNy511 = req.query?.includeNy511ApiKey === '1'
  const includeOpenrouter = req.query?.includeOpenrouterApiKey === '1'
  const ak = req.credentialAccountKey
  let tomtomApiKey = undefined
  let hereApiKey = undefined
  let ny511ApiKey = undefined
  let openrouterApiKey = undefined
  let openrouterModel = undefined
  if (includeTomtom && typeof ak === 'string' && ak.trim()) {
    tomtomApiKey = (await getTomtomApiKeyForAccount(ak)) || ''
  }
  if (includeHere && typeof ak === 'string' && ak.trim()) {
    hereApiKey = (await getHereApiKeyForAccount(ak)) || ''
  }
  if (includeNy511 && typeof ak === 'string' && ak.trim()) {
    ny511ApiKey = (await getNy511ApiKeyForAccount(ak)) || ''
  }
  if (includeOpenrouter && typeof ak === 'string' && ak.trim()) {
    const akTrim = ak.trim()
    openrouterApiKey = (await getOpenrouterApiKeyForAccount(akTrim)) || ''
    const storedModel = await getOpenrouterModelForAccount(akTrim)
    openrouterModel = sanitizeOpenrouterModel(storedModel || OPENROUTER_DEFAULT_MODEL)
  }
  let gwbUpperCamYoutubeUrl = ''
  /** @type {{ enabled: boolean, radiusNm: number } | null} */
  let helpersAutoArrivePrefs = null
  /** @type {{ chatId: string, ttsEnabled: boolean | null, dailyBriefingEnabled: boolean | null } | null} */
  let wahaPrefs = null
  /** @type {Awaited<ReturnType<typeof getBlueBubblesPrefsForAccount>> | null} */
  let blueBubblesPrefs = null
  /** @type {Awaited<ReturnType<typeof getSmtpPrefsForAccount>> | null} */
  let smtpPrefs = null
  if (typeof ak === 'string' && ak.trim()) {
    const akTrim = ak.trim()
    gwbUpperCamYoutubeUrl = (await getGwbUpperCamYoutubeUrlForAccount(akTrim)) || ''
    helpersAutoArrivePrefs = await getHelpersAutoArrivePrefsForAccount(akTrim)
    wahaPrefs = await getWahaPrefsForAccount(akTrim)
    blueBubblesPrefs = await getBlueBubblesPrefsForAccount(akTrim)
    smtpPrefs = await getSmtpPrefsForAccount(akTrim)
  }
  return {
    ...meta,
    ...(includeBearer ? { fedexLinehaulBearer } : {}),
    ...(includeTomtom ? { tomtomApiKey } : {}),
    ...(includeHere ? { hereApiKey } : {}),
    ...(includeNy511 ? { ny511ApiKey } : {}),
    ...(includeOpenrouter ? { openrouterApiKey, openrouterModel } : {}),
    gwbUpperCamYoutubeUrl,
    ...(helpersAutoArrivePrefs
      ? {
          helpersAutoArriveNearDestEnabled: helpersAutoArrivePrefs.enabled,
          helpersAutoArriveRadiusNm: helpersAutoArrivePrefs.radiusNm,
        }
      : {}),
    ...(wahaPrefs
      ? {
          wahaChatId: wahaPrefs.chatId,
          wahaTtsEnabled: wahaPrefs.ttsEnabled,
          wahaDailyBriefingEnabled: wahaPrefs.dailyBriefingEnabled,
          wahaAutoRespondPhoneEnabled: wahaPrefs.autoRespondPhoneEnabled,
          wahaAutoRespondWhereEnabled: wahaPrefs.autoRespondWhereEnabled,
          wahaAutoRespondWhoAtEnabled: wahaPrefs.autoRespondWhoAtEnabled,
          wahaUrl: wahaPrefs.wahaUrl || '',
          wahaApiKey: wahaPrefs.wahaApiKey || '',
        }
      : {}),
    ...(blueBubblesPrefs
      ? {
          blueBubblesUrl: blueBubblesPrefs.serverUrl || '',
          blueBubblesPassword: blueBubblesPrefs.password ? '••••' : '',
          blueBubblesChatGuid: blueBubblesPrefs.chatGuid || '',
          blueBubblesTtsEnabled: blueBubblesPrefs.ttsEnabled,
          blueBubblesAutoReplyEnabled: blueBubblesPrefs.autoReplyEnabled,
          blueBubblesWebhookToken: blueBubblesPrefs.webhookToken || '',
          blueBubblesContactRules: blueBubblesPrefs.contactRules || [],
        }
      : {}),
    ...(smtpPrefs
      ? {
          smtpEnabled: smtpPrefs.enabled,
          smtpHost: smtpPrefs.host || '',
          smtpPort: smtpPrefs.port,
          smtpSecure: smtpPrefs.secure,
          smtpUser: smtpPrefs.user || '',
          smtpPassword: smtpPrefs.password ? '••••' : '',
          smtpFromEmail: smtpPrefs.fromEmail || '',
          smtpFromName: smtpPrefs.fromName || 'TripBuddy',
          emailNotifyTo: smtpPrefs.notifyTo || '',
          emailTimezone: smtpPrefs.timezone || 'America/New_York',
          emailOnNewTrip: smtpPrefs.onNewTrip,
          emailOnPreplan: smtpPrefs.onPreplan,
          emailOnStatusChange: smtpPrefs.onStatusChange,
          emailOnDriverMismatch: smtpPrefs.onDriverMismatch,
          emailOnDispatchInstructions: smtpPrefs.onDispatchInstructions,
          emailOnDailyShift: smtpPrefs.onDailyShiftSummary,
          emailOnWeeklySummary: smtpPrefs.onWeeklySummary,
          emailTripCc: smtpPrefs.tripCc || '',
          emailDailyShiftCc: smtpPrefs.dailyShiftCc || '',
          emailWeeklySummaryCc: smtpPrefs.weeklySummaryCc || '',
          emailDailyDelayMins: smtpPrefs.dailyDelayMins,
        }
      : {}),
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

app.put('/api/settings/tomtom-api-key', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const raw =
      typeof body.tomtomApiKey === 'string'
        ? body.tomtomApiKey
        : typeof body.key === 'string'
          ? body.key
          : ''
    const sanitized = sanitizeTomtomApiKey(raw)
    if (raw.trim() && !sanitized) {
      return reply.code(400).send({ error: 'Invalid TomTom API key format.' })
    }
    await setTomtomApiKeyForAccount(ak, sanitized)
    return { ok: true, hasTomtomApiKey: Boolean(sanitized) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.put('/api/settings/here-api-key', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const raw =
      typeof body.hereApiKey === 'string'
        ? body.hereApiKey
        : typeof body.key === 'string'
          ? body.key
          : ''
    const sanitized = sanitizeHereApiKey(raw)
    if (raw.trim() && !sanitized) {
      return reply.code(400).send({ error: 'Invalid HERE API key format.' })
    }
    await setHereApiKeyForAccount(ak, sanitized)
    return { ok: true, hasHereApiKey: Boolean(sanitized) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.put('/api/settings/ny511-api-key', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const raw =
      typeof body.ny511ApiKey === 'string'
        ? body.ny511ApiKey
        : typeof body.key === 'string'
          ? body.key
          : ''
    const sanitized = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '')
    if (raw.trim() && !sanitized) {
      return reply.code(400).send({ error: 'Invalid 511NY API key format.' })
    }
    await setNy511ApiKeyForAccount(ak, sanitized)
    return { ok: true, hasNy511ApiKey: Boolean(sanitized) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/openrouter/models', async (req, reply) => {
  reply.header('Cache-Control', 'private, max-age=300')
  try {
    const q = String(req.query?.q ?? req.query?.query ?? '').trim()
    const limitRaw = Number(req.query?.limit)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(500, Math.floor(limitRaw))
      : q
        ? 40
        : 400
    let apiKey = ''
    const ak = req.credentialAccountKey
    if (typeof ak === 'string' && ak.trim()) {
      apiKey = (await getOpenrouterApiKeyForAccount(ak.trim())) || ''
    }
    const models = await fetchOpenrouterModelsCatalog(apiKey)
    const listed = q ? filterOpenrouterModels(models, q, limit) : models
    return {
      ok: true,
      count: models.length,
      models: listed,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(502).send({ ok: false, error: msg, models: [] })
  }
})

app.put('/api/settings/openrouter-api-key', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const raw =
      typeof body.openrouterApiKey === 'string'
        ? body.openrouterApiKey
        : typeof body.key === 'string'
          ? body.key
          : ''
    const sanitized = raw.trim()
    if (raw.trim() && sanitized.length < 8) {
      return reply.code(400).send({ error: 'Invalid OpenRouter API key format.' })
    }
    await setOpenrouterApiKeyForAccount(ak, sanitized)
    const modelRaw =
      typeof body.openrouterModel === 'string'
        ? body.openrouterModel
        : typeof body.model === 'string'
          ? body.model
          : ''
    if (modelRaw.trim()) {
      await setOpenrouterModelForAccount(ak, sanitizeOpenrouterModel(modelRaw))
    }
    const openrouterModel = sanitizeOpenrouterModel(
      (await getOpenrouterModelForAccount(ak)) || OPENROUTER_DEFAULT_MODEL,
    )
    return { ok: true, hasOpenrouterApiKey: Boolean(sanitized), openrouterModel }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/translate/sender-names', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(401).send({ ok: false, error: 'Sign in required.' })
    }
    const body = req.body ?? {}
    const items = Array.isArray(body.items) ? body.items : []
    const filtered = items
      .map((item) => ({
        id: String(item?.id ?? '').trim(),
        text: String(item?.text ?? '').trim(),
      }))
      .filter((item) => item.id && item.text && needsEnglishSenderNameTranslation(item.text))
      .slice(0, 60)

    if (!filtered.length) {
      return { ok: true, names: {}, textEn: {} }
    }

    const stored = await getSenderNameTranslationsForAccount(ak.trim())
    /** @type {Record<string, string>} */
    const names = {}
    /** @type {Record<string, string>} */
    const textEn = { ...stored }
    const toFetch = []

    for (const item of filtered) {
      const cached = stored[item.text]
      if (cached) {
        names[item.id] = cached
        continue
      }
      toFetch.push(item)
    }

    if (toFetch.length) {
      const translated = await translateSenderNamesToEnglish(toFetch)
      const additions = {}
      for (const item of toFetch) {
        const en = translated[item.id] || item.text
        names[item.id] = en
        additions[item.text] = en
      }
      if (Object.keys(additions).length) {
        await mergeSenderNameTranslationsForAccount(ak.trim(), additions)
        Object.assign(textEn, additions)
      }
    }

    return { ok: true, names, textEn }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(502).send({ ok: false, error: msg })
  }
})

app.get('/api/translate/sender-names/cache', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  const ak = req.credentialAccountKey
  if (typeof ak !== 'string' || !ak.trim()) {
    return reply.code(401).send({ ok: false, error: 'Sign in required.' })
  }
  const textEn = await getSenderNameTranslationsForAccount(ak.trim())
  return { ok: true, textEn }
})

app.post('/api/whatsapp/daily-briefing', async (req, reply) => {
  reply.header('Cache-Control', 'no-store')
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(401).send({ ok: false, error: 'Sign in required.' })
    }
    const body = req.body ?? {}
    const chatId = String(body.chatId ?? '').trim()
    if (!chatId) {
      return reply.code(400).send({ ok: false, error: 'chatId required' })
    }
    const akTrim = ak.trim()
    applyWahaPrefsForAccount(await getWahaPrefsForAccount(akTrim))
    try {
    const openRouterApiKey = await getOpenrouterApiKeyForAccount(akTrim)
    if (!openRouterApiKey) {
      return reply.code(400).send({
        ok: false,
        error: 'OpenRouter API key not configured. Add it in Settings → API.',
      })
    }
    const storedModel = await getOpenrouterModelForAccount(akTrim)
    const openRouterModel = sanitizeOpenrouterModel(
      String(body.model ?? body.openrouterModel ?? storedModel ?? OPENROUTER_DEFAULT_MODEL),
    )
    const timeZone = String(body.timeZone ?? 'UTC').trim() || 'UTC'
    const chatLabel = String(body.chatLabel ?? chatId).trim()
    const result = await generateDailyBriefing({
      chatId,
      chatLabel,
      timeZone,
      openRouterApiKey,
      openRouterModel,
      accountKey: akTrim,
      skipLiveSync: body.skipThreadSync === true,
    })
    if (!result.ok) {
      return { ok: false, error: result.error || 'Briefing generation failed.', messageCount: result.messageCount ?? 0 }
    }
    return result
    } finally {
      clearAccountWahaPrefs()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
})

app.put('/api/settings/gwb-upper-cam-youtube-url', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const raw = typeof body.url === 'string' ? body.url.trim() : ''
    if (raw.length > 512) {
      return reply.code(400).send({ error: 'URL is too long (max 512 characters).' })
    }
    if (raw && !extractYoutubeVideoIdFromInput(raw)) {
      return reply.code(400).send({
        error:
          'Paste a valid YouTube link (watch, youtu.be, embed, live, or shorts) or clear the field.',
      })
    }
    await setGwbUpperCamYoutubeUrlForAccount(ak.trim(), raw)
    return { ok: true, gwbUpperCamYoutubeUrl: raw }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

const HELPERS_RADIUS_NM_MIN = 0.25
const HELPERS_RADIUS_NM_MAX = 25

const WAHA_CHAT_ID_MAX = 256

app.put('/api/settings/waha-prefs', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const prefs = {}
    if (Object.prototype.hasOwnProperty.call(body, 'chatId')) {
      prefs.chatId = String(body.chatId ?? '').trim().slice(0, WAHA_CHAT_ID_MAX)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ttsEnabled')) {
      prefs.ttsEnabled = body.ttsEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'dailyBriefingEnabled')) {
      prefs.dailyBriefingEnabled = body.dailyBriefingEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'autoRespondPhoneEnabled')) {
      prefs.autoRespondPhoneEnabled = body.autoRespondPhoneEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'autoRespondWhereEnabled')) {
      prefs.autoRespondWhereEnabled = body.autoRespondWhereEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'autoRespondWhoAtEnabled')) {
      prefs.autoRespondWhoAtEnabled = body.autoRespondWhoAtEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'wahaUrl')) {
      prefs.wahaUrl = String(body.wahaUrl ?? '').trim().slice(0, 500)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'wahaApiKey')) {
      prefs.wahaApiKey = String(body.wahaApiKey ?? '').trim().slice(0, 500)
    }
    if (!Object.keys(prefs).length) {
      return reply.code(400).send({ error: 'Provide at least one WAHA preference field.' })
    }
    await setWahaPrefsForAccount(ak.trim(), prefs)
    const stored = await getWahaPrefsForAccount(ak.trim())
    return {
      ok: true,
      wahaChatId: stored.chatId,
      wahaTtsEnabled: stored.ttsEnabled,
      wahaDailyBriefingEnabled: stored.dailyBriefingEnabled,
      wahaAutoRespondPhoneEnabled: stored.autoRespondPhoneEnabled,
      wahaAutoRespondWhereEnabled: stored.autoRespondWhereEnabled,
      wahaAutoRespondWhoAtEnabled: stored.autoRespondWhoAtEnabled,
      wahaUrl: stored.wahaUrl || '',
      wahaApiKey: stored.wahaApiKey ? '••••' : '',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.put('/api/settings/smtp-prefs', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    /** @type {Record<string, unknown>} */
    const prefs = {}
    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) prefs.enabled = body.enabled === true
    if (Object.prototype.hasOwnProperty.call(body, 'host')) {
      prefs.host = String(body.host ?? '').trim().slice(0, 255)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'port')) {
      const p = Number(body.port)
      if (Number.isFinite(p)) prefs.port = Math.max(1, Math.min(65535, Math.floor(p)))
    }
    if (Object.prototype.hasOwnProperty.call(body, 'secure')) prefs.secure = body.secure === true
    if (Object.prototype.hasOwnProperty.call(body, 'user')) {
      prefs.user = String(body.user ?? '').trim().slice(0, 255)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'password')) {
      const pw = String(body.password ?? '').trim()
      if (pw && pw !== '••••') prefs.password = pw
    }
    if (Object.prototype.hasOwnProperty.call(body, 'fromEmail')) {
      prefs.fromEmail = String(body.fromEmail ?? '').trim().slice(0, 320)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'fromName')) {
      prefs.fromName = String(body.fromName ?? '').trim().slice(0, 120)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'notifyTo')) {
      prefs.notifyTo = String(body.notifyTo ?? '').trim().slice(0, 320)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'timezone')) {
      prefs.timezone = String(body.timezone ?? '').trim().slice(0, 64)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onNewTrip')) {
      prefs.onNewTrip = body.onNewTrip === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onPreplan')) {
      prefs.onPreplan = body.onPreplan === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onStatusChange')) {
      prefs.onStatusChange = body.onStatusChange === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onDriverMismatch')) {
      prefs.onDriverMismatch = body.onDriverMismatch === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onDispatchInstructions')) {
      prefs.onDispatchInstructions = body.onDispatchInstructions === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onDailyShiftSummary')) {
      prefs.onDailyShiftSummary = body.onDailyShiftSummary === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onWeeklySummary')) {
      prefs.onWeeklySummary = body.onWeeklySummary === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'tripCc')) {
      prefs.tripCc = String(body.tripCc ?? '').trim().slice(0, 960)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'dailyShiftCc')) {
      prefs.dailyShiftCc = String(body.dailyShiftCc ?? '').trim().slice(0, 960)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'weeklySummaryCc')) {
      prefs.weeklySummaryCc = String(body.weeklySummaryCc ?? '').trim().slice(0, 960)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'dailyDelayMins')) {
      const d = Number(body.dailyDelayMins)
      if (Number.isFinite(d)) prefs.dailyDelayMins = Math.max(0, Math.min(720, Math.floor(d)))
    }
    if (!Object.keys(prefs).length) {
      return reply.code(400).send({ error: 'Provide at least one SMTP field.' })
    }
    await setSmtpPrefsForAccount(ak.trim(), prefs)
    const stored = await getSmtpPrefsForAccount(ak.trim())
    return {
      ok: true,
      smtpEnabled: stored.enabled,
      smtpHost: stored.host,
      smtpPort: stored.port,
      smtpSecure: stored.secure,
      smtpUser: stored.user,
      smtpPassword: stored.password ? '••••' : '',
      smtpFromEmail: stored.fromEmail,
      smtpFromName: stored.fromName,
      emailNotifyTo: stored.notifyTo,
      emailTimezone: stored.timezone,
      emailOnNewTrip: stored.onNewTrip,
      emailOnPreplan: stored.onPreplan,
      emailOnStatusChange: stored.onStatusChange,
      emailOnDriverMismatch: stored.onDriverMismatch,
      emailOnDispatchInstructions: stored.onDispatchInstructions,
      emailOnDailyShift: stored.onDailyShiftSummary,
      emailOnWeeklySummary: stored.onWeeklySummary,
      emailTripCc: stored.tripCc,
      emailDailyShiftCc: stored.dailyShiftCc,
      emailWeeklySummaryCc: stored.weeklySummaryCc,
      emailDailyDelayMins: stored.dailyDelayMins,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/settings/smtp-test', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const kind = typeof body.kind === 'string' ? body.kind.trim() : 'smtp'
    const r = await sendTestEmailForKind(ak.trim(), kind)
    return { ok: true, kind, ...r }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/settings/email-test-kinds', async () => {
  return { kinds: EMAIL_TEST_KINDS }
})

const BB_CHAT_GUID_MAX = 512

app.put('/api/settings/bluebubbles-prefs', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    /** @type {Record<string, unknown>} */
    const prefs = { ensureWebhookToken: true }
    if (Object.prototype.hasOwnProperty.call(body, 'serverUrl')) {
      prefs.serverUrl = String(body.serverUrl ?? '').trim().slice(0, 500)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'password')) {
      prefs.password = String(body.password ?? '').trim().slice(0, 500)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'chatGuid')) {
      prefs.chatGuid = String(body.chatGuid ?? '').trim().slice(0, BB_CHAT_GUID_MAX)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ttsEnabled')) {
      prefs.ttsEnabled = body.ttsEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'autoReplyEnabled')) {
      prefs.autoReplyEnabled = body.autoReplyEnabled === true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'contactRules')) {
      prefs.contactRules = Array.isArray(body.contactRules) ? body.contactRules : []
    }
    const fieldCount = Object.keys(prefs).filter((k) => k !== 'ensureWebhookToken').length
    if (!fieldCount) {
      return reply.code(400).send({ error: 'Provide at least one BlueBubbles preference field.' })
    }
    await setBlueBubblesPrefsForAccount(ak.trim(), prefs)
    const stored = await getBlueBubblesPrefsForAccount(ak.trim())
    const appUrl = getPublicAppUrl(req)
    const webhookUrl = stored.webhookToken
      ? `${appUrl}/api/bluebubbles/webhook/${stored.webhookToken}`
      : ''
    return {
      ok: true,
      blueBubblesUrl: stored.serverUrl || '',
      blueBubblesPassword: stored.password ? '••••' : '',
      blueBubblesChatGuid: stored.chatGuid || '',
      blueBubblesTtsEnabled: stored.ttsEnabled,
      blueBubblesAutoReplyEnabled: stored.autoReplyEnabled,
      blueBubblesWebhookToken: stored.webhookToken || '',
      blueBubblesWebhookUrl: webhookUrl,
      blueBubblesContactRules: stored.contactRules || [],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/settings/bluebubbles-register-webhook', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    await setBlueBubblesPrefsForAccount(ak.trim(), { ensureWebhookToken: true })
    const stored = await getBlueBubblesPrefsForAccount(ak.trim())
    if (!stored.webhookToken) {
      return reply.code(500).send({ error: 'Could not generate webhook token.' })
    }
    const appUrl = getPublicAppUrl(req)
    const webhookUrl = `${appUrl}/api/bluebubbles/webhook/${stored.webhookToken}`
    applyBbClientPrefs(stored)
    try {
      const existing = await listBlueBubblesWebhooks()
      const list = Array.isArray(existing.body) ? existing.body : []
      const already = list.some((w) => w && typeof w === 'object' && w.url === webhookUrl)
      if (!already) {
        const reg = await registerBlueBubblesWebhook({
          url: webhookUrl,
          events: ['new-message', 'updated-message', 'typing-indicator'],
        })
        if (!reg.ok) {
          return reply.code(reg.status || 502).send({
            ok: false,
            error: reg.error || 'Failed to register webhook on BlueBubbles server.',
            webhookUrl,
          })
        }
      }
      return { ok: true, webhookUrl, registered: !already }
    } finally {
      clearBbClientPrefs()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.put('/api/settings/helpers-auto-arrive', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(400).send({ error: 'No account in session.' })
    }
    const body = req.body ?? {}
    const enabled = body.enabled === true
    const rawNm = body.radiusNm
    const nm =
      typeof rawNm === 'number' && Number.isFinite(rawNm)
        ? rawNm
        : typeof rawNm === 'string' && rawNm.trim()
          ? Number.parseFloat(rawNm.trim())
          : NaN
    if (!Number.isFinite(nm)) {
      return reply.code(400).send({ error: 'radiusNm must be a number (nautical miles).' })
    }
    if (nm < HELPERS_RADIUS_NM_MIN || nm > HELPERS_RADIUS_NM_MAX) {
      return reply.code(400).send({
        error: `radiusNm must be between ${HELPERS_RADIUS_NM_MIN} and ${HELPERS_RADIUS_NM_MAX} NM.`,
      })
    }
    await setHelpersAutoArrivePrefsForAccount(ak.trim(), { enabled, radiusNm: nm })
    return {
      ok: true,
      helpersAutoArriveNearDestEnabled: enabled,
      helpersAutoArriveRadiusNm: nm,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.get('/api/settings/api-quota', async (req, reply) => {
  const ak = req.credentialAccountKey
  if (typeof ak !== 'string' || !ak.trim()) {
    return reply.code(401).send({ error: 'Unauthorized' })
  }
  return getApiQuotaSnapshot(ak.trim())
})

app.put('/api/settings/api-quota-limits', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const body = req.body ?? {}
    const limits =
      body.limits && typeof body.limits === 'object' && !Array.isArray(body.limits)
        ? body.limits
        : {}
    return await setApiQuotaLimitOverrides(ak.trim(), limits)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/settings/api-quota-reset', async (req, reply) => {
  try {
    const ak = req.credentialAccountKey
    if (typeof ak !== 'string' || !ak.trim()) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    return await resetApiQuotaDayCounts(ak.trim())
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

app.get('/api/settings/devices', async (req) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return { ok: true, devices: [], maxSessions: MAX_SESSIONS_PER_ACCOUNT }
  }
  const sid = req.cookies?.[COOKIE_NAME]
  const devices = await listRegisteredDevices(ak, typeof sid === 'string' ? sid : '')
  return { ok: true, devices, maxSessions: MAX_SESSIONS_PER_ACCOUNT }
})

app.post('/api/settings/devices/register', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  try {
    const payload = parseDevicePayload(req.body ?? {})
    const device = await registerDeviceOnly(ak, payload, getClientIp(req))
    return { ok: true, device }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.put('/api/settings/devices/:deviceId', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  const deviceId = String(req.params?.deviceId ?? '').trim()
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  try {
    const device = await renameRegisteredDevice(ak, deviceId, name)
    return { ok: true, device }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.delete('/api/settings/devices/:deviceId/session', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  const deviceId = String(req.params?.deviceId ?? '').trim()
  const sid = req.cookies?.[COOKIE_NAME]
  try {
    const list = await listRegisteredDevices(ak, typeof sid === 'string' ? sid : '')
    const target = list.find((d) => d.id === deviceId)
    if (target?.isCurrent) {
      return reply.code(400).send({
        ok: false,
        error: 'Use Sign out to end this device session.',
      })
    }
    const result = await revokeDeviceSession(ak, deviceId)
    return { ok: true, ...result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.delete('/api/settings/devices/:deviceId', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  const deviceId = String(req.params?.deviceId ?? '').trim()
  const sid = req.cookies?.[COOKIE_NAME]
  try {
    const list = await listRegisteredDevices(ak, typeof sid === 'string' ? sid : '')
    const target = list.find((d) => d.id === deviceId)
    if (target?.isCurrent) {
      return reply.code(400).send({
        ok: false,
        error: 'Sign out before removing this device.',
      })
    }
    await deleteRegisteredDevice(ak, deviceId)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.post('/api/settings/devices/touch', async (req, reply) => {
  const ak = String(req.credentialAccountKey || getDataAccountKey() || '').trim()
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : ''
  if (!deviceId) {
    return reply.code(400).send({ ok: false, error: 'deviceId required' })
  }
  try {
    const device = await touchCurrentDevice(ak, deviceId, getClientIp(req))
    return { ok: true, device }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.get('/api/settings/bridge-traffic-export', async (_req, reply) => {
  try {
    const data = await buildBridgeTrafficExport()
    return { ok: true, ...data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(500).send({ ok: false, error: msg })
  }
})

app.get('/api/settings/bridge-traffic-profiles', async (req) => {
  const ak = /** @type {any} */ (req).credentialAccountKey
  if (!ak) {
    return { ok: true, overrides: {}, updatedAt: null }
  }
  const { overrides, updatedAt } = await readBridgeTrafficProfileOverrides(ak)
  return { ok: true, overrides, updatedAt }
})

app.put('/api/settings/bridge-traffic-profiles', async (req, reply) => {
  const ak = /** @type {any} */ (req).credentialAccountKey
  if (!ak) {
    return reply.code(401).send({ error: 'Not signed in' })
  }
  const raw = req.body?.overrides
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return reply.code(400).send({ error: 'Provide { overrides: { profileKey: { ... } } }' })
  }
  try {
    const doc = await writeBridgeTrafficProfileOverrides(ak, raw)
    return { ok: true, overrides: doc.overrides, updatedAt: doc.updatedAt }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
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

app.get('/api/fedex/linehaul/view-trip-info-details', async (req, reply) => {
  const q = req.query ?? {}
  const orgOrigin =
    typeof q.orgIdOrigin === 'string' && q.orgIdOrigin.trim()
      ? q.orgIdOrigin.trim()
      : ''
  const orgDest =
    typeof q.orgIdDest === 'string' && q.orgIdDest.trim()
      ? q.orgIdDest.trim()
      : ''
  if (!DIGITS_RE.test(orgOrigin) || !DIGITS_RE.test(orgDest)) {
    return reply.code(400).send({
      error: 'Pass orgIdOrigin and orgIdDest (digits only).',
    })
  }
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return reply.code(401).send({
      error:
        'No FedEx Linehaul bearer token on file. Use Settings → Capture Linehaul token, or save a token under Driver Credentials.',
    })
  }

  let originIdHeader =
    typeof q.originId === 'string' && q.originId.trim() ? q.originId.trim() : ''
  if (!originIdHeader) {
    const tractorNbr = await getTractorNumber()
    if (tractorNbr && DIGITS_RE.test(String(tractorNbr).trim())) {
      const tr = await linehaulGet('tractor', String(tractorNbr).trim(), bearer)
      const lid = tr.body?.locationId
      if (lid != null && String(lid).trim() !== '') {
        originIdHeader = String(lid).trim()
      }
    }
  }

  const emp = (await getEmployeeNumber()) || ''
  const pad = (n) => String(n).padStart(2, '0')
  const now = new Date()
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const correlationId =
    emp && DIGITS_RE.test(emp)
      ? `MTA_${emp}_${ts}`
      : `MTA_${ts}`

  const result = await linehaulViewTripInfoDetailsGet(orgOrigin, orgDest, bearer, {
    originIdHeader: originIdHeader || orgOrigin,
    correlationId,
  })
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

app.get('/api/directory/geocode-status', async () => getDirectoryGeocodeStatus())

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
    /** @type {Record<string, unknown>} */
    const patch = {}
    if ('phone' in body) patch.phone = typeof body.phone === 'string' ? body.phone : ''
    if ('locationName' in body) patch.locationName = body.locationName
    if ('abbreviation' in body) patch.abbreviation = body.abbreviation
    if ('address' in body) patch.address = body.address
    if ('locationId' in body && body.locationId != null) {
      patch.locationId =
        typeof body.locationId === 'string' ? body.locationId : String(body.locationId)
    }
    if ('latitude' in body) {
      const v = body.latitude
      if (v == null || v === '') {
        patch.latitude = null
      } else {
        const n = Number(v)
        patch.latitude = Number.isFinite(n) ? n : null
      }
    }
    if ('longitude' in body) {
      const v = body.longitude
      if (v == null || v === '') {
        patch.longitude = null
      } else {
        const n = Number(v)
        patch.longitude = Number.isFinite(n) ? n : null
      }
    }
    const result = await patchLocation(locationId, patch)
    return { ok: true, ...result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = /not found/i.test(msg) ? 404 : 400
    return reply.code(code).send({ error: msg })
  }
})

app.post('/api/directory/bulk', async (req, reply) => {
  try {
    const body = req.body ?? {}
    const entries = Array.isArray(body.entries) ? body.entries : []
    if (entries.length === 0) {
      return reply.code(400).send({ error: 'entries array is required and must not be empty' })
    }
    const result = await bulkUpsertLocations(entries)
    return { ok: true, ...result }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ error: msg })
  }
})

app.post('/api/directory/geocode-missing', async (req, reply) => {
  try {
    const body = req.body ?? {}
    const max = Math.min(40, Math.max(1, Number(body.max) || 18))
    const delayMs = Math.min(3000, Math.max(850, Number(body.delayMs) || 1000))
    const result = await geocodeMissingDirectoryLocations({ max, delayMs })
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
  }
})

app.post('/api/directory/:locationId/geocode', async (req, reply) => {
  try {
    const rawId = req.params?.locationId
    const locationId =
      typeof rawId === 'string'
        ? rawId.trim()
        : rawId != null
          ? String(rawId).trim()
          : ''
    if (!locationId) {
      return reply.code(400).send({ ok: false, error: 'locationId is required' })
    }
    const result = await geocodeDirectoryLocationById(locationId)
    if (!result.ok) {
      return reply.code(400).send(result)
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return reply.code(400).send({ ok: false, error: msg })
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
  /** Default on for faster dispatch gate / tighter navigation timeout. */
  const fastDispatchGate = body.fastDispatchGate !== false
  const tokenQuietMs =
    typeof body.tokenQuietMs === 'number' && body.tokenQuietMs >= 0
      ? body.tokenQuietMs
      : undefined
  const navigationTimeoutMs =
    typeof body.navigationTimeoutMs === 'number' && body.navigationTimeoutMs > 0
      ? body.navigationTimeoutMs
      : undefined
  const sid = req.cookies?.[COOKIE_NAME]
  const ak = getSessionAccountKey(sid)
  try {
    const runCapture = () =>
      captureAndSaveLinehaulBearer({
        headless,
        tryOktaLogin,
        clearSession,
        bypassValidityProbe,
        fastDispatchGate,
        ...(tokenQuietMs !== undefined ? { tokenQuietMs } : {}),
        ...(navigationTimeoutMs !== undefined ? { navigationTimeoutMs } : {}),
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
    const credPhone = (await getDriverPhone()).trim()
    const a = await readAssignment()
    if (!(credPhone || (a.driverPhone || '').trim())) {
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
  cancelAllPlaywrightRuns()
  const idle = await waitForPlaywrightIdle()
  return { ok: true, idle }
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

/** In-browser Inspect & Check Out: yes/no confirm (e.g. manual Add Dolly). */
app.post('/api/run/retry-inspect-confirm', async (req, reply) => {
  const { runId, confirmed } = req.body ?? {}
  if (!runId || typeof runId !== 'string') {
    return reply.code(400).send({ error: 'runId required' })
  }
  const r = submitBlockInspectConfirm(runId, confirmed === true)
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
  const { headless = true, slowMo = 0, tripData = {}, preempt = false } = req.body ?? {}
  if (isAnyPlaywrightRunnerBusy()) {
    if (!preempt) {
      return reply.code(409).send({ error: 'Runner busy' })
    }
    cancelAllPlaywrightRuns()
    const idle = await waitForPlaywrightIdle()
    if (!idle) {
      return reply.code(503).send({ error: 'Runner still busy after cancel' })
    }
  }
  const auto = await getAutomation(req.params.id)
  if (!auto) return reply.code(404).send({ error: 'Automation not found' })
  try {
    const result = await runAutomation(auto, { headless, slowMo, tripData })
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
    setHeaders(res, filePath) {
      const base = path.basename(filePath)
      if (base === 'index.html' || base === 'build-meta.json') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        res.setHeader('Pragma', 'no-cache')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
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
if (process.env.NODE_ENV === 'production' && host === '127.0.0.1') {
  console.warn(
    '[startup] FEDEX_TOOL_API_HOST is 127.0.0.1 — Traefik/Dokploy need 0.0.0.0 or the container will return 502.',
  )
}

try {
  await requirePostgresOrThrow({ attempts: 12, delayMs: 2500 })
  await ensureUserProfileTable()
  await ensureWahaChatHistoryTable()
  await ensureBlueBubblesChatHistoryTable()
} catch (e) {
  console.error('[postgres]', (e && e.message) || e)
  process.exit(1)
}
try {
  await runDataMigrationOnStartup()
} catch (e) {
  console.error('[data-migration]', (e && e.message) || e)
  process.exit(1)
}
try {
  await mergeFedexGroundDirectorySeed()
} catch (e) {
  console.error('[fedex-ground-seed]', (e && e.message) || e)
}

/* ═══════════════════ Pre-entered trailer numbers ═══════════════════ */
import { getTrailerNumbers, putTrailerNumber } from './trailer-number-store.mjs'

app.get('/api/trailer-numbers/:legSeq', async (req, reply) => {
  const legSeq = String(req.params.legSeq || '').trim()
  if (!legSeq) return reply.code(400).send({ error: 'legSeq required' })
  try {
    const numbers = await getTrailerNumbers(legSeq)
    return { ok: true, legSeq, numbers }
  } catch (e) {
    return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) })
  }
})

app.put('/api/trailer-numbers', async (req, reply) => {
  try {
    const b = req.body ?? {}
    const legSeq = String(b.legSeq || '').trim()
    const trailerIndex = Number(b.trailerIndex)
    const number = String(b.number || '').trim()
    if (!legSeq) return reply.code(400).send({ error: 'legSeq required' })
    if (!trailerIndex || trailerIndex < 1) return reply.code(400).send({ error: 'trailerIndex required (1-based)' })
    if (!number) return reply.code(400).send({ error: 'number required' })
    const numbers = await putTrailerNumber(legSeq, trailerIndex, number)
    return { ok: true, legSeq, numbers }
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) })
  }
})

/* ═══════════════════ Dispatch proof screenshots ═══════════════════ */
import { getDispatchProof } from './dispatch-proof-store.mjs'

app.get('/api/dispatch-proof/:legSeq', async (req, reply) => {
  const legSeq = String(req.params.legSeq || '').trim()
  if (!legSeq) return reply.code(400).send({ error: 'legSeq required' })
  try {
    const screenshots = await getDispatchProof(legSeq)
    return { ok: true, legSeq, screenshots }
  } catch (e) {
    return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) })
  }
})

await refreshPanynjCrossingData().catch((e) => {
  console.error('[bridge-panynj] initial', (e && e.message) || e)
})
startPanynjBridgePoll((e) => {
  console.error('[bridge-panynj]', (e && e.message) || e)
})

try {
  await app.listen({ port: API_PORT, host })
  const url = `http://${host}:${API_PORT}`
  console.log(`FedEx tool API listening on ${url}`)
  emitLog('info', `FedEx tool API listening on ${url}`)
  startDirectoryGeocodeBackground()
  startEmailScheduler()
} catch (e) {
  console.error(e)
  process.exit(1)
}
