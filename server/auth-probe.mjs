import { captureAndSaveLinehaulBearer } from './playwright/linehaulBearerCapture.mjs'

/**
 * App login: same path as Settings → capture token — open dispatch, sign in, scrape API token.
 * Success when a Linehaul JWT is captured and saved.
 *
 * @param {{ username: string, password: string }} creds
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function verifyAppLoginWithBearerCapture(creds) {
  const username = typeof creds.username === 'string' ? creds.username.trim() : ''
  const password = typeof creds.password === 'string' ? creds.password : ''
  if (!username || !password) {
    return { ok: false, error: 'Username and password are required.' }
  }

  const ac = new AbortController()
  const timeoutMs = 120_000
  const timer = setTimeout(() => ac.abort(), timeoutMs)

  try {
    await captureAndSaveLinehaulBearer({
      tryOktaLogin: true,
      headless: true,
      clearSession: true,
      bypassValidityProbe: true,
      signal: ac.signal,
      waitMs: 90_000,
      credentialOverride: { username, password },
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'Aborted') {
      return {
        ok: false,
        error:
          'Sign-in timed out. Check your network and try again.',
      }
    }
    if (/Linehaul capture already in progress/i.test(msg)) {
      return {
        ok: false,
        error: 'Another sign-in is running. Try again in a moment.',
      }
    }
    if (
      /timed out waiting for a Linehaul/i.test(msg) ||
      /Runner or Linehaul capture busy/i.test(msg)
    ) {
      return {
        ok: false,
        error: 'Could not verify credentials. Try again.',
      }
    }
    return {
      ok: false,
      error: 'Wrong username or password.',
    }
  } finally {
    clearTimeout(timer)
  }
}
