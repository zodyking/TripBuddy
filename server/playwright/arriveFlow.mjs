import { clickMenuIfEnabled } from './pages/dispatchHome.mjs'
import { assertNotStuckOnPurpleId } from './dispatchAuthGate.mjs'
import { ARRIVE_XPATH } from './arriveXpathDefaults.mjs'

export { ARRIVE_XPATH } from './arriveXpathDefaults.mjs'

/**
 * Timeouts aligned with checkInFlow for blazing fast speed.
 */
export const ARRIVE_LOC_VISIBLE_MS = 30_000
export const ARRIVE_LOC_VISIBLE_SHORT_MS = 20_000
export const ARRIVE_LOC_AFTER_NAV_MS = 15_000

const LOC_VISIBLE_MS = ARRIVE_LOC_VISIBLE_MS
const LOC_VISIBLE_SHORT_MS = ARRIVE_LOC_VISIBLE_SHORT_MS

const GEOFENCE_BANNER_SNIPPET = 'tractor may have been arrived by geofence'

/**
 * Check if page contains geofence auto-arrival banner.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectGeofenceBanner(page) {
  try {
    const body = await page.locator('body').innerText({ timeout: 2000 })
    return body.toLowerCase().includes(GEOFENCE_BANNER_SNIPPET)
  } catch {
    return false
  }
}

function xp(path) {
  return `xpath=${path}`
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
 * Run the full Arrive flow: homepage → select tractor → enter number → continue → arrive.
 *
 * @param {object} opts
 * @param {import('playwright').Page} opts.page
 * @param {string} opts.tractorNumber
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function runFullArrive({ page, tractorNumber, log, signal }) {
  assertNotStuckOnPurpleId(page)
  const AX = ARRIVE_XPATH

  const arriveLoc = page.locator(xp(AX.arriveHome))
  try {
    await arriveLoc.waitFor({ state: 'visible', timeout: LOC_VISIBLE_MS })
  } catch {
    log('warn', 'Arrive button not visible, trying menu fallback')
    const ok = await clickMenuIfEnabled(page, 'arrive', log)
    if (!ok) {
      throw new Error('Arrive button not available on homepage')
    }
    await sleep(500, signal)
  }

  if (signal?.aborted) throw new Error('Aborted')

  try {
    await arriveLoc.click({ timeout: 5_000 })
    log('info', 'Clicked Arrive')
  } catch {
    log('warn', 'Direct click failed, using menu')
    const ok = await clickMenuIfEnabled(page, 'arrive', log)
    if (!ok) throw new Error('Could not open Arrive')
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {})

  if (signal?.aborted) throw new Error('Aborted')

  const selectTractorLoc = page.locator(xp(AX.arriveSelectTractor))
  await selectTractorLoc.waitFor({ state: 'visible', timeout: LOC_VISIBLE_SHORT_MS })
  await selectTractorLoc.click()
  log('info', 'Selected Tractor Number option')

  await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {})

  if (signal?.aborted) throw new Error('Aborted')

  const tractorInputLoc = page.locator(xp(AX.tractorInput))
  await tractorInputLoc.waitFor({ state: 'visible', timeout: LOC_VISIBLE_SHORT_MS })
  await tractorInputLoc.fill(tractorNumber)
  log('info', `Entered tractor number: ${tractorNumber}`)

  if (signal?.aborted) throw new Error('Aborted')

  const continueLoc = page.locator(xp(AX.continueBtn))
  await continueLoc.waitFor({ state: 'visible', timeout: LOC_VISIBLE_SHORT_MS })
  await continueLoc.click()
  log('info', 'Clicked Continue')

  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
  await sleep(1000, signal)

  if (signal?.aborted) throw new Error('Aborted')

  const geofenceDetected = await detectGeofenceBanner(page)
  if (geofenceDetected) {
    log('info', 'Tractor already arrived by geofence — skipping manual arrive')
    return { success: true, alreadyArrivedByGeofence: true }
  }

  const arriveSubmitLoc = page.locator(xp(AX.arriveSubmit))
  try {
    await arriveSubmitLoc.waitFor({ state: 'visible', timeout: LOC_VISIBLE_MS })
  } catch {
    const byRole = page.getByRole('button', { name: /arrive/i })
    await byRole.first().waitFor({ state: 'visible', timeout: 5_000 })
    await byRole.first().click()
    log('info', 'Clicked Arrive (role fallback)')
    return { success: true, alreadyArrivedByGeofence: false }
  }

  await arriveSubmitLoc.click()
  log('info', 'Clicked Arrive to confirm arrival')

  return { success: true, alreadyArrivedByGeofence: false }
}
