import { assertNotStuckOnPurpleId } from './dispatchAuthGate.mjs'
import { getResolvedCheckInXpaths } from './checkInFlow.mjs'

/**
 * Fast tail (phone → sign-out): semantic steps + short caps (Okta-style).
 * Slightly higher for toolbar clicks than in-dialog actions.
 */
const DIALOG_MS = 2_000
const ACTION_MS = 2_000
const TOOLBAR_MS = 5_000

const T = {
  phoneModalWait: DIALOG_MS,
  phoneFill: ACTION_MS,
  phoneSend: ACTION_MS,
}

function xp(path) {
  return `xpath=${path}`
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
  await modalRoot.waitFor({ state: 'visible', timeout: DIALOG_MS })

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
 * After check-in submit succeeds: phone modal, assistance confirm, toolbar sign out, confirm.
 * @param {import('playwright').Page} page
 * @param {{ phone: string, log: (type: string, message: string, extra?: object) => void, signal?: AbortSignal }} opts
 */
export async function runPhoneModalAndSignOut(page, { phone, log, signal }) {
  assertNotStuckOnPurpleId(page)
  const digits = normalizePhoneForFill(phone)
  if (!digits) throw new Error('Driver phone is empty')

  const CX = await getResolvedCheckInXpaths()

  if (signal?.aborted) throw new Error('Aborted')

  log('info', 'Phone modal')
  const modal = page.locator('app-not-scheduled-phone-number-modal')
  await modal.waitFor({ state: 'visible', timeout: T.phoneModalWait })

  const inpInModal = modal.locator('input').first()
  const inpTyped = modal.locator('input[type="tel"], input[type="text"]').first()
  const inpBySettings = page.locator(xp(CX.phoneModalInput))

  if (signal?.aborted) throw new Error('Aborted')

  try {
    await inpInModal.fill(digits, { force: true, timeout: T.phoneFill })
  } catch {
    try {
      await inpTyped.fill(digits, { force: true, timeout: T.phoneFill })
    } catch {
      await inpBySettings.fill(digits, { force: true, timeout: T.phoneFill })
    }
  }
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

  if (signal?.aborted) throw new Error('Aborted')

  const signOutToolbar = page.locator(xp(CX.toolbarSignOut))
  await signOutToolbar.click({ force: true, timeout: TOOLBAR_MS })
  log('info', 'Opened sign out')

  if (signal?.aborted) throw new Error('Aborted')

  await clickSignOutModalConfirm(page, CX, signal)
  log('info', 'Signed out', { checkInComplete: true })
}

/**
 * Sign out only (no phone modal) — used when geofence already arrived.
 * @param {import('playwright').Page} page
 * @param {{ log: (type: string, message: string, extra?: object) => void, signal?: AbortSignal }} opts
 */
export async function clickSignOutOnly(page, { log, signal }) {
  assertNotStuckOnPurpleId(page)
  const CX = await getResolvedCheckInXpaths()

  if (signal?.aborted) throw new Error('Aborted')

  const signOutToolbar = page.locator(xp(CX.toolbarSignOut))
  await signOutToolbar.click({ force: true, timeout: TOOLBAR_MS })
  log('info', 'Opened sign out')

  if (signal?.aborted) throw new Error('Aborted')

  await clickSignOutModalConfirm(page, CX, signal)
  log('info', 'Signed out (geofence arrival)')
}
