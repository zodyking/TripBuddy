import { readKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'
import { POLL_MS } from './bridge-panynj.mjs'

const PANYNJ_KEY = G('bridge:panynj:series')
const VERRAZZANO_KEY = G('bridge:verrazzano:series')

/**
 * PANYNJ `routeId` → bridge label + direction (+ deck when GWB).
 * @type {Readonly<Record<string, { bridge: string, travelDirection: 'ToNY' | 'ToNJ', deck?: string }>>}
 */
const PANYNJ_ROUTE_META = Object.freeze({
  217: { bridge: 'Bayonne Bridge', travelDirection: 'ToNJ' },
  222: { bridge: 'Bayonne Bridge', travelDirection: 'ToNY' },
  87: { bridge: 'Goethals Bridge', travelDirection: 'ToNJ' },
  86: { bridge: 'Goethals Bridge', travelDirection: 'ToNY' },
  260: { bridge: 'Outerbridge Crossing', travelDirection: 'ToNJ' },
  2520: { bridge: 'Outerbridge Crossing', travelDirection: 'ToNY' },
  12: { bridge: 'George Washington Bridge', travelDirection: 'ToNJ', deck: 'Upper' },
  11: { bridge: 'George Washington Bridge', travelDirection: 'ToNJ', deck: 'Lower' },
  211: { bridge: 'George Washington Bridge', travelDirection: 'ToNY', deck: 'Upper' },
  212: { bridge: 'George Washington Bridge', travelDirection: 'ToNY', deck: 'Lower' },
  259: { bridge: 'Holland Tunnel', travelDirection: 'ToNJ' },
  256: { bridge: 'Holland Tunnel', travelDirection: 'ToNY' },
  1: { bridge: 'Lincoln Tunnel', travelDirection: 'ToNJ' },
  224: { bridge: 'Lincoln Tunnel', travelDirection: 'ToNY' },
})

/**
 * @param {{ bridge: string, deck?: string }} meta
 */
function bridgeGroupKey(meta) {
  const deck = meta.deck ? String(meta.deck).trim() : ''
  return deck ? `${meta.bridge} — ${deck}` : meta.bridge
}

/**
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function summarizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      pointCount: 0,
      firstAt: null,
      lastAt: null,
      spanHours: 0,
    }
  }
  const first = points[0].t
  const last = points[points.length - 1].t
  return {
    pointCount: points.length,
    firstAt: new Date(first).toISOString(),
    lastAt: new Date(last).toISOString(),
    spanHours: Math.round(((last - first) / 3_600_000) * 100) / 100,
  }
}

/**
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function formatSamples(points) {
  if (!Array.isArray(points)) return []
  return points.map((p) => ({
    at: new Date(p.t).toISOString(),
    crossingMinutes: p.m,
    speedMph: p.s,
  }))
}

/**
 * Full Postgres KV history for all stored bridge / tunnel routes + Verrazzano.
 */
export async function buildBridgeTrafficExport() {
  const panynjSt = await readKeyJson(PANYNJ_KEY, () => ({
    lastAppendTs: 0,
    pointsByRoute: {},
  }))
  const vzSt = await readKeyJson(VERRAZZANO_KEY, () => ({
    lastAppendTs: 0,
    pointsByDirection: { ToNY: [], ToNJ: [] },
  }))

  /** @type {Record<string, Record<string, unknown>>} */
  const byBridge = {}

  const routeIds = Object.keys(panynjSt.pointsByRoute || {}).sort((a, b) => {
    const ma = PANYNJ_ROUTE_META[a]
    const mb = PANYNJ_ROUTE_META[b]
    const ba = ma ? bridgeGroupKey(ma) : a
    const bb = mb ? bridgeGroupKey(mb) : b
    return ba.localeCompare(bb) || a.localeCompare(b)
  })

  for (const routeId of routeIds) {
    const raw = panynjSt.pointsByRoute[routeId]
    const points = Array.isArray(raw) ? raw : []
    const meta = PANYNJ_ROUTE_META[routeId] || {
      bridge: `Unknown crossing (route ${routeId})`,
      travelDirection: /** @type {const} */ ('ToNY'),
    }
    const group = bridgeGroupKey(meta)
    const dir = meta.travelDirection
    if (!byBridge[group]) byBridge[group] = {}
    byBridge[group][dir] = {
      routeId: String(routeId),
      source: 'panynj',
      pollIntervalMs: POLL_MS,
      maxStoredPoints: 500,
      ...summarizePoints(points),
      samples: formatSamples(points),
    }
  }

  const vzBridge = 'Verrazzano-Narrows Bridge'
  byBridge[vzBridge] = {}
  for (const dir of /** @type {const} */ (['ToNY', 'ToNJ'])) {
    const points = Array.isArray(vzSt.pointsByDirection?.[dir])
      ? vzSt.pointsByDirection[dir]
      : []
    byBridge[vzBridge][dir] = {
      routeId: 'verrazzano',
      source: 'verrazzano',
      maxStoredPoints: 500,
      ...summarizePoints(points),
      samples: formatSamples(points),
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    storage: {
      postgresTable: 'fedextool_kv',
      panynjKey: PANYNJ_KEY,
      verrazzanoKey: VERRAZZANO_KEY,
      panynjLastAppendAt:
        panynjSt.lastAppendTs > 0
          ? new Date(panynjSt.lastAppendTs).toISOString()
          : null,
      verrazzanoLastAppendAt:
        vzSt.lastAppendTs > 0
          ? new Date(vzSt.lastAppendTs).toISOString()
          : null,
    },
    byBridge,
  }
}
