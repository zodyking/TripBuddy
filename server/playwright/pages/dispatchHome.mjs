import { MENU, HOMEPAGE_MENU_IDS } from '../selectors.mjs'

/** Short labels for live log / UI (matches MENU keys). */
const MENU_LABEL = {
  checkIn: 'Check In',
  beginNewCheckIn: 'Begin new check-in',
  arrive: 'Arrive',
  inspectAndCheckOut: 'Inspect and Check Out',
  reviewAndStartTrip: 'Review and Start Trip',
  viewTripAndRouting: 'View Trip and Routing',
}

/** @param {string} key */
export function menuHumanName(key) {
  return MENU_LABEL[key] ?? key
}

function menuButton(page, key) {
  const spec = MENU[key]
  if (!spec) throw new Error(`Unknown menu key: ${key}`)
  const roleOpts = { name: spec.name }
  if (spec.exact === true) roleOpts.exact = true
  return page.getByRole(spec.role, roleOpts)
}

/**
 * Prefer stable homepage IDs when present (visible), else role+name from MENU.
 * @param {import('playwright').Page} page
 * @param {'checkIn' | 'inspectAndCheckOut'} key
 */
async function homepageMenuButtonOrRole(page, key) {
  const idSel = HOMEPAGE_MENU_IDS[key]
  if (idSel) {
    const byId = page.locator(idSel).first()
    if (await byId.isVisible().catch(() => false)) return byId
  }
  return menuButton(page, key)
}

export async function clickMenuIfEnabled(page, key, log) {
  const label = menuHumanName(key)
  const btn = menuButton(page, key)
  const visible = await btn.isVisible().catch(() => false)
  if (!visible) {
    log('warn', `${label} isn't on screen`)
    return false
  }
  const enabled = await btn.isEnabled().catch(() => false)
  if (!enabled) {
    log('warn', `${label} isn't available right now`)
    return false
  }
  await btn.click()
  log('info', `Opened ${label}`)
  return true
}

/**
 * Inspect & Check Out phase-1 gate: Check In must be disabled and Inspect & Check Out enabled.
 * Inverse (Check In enabled, Inspect disabled) means no trip to inspect.
 *
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 * @returns {Promise<
 *   | { outcome: 'opened' }
 *   | { outcome: 'no_trip' }
 *   | { outcome: 'ambiguous'; reason: string; checkInEnabled?: boolean; inspectEnabled?: boolean }
 * >}
 */
export async function inspectCheckoutHomeGate(page, log) {
  const GATE_TIMEOUT_MS = 12_000
  const POLL_MS = 100
  const deadline = Date.now() + GATE_TIMEOUT_MS

  while (Date.now() < deadline) {
    const checkIn = await homepageMenuButtonOrRole(page, 'checkIn')
    const inspect = await homepageMenuButtonOrRole(page, 'inspectAndCheckOut')
    const ciVis = await checkIn.isVisible().catch(() => false)
    const inVis = await inspect.isVisible().catch(() => false)

    if (!ciVis || !inVis) {
      log('detail', 'Gate: buttons not visible yet, waiting…')
      await page.waitForTimeout(POLL_MS)
      continue
    }

    const ciEn = await checkIn.isEnabled().catch(() => false)
    const inEn = await inspect.isEnabled().catch(() => false)

    if (!ciEn && inEn) {
      await inspect.click()
      log('info', 'Opened Inspect and Check Out (home gate passed)')
      return { outcome: 'opened' }
    }

    if (ciEn && inEn) {
      log('detail', 'Gate: both buttons enabled, waiting for Inspect to become sole enabled…')
      await page.waitForTimeout(POLL_MS)
      continue
    }

    if (ciEn && !inEn) {
      return { outcome: 'no_trip' }
    }

    log('detail', `Gate: ciEn=${ciEn} inEn=${inEn}, retrying…`)
    await page.waitForTimeout(POLL_MS)
  }

  const checkIn = await homepageMenuButtonOrRole(page, 'checkIn')
  const inspect = await homepageMenuButtonOrRole(page, 'inspectAndCheckOut')
  const ciEn = await checkIn.isEnabled().catch(() => false)
  const inEn = await inspect.isEnabled().catch(() => false)
  if (!ciEn && inEn) {
    await inspect.click()
    log('info', 'Opened Inspect and Check Out (gate passed on final check)')
    return { outcome: 'opened' }
  }
  if (ciEn && !inEn) {
    return { outcome: 'no_trip' }
  }
  log('warn', 'Inspect/checkout gate timed out with ambiguous button states')
  return {
    outcome: 'ambiguous',
    reason: 'gate_timeout',
    checkInEnabled: ciEn,
    inspectEnabled: inEn,
  }
}

/**
 * Fingerprint home/dashboard for assignment polling: welcome text + button states.
 */
export async function captureHomeFingerprint(page) {
  const welcome = await page
    .getByText(/Welcome/i)
    .first()
    .innerText()
    .catch(() => '')

  const keys = Object.keys(MENU)
  const states = {}
  for (const key of keys) {
    const btn = menuButton(page, key)
    states[key] = {
      visible: await btn.isVisible().catch(() => false),
      enabled: await btn.isEnabled().catch(() => false),
    }
  }

  return {
    welcome: welcome.trim(),
    buttons: states,
    capturedAt: Date.now(),
  }
}
