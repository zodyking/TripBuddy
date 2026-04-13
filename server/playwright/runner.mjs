import { DISPATCH_ENTRY_URL, SESSION_START_URL } from '../config.mjs'
import { emitLog } from '../log-bus.mjs'
import { getScenarioFlowConfig } from '../flow-scripts-store.mjs'
import { ensureContext, getOrCreatePage, closeContext } from './browser.mjs'
import {
  clickMenuIfEnabled,
  captureHomeFingerprint,
} from './pages/dispatchHome.mjs'
import { fillInspectCheckoutForm } from './pages/inspectCheckout.mjs'
import { tryOktaAutoLogin } from './oktaLogin.mjs'
import {
  getUsername,
  getDecryptedPassword,
} from '../credentials-store.mjs'
import { runCheckInEndToEnd } from './checkInOrchestration.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { runDeclarativeSteps } from './declarativeFlow.mjs'

/** @type {AbortController | null} */
let runAbort = null

/** Avoid poll / concurrent automation fighting the same browser. */
let runnerBusy = false
/** Block-based automations (blocks.mjs) use a separate flag; preview must treat both as busy. */
let blockAutomationBusy = false

export function setBlockAutomationBusy(v) {
  blockAutomationBusy = !!v
}

export function isRunnerBusy() {
  return runnerBusy
}

/** In-browser location retry: wait for POST /api/run/retry-location */
const CHECKIN_RETRY_WAIT_MS = 5 * 60 * 1000

/**
 * @type {{
 *   runId: string
 *   timeoutId: ReturnType<typeof setTimeout>
 *   resolve: (loc: string) => void
 *   reject: (e: Error) => void
 * } | null}
 */
let pendingCheckInRetry = null

/**
 * @param {string} runId
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
function waitForCheckInRetryLocation(runId, signal) {
  return new Promise((resolve, reject) => {
    if (pendingCheckInRetry) {
      try {
        pendingCheckInRetry.reject(new Error('Superseded'))
      } catch {
        /* ignore */
      }
      pendingCheckInRetry = null
    }
    /** @type {{ runId: string, timeoutId: ReturnType<typeof setTimeout>, resolve: (loc: string) => void, reject: (e: Error) => void } | null} */
    let state = null
    const cleanup = () => {
      if (state?.timeoutId) clearTimeout(state.timeoutId)
      signal?.removeEventListener('abort', onAbort)
      if (pendingCheckInRetry === state) pendingCheckInRetry = null
    }
    const onAbort = () => {
      if (!state) return
      cleanup()
      reject(new Error('Aborted'))
    }
    state = {
      runId,
      timeoutId: setTimeout(() => {
        if (pendingCheckInRetry !== state) return
        cleanup()
        reject(new Error('Check-in location retry timed out'))
      }, CHECKIN_RETRY_WAIT_MS),
      resolve: (loc) => {
        cleanup()
        resolve(loc)
      },
      reject: (e) => {
        cleanup()
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingCheckInRetry = state
  })
}

/**
 * @param {string} runId
 * @param {string} location
 */
export function submitCheckInRetryLocation(runId, location) {
  const loc = String(location || '').trim()
  if (!loc) return { ok: false, error: 'location required' }
  if (!pendingCheckInRetry || pendingCheckInRetry.runId !== runId) {
    return { ok: false, error: 'No pending check-in location retry for this run' }
  }
  pendingCheckInRetry.resolve(loc)
  return { ok: true }
}

/**
 * @param {string} runId
 */
export function cancelCheckInRetry(runId) {
  if (!pendingCheckInRetry || pendingCheckInRetry.runId !== runId) {
    return { ok: false, error: 'No pending check-in location retry' }
  }
  pendingCheckInRetry.reject(new Error('Check-in retry cancelled'))
  return { ok: true }
}

function rejectPendingCheckInRetryIfAny(reason) {
  if (!pendingCheckInRetry) return
  try {
    pendingCheckInRetry.reject(
      reason instanceof Error ? reason : new Error(String(reason)),
    )
  } catch {
    /* ignore */
  }
  pendingCheckInRetry = null
}

/** @type {ReturnType<typeof setInterval> | null} */
let previewTimer = null
/** @type {{ image: string, ts: number } | null} */
let latestPreview = null

const PREVIEW_INTERVAL_MS = 400

