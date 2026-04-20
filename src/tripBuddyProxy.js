/**
 * Must match server `trip-buddy-proxy.mjs` TRIP_BUDDY_PROXY_PREFIX (default /embed/trip-buddy).
 */
export const TRIP_BUDDY_PROXY_PREFIX =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TRIP_BUDDY_PROXY_PREFIX) ||
  '/embed/trip-buddy'
