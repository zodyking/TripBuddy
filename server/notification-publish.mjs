import { appendInAppNotification, appendInAppForLastActive } from './in-app-notifications-store.mjs'
import { emitLog } from './log-bus.mjs'
import { maybeSendEmailForInAppNotification } from './email-notification-service.mjs'

/**
 * Persist + emit one in-app notification (KV inbox + SSE via logBus `inapp`).
 * @param {string} accountKey
 * @param {{ type?: string, message: string, source: string, extra?: object }} payload
 */
export async function publishInAppForAccount(accountKey, payload) {
  if (!accountKey) return { ok: false, skipped: 'no_account' }
  try {
    const r = await appendInAppNotification(accountKey, payload)
    if (r?.item) {
      emitLog('inapp', r.item.message, {
        id: r.item.id,
        ntype: r.item.type,
        source: r.item.source,
        read: r.item.read,
        ts: r.item.ts,
        extra: r.item.extra,
      })
      void maybeSendEmailForInAppNotification(accountKey, payload).catch((e) => {
        console.error('[email] trip notification failed', e)
      })
    }
    return r
  } catch (e) {
    console.error('[notifications] publishInAppForAccount failed:', e)
    return { ok: false, skipped: 'storage_error' }
  }
}

/**
 * Persist + emit for last-active account (poll, bridge digest).
 */
export async function publishInAppForLastActiveUser(payload) {
  try {
    const r = await appendInAppForLastActive(payload)
    if (r?.item) {
      emitLog('inapp', r.item.message, {
        id: r.item.id,
        ntype: r.item.type,
        source: r.item.source,
        read: r.item.read,
        ts: r.item.ts,
        extra: r.item.extra,
      })
    }
    return r
  } catch (e) {
    console.error('[notifications] publishInAppForLastActiveUser failed:', e)
    return { ok: false, skipped: 'storage_error' }
  }
}

/** @type {string | null} */
let lastBridgeDigestSig = null

/**
 * When Port Authority crossing data changes materially, notify the last-active user.
 * @param {unknown[]} live
 */
export function maybeNotifyBridgeCrossingDigest(live) {
  if (!Array.isArray(live) || live.length === 0) return
  const parts = []
  for (let i = 0; i < Math.min(live.length, 40); i++) {
    const row = live[i]
    if (!row || typeof row !== 'object') continue
    const o = /** @type {Record<string, unknown>} */ (row)
    const id = o.routeId
    const t = o.routeTravelTime
    const n = o.crossingDisplayName
    parts.push(
      `${id ?? ''}:${typeof t === 'number' ? t : String(t ?? '')}:${typeof n === 'string' ? n.slice(0, 24) : ''}`,
    )
  }
  const sig = parts.join('|')
  if (sig === lastBridgeDigestSig) return
  lastBridgeDigestSig = sig
  void publishInAppForLastActiveUser({
    type: 'traffic',
    message: 'Bridge and tunnel crossing times were refreshed',
    source: 'bridges',
    extra: { routeCount: live.length },
  })
}
