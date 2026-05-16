import { clickMenuIfEnabled } from './pages/dispatchHome.mjs'
import { assertNotStuckOnPurpleId } from './dispatchAuthGate.mjs'
import { mergeCheckInXpaths, readCheckInFlow } from '../check-in-flow-store.mjs'

export { CHECKIN_XPATH } from './checkInXpathDefaults.mjs'

/** FedEx Linehaul banner when saved dispatch location does not match driver location */
const DRIVER_LOCATION_MISMATCH_SNIPPET =
  'Driver ID is currently not located where the tractor is trying to dispatch from'

/**
 * @param {string} text
 */
function normalizeFedexBannerTextForMatch(text) {
  let s = String(text).normalize('NFKC')
  s = s.replace(/[\u2018\u2019\u201c\u201d]/g, "'")
  s = s.replace(/\u00a0/g, ' ')
  s = s.replace(/\s+/g, ' ')
  return s.trim().toLowerCase()
}

/**
 * @param {string} text
 */
function bannerIndicatesLocationMismatch(text) {
  const n = normalizeFedexBannerTextForMatch(text)
  const snippet = normalizeFedexBannerTextForMatch(DRIVER_LOCATION_MISMATCH_SNIPPET)
  if (n.includes(snippet)) return true
  if (n.includes('linehaul office') && n.includes('not located')) return true
  return false
}

/**
 * Demo-tuned: each Playwright `waitFor` / `waitForLoadState` cap is 2s unless noted.
 * Exported so `blocks.mjs` stays aligned with `runFullCheckIn`.
 */
export const CHECKIN_LOC_VISIBLE_MS = 2_000
export const CHECKIN_LOC_VISIBLE_SHORT_MS = 2_000
export const CHECKIN_LOC_AFTER_NAV_MS = 2_000

const LOC_VISIBLE_MS = CHECKIN_LOC_VISIBLE_MS
const LOC_VISIBLE_SHORT_MS = CHECKIN_LOC_VISIBLE_SHORT_MS
const LOC_AFTER_NAV_MS = CHECKIN_LOC_AFTER_NAV_MS

/** Max time to poll for FedEx app-banner after submit */
const BANNER_WINDOW_MS = 2_000
const BANNER_POLL_MS = 50
const BANNER_INITIAL_MS = 0
/** When isVisible() is false (animations), still detect non-empty banner text via textContent */
const BANNER_TEXT_MIN_LEN = 20

/**
 * Visible banner, or attached banner with substantive text (Playwright visibility can lag).
 * @param {import('playwright').Locator} banner
 * @returns {Promise<{ bannerText: string, locationMismatch: boolean } | null>}
 */
async function readSubmitBannerOutcome(banner) {
  const visible = await banner.isVisible().catch(() => false)
  if (visible) {
    const text = (await banner.innerText().catch(() => '')).trim()
    return {
      bannerText: text || '(banner with no text)',
      locationMismatch: bannerIndicatesLocationMismatch(text),
    }
  }
  const count = await banner.count().catch(() => 0)
  if (count === 0) return null
  const raw = await banner
    .first()
    .evaluate((el) => (el && 'textContent' in el ? el.textContent : '') || '')
    .catch(() => '')
  const text = String(raw).replace(/\s+/g, ' ').trim()
  if (
    text.length >= BANNER_TEXT_MIN_LEN ||
    bannerIndicatesLocationMismatch(text)
  ) {
    return {
      bannerText: text,
      locationMismatch: bannerIndicatesLocationMismatch(text),
    }
  }
  return null
}

function xp(path) {
  return `xpath=${path}`
}

/**
 * @param {import('playwright').Page} page
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
 * @param {import('playwright').Locator} loc
 */
async function isControlDisabled(loc) {
  const disabled = await loc.isDisabled().catch(() => false)
  const aria = await loc.getAttribute('aria-disabled')
  const cls = (await loc.getAttribute('class')) || ''
  return (
    disabled ||
    aria === 'true' ||
    cls.includes('mat-mdc-button-disabled') ||
    cls.includes('mat-button-disabled')
  )
}

/**
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} beginLoc
 * @param {AbortSignal | undefined} signal
 * @param {(type: string, message: string) => void} log
 */
