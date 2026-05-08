import { captureAndSaveLinehaulBearer } from './playwright/linehaulBearerCapture.mjs'
import { PURPLEID_SIGNIN_MESSAGE } from './playwright/dispatchAuthGate.mjs'

/**
 * Hard cap for app login (sign-in + token scrape). Okta + fdxtools + JWT often exceed 1–2 minutes.
 * Override with FEDEX_LOGIN_PROBE_MS (milliseconds).
 */
const LOGIN_TOTAL_MS = Number(process.env.FEDEX_LOGIN_PROBE_MS ?? 420_000)

/** After dispatch gate, wait for first Linehaul Apigee request with Authorization. */
const LOGIN_JWT_WAIT_MS = Number(process.env.FEDEX_LOGIN_JWT_WAIT_MS ?? 360_000)

/**
 * Map Playwright / gate errors to user-facing messages. Avoid blaming "wrong password" for timeouts.
 * @param {unknown} err
 * @returns {string}
 */
function mapLoginProbeError(err) {
  const msg = err instanceof Error ? err.message : String(err)
  const low = msg.toLowerCase()

  if (msg === 'Aborted') {
    return 'Sign-in took too long. Try again on a stable connection.'
  }
  if (/linehaul capture already in progress/i.test(msg)) {
    return 'Another sign-in is running. Try again in a moment.'
  }
  if (/purpleid automatic sign-in did not complete/i.test(msg)) {
    return 'PurpleID step did not finish. Check username and password, or try again.'
  }
  if (
    /timed out waiting for a linehaul/i.test(msg) ||
    /timed out waiting for linehaul/i.test(low)
  ) {
    return 'Signed in, but Linehaul did not load in time. Wait and try again, or check VPN/network.'
  }
  if (
    /timed out waiting for fedex ground dispatch/i.test(msg) ||
    /timed out waiting for fedex ground/i.test(low)
  ) {
    return 'FedEx dispatch did not load after PurpleID. Try again or check network/VPN.'
  }
  if (/runner or linehaul capture busy/i.test(msg)) {
    return 'Could not verify credentials. Try again in a moment.'
  }
  if (
    msg.includes(PURPLEID_SIGNIN_MESSAGE) ||
    /save your fedex username and password/i.test(low)
  ) {
    return 'FedEx opened PurpleID sign-in; saved credentials are missing or could not be used. Check Settings or try again.'
  }
  if (/net::err/i.test(low) || /econnrefused/i.test(low) || /enotfound/i.test(low)) {
    return 'Network error reaching FedEx. Check connection and try again.'
  }
  if (/timeout/i.test(low) && /exceeded/i.test(low)) {
    return 'Sign-in timed out (FedEx or Okta was slow). Try again.'
  }

  return 'Sign-in could not be verified. Try again; if this persists, check credentials or server logs.'
}

/**
 * App login: capture path with inline credentials — success when API token is saved.
 * Uses full (non-fast) dispatch gate timeouts so headless login matches bearer capture reliability.
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
      credentialOverride: { username, password },
      /** Full dispatch / Okta waits — fast mode was capped ~15s total and caused false failures */
      fastDispatchGate: false,
    })
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: mapLoginProbeError(e),
    }
  } finally {
    clearTimeout(timer)
  }
}