export function getAutomationPreview() {
  const busy = runnerBusy || blockAutomationBusy
  return {
    busy,
    ...(latestPreview
      ? { ts: latestPreview.ts, image: latestPreview.image }
      : {}),
  }
}

export function clearAutomationPreview() {
  latestPreview = null
}

/**
 * @param {import('playwright').Page} page
 */
export function startPreviewCapture(page) {
  stopPreviewCapture()
  const tick = async () => {
    try {
      if (page.isClosed()) return
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: 55,
        fullPage: false,
      })
      latestPreview = { image: buf.toString('base64'), ts: Date.now() }
    } catch {
      /* navigation or closed */
    }
  }
  void tick()
  previewTimer = setInterval(tick, PREVIEW_INTERVAL_MS)
}

export function stopPreviewCapture() {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  clearAutomationPreview()
}

export function cancelRun() {
  runAbort?.abort()
}

function makeLog(runId) {
  return (type, message, extra = {}) => {
    emitLog(type, message, { runId, ...extra })
  }
}

function buildOrderedValues(values, valueOrder) {
  if (!values || typeof values !== 'object') return []
  if (Array.isArray(valueOrder) && valueOrder.length > 0) {
    return valueOrder.map((id) => values[id] ?? '')
  }
  return [
    values.dolly ?? '',
    values.field1 ?? '',
    values.field2 ?? '',
  ]
}

/**
 * Full check-in with in-browser location retries (same Playwright page; no browser restart).
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} opts.signal
 * @param {boolean} opts.tryOktaLogin
 * @param {string} opts.runId
 * @returns {Promise<{ success: boolean, bannerText?: string, locationMismatch?: boolean, missionComplete?: boolean, signedOut?: boolean, tripReadyAcknowledged?: boolean, checkInNewTripFound?: boolean }>}
 */
async function runCheckInWithLocationRetries(page, { log, signal, tryOktaLogin, runId }) {
  return runCheckInEndToEnd(page, {
    log,
    signal,
    tryOktaLogin,
    runId,
    waitForLocationRetry: waitForCheckInRetryLocation,
  })
}

/**
 * Built-in scenario body only (after initial dispatch URL load).
 * @returns {Promise<{ checkInPayload: { success: boolean, bannerText?: string, locationMismatch?: boolean, missionComplete?: boolean, signedOut?: boolean, tripReadyAcknowledged?: boolean, checkInNewTripFound?: boolean } | null }>}
 */
async function runBuiltinScenarioBody(
  page,
  scenario,
  {
    log,
    signal,
    tryOktaLogin,
    values,
    valueOrder,
    runId,
  },
) {
  /** @type {{ success: boolean, bannerText?: string, locationMismatch?: boolean } | null} */
  let checkInPayload = null

  switch (scenario) {
    case 'navigate_home':
      log('info', 'At FedEx Ground dispatch home (fdxtools)')
      break
    case 'check_in': {
      if (!runId || typeof runId !== 'string') {
        throw new Error('Internal error: check_in requires runId')
      }
      checkInPayload = await runCheckInWithLocationRetries(page, {
        log,
        signal,
        tryOktaLogin,
        runId,
      })
      break
    }
    case 'begin_new_check_in':
      if (signal.aborted) throw new Error('Aborted')
      await clickMenuIfEnabled(page, 'beginNewCheckIn', log)
      break
    case 'view_trip':
      if (signal.aborted) throw new Error('Aborted')
      await clickMenuIfEnabled(page, 'viewTripAndRouting', log)
      break
    case 'inspect_checkout': {
      if (signal.aborted) throw new Error('Aborted')
      const opened = await clickMenuIfEnabled(page, 'inspectAndCheckOut', log)
      if (opened) {
        if (signal.aborted) throw new Error('Aborted')
        await fillInspectCheckoutForm(
          page,
          {
            orderedValues: buildOrderedValues(values, valueOrder),
            dolly: values.dolly,
            field1: values.field1,
            field2: values.field2,
          },
          log,
        )
      }
      break
    }
    case 'arrive':
      if (signal.aborted) throw new Error('Aborted')
      await clickMenuIfEnabled(page, 'arrive', log)
      break
    default:
      throw new Error(`Unknown scenario: ${scenario}`)
  }

  return { checkInPayload }
}

/**
 * One-shot automation from POST /api/run. When `closeAfter` is true (default for API),
 * the persistent browser context is always closed in `finally` after success or error.
 * `openSession` and assignment polling reuse the context and do not use this teardown path.
 */