async function waitUntilBeginNewDisabled(page, beginLoc, signal, log) {
  const timeoutMs = 2_000
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('Aborted')
    if (await isControlDisabled(beginLoc)) {
      log('info', 'Check-in session ready')
      return
    }
    await sleep(40, signal)
  }
  throw new Error(
    'Begin new check-in did not gray out — close the browser session, sign in again, then retry Check in',
  )
}

/** Overall cap for parallel Continue strategies (Promise.any + race). */
const CONFIRM_BEGIN_NEW_OVERALL_MS = 2_000

/**
 * FedEx may show "Begin New Check In?" with Continue/Cancel after clicking Begin New Check In.
 * Runs primary + fallback locators in parallel (Promise.any) so the first success wins quickly.
 * Does not throw if the modal is absent. Warns only if the modal is still present after attempts.
 * @param {import('playwright').Page} page
 * @param {Record<string, string>} CX
 * @param {(type: string, message: string, extra?: object) => void} log
 * @param {AbortSignal | undefined} signal
 */
async function confirmBeginNewIfPresent(page, CX, log, signal) {
  if (signal?.aborted) throw new Error('Aborted')

  const primary = page.locator(xp(CX.beginNewConfirmContinue))
  const modalHost = page.locator('app-homepage-begin-new-checkin-modal')
  const fallbackRole = modalHost.getByRole('button', { name: /continue/i })
  const fallbackText = page.locator(
    'xpath=//app-homepage-begin-new-checkin-modal//button[contains(translate(normalize-space(string(.)),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"continue")]',
  )

  /**
   * @param {import('playwright').Locator} loc
   */
  async function clickContinueBranch(loc) {
    await loc.first().waitFor({ state: 'attached', timeout: 2_000 })
    if (signal?.aborted) throw new Error('Aborted')
    try {
      await loc.first().click({ timeout: 2_000 })
    } catch {
      if (signal?.aborted) throw new Error('Aborted')
      await loc.first().click({ timeout: 2_000, force: true })
    }
  }

  try {
    await Promise.race([
      Promise.any([
        clickContinueBranch(primary),
        clickContinueBranch(fallbackRole),
        clickContinueBranch(fallbackText),
      ]),
      sleep(CONFIRM_BEGIN_NEW_OVERALL_MS, signal).then(() => {
        throw new Error('Begin new check-in Continue timeout')
      }),
    ])
    log('info', 'Confirmed new check-in')
  } catch (e) {
    if (signal?.aborted) throw new Error('Aborted')
    const modalStillThere = await modalHost.isVisible().catch(() => false)
    if (modalStillThere) {
      log('warn', 'Begin new check-in dialog is open but Continue could not be clicked', {
        beginNewConfirmSkipped: true,
      })
    }
  }
}

export async function getResolvedCheckInXpaths() {
  const doc = await readCheckInFlow()
  return mergeCheckInXpaths(doc.xpaths)
}

/**
 * Poll FedEx banner after a check-in submit (initial or retry).
 * @param {import('playwright').Locator} banner
 * @param {(type: string, message: string, extra?: object) => void} log
 * @param {AbortSignal | undefined} signal
 * @param {{ runId?: string }} [opts]
 * @returns {Promise<{ success: boolean, bannerText?: string, locationMismatch?: boolean }>}
 */
async function pollBannerAfterSubmit(banner, log, signal, opts = {}) {
  const { runId } = opts
  log('info', 'Checking result')
  await sleep(BANNER_INITIAL_MS, signal)
  const pollUntil = Date.now() + BANNER_WINDOW_MS
  while (Date.now() < pollUntil) {
    if (signal?.aborted) throw new Error('Aborted')
    const outcome = await readSubmitBannerOutcome(banner)
    if (outcome) {
      log('warn', 'FedEx reported a message after submit', {
        checkInBanner: true,
        bannerText: outcome.bannerText,
        locationMismatch: outcome.locationMismatch,
        ...(runId ? { locationRetryNeeded: true, runId } : {}),
      })
      return {
        success: false,
        bannerText: outcome.bannerText,
        locationMismatch: outcome.locationMismatch,
      }
    }
    const remaining = pollUntil - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(BANNER_POLL_MS, remaining), signal)
  }

  log('info', 'Check-in finished')
  return { success: true }
}

