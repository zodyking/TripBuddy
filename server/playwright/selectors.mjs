/**
 * Centralized selectors for Ground Linehaul Dispatch.
 * Refine with Playwright codegen against the live app if labels differ.
 */

export const MENU = {
  checkIn: { role: 'button', name: 'Check In', exact: true },
  beginNewCheckIn: { role: 'button', name: /Begin New Check In/i },
  arrive: { role: 'button', name: /Arrive/i },
  inspectAndCheckOut: { role: 'button', name: /Inspect and Check Out/i },
  reviewAndStartTrip: { role: 'button', name: /Review and Start Trip/i },
  viewTripAndRouting: { role: 'button', name: /View Trip and Routing/i },
}

/**
 * Inspect/checkout form: adjust to match real inputs (codegen on headed run).
 * Tries label, placeholder, then ordinal inputs inside main content.
 */
export const FORM_FALLBACK = {
  dolly: [
    'input:near(:text("dolly"))',
    '[aria-label*="dolly" i]',
    '[placeholder*="dolly" i]',
  ],
  field1: [
    'input:near(:text("seal"))',
    'input:near(:text("trailer"))',
    '[aria-label*="seal" i]',
    '[aria-label*="trailer" i]',
    '[placeholder*="seal" i]',
    '[placeholder*="trailer" i]',
  ],
}
