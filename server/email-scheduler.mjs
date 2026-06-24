import { listAccountKeysWithSmtpEnabled } from './user-profile-pg.mjs'
import { maybeSendScheduledEmailsForAccount } from './email-notification-service.mjs'
import { maybeSyncEmailTripActivityForAccount } from './email-trip-activity.mjs'

const TICK_MS = 60_000
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null

async function tick() {
  try {
    const accounts = await listAccountKeysWithSmtpEnabled()
    const now = new Date()
    for (const ak of accounts) {
      try {
        await maybeSyncEmailTripActivityForAccount(ak)
      } catch (e) {
        console.error('[email-scheduler] trip activity sync failed', ak, e)
      }
      try {
        await maybeSendScheduledEmailsForAccount(ak, now)
      } catch (e) {
        console.error('[email-scheduler] account failed', ak, e)
      }
    }
  } catch (e) {
    console.error('[email-scheduler] tick failed', e)
  }
}

export function startEmailScheduler() {
  if (timer) return
  timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  void tick()
}

export function stopEmailScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
