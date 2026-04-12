/**
 * Capture FedEx Linehaul Apigee JWT from fdxtools browser traffic and persist via saveCredentials.
 */

import { DISPATCH_ENTRY_URL } from '../config.mjs'
import { emitLog } from '../log-bus.mjs'
import {
  getDecryptedLinehaulBearer,
  getLinehaulDriverId,
  getTractorNumber,
  saveCredentials,
} from '../credentials-store.mjs'
import { linehaulGet, isLinehaulApigeeUrl } from '../fedex-linehaul-api.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { ensureContext, getOrCreatePage } from './browser.mjs'

/** @type {boolean} */
let captureBusy = false

export function isLinehaulCaptureBusy() {
  return captureBusy
}

/**
 * @param {string | undefined} raw
 * @returns {string | null} raw JWT without "Bearer " prefix
 */
export function parseBearerFromAuthHeader(raw) {
  if (raw == null || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  if (/^bearer\s+/i.test(s)) {
    s = s.replace(/^bearer\s+/i, '').trim()
  }
  if (!s) return null
  const parts = s.split('.')
  if (parts.length < 3) return null
  return s
}

/**
 * @param {import('playwright').Request} request
 * @returns {string | null}
 */
function tokenFromRequest(request) {
  if (!isLinehaulApigeeUrl(request.url())) return null
  const h = request.headers()
  const raw = h.authorization ?? h.Authorization
  return parseBearerFromAuthHeader(raw)
}

/**
 * If a bearer exists and a cheap Linehaul GET succeeds, skip browser capture.
 * @returns {Promise<{ skipBrowser: boolean, reason?: string }>}
 */
async function probeExistingBearer() {
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    return { skipBrowser: false, reason: 'no_bearer_on_file' }
  }

  const driverId = await getLinehaulDriverId()
  if (driverId && /^\d+$/.test(driverId)) {
    const r = await linehaulGet('driver', driverId, bearer)
    if (r.status === 200 && r.ok) {
      return { skipBrowser: true, reason: 'token_ok' }
    }
    if (r.status === 401 || r.status === 403) {
      return { skipBrowser: false, reason: 'token_unauthorized' }
    }
  }

  const tractor = await getTractorNumber()
  if (tractor && /^\d+$/.test(tractor)) {
    const r = await linehaulGet('tractor', tractor, bearer)
    if (r.status === 200 && r.ok) {
      return { skipBrowser: true, reason: 'token_ok' }
    }
    if (r.status === 401 || r.status === 403) {
      return { skipBrowser: false, reason: 'token_unauthorized' }
    }
  }

  return { skipBrowser: false, reason: 'cannot_probe_need_browser' }
}

