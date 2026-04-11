/** FedEx Ground Linehaul Dispatch — Angular app XPaths (fragile if DOM order changes). */
export const CHECKIN_XPATH = {
  beginNew:
    '/html/body/app-root/div/app-homepage/div/button[6]',
  /** "Begin New Check In?" confirmation dialog — orange Continue. */
  beginNewConfirmContinue:
    '/html/body/div[2]/div[2]/div/mat-dialog-container/div/div/app-homepage-begin-new-checkin-modal/app-modal/div/div[2]/app-button[1]/button',
  checkInHome:
    '/html/body/app-root/div/app-homepage/div/button[1]',
  checkInSelectFirst:
    '/html/body/app-root/div/app-checkin-select/div/div[2]/button[1]',
  tractorInput:
    '/html/body/app-root/div/app-checkin/div[1]/mat-form-field[1]/div[1]/div/div[2]/input',
  locationInput:
    '/html/body/app-root/div/app-checkin/div[1]/mat-form-field[2]/div[1]/div/div[2]/input',
  submit: '/html/body/app-root/div/app-checkin/div[2]/button',
  banner: '/html/body/app-root/div/app-checkin/app-banner/div',
  /** Override via GET/PUT /api/settings/check-in-flow if the FedEx DOM changes. */
  /** Descendant //input — robust if Material wraps the native input differently. */
  phoneModalInput:
    '/html/body/div[2]/div[2]/div/mat-dialog-container/div/div/app-not-scheduled-phone-number-modal/app-modal/div/div[1]/app-form/form/mat-form-field//input',
  /** Case-insensitive — FedEx UI often shows "SEND" in all caps. */
  phoneModalSend:
    '/html/body/div[2]/div[2]/div/mat-dialog-container/div/div/app-not-scheduled-phone-number-modal//button[contains(translate(normalize-space(string(.)),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"send")]',
  assistanceConfirmButton:
    '/html/body/div[2]/div[2]/div/mat-dialog-container/div/div/app-assistance-confirmation-modal/app-modal/div/div[2]/app-button[1]/button',
  toolbarSignOut: '/html/body/app-root/app-toolbar/div/div[2]/button[2]',
  /** Fallback: live UI often labels the primary action "Continue" — prefer role-based click in postCheckInFlow. */
  signOutConfirmButton:
    '/html/body/div[2]/div[2]/div/mat-dialog-container/div/div/app-sign-out-modal/app-modal/div/div[2]/app-button[1]/button',
}

/** @type {(keyof typeof CHECKIN_XPATH)[]} */
export const CHECKIN_XPATH_KEYS = /** @type {(keyof typeof CHECKIN_XPATH)[]} */ (
  Object.keys(CHECKIN_XPATH)
)
