import { ensureContext, getOrCreatePage } from './playwright/browser.mjs'
import { ensureDispatchAppReady, isLikelyOktaAuthUrl } from './playwright/dispatchAuthGate.mjs'
import {
  DISPATCH_ENTRY_URL,
  DISPATCH_LOGIN_SUCCESS_PATH,
} from './config.mjs'

const DISPATCH_ORIGIN = 'https://fdxtools.fedex.com'

/**
 * @param {string} urlString
 */
export function isDispatchLoginSuccessUrl(urlString) {
  try {
    const u = new URL(urlString)
    if (!u.hostname.includes('fdxtools.fedex.com')) return false
    const p = u.pathname.replace(/\/+$/, '') || '/'
    const t = DISPATCH_LOGIN_SUCCESS_PATH.replace(/\/+$/, '') || '/'
    return p === t
  } catch {
    return false
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {AbortSignal | undefined} signal
 * @param {number} maxMs
 */
async function sleep(ms, signal) {
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
 * After Okta gate, wait until URL matches dispatch nested home (or navigate there once in-session).
 * @param {import('playwright').Page} page
 * @param {AbortSignal | undefined} signal
 */
async function ensureDispatchLoginSuccessUrl(page, signal) {
  const step = 500
  const phase1Ms = 20_000
  const deadline1 = Date.now() + phase1Ms

  while (Date.now() < deadline1) {
    if (signal?.aborted) throw new Error('Aborted')
    if (isDispatchLoginSuccessUrl(page.url())) return
    await sleep(step, signal)
  }

  if (isDispatchLoginSuccessUrl(page.url())) return

  const pathPart = DISPATCH_LOGIN_SUCCESS_PATH.startsWith('/')
    ? DISPATCH_LOGIN_SUCCESS_PATH
    : `/${DISPATCH_LOGIN_SUCCESS_PATH}`
  const target = `${DISPATCH_ORIGIN}${pathPart}`
  try {
    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
  } catch {
    /* fall through to poll */
  }

  const deadline2 = Date.now() + 25_000
  while (Date.now() < deadline2) {
    if (signal?.aborted) throw new Error('Aborted')
    if (isLikelyOktaAuthUrl(page.url())) {
      throw new Error('BAD_CREDENTIALS')
    }
    if (isDispatchLoginSuccessUrl(page.url())) return
    await sleep(step, signal)
  }

  if (!isDispatchLoginSuccessUrl(page.url())) {
    throw new Error('BAD_CREDENTIALS')
  }
}

/**
 * Verify FedEx PurpleID credentials by opening dispatch and running the same Okta gate as check-in.
 * Success = session reaches `DISPATCH_LOGIN_SUCCESS_PATH` on fdxtools (default: …/grdlhldispatch/grdlhldispatch/home).
 * Does not read or write the credentials file — uses inline username/password only.
 *
 * @param {{ username: string, password: string }} creds
 * @param {{ log?: (type: string, message: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function verifyCredentialsWithDispatchGate(creds, opts = {}) {
  const log = opts.log ?? (() => {})
  const username = typeof creds.username === 'string' ? creds.username.trim() : ''
  const password = typeof creds.password === 'string' ? creds.password : ''
  if (!username || !password) {
    return { ok: false, error: 'Username and password are required.' }
  }

  await ensureContext({ headless: true })
  const page = await getOrCreatePage()
  const ac = new AbortController()
  const timeoutMs = 180_000
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  try {
    await page.goto(DISPATCH_ENTRY_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await ensureDispatchAppReady(page, {
      tryOktaLogin: true,
      signal: ac.signal,
      credentialOverride: { username, password },
      log: (type, msg) => log(type, msg),
    })
    await ensureDispatchLoginSuccessUrl(page, ac.signal)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'Aborted') {
      return {
        ok: false,
        error:
          'Sign-in timed out. Check network and credentials, then try again.',
      }
    }
    if (msg === 'BAD_CREDENTIALS') {
      return {
        ok: false,
        error:
          'Bad credentials. Sign-in did not complete to FedEx dispatch home.',
      }
    }
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
