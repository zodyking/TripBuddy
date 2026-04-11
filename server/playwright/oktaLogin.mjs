/**
 * PurpleID / Okta sign-in: semantic selectors first (visible identifier + Next button),
 * then XPath fallback for legacy FedEx LHL DOM.
 * Never log the password.
 */

const XPATH = {
  username:
    '/html/body/div[3]/div[2]/main/div[2]/div/div/div[2]/form/div[1]/div[3]/div/div[2]/span/input',
  next: '/html/body/div[3]/div[2]/main/div[2]/div/div/div[2]/form/div[2]/input',
  password:
    '/html/body/div[3]/div[2]/main/div[2]/div/div/div[2]/form/div[1]/div[4]/div/div[2]/span/input',
  verify: '/html/body/div[3]/div[2]/main/div[2]/div/div/div[2]/form/div[2]/input',
}

/** @param {string} path */
function xp(path) {
  return `xpath=${path}`
}

/**
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string) => void} log
 */
async function tryXPathFlow(page, username, password, log) {
  const userLoc = page.locator(xp(XPATH.username))
  await userLoc.waitFor({ state: 'visible', timeout: 30_000 })
  await userLoc.click()
  await userLoc.fill(username)
  log('info', 'Typing username (XPath)')

  await page.locator(xp(XPATH.next)).click()
  log('info', 'Continuing to password')

  const passLoc = page.locator(xp(XPATH.password))
  await passLoc.waitFor({ state: 'visible', timeout: 15_000 })
  await passLoc.click()
  await passLoc.fill(password)
  log('info', 'Typing password')

  await page.locator(xp(XPATH.verify)).click()
  log('info', 'Signing in')
}

/**
 * Primary flow: Okta-standard fields and visible Next/Verify buttons.
 * @returns {Promise<boolean>} true if the full path ran; false to try XPath
 */
async function trySemanticOktaFlow(page, username, password, log) {
  const want = username.trim()

  const identifier = page
    .locator('input[name="identifier"]')
    .or(page.getByLabel(/^username$/i))
    .or(page.getByLabel(/user name/i))
    .or(page.locator('input[autocomplete="username"]'))
    .first()

  try {
    await identifier.waitFor({ state: 'visible', timeout: 30_000 })
  } catch {
    log('info', 'Semantic sign-in: identifier field not found')
    return false
  }

  await identifier.click()
  await identifier.fill(want)
  log('info', 'Typing username')

  const got = (await identifier.inputValue()).trim()
  if (got !== want) {
    log('warn', 'Semantic sign-in: username not retained in field; trying legacy XPath')
    return false
  }

  const nextPrimary = page.getByRole('button', { name: /^next$/i }).first()
  const nextAlt = page.getByRole('button', { name: /^continue$/i }).first()
  let proceed = nextPrimary
  const primaryVisible = await nextPrimary.isVisible().catch(() => false)
  if (!primaryVisible) {
    const altVisible = await nextAlt.isVisible().catch(() => false)
    if (!altVisible) {
      log('info', 'Semantic sign-in: Next/Continue button not visible')
      return false
    }
    proceed = nextAlt
  }

  await proceed.click()
  log('info', 'Continuing to password')

  const pass = page
    .locator('input[type="password"], input[name="credentials.passcode"]')
    .first()
  await pass.waitFor({ state: 'visible', timeout: 15_000 })
  await pass.click()
  await pass.fill(password)
  log('info', 'Typing password')

  const submit = page
    .getByRole('button', { name: /verify|sign in|log in/i })
    .first()
  await submit.waitFor({ state: 'visible', timeout: 15_000 })
  await submit.click()
  log('info', 'Signing in')

  return true
}

/**
 * @param {import('playwright').Page} page
 * @param {string | null} username
 * @param {string | null} password
 * @param {(type: string, message: string) => void} log
 */
export async function tryOktaAutoLogin(page, username, password, log) {
  if (!username || !password) {
    log('info', 'Sign-in skipped (no saved credentials)')
    return false
  }

  let semanticOk = false
  try {
    semanticOk = await trySemanticOktaFlow(page, username, password, log)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('warn', 'Semantic sign-in error; trying legacy XPath')
    log('detail', msg)
  }
  if (semanticOk) return true

  log('warn', 'Trying XPath sign-in (legacy DOM)')
  try {
    await tryXPathFlow(page, username, password, log)
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', 'Okta auto-login failed')
    log('detail', msg)
    return false
  }
}
