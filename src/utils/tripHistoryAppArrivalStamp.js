import { putAssignment } from '../api.js'
import { invalidateLastTripMileageFetchKeyForSeq } from '../stores/linehaulSnapshotStore.js'

/**
 * Human-readable local arrival stamp for trip-form PDF / history (browser locale).
 * @param {number} [capturedAtMs]
 */
export function formatAppCapturedTripArrivalLocal(capturedAtMs = Date.now()) {
  return new Date(capturedAtMs).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/**
 * Merge app-captured arrival metadata onto the existing trip-history row for this leg
 * (shallow upsert merge keeps prior tripDetails keys FedEx did not resend).
 *
 * @param {string} dailyTripLegSequence
 * @param {number} [capturedAtMs]
 */
export async function upsertTripHistoryAppCapturedArrival(dailyTripLegSequence, capturedAtMs = Date.now()) {
  const seq = String(dailyTripLegSequence ?? '').trim()
  if (!/^\d+$/.test(seq)) return
  const ms =
    typeof capturedAtMs === 'number' && Number.isFinite(capturedAtMs) && capturedAtMs > 0
      ? capturedAtMs
      : Date.now()
  await putAssignment({
    upsertTripHistoryEntry: {
      id: `h-${seq}`,
      source: 'linehaul',
      dailyTripLegSequence: seq,
      tripDetails: {
        appCapturedTripArrivalLocal: formatAppCapturedTripArrivalLocal(ms),
        appCapturedTripArrivalAtMs: ms,
      },
    },
  })
  invalidateLastTripMileageFetchKeyForSeq(seq)
}
