import { tryOktaAutoLogin } from './oktaLogin.mjs'
import { getUsername, getDecryptedPassword } from '../credentials-store.mjs'
import { DISPATCH_STABLE_MS } from '../config.mjs'

const OKTA_HOST_RE = /purpleid\.okta\.com|\.okta\.com|oktapreview\.com/i

export const PURPLEID_SIGNIN_MESSAGE =
  'FedEx opened PurpleID sign-in. Save username and password in Settings (Sign-in) and enable Okta auto-login for headless Check in, or complete sign-in in a headed browser session, then run Check in again.'

/**
 * @param {string} url
 */
export function isLikelyOktaAuthUrl(url) {
  return OKTA_HOST_RE.test(url)
}

/**
 * @param {string} url
 */
export function isDispatchFedExAppUrl(url) {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('fedex.com')) return false
    return (
      u.hostname.includes('fdxtools.fedex.com') ||
      u.pathname.includes('grdlhldispatch')
    )
  } catch {
    return false
  }
}

/**
 * @param {number} ms
 * @param {AbortSignal | undefined} signal
 */
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
 * If the page is still on PurpleID/Okta, fail fast for check-in (safety net).
 * @param {import('playwright').Page} page
 */
export function assertNotStuckOnPurpleId(page) {
  const url = page.url()
  if (isLikelyOktaAuthUrl(url)) {
    throw new Error(PURPLEID_SIGNIN_MESSAGE)
  }
}

/**
 * Okta branch runs full login + wait for dispatch (stable).
 * Stable dispatch: log and finish gate.
 * @returns {Promise<boolean>} true if this gate is fully done (caller should return)
 */
async function spinStableDispatchOrHandleOkta(
  page,
  { tryOktaLogin, log, signal, dispatchWaitMs, step },
  untilTs,
) {
  let dispatchStableSince = null
  while (Date.now() < untilTs) {
    if (signal?.aborted) throw new Error('Aborted')
    const url = page.url()
    if (isLikelyOktaAuthUrl(url)) {
      dispatchStableSince = null
      await handleOktaThenWaitDispatch(page, {
        tryOktaLogin,
        log,
        signal,
        dispatchWaitMs,
        step,
      })
      return true
    }
    if (isDispatchFedExAppUrl(url)) {
      const now = Date.now()
      if (dispatchStableSince == null) {
        dispatchStableSince = now
      } else if (now - dispatchStableSince >= DISPATCH_STABLE_MS) {
        log(
          'info',
          'FedEx Ground dispatch (fdxtools) URL stable — continuing Check in',
        )
        return true
      }
    } else {
      dispatchStableSince = null
    }
    await sleep(step, signal)
  }
  return false
}

/**
 * After `goto` dispatch, handle late PurpleID redirect and require stable dispatch URL
 * before Check in continues.
 *
 * @param {import('playwright').Page} page
 * @param {{ tryOktaLogin: boolean, log: (type: string, message: string) => void, signal?: AbortSignal }} opts
 */
export async function ensureDispatchAppReady(page, { tryOktaLogin, log, signal }) {
  const settleMs = 15_000
  const secondPhaseMs = 12_000
  const thirdPhaseMs = 15_000
  const dispatchWaitMs = 120_000
  const step = 400

  const opts = { tryOktaLogin, log, signal, dispatchWaitMs, step }

  await sleep(100, signal).catch(() => {})

  if (await spinStableDispatchOrHandleOkta(page, opts, Date.now() + settleMs)) {
    return
  }
  if (await spinStableDispatchOrHandleOkta(page, opts, Date.now() + secondPhaseMs)) {
    return
  }

  const url = page.url()
  if (isLikelyOktaAuthUrl(url)) {
    await handleOktaThenWaitDispatch(page, opts)
    return
  }
  if (isDispatchFedExAppUrl(url)) {
    if (await spinStableDispatchOrHandleOkta(page, opts, Date.now() + thirdPhaseMs)) {
      return
    }
    log(
      'warn',
      'FedEx Ground app visible but URL not stable yet — waiting for fdxtools home…',
    )
    await waitForDispatchUrl(page, log, signal, dispatchWaitMs, step)
    return
  }

  log(
    'warn',
    'Waiting for FedEx Ground dispatch home (fdxtools.fedex.com)…',
  )
  await waitForDispatchUrl(page, log, signal, dispatchWaitMs, step)
}

/**
 * @param {import('playwright').Page} page
 * @param {{ tryOktaLogin: boolean, log: (type: string, message: string) => void, signal?: AbortSignal, dispatchWaitMs: number, step: number }} opts
 */
async function handleOktaThenWaitDispatch(
  page,
  { tryOktaLogin, log, signal, dispatchWaitMs, step },
) {
  const u = await getUsername()
  const p = await getDecryptedPassword()
  const canAuto = Boolean(u && p)
  if (!canAuto) {
    throw new Error(PURPLEID_SIGNIN_MESSAGE)
  }
  if (!tryOktaLogin) {
    log('info', 'PurpleID detected — running saved sign-in')
  }
  await tryOktaAutoLogin(page, u, p, (type, msg) => log(type, msg))
  log(
    'info',
    'Waiting for FedEx Ground dispatch home (fdxtools) after PurpleID sign-in…',
  )
  await waitForDispatchUrl(page, log, signal, dispatchWaitMs, step)
  log('info', 'Back on FedEx Ground dispatch (fdxtools) home')
}

/**
 * Wait until FedEx dispatch URL holds for DISPATCH_STABLE_MS (avoids post-login bounce to Okta).
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string) => void} log
 * @param {AbortSignal | undefined} signal
 * @param {number} maxMs
 * @param {number} step
 */
async function waitForDispatchUrl(page, log, signal, maxMs, step) {
  const deadline = Date.now() + maxMs
  let dispatchStableSince = null
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Aborted')
    const url = page.url()
    if (isLikelyOktaAuthUrl(url)) {
      dispatchStableSince = null
    } else if (isDispatchFedExAppUrl(url)) {
      const now = Date.now()
      if (dispatchStableSince == null) {
        dispatchStableSince = now
      } else if (now - dispatchStableSince >= DISPATCH_STABLE_MS) {
        return
      }
    } else {
      dispatchStableSince = null
    }
    await sleep(step, signal)
  }
  throw new Error(
    'Timed out waiting for FedEx Ground dispatch (fdxtools) after PurpleID sign-in. Complete sign-in in a headed session once, or check network and credentials.',
  )
}