/**
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string} opts.tractorNumber
 * @param {string} opts.currentLocation
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.runId] If set, mismatch logs include locationRetryNeeded for in-browser retry.
 * @returns {Promise<{ success: boolean, bannerText?: string, locationMismatch?: boolean }>}
 */
export async function runFullCheckIn({
  page,
  tractorNumber,
  currentLocation,
  log,
  signal,
  runId,
}) {
  assertNotStuckOnPurpleId(page)
  const CX = await getResolvedCheckInXpaths()

  const beginLoc = page.locator(xp(CX.beginNew))
  await beginLoc.waitFor({ state: 'visible', timeout: LOC_VISIBLE_MS })

  let needWaitForBeginDisabled = false

  if (await isControlDisabled(beginLoc)) {
    log('info', 'Check-in already started — opening Check In')
  } else {
    try {
      await beginLoc.click()
      log('info', 'Starting new check-in')
      await confirmBeginNewIfPresent(page, CX, log, signal)
      needWaitForBeginDisabled = true
    } catch {
      log('warn', 'Using menu to start check-in')
      const ok = await clickMenuIfEnabled(page, 'beginNewCheckIn', log)
      if (!ok) {
        if (await isControlDisabled(beginLoc)) {
          log('info', 'Check-in already started — opening Check In')
        } else {
          throw new Error('Begin new check-in not available on homepage')
        }
      } else {
        await beginLoc
          .waitFor({ state: 'visible', timeout: 2_000 })
          .catch(() => {})
        await confirmBeginNewIfPresent(page, CX, log, signal)
        needWaitForBeginDisabled = true
      }
    }
    if (needWaitForBeginDisabled) {
      await waitUntilBeginNewDisabled(page, beginLoc, signal, log)
    }
  }

  const checkInBtn = page.locator(xp(CX.checkInHome))
  try {
    await checkInBtn.waitFor({ state: 'visible', timeout: LOC_VISIBLE_SHORT_MS })
    await checkInBtn.click()
    log('info', 'Opening Check In')
  } catch {
    log('warn', 'Using menu to open Check In')
    const ok = await clickMenuIfEnabled(page, 'checkIn', log)
    if (!ok) throw new Error('Check In button not available')
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => {})

  const optionBtn = page.locator(xp(CX.checkInSelectFirst))
  await optionBtn.waitFor({ state: 'visible', timeout: 2_000 })
  await optionBtn.click()
  log('info', 'Choosing check-in option')

  const tractorEl = page.locator(xp(CX.tractorInput))
  const locationEl = page.locator(xp(CX.locationInput))
  await tractorEl.waitFor({ state: 'visible', timeout: LOC_VISIBLE_MS })
  await locationEl.waitFor({ state: 'visible', timeout: LOC_VISIBLE_SHORT_MS })
  await tractorEl.fill(tractorNumber)
  await locationEl.fill(currentLocation)
  log('info', 'Entering tractor and location')

  await page.locator(xp(CX.submit)).click()
  log('info', 'Submitting check-in')

  const banner = page.locator(xp(CX.banner))
  return await pollBannerAfterSubmit(banner, log, signal, { runId })
}

/**
 * Same browser session: update location field and submit again (after a mismatch banner).
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string} opts.currentLocation
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.runId]
 * @returns {Promise<{ success: boolean, bannerText?: string, locationMismatch?: boolean }>}
 */
export async function retryCheckInWithNewLocation({
  page,
  currentLocation,
  log,
  signal,
  runId,
}) {
  assertNotStuckOnPurpleId(page)
  const CX = await getResolvedCheckInXpaths()
  const locationEl = page.locator(xp(CX.locationInput))
  await locationEl.waitFor({ state: 'visible', timeout: LOC_VISIBLE_SHORT_MS })
  await locationEl.fill(currentLocation)
  log('info', 'Retrying check-in with new location (same browser session)')
  await page.locator(xp(CX.submit)).click()
  log('info', 'Submitting check-in retry')
  const banner = page.locator(xp(CX.banner))
  return await pollBannerAfterSubmit(banner, log, signal, { runId })
}
