/**
 * Broadcast PANYNJ crossing tier changes on SSE for all connected clients.
 */
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'
import { emitLog } from './log-bus.mjs'
import { bridgeDelayTier } from './bridge-delay-tier.mjs'
import {
  isTunnelRow,
  normalizeApiTravelDir,
  rowDisplayTitle,
  rowKey,
  rowRouteSpeedMph,
  rowTravelMinutes,
} from './bridge-crossing-server.mjs'

const STATE_KEY = G('bridge:panynj:lastTierByRow')

/**
 * @param {unknown} live
 */
export async function broadcastBridgeTierChanges(live) {
  if (!Array.isArray(live) || live.length === 0) return

  const prevDoc = await readKeyJson(STATE_KEY, () => ({ v: 1, tiers: /** @type {Record<string, string>} */ ({}) }))
  const prevTiers =
    prevDoc && typeof prevDoc === 'object' && prevDoc.tiers && typeof prevDoc.tiers === 'object'
      ? /** @type {Record<string, string>} */ (prevDoc.tiers)
      : {}

  /** @type {Record<string, string>} */
  const nextTiers = { ...prevTiers }

  for (const row of live) {
    if (!row || typeof row !== 'object' || isTunnelRow(row)) continue
    const k = rowKey(row)
    if (!k) continue
    const mins = rowTravelMinutes(row)
    if (mins == null || !Number.isFinite(mins)) continue
    const tier = bridgeDelayTier(mins)
    const spd = rowRouteSpeedMph(row)
    const dir = normalizeApiTravelDir(
      (/** @type {Record<string, unknown>} */ (row)).travelDirection,
    )
    const title = rowDisplayTitle(row)
    const prev = prevTiers[k]
    if (prev === tier) {
      nextTiers[k] = tier
      continue
    }
    // Cold start: avoid emitting every crossing once; only alert new reds or real transitions after warmup.
    if (!prev && tier !== 'red') {
      nextTiers[k] = tier
      continue
    }
    nextTiers[k] = tier
    const rid =
      (/** @type {Record<string, unknown>} */ (row)).routeId != null
        ? String((/** @type {Record<string, unknown>} */ (row)).routeId)
        : ''
    emitLog('bridge_tier', `${title}: traffic ${tier}`, {
      type: 'bridge_tier',
      routeId: rid,
      rowKey: k,
      title,
      travelDirection: dir || '',
      prevTier: prev || '',
      tier,
      minutes: mins,
      speedMph: spd != null && Number.isFinite(spd) ? spd : null,
      ts: Date.now(),
    })
  }

  await writeKeyJson(STATE_KEY, { v: 1, tiers: nextTiers })
}
