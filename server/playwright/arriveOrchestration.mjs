import { getTractorNumber, getDriverPhone } from '../credentials-store.mjs'
import { readAssignment } from '../assignment-store.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { runFullArrive } from './arriveFlow.mjs'
import { runPhoneModalWithoutSignOut } from './postCheckInFlow.mjs'

/**
 * End-to-end Arrive flow: sign in, arrive at destination, optional phone / Linehaul / assistance.
 * Does not automate sign-out (avoids flaky timeouts that prevented TTS/UI success).
 *
 * If tractor was already arrived by geofence, no post steps.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} opts.signal
 * @param {boolean} opts.tryOktaLogin
 * @returns {Promise<{ success: boolean, error?: string, signedOut?: boolean, alreadyArrivedByGeofence?: boolean, missionComplete?: boolean, tripReadyAcknowledged?: boolean } | undefined>}
 */
export async function runArriveEndToEnd(page, opts) {
  const { log, signal, tryOktaLogin } = opts
  if (signal.aborted) throw new Error('Aborted')

  await ensureDispatchAppReady(page, {
    tryOktaLogin,
    log,
    signal,
  })

  const tractorNumber = await getTractorNumber()
  if (!tractorNumber) throw new Error('Set tractor number in Settings')

  let arrivePayload = await runFullArrive({
    page,
    tractorNumber,
    log,
    signal,
  })

  if (arrivePayload?.success === true) {
    if (arrivePayload.alreadyArrivedByGeofence) {
      log('info', 'Geofence arrival — mission complete (no automated sign-out)', {
        arriveComplete: true,
        missionComplete: true,
      })
      arrivePayload = {
        ...arrivePayload,
        missionComplete: true,
        signedOut: false,
      }
    } else {
      const cred = (await getDriverPhone()).trim()
      const a = await readAssignment()
      const phone = cred || (a.driverPhone || '').trim()
      if (!phone) {
        throw new Error(
          'Set driver phone (Driver Credentials in Settings) before Arrive',
        )
      }
      const post = await runPhoneModalWithoutSignOut(page, { phone, log, signal })
      arrivePayload = {
        ...arrivePayload,
        missionComplete: true,
        signedOut: false,
        tripReadyAcknowledged: post.tripReadyAcknowledged === true,
      }
    }
  }

  return arrivePayload
}
