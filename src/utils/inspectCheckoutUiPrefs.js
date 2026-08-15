/**
 * Home display for Inspect & Check Out while a run is in progress.
 * preview = current full-screen browser screenshot
 * button = keep Home visible; the quick-action button shows step / error text
 */

const KEY = 'fedextool-inspect-checkout-ui-mode'

/** @typedef {'preview' | 'button'} InspectCheckoutUiMode */

/**
 * @param {unknown} raw
 * @returns {InspectCheckoutUiMode}
 */
export function normalizeInspectCheckoutUiMode(raw) {
  return raw === 'button' ? 'button' : 'preview'
}

/** @returns {InspectCheckoutUiMode} */
export function getInspectCheckoutUiMode() {
  if (typeof window === 'undefined' || !window.localStorage) return 'preview'
  try {
    return normalizeInspectCheckoutUiMode(window.localStorage.getItem(KEY))
  } catch {
    return 'preview'
  }
}

/** @param {InspectCheckoutUiMode} mode */
export function setInspectCheckoutUiMode(mode) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(KEY, normalizeInspectCheckoutUiMode(mode))
  } catch {
    /* ignore */
  }
}
