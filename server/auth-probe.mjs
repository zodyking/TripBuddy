import { captureAndSaveLinehaulBearer } from './playwright/linehaulBearerCapture.mjs'

/** Hard cap for app login (sign-in + token scrape). */
const LOGIN_TOTAL_MS = 15_000

/**
 * App login: capture path with inline credentials — success when API token is saved.
 * Aborts at LOGIN_TOTAL_MS; uses fast dispatch gate + short JWT wait.
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
  const timer = setTimeout(() => ac.abort(), LOGIN_TOTAL_MS)

  try {
    await captureAndSaveLinehaulBearer({
      tryOktaLogin: true,
      headless: true,
      clearSession: true,
      bypassValidityProbe: true,
      signal: ac.signal,
      waitMs: 12_000,
      credentialOverride: { username, password },
      fastDispatchGate: true,
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'Aborted') {
      return {
        ok: false,
        error: 'Sign-in took too long. Try again.',
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
