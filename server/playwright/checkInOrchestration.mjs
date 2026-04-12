import { getTractorNumber } from '../credentials-store.mjs'
import { readAssignment } from '../assignment-store.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { runFullCheckIn, retryCheckInWithNewLocation } from './checkInFlow.mjs'
import { runPhoneModalAndSignOut } from './postCheckInFlow.mjs'

/**
 * Same end-to-end check-in as POST /api/run `check_in`, with injectable location-retry wait.
 * Runner uses `waitForCheckInRetryLocation`; block automations use `waitForBlockRetryLocation`.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} opts.signal
 * @param {boolean} opts.tryOktaLogin
 * @param {string} opts.runId
 * @param {(runId: string, signal: AbortSignal) => Promise<string>} opts.waitForLocationRetry
 * @returns {Promise<{ success: boolean, bannerText?: string, locationMismatch?: boolean, signedOut?: boolean, tripReadyAcknowledged?: boolean } | undefined>}
 */
export async function runCheckInEndToEnd(page, opts) {
  const { log, signal, tryOktaLogin, runId, waitForLocationRetry } = opts
  if (signal.aborted) throw new Error('Aborted')

  await ensureDispatchAppReady(page, {
    tryOktaLogin,
    log,
    signal,
  })

  const tractorNumber = await getTractorNumber()
  if (!tractorNumber) throw new Error('Set tractor number in Settings')

  const assignment = await readAssignment()
  const loc = (assignment.tractorLocation || '').trim()
  if (!loc) {
    throw new Error('Set current location (Tractor location) before Check in')
  }

  let checkInPayload = await runFullCheckIn({
    page,
    tractorNumber,
    currentLocation: loc,
    log,
    signal,
    runId,
  })

  while (
    checkInPayload &&
    !checkInPayload.success &&
    checkInPayload.locationMismatch === true
  ) {
    const newLoc = await waitForLocationRetry(runId, signal)
    checkInPayload = await retryCheckInWithNewLocation({
      page,
      currentLocation: newLoc,
      log,
      signal,
      runId,
    })
  }

  if (checkInPayload?.success === true) {
    const a = await readAssignment()
    const phone = (a.driverPhone || '').trim()
    if (!phone) {
      throw new Error(
        'Set driver phone (Driver Credentials in Settings) before Check in',
      )
    }
    const postResult = await runPhoneModalAndSignOut(page, { phone, log, signal })
    checkInPayload = {
      ...checkInPayload,
      signedOut: true,
      tripReadyAcknowledged: postResult.tripReadyAcknowledged,
    }
  }

  return checkInPayload
}
