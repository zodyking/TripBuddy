import { assertNotStuckOnPurpleId } from './dispatchAuthGate.mjs'
import { getResolvedCheckInXpaths } from './checkInFlow.mjs'
import { detectCheckInMissionPageState } from './checkInMissionDetectors.mjs'

/**
 * Post-submit tails: check-in mission polling, arrive phone/Linehaul/assistance without sign-out,
 * and shared dialogs (Contact Linehaul). Short action timeouts (Okta-style).
 */
const DIALOG_MS = 2_000
/** Sign-out confirmation modal can render slowly after toolbar click (Angular / network). */
const SIGN_OUT_MODAL_MS = 15_000
const ACTION_MS = 2_000

const T = {
  phoneModalWait: DIALOG_MS,
  phoneFill: ACTION_MS,
  phoneSend: ACTION_MS,
}

/** Check-in post-submit: poll for success text; no automated sign-out. */
const MISSION_POLL_MS = 400
const CHECKIN_MISSION_MAX_MS = 240_000
const WAIT_MODAL_OR_SUCCESS_MS = 120_000

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

function xp(path) {
  return `xpath=${path}`
}

/**
 * Detect if the page shows "Check In Successful!" with "Trip Summary" —
 * indicates a trip was assigned during check-in and phone modal won't appear.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectTripReadyPage(page) {
  try {
    const body = await page.locator('body').innerText({ timeout: 2000 })
    const lower = body.toLowerCase()
    return lower.includes('check in successful') && lower.includes('trip summary')
  } catch {
    return false
  }
}

/**
 * After SEND, FedEx shows "Contact Linehaul" with orange CONFIRM.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 * @param {AbortSignal | undefined} signal
 */
async function clickContactLinehaulConfirm(page, log, signal) {
  if (signal?.aborted) throw new Error('Aborted')
  log('info', 'Contact Linehaul confirm')
  const dlg = page
    .locator('mat-dialog-container')
    .filter({
      hasText: /Contact Linehaul|Is this information correct|No Approved Trip/i,
    })
    .last()
  const confirmBtn = dlg.getByRole('button', { name: /^confirm$/i })
  await confirmBtn.click({ force: true, timeout: ACTION_MS })
  log('info', 'Confirmed Contact Linehaul')
}

/**
 * Normalize for form fill: keep digits and leading + if present.
 * @param {string} raw
 */
export function normalizePhoneForFill(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s.startsWith('+')) {
    return '+' + s.slice(1).replace(/\D/g, '')
  }
  return s.replace(/\D/g, '')
}

/**
 * FedEx Angular can ignore a plain `.fill`; verify the value and dispatch input/change if needed.
 *
 * @param {import('playwright').Locator} modal
 * @param {import('playwright').Page} page
 * @param {Awaited<ReturnType<typeof getResolvedCheckInXpaths>>} CX
 * @param {string} digits
 * @param {AbortSignal | undefined} signal
 */
