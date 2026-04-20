/**
 * FedEx dispatch entry (same concept as server `DISPATCH_ENTRY_URL`).
 * Override at build time: VITE_FEDEX_DISPATCH_URL=https://...
 */
export const FEDEX_DISPATCH_HOME_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FEDEX_DISPATCH_URL) ||
  'https://fdxtools.fedex.com/grdlhldispatch/home'
