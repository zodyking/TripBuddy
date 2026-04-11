import { PRESETS } from './assignment-store.mjs'

/**
 * Default photo slots until automatic assignment rules exist.
 */
export function getDefaultPhotoSlots() {
  return PRESETS.sealed_dual.photoSlots.map((s) => ({ ...s }))
}

/**
 * Hook for future logic (poll fingerprint, trip type, etc.).
 * Return nothing to keep the current file-backed assignment unchanged.
 *
 * @param {object} ctx e.g. { source: 'get'|'poll', fingerprint?, previous?, current?, assignment? }
 */
export async function maybeUpdateAssignmentFromContext(_ctx) {
  return null
}
