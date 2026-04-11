import { MENU } from '../selectors.mjs'

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
  return page.getByRole(spec.role, { name: spec.name, exact: spec.exact })
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
