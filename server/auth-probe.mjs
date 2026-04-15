import { ensureContext, getOrCreatePage } from './playwright/browser.mjs'
import { ensureDispatchAppReady } from './playwright/dispatchAuthGate.mjs'
import { DISPATCH_ENTRY_URL } from './config.mjs'

/**
 * Verify FedEx PurpleID credentials by opening dispatch and running the same Okta gate as check-in.
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
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
