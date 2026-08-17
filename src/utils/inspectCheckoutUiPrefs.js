/**
 * Home display while a quick action runs.
 * preview = full-screen browser screenshot
 * button = smart action buttons (keep Home open; the button shows step / error text)
 */

const KEY = 'fedextool-inspect-checkout-ui-mode'

/** Fired after a Settings change so Home can switch preview vs smart action buttons. */
export const INSPECT_CHECKOUT_UI_MODE_EVENT = 'tripbuddy-inspect-checkout-ui-mode'

/** @typedef {'preview' | 'button'} InspectCheckoutUiMode */

/**
 * @param {unknown} raw
 * @returns {InspectCheckoutUiMode}
 */
export function normalizeInspectCheckoutUiMode(raw) {
  return raw === 'preview' ? 'preview' : 'button'
}

/** @returns {InspectCheckoutUiMode} */
export function getInspectCheckoutUiMode() {
  if (typeof window === 'undefined' || !window.localStorage) return 'button'
  try {
    return normalizeInspectCheckoutUiMode(window.localStorage.getItem(KEY))
  } catch {
    return 'button'
  }
}

/** @param {InspectCheckoutUiMode} mode */
export function setInspectCheckoutUiMode(mode) {
  const next = normalizeInspectCheckoutUiMode(mode)
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(KEY, next)
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(INSPECT_CHECKOUT_UI_MODE_EVENT, { detail: next }))
  } catch {
    /* ignore */
  }
}