/** Truncate long URLs for logs (no secrets). */
function shortUrl(u) {
  try {
    const x = new URL(u)
    const s = `${x.hostname}${x.pathname}`
    return s.length > 120 ? `${s.slice(0, 117)}…` : s
  } catch {
    return u.length > 120 ? `${u.slice(0, 117)}…` : u
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Open fdxtools, wait for Apigee Linehaul request, save JWT.
 * @param {{
 *   tryOktaLogin?: boolean
 *   headless?: boolean
 *   slowMo?: number
 *   signal?: AbortSignal
 *   waitMs?: number
 *   clearSession?: boolean
 *   bypassValidityProbe?: boolean
 * }} [opts]
 */
export async function captureAndSaveLinehaulBearer(opts = {}) {
  if (captureBusy) {
    throw new Error('Linehaul capture already in progress')
  }
  captureBusy = true

  const {
    tryOktaLogin = true,
    headless = true,
    slowMo = 0,
    signal,
    waitMs = 180_000,
    clearSession = true,
    bypassValidityProbe = false,
  } = opts

  const log = (/** @type {string} */ type, /** @type {string} */ message) => {
    emitLog(type, message)
  }

  try {
    if (!bypassValidityProbe) {
      const probe = await probeExistingBearer()
      if (probe.skipBrowser) {
        log('info', 'Linehaul bearer token already valid — skipping browser capture')
        return { ok: true, skipped: true, reason: probe.reason ?? 'token_ok' }
      }
    }
    log('info', '[Linehaul capture] Starting (verbose). Headless session will load fdxtools; sign-in runs if needed.')
    await ensureContext({ headless, slowMo })
    const page = await getOrCreatePage()
    const ctx = page.context()

    if (clearSession) {
      log(
        'info',
        '[Linehaul capture] Clearing browser cookies for this profile so fdxtools requires a fresh sign-in.',
      )
      await ctx.clearCookies()
      log('info', '[Linehaul capture] Cookies cleared.')
    } else {
      log(
        'info',
        '[Linehaul capture] Keeping existing session (clearSession=false) — may skip PurpleID if already logged in.',
      )
    }

    /** @type {string | null} */
    let capturedLinehaul = null
    /** @type {string | null} */
    let capturedDriverName = null
    /** Throttle noisy Linehaul request logs */
    let lastLinehaulReqLog = 0

    /**
     * Check if response is Okta userinfo endpoint.
     * @param {string} url
     */
    function isOktaUserinfoUrl(url) {
      return /purpleid\.okta\.com/i.test(url) && url.includes('/v1/userinfo')
    }

    const onRequest = (/** @type {import('playwright').Request} */ request) => {
      const url = request.url()
      if (isLinehaulApigeeUrl(url)) {
        const now = Date.now()
        if (now - lastLinehaulReqLog > 400) {
          lastLinehaulReqLog = now
          const h = request.headers()
          const raw = h.authorization ?? h.Authorization
          const hasAuth = Boolean(parseBearerFromAuthHeader(raw))
          log(
            'detail',
            `[Linehaul capture] Apigee Linehaul ${request.method()} ${shortUrl(url)} — Authorization header: ${hasAuth ? 'present' : 'missing'}`,
          )
        }
      }
      if (!capturedLinehaul) {
        const t = tokenFromRequest(request)
        if (t) {
          capturedLinehaul = t
          log(
            'info',
            `[Linehaul capture] Captured JWT from browser (${t.length} chars). Saving…`,
          )
        }
      }
    }

    const onFrameNav = (/** @type {import('playwright').Frame} */ frame) => {
      if (frame === page.mainFrame()) {
        log('detail', `[Linehaul capture] Navigate → ${frame.url()}`)
      }
    }

    const onConsole = (/** @type {import('playwright').ConsoleMessage} */ msg) => {
      const t = msg.type()
      if (t === 'error' || t === 'warning') {
        log('warn', `[Linehaul capture] Browser ${t}: ${msg.text()}`)
      }
    }

    const onResponse = async (/** @type {import('playwright').Response} */ response) => {
      if (capturedDriverName) return
      try {
        const url = response.url()
        if (!isOktaUserinfoUrl(url)) return
        if (response.status() !== 200) return
        const body = await response.json()
        const g = typeof body.given_name === 'string' ? body.given_name.trim() : ''
        const f = typeof body.family_name === 'string' ? body.family_name.trim() : ''
        let name = [g, f].filter(Boolean).join(' ')
        if (!name && typeof body.name === 'string') {
          name = body.name.trim()
        }
        if (name) {
          capturedDriverName = name
          log('info', `[Linehaul capture] Captured driver name from userinfo: ${name}`)
        }
      } catch {
        /* ignore parse errors */
      }
    }

    page.on('request', onRequest)
    page.on('response', onResponse)
    page.on('framenavigated', onFrameNav)
    page.on('console', onConsole)

    try {
      log('info', `[Linehaul capture] Loading dispatch URL: ${DISPATCH_ENTRY_URL}`)
      await page.goto(DISPATCH_ENTRY_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 120_000,
      })
      const title = (await page.title().catch(() => '')).trim()
      log(
        'info',
        `[Linehaul capture] After goto — url=${page.url()}${title ? ` title="${title}"` : ''}`,
      )

      log(
        'info',
        '[Linehaul capture] Running dispatch gate (PurpleID / Okta / stable fdxtools home)…',
      )
      await ensureDispatchAppReady(page, { tryOktaLogin, log, signal })
      log(
        'info',
        `[Linehaul capture] Dispatch gate finished — url=${page.url()}`,
      )

      const waitStarted = Date.now()
      const deadline = waitStarted + waitMs
      let lastHeartbeat = Date.now()
      while (!capturedLinehaul && Date.now() < deadline) {
        if (signal?.aborted) throw new Error('Aborted')
        const now = Date.now()
        if (now - lastHeartbeat >= 10_000) {
          lastHeartbeat = now
          const elapsed = Math.floor((now - waitStarted) / 1000)
          log(
            'info',
            `[Linehaul capture] Still waiting for Linehaul JWT (${elapsed}s) — page=${page.url()}`,
          )
        }
        await sleep(250, signal)
      }

      if (!capturedLinehaul) {
        throw new Error(
          'Timed out waiting for a Linehaul Apigee request with Authorization. Stay on dispatch home until the app loads Linehaul data, or try headed mode / complete sign-in.',
        )
      }

      await saveCredentials({
        fedexLinehaulBearer: capturedLinehaul,
        ...(capturedDriverName ? { driverName: capturedDriverName } : {}),
      })
      log('info', '[Linehaul capture] Linehaul bearer token saved to encrypted credentials.')
      if (capturedDriverName) {
        log('info', `[Linehaul capture] Driver name saved: ${capturedDriverName}`)
      }
      return { ok: true, saved: true, reason: 'captured' }
    } finally {
      page.off('request', onRequest)
      page.off('response', onResponse)
      page.off('framenavigated', onFrameNav)
      page.off('console', onConsole)
    }
  } finally {
    captureBusy = false
  }
}
