/** FedEx Ground Linehaul Dispatch — Angular app XPaths for Arrive flow. */
export const ARRIVE_XPATH = {
  /** Arrive button on homepage (orange bordered button) */
  arriveHome: '/html/body/app-root/div/app-homepage/div/button[4]',
  /** "Tractor Number" option on arrival verification page */
  arriveSelectTractor: '/html/body/app-root/div/app-arrival-select/div/button[1]',
  /** Tractor number input field */
  tractorInput:
    '/html/body/app-root/div/app-arrival-search/div[1]/div/mat-form-field/div[1]/div/div[2]/input',
  /** Continue button after entering tractor number */
  continueBtn: '/html/body/app-root/div/app-arrival-search/div[2]/button',
  /** Final Arrive button on summary/validation page */
  arriveSubmit: '/html/body/app-root/div/app-arrival-summary/button',
}

/** @type {(keyof typeof ARRIVE_XPATH)[]} */
export const ARRIVE_XPATH_KEYS = /** @type {(keyof typeof ARRIVE_XPATH)[]} */ (
  Object.keys(ARRIVE_XPATH)
)
