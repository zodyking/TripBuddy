import { appendInAppNotification, appendInAppForLastActive } from './in-app-notifications-store.mjs'
import { getLastActiveAccountKey } from './active-account.mjs'
import { emitLog } from './log-bus.mjs'
import { broadcastInAppToAccountSessions } from './session-sse.mjs'

/**
 * @param {{ id: string, message: string, type?: string, source?: string, read?: boolean, ts?: number, extra?: object }} item
 * @param {string} accountKey
 */
function emitInAppToSse(item, accountKey) {
  if (!item) return
  const pl = {
    type: 'inapp',
    message: item.message,
    id: item.id,
    ntype: item.type,
    source: item.source,
    read: item.read,
    ts: item.ts,
    extra: item.extra,
  }
  emitLog('inapp', item.message, {
    id: item.id,
    ntype: item.type,
    source: item.source,
    read: item.read,
    ts: item.ts,
    extra: item.extra,
  })
  broadcastInAppToAccountSessions(accountKey, pl)
}

/**
 * Persist + broadcast one in-app notification to a specific account (SSE `inapp`).
 * @param {string} accountKey
 * @param {{ type?: string, message: string, source: string, extra?: object }} payload
 */
export async function publishInAppForAccount(accountKey, payload) {
  if (!accountKey) return { ok: false, skipped: 'no_account' }
  try {
    const r = await appendInAppNotification(accountKey, payload)
    if (r?.item) {
      emitInAppToSse(r.item, accountKey)
    }
    return r
  } catch (e) {
    console.error('[notifications] publishInAppForAccount failed:', e)
    return { ok: false, skipped: 'storage_error' }
  }
}

/**
 * Persist + broadcast for whichever account is “last active” (poll, bridge digest).
 */
export async function publishInAppForLastActiveUser(payload) {
  try {
    const r = await appendInAppForLastActive(payload)
    const ak = getLastActiveAccountKey()
    if (r?.item && ak) {
      emitInAppToSse(r.item, ak)
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
 * When Port Authority crossing data changes materially, notify the last-active user (same as poll).
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
