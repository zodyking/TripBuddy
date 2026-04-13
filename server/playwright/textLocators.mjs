/**
 * Text-on-screen button targeting when stable ids, XPath, or getByRole(name)
 * are unreliable (e.g. accessible name differs from visible copy).
 *
 * Prefer buttonLikeByVisibleText (hasText filter). Use buttonNearestToText when
 * the matched text lives in a child node and role/name locators fail.
 */

/**
 * Button or `[role="button"]` whose subtree contains the text (string or RegExp).
 *
 * @param {import('playwright').Page} page
 * @param {string | RegExp} text
 * @returns {import('playwright').Locator}
 */
export function buttonLikeByVisibleText(page, text) {
  return page.locator('button, [role="button"]').filter({ hasText: text })
}

/**
 * Nearest ancestor `button` or `[role="button"]` for a getByText match (non-exact).
 * Use when visible label is nested (e.g. span) and filter(hasText) is too broad.
 *
 * @param {import('playwright').Page} page
 * @param {string | RegExp} text
 * @returns {import('playwright').Locator}
 */
export function buttonNearestToText(page, text) {
  return page
    .getByText(text, { exact: false })
    .locator('xpath=./ancestor::*[self::button or @role="button"][1]')
}
