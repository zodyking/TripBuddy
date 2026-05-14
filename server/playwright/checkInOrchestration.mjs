import { getTractorNumber, getLinehaulDriverId, getDecryptedLinehaulBearer, getDriverPhone } from '../credentials-store.mjs'
import { readAssignment } from '../assignment-store.mjs'
import { linehaulGet } from '../fedex-linehaul-api.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { runFullCheckIn, retryCheckInWithNewLocation } from './checkInFlow.mjs'
import { runPhoneModalUntilMissionComplete } from './postCheckInFlow.mjs'

/**
 * Fetch driver location from FedEx API.
 * @returns {Promise<string>} driverLocation (digits)
 */
async function fetchDriverLocation() {
  const driverId = await getLinehaulDriverId()
  if (!driverId) {
    throw new Error('Set Username / Driver ID in Settings (digits only)')
  }
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) {
    throw new Error('No FedEx Linehaul bearer token. Use Settings → Capture Linehaul token first.')
  }
  const result = await linehaulGet('driver', driverId, bearer)
  if (!result.ok) {
    throw new Error(`Failed to fetch driver info (status ${result.status}). Check your bearer token.`)
  }
  const driverLocation = result.body?.driverLocation
  if (!driverLocation || String(driverLocation).trim() === '') {
    throw new Error('Driver location not available from FedEx API. Location will be prompted if mismatch occurs.')
  }
  return String(driverLocation).trim()
}

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
 * @returns {Promise<{ success: boolean, bannerText?: string, locationMismatch?: boolean, missionComplete?: boolean, signedOut?: boolean, tripReadyAcknowledged?: boolean, checkInNewTripFound?: boolean } | undefined>}
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

  // Fetch driver location from FedEx API instead of saved assignment
  const loc = await fetchDriverLocation()
  log('info', `Using driver location from API: ${loc}`)

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
    const postResult = await runPhoneModalUntilMissionComplete(page, {
      log,
      signal,
      getPhone: async () => {
        const fromC = (await getDriverPhone()).trim()
        if (fromC) return fromC
        const a = await readAssignment()
        return (a.driverPhone || '').trim()
      },
    })
    checkInPayload = {
      ...checkInPayload,
      missionComplete: true,
      signedOut: false,
      tripReadyAcknowledged: postResult.tripReadyAcknowledged === true,
      checkInNewTripFound: postResult.checkInNewTripFound === true,
    }
  }

  return checkInPayload
}