export async function fillNotScheduledPhoneModalField(modal, page, CX, digits, signal) {
  if (signal?.aborted) throw new Error('Aborted')
  const locators = [
    modal.locator('input[type="tel"]').first(),
    modal.locator('input[type="text"]').first(),
    modal.locator('input').first(),
    page.locator(xp(CX.phoneModalInput)),
  ]

  /** @param {import('playwright').Locator} loc */
  const tryOne = async (loc) => {
    await loc.waitFor({ state: 'visible', timeout: T.phoneFill })
    await loc.click({ force: true, timeout: T.phoneFill })
    await loc.fill('', { force: true, timeout: T.phoneFill })
    await loc.fill(digits, { force: true, timeout: T.phoneFill })
    const v = normalizePhoneForFill(await loc.inputValue().catch(() => ''))
    if (v === digits) return true
    await loc.evaluate(
      (el, d) => {
        const input = /** @type {HTMLInputElement} */ (el)
        input.value = d
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.dispatchEvent(new Event('blur', { bubbles: true }))
      },
      digits,
    )
    const v2 = normalizePhoneForFill(await loc.inputValue().catch(() => ''))
    return v2 === digits
  }

  let lastErr = /** @type {Error | null} */ (null)
  for (const loc of locators) {
    if (signal?.aborted) throw new Error('Aborted')
    try {
      if (await tryOne(loc)) return
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr ?? new Error('Could not fill trip not scheduled phone field')
}

/**
 * FedEx "Are you sure you want to sign out?" uses an orange **Continue** button (not "Sign out" text).
 * Prefer role inside `app-sign-out-modal`, then saved XPath.
 *
 * @param {import('playwright').Page} page
 * @param {Awaited<ReturnType<typeof getResolvedCheckInXpaths>>} CX
 * @param {AbortSignal | undefined} signal
 */
export async function clickSignOutModalConfirm(page, CX, signal) {
  if (signal?.aborted) throw new Error('Aborted')

  const modalRoot = page.locator('app-sign-out-modal')
  await modalRoot.waitFor({ state: 'visible', timeout: SIGN_OUT_MODAL_MS })

  const byContinue = modalRoot.getByRole('button', { name: /continue/i })
  const bySignOut = modalRoot.getByRole('button', { name: /sign out/i })
  const byConfirm = modalRoot.getByRole('button', { name: /^confirm$/i })
  const byXpath = page.locator(xp(CX.signOutConfirmButton))

  const attempts = [
    () => byContinue.click({ force: true, timeout: ACTION_MS }),
    () => bySignOut.first().click({ force: true, timeout: ACTION_MS }),
    () => byConfirm.click({ force: true, timeout: ACTION_MS }),
    () => byXpath.click({ force: true, timeout: ACTION_MS }),
  ]

  let lastErr = /** @type {Error | null} */ (null)
  for (const tryClick of attempts) {
    if (signal?.aborted) throw new Error('Aborted')
    try {
      await tryClick()
      return
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw lastErr ?? new Error('Sign out confirm button not found')
}

/**
 * Map mission detector state to payload fields for the dashboard / TTS.
 * @param {'new_trip' | 'trip_ready' | 'plain_success'} state
 * @returns {{ checkInNewTripFound?: boolean, tripReadyAcknowledged?: boolean, missionComplete: true }}
 */
function missionPayloadFromState(state) {
  if (state === 'new_trip') {
    return { checkInNewTripFound: true, missionComplete: true }
  }
  if (state === 'trip_ready') {
    return { tripReadyAcknowledged: true, missionComplete: true }
  }
  return { missionComplete: true }
}

/**
 * After check-in form success: optionally drive phone → Linehaul → assistance, polling for
 * "Check In Successful" / trip pages. No automated sign-out.
 *
 * @param {import('playwright').Page} page
 * @param {{ log: (type: string, message: string, extra?: object) => void, signal?: AbortSignal, getPhone: () => Promise<string> }} opts
 * @returns {Promise<{ missionComplete: true, checkInNewTripFound?: boolean, tripReadyAcknowledged?: boolean }>}
 */
export async function runPhoneModalUntilMissionComplete(page, { log, signal, getPhone }) {
  assertNotStuckOnPurpleId(page)
  const CX = await getResolvedCheckInXpaths()
  const deadline = Date.now() + CHECKIN_MISSION_MAX_MS

  const tryComplete = async () => {
    const state = await detectCheckInMissionPageState(page)
    if (!state) return null
    const payload = missionPayloadFromState(state)
    log('info', 'Check-in mission complete', {
      checkInComplete: true,
      ...payload,
    })
    return payload
  }

  let done = await tryComplete()
  if (done) return done

  const modalWaitUntil = Date.now() + WAIT_MODAL_OR_SUCCESS_MS
  while (Date.now() < modalWaitUntil && Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Aborted')
    done = await tryComplete()
    if (done) return done
    const modal = page.locator('app-not-scheduled-phone-number-modal')
    if (await modal.isVisible().catch(() => false)) break
    await sleep(MISSION_POLL_MS, signal)
  }

  done = await tryComplete()
  if (done) return done

  const modal = page.locator('app-not-scheduled-phone-number-modal')
  if (!(await modal.isVisible().catch(() => false))) {
    throw new Error(
      'Check-in succeeded but neither success text nor phone modal appeared in time',
    )
  }

  const rawPhone = await getPhone()
  const digits = normalizePhoneForFill(rawPhone)
  if (!digits) {
    throw new Error(
      'Set driver phone (Driver Credentials in Settings) before Check in',
    )
  }

  log('info', 'Phone modal')
  await modal.waitFor({ state: 'visible', timeout: T.phoneModalWait })

  if (signal?.aborted) throw new Error('Aborted')

  await fillNotScheduledPhoneModalField(modal, page, CX, digits, signal)
  log('info', 'Entered driver phone')

  if (signal?.aborted) throw new Error('Aborted')

  done = await tryComplete()
  if (done) return done

  const sendByRole = modal.getByRole('button', { name: /send/i })
  const sendBtn = page.locator(xp(CX.phoneModalSend))

  try {
    await sendByRole.click({ force: true, timeout: T.phoneSend })
  } catch {
    await sendBtn.click({ force: true, timeout: T.phoneSend })
  }
  log('info', 'Sent phone number')

  if (signal?.aborted) throw new Error('Aborted')

  done = await tryComplete()
  if (done) return done

  await clickContactLinehaulConfirm(page, log, signal)

  if (signal?.aborted) throw new Error('Aborted')

  done = await tryComplete()
  if (done) return done

  log('info', 'Assistance (if any)')
  const assistByRole = page
    .locator('app-assistance-confirmation-modal')
    .getByRole('button', { name: /confirm|continue|ok/i })
    .first()
  const assistBtn = page.locator(xp(CX.assistanceConfirmButton))
  try {
    await assistByRole.click({ force: true, timeout: ACTION_MS })
    log('info', 'Confirmed assistance')
  } catch {
    try {
      await assistBtn.click({ force: true, timeout: ACTION_MS })
      log('info', 'Confirmed assistance')
    } catch {
      log('info', 'No assistance modal — continuing')
    }
  }

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Aborted')
    done = await tryComplete()
    if (done) return done
    await sleep(MISSION_POLL_MS, signal)
  }

  throw new Error('Timed out waiting for Check In Successful after phone flow')
}

/**
 * Arrive post-submit: phone → Linehaul → assistance (or trip-ready shortcut without phone).
 * No automated sign-out (avoids flaky toolbar/modal timeouts that fail the whole run).
 *
 * @param {import('playwright').Page} page
 * @param {{ phone: string, log: (type: string, message: string, extra?: object) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ missionComplete: true, tripReadyAcknowledged: boolean }>}
 */
export async function runPhoneModalWithoutSignOut(page, { phone, log, signal }) {
  assertNotStuckOnPurpleId(page)
  const digits = normalizePhoneForFill(phone)
  if (!digits) throw new Error('Driver phone is empty')

  const CX = await getResolvedCheckInXpaths()

  if (signal?.aborted) throw new Error('Aborted')

  const tripReady = await detectTripReadyPage(page)
  if (tripReady) {
    log('info', 'Trip ready page detected — skipping phone modal (no automated sign-out)')
    log('info', 'Arrive post-flow complete', {
      arriveComplete: true,
      missionComplete: true,
      tripReadyAcknowledged: true,
    })
    return { missionComplete: true, tripReadyAcknowledged: true }
  }

  log('info', 'Phone modal')
  const modal = page.locator('app-not-scheduled-phone-number-modal')
  await modal.waitFor({ state: 'visible', timeout: T.phoneModalWait })

  if (signal?.aborted) throw new Error('Aborted')

  await fillNotScheduledPhoneModalField(modal, page, CX, digits, signal)
  log('info', 'Entered driver phone')

  if (signal?.aborted) throw new Error('Aborted')

  const sendByRole = modal.getByRole('button', { name: /send/i })
  const sendBtn = page.locator(xp(CX.phoneModalSend))

  try {
    await sendByRole.click({ force: true, timeout: T.phoneSend })
  } catch {
    await sendBtn.click({ force: true, timeout: T.phoneSend })
  }
  log('info', 'Sent phone number')

  if (signal?.aborted) throw new Error('Aborted')

  await clickContactLinehaulConfirm(page, log, signal)

  if (signal?.aborted) throw new Error('Aborted')

  log('info', 'Assistance (if any)')
  const assistByRole = page
    .locator('app-assistance-confirmation-modal')
    .getByRole('button', { name: /confirm|continue|ok/i })
    .first()
  const assistBtn = page.locator(xp(CX.assistanceConfirmButton))
  try {
    await assistByRole.click({ force: true, timeout: ACTION_MS })
    log('info', 'Confirmed assistance')
  } catch {
    try {
      await assistBtn.click({ force: true, timeout: ACTION_MS })
      log('info', 'Confirmed assistance')
    } catch {
      log('info', 'No assistance modal — continuing')
    }
  }

  log('info', 'Arrive post-flow complete', {
    arriveComplete: true,
    missionComplete: true,
    tripReadyAcknowledged: false,
  })
  return { missionComplete: true, tripReadyAcknowledged: false }
}
