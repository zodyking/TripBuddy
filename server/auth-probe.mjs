import {
  verifyPasswordForAccountKey,
  getUsernameForAccountKey,
  getDecryptedLinehaulBearer,
  getLinehaulDriverId,
  getTractorNumber,
} from './credentials-store.mjs'
import { linehaulGet } from './fedex-linehaul-api.mjs'
import { captureAndSaveLinehaulBearer } from './playwright/linehaulBearerCapture.mjs'

/** Hard cap for headless FedEx/PurpleID login (navigation + gate + JWT capture). */
const LOGIN_TOTAL_MS = Number(process.env.FEDEX_LOGIN_TOTAL_MS) || 180_000

/** Playwright navigation timeout for login (must be less than total budget). */
const LOGIN_NAV_MS = Number(process.env.FEDEX_LOGIN_NAV_MS) || 85_000

/** Time after dispatch gate to wait for first Linehaul Apigee JWT in network. */
const LOGIN_JWT_WAIT_MS = Number(process.env.FEDEX_LOGIN_JWT_WAIT_MS) || 95_000

/**
 * When the typed password matches what we have on file and the stored Linehaul JWT
 * still works against FedEx Apigee, skip Playwright entirely (fast re-login).
 *
 * Always falls through to headless login when the password changed, token expired,
 * or we cannot probe driver/tractor.
 *
 * @param {string} accountKey
 * @param {string} username
 * @param {string} password
 * @returns {Promise<boolean>}
 */
export async function tryFedexBearerReuseLogin(accountKey, username, password) {
  const ak = String(accountKey || '').trim()
  const u = String(username || '').trim()
  const p = typeof password === 'string' ? password : ''
  if (!ak || !u || !p) return false

  const storedUser = await getUsernameForAccountKey(ak)
  if (storedUser && storedUser.toLowerCase() !== u.toLowerCase()) return false

  const hashOk = await verifyPasswordForAccountKey(ak, p)
  if (!hashOk) return false

  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) return false

  const driverId = await getLinehaulDriverId()
  if (driverId && /^\d+$/.test(driverId)) {
    try {
      const r = await linehaulGet('driver', driverId, bearer)
      if (r.ok && r.status === 200) return true
      if (r.status === 401 || r.status === 403) return false
    } catch {
      return false
    }
  }

  const tractor = await getTractorNumber()
  if (tractor && /^\d+$/.test(tractor)) {
    try {
      const r = await linehaulGet('tractor', tractor, bearer)
      if (r.ok && r.status === 200) return true
      if (r.status === 401 || r.status === 403) return false
    } catch {
      return false
    }
  }

  return false
}

/**
 * App login: capture path with inline credentials — success when API token is saved.
 * Aborts at LOGIN_TOTAL_MS; uses fast dispatch gate + JWT wait tuned for real FedEx loads.
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
      waitMs: LOGIN_JWT_WAIT_MS,
      navigationTimeoutMs: LOGIN_NAV_MS,
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
