import { getTractorNumber } from '../credentials-store.mjs'
import { readAssignment } from '../assignment-store.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { runFullArrive } from './arriveFlow.mjs'
import { runPhoneModalAndSignOut } from './postCheckInFlow.mjs'

/**
 * End-to-end Arrive flow: sign in, arrive at destination, phone modal, sign out.
 * Same pattern as checkInOrchestration but for arrival confirmation.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} opts.signal
 * @param {boolean} opts.tryOktaLogin
 * @returns {Promise<{ success: boolean, error?: string, signedOut?: boolean } | undefined>}
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
    const a = await readAssignment()
    const phone = (a.driverPhone || '').trim()
    if (!phone) {
      throw new Error(
        'Set driver phone (Driver Credentials in Settings) before Arrive',
      )
    }
    await runPhoneModalAndSignOut(page, { phone, log, signal })
    arrivePayload = { ...arrivePayload, signedOut: true }
  }

  return arrivePayload
}
