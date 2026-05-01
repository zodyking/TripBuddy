import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'
import { readAssignmentForAccount } from './assignment-store.mjs'
import { bridgeDelayTier } from './bridge-delay-tier.mjs'
import { inferTravelDirectionFromTripBody } from './bridge-travel-context.mjs'
import { publishInAppForLastActiveUser } from './notification-publish.mjs'
import { getLastActiveAccountKey } from './active-account.mjs'

const STATE_KEY = G('bridge:tier-notify:v1')
const COOLDOWN_MS = 90_000

/**
 * @param {unknown} v
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
function normalizeApiTravelDir(v) {
  const s = String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (s === 'TONY' || s === 'TOWARDNY' || s === 'TONYC') return 'ToNY'
  if (s === 'TONJ' || s === 'TOWARDNJ' || s === 'TONJE') return 'ToNJ'
  if (s.includes('TO') && s.includes('NY') && !s.includes('NJ')) return 'ToNY'
  if (s.includes('TO') && s.includes('NJ') && !s.includes('NY')) return 'ToNJ'
  return ''
}

/**
 * @param {unknown} row
 */
function isTunnelRow(row) {
  if (row == null || typeof row !== 'object') return false
  const n = String((/** @type {Record<string, unknown>} */ (row)).crossingDisplayName || '')
  return /\btunnel\b/i.test(n)
}

/**
 * @param {unknown} row
 */
function isClosedRow(row) {
  return row != null && typeof row === 'object' && /** @type {any} */ (row).isCrossingClosed === true
}

/**
 * @returns {Promise<'ToNY' | 'ToNJ' | ''>}
 */
async function dispatchWatchTravelDir() {
  const ak = getLastActiveAccountKey()
  if (!ak) return ''
  try {
    const a = await readAssignmentForAccount(ak)
    const snap = a?.persistedLinehaulTripSnapshot
    if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
      const dir = inferTravelDirectionFromTripBody(snap)
      if (dir === 'ToNY' || dir === 'ToNJ') return dir
    }
  } catch {
    /* ignore */
  }
  return ''
}

function tierVerb(t) {
  if (t === 'green') return 'light traffic'
  if (t === 'orange') return 'moderate delays'
  return 'heavy delays'
}

/**
 * @typedef {{ tiers: Record<string, string>, lastNotifyAt: Record<string, number> }} TierNotifyState
 */

/**
 * @param {unknown[]} live
 */
export async function maybeNotifyBridgeTierChanges(live) {
  if (!Array.isArray(live) || live.length === 0) return

  const watchDir = await dispatchWatchTravelDir()

  /** @type {TierNotifyState} */
  const prev = await readKeyJson(STATE_KEY, () => ({
    tiers: {},
    lastNotifyAt: {},
  }))
  const tiers = { ...(prev.tiers || {}) }
  const lastNotifyAt = { ...(prev.lastNotifyAt || {}) }
  const now = Date.now()

  for (const row of live) {
    if (!row || typeof row !== 'object') continue
    if (isTunnelRow(row)) continue
    if (isClosedRow(row)) continue
    const o = /** @type {Record<string, unknown>} */ (row)
    const rid = o.routeId
    if (rid == null) continue
    const id = String(rid)
    const rowDir = normalizeApiTravelDir(o.travelDirection)
    if (watchDir) {
      if (rowDir !== watchDir) continue
    }

    const m = o.routeTravelTime
    const minutes = typeof m === 'number' && Number.isFinite(m) ? m : Number(m)
    if (!Number.isFinite(minutes) || minutes < 0) continue

    const tier = bridgeDelayTier(minutes)
    const prevTier = tiers[id]
    const name = String(o.crossingDisplayName || 'Crossing').trim() || 'Crossing'

    if (prevTier && prevTier !== tier) {
      const last = lastNotifyAt[id] || 0
      if (now - last >= COOLDOWN_MS) {
        const dirLab = rowDir === 'ToNY' ? 'to NY' : rowDir === 'ToNJ' ? 'to NJ' : ''
        const watchLab =
          watchDir === 'ToNY'
            ? ' (dispatch toward NY)'
            : watchDir === 'ToNJ'
              ? ' (dispatch toward NJ)'
              : ''
        const msg = `${name}${dirLab ? ` ${dirLab}` : ''}: ${tierVerb(prevTier)} → ${tierVerb(tier)} (${Math.round(minutes)} min)${watchLab}`
        void publishInAppForLastActiveUser({
          type: 'traffic',
          message: msg,
          source: 'bridges-tier',
          extra: {
            routeId: id,
            fromTier: prevTier,
            toTier: tier,
            minutes: Math.round(minutes),
            travelDirection: rowDir || null,
            watchDir: watchDir || null,
          },
        })
        lastNotifyAt[id] = now
      }
    }
    tiers[id] = tier
  }

  await writeKeyJson(STATE_KEY, { tiers, lastNotifyAt })
}