export async function runScenario(opts) {
  const runId = `run-${Date.now()}`
  const log = makeLog(runId)
  runAbort = new AbortController()
  const signal = runAbort.signal

  const {
    headless = true,
    slowMo = 0,
    scenario,
    values = {},
    valueOrder,
    closeAfter = true,
    tryOktaLogin = false,
  } = opts

  /** @type {{ success: boolean, bannerText?: string, locationMismatch?: boolean } | null} */
  let checkInPayload = null

  runnerBusy = true
  try {
    await ensureContext({ headless, slowMo })
    const page = await getOrCreatePage()
    startPreviewCapture(page)
    log(
      'info',
      'Opening FedEx Ground dispatch (fdxtools) — PurpleID may appear next',
    )
    await page.goto(DISPATCH_ENTRY_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })
    log('info', 'FedEx Ground dispatch page loaded (dispatch home / sign-in)')
    {
      const url = page.url()
      const title = (await page.title().catch(() => '')).trim()
      log(
        'detail',
        title ? `Navigation: ${url} — ${title}` : `Navigation: ${url}`,
      )
    }

    if (signal.aborted) throw new Error('Aborted')

    const flowConfig = await getScenarioFlowConfig(scenario)
    const useDeclarative =
      flowConfig?.useCustom === true &&
      Array.isArray(flowConfig.steps) &&
      flowConfig.steps.length > 0

    const builtinOpts = {
      log,
      signal,
      tryOktaLogin,
      values,
      valueOrder,
      runId,
    }

    if (useDeclarative) {
      await runDeclarativeSteps(page, flowConfig.steps, {
        log,
        signal,
        async runBuiltin(name) {
          const r = await runBuiltinScenarioBody(page, name, builtinOpts)
          if (r.checkInPayload != null) checkInPayload = r.checkInPayload
        },
      })
    } else {
      const r = await runBuiltinScenarioBody(page, scenario, builtinOpts)
      checkInPayload = r.checkInPayload
    }

    const fp = await captureHomeFingerprint(page).catch(() => null)
    log('info', 'Run finished', { fingerprint: fp, checkIn: checkInPayload })

    return {
      ok: true,
      runId,
      fingerprint: fp,
      ...(checkInPayload != null ? { checkIn: checkInPayload } : {}),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', msg)
    return { ok: false, runId, error: msg }
  } finally {
    rejectPendingCheckInRetryIfAny(new Error('Run ended'))
    stopPreviewCapture()
    runnerBusy = false
    try {
      if (closeAfter) {
        await closeContext()
        log('browser', 'Browser closed after run')
      }
    } catch (closeErr) {
      const m = closeErr instanceof Error ? closeErr.message : String(closeErr)
      log('error', `Browser close failed: ${m}`)
    }
    runAbort = null
  }
}

export async function openSession({
  headless = false,
  slowMo = 0,
  tryOktaLogin = false,
} = {}) {
  runnerBusy = true
  try {
    await ensureContext({ headless, slowMo })
    const page = await getOrCreatePage()
    startPreviewCapture(page)
    emitLog(
      'info',
      `Opening session URL: ${SESSION_START_URL === DISPATCH_ENTRY_URL ? 'FedEx Ground dispatch home (fdxtools, default)' : 'FEDEX_OKTA_AUTHORIZE_URL'}`,
    )
    await page.goto(SESSION_START_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })
    emitLog('info', 'Session page loaded')
    if (tryOktaLogin) {
      const u = await getUsername()
      const p = await getDecryptedPassword()
      await tryOktaAutoLogin(page, u, p, logAdapter)
    } else {
      emitLog(
        'info',
        'Automatic sign-in is off for this session — sign in manually in the browser window if one opens.',
      )
    }
    return { ok: true }
  } finally {
    stopPreviewCapture()
    runnerBusy = false
  }
}

function logAdapter(type, message) {
  emitLog(type, message)
}

export async function closeSession() {
  stopPreviewCapture()
  await closeContext()
  return { ok: true }
}

export async function pollFingerprintOnce({ headless = true } = {}) {
  await ensureContext({ headless })
  const page = await getOrCreatePage()
  await page.goto(DISPATCH_ENTRY_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  })
  const fingerprint = await captureHomeFingerprint(page)
  return fingerprint
}

export async function pollFingerprintSafe(opts = {}) {
  if (isRunnerBusy()) return null
  return pollFingerprintOnce(opts)
}
