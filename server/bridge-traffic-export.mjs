import { readKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'
import { POLL_MS } from './bridge-panynj.mjs'

const PANYNJ_KEY = G('bridge:panynj:series')
const VERRAZZANO_KEY = G('bridge:verrazzano:series')
const EXPORT_FORMAT_VERSION = 2

/**
 * @typedef {'to_ny' | 'to_nj'} DirectionCode
 * @typedef {{
 *   bridge: string,
 *   travelDirection: 'ToNY' | 'ToNJ',
 *   deck?: string,
 *   facilityType?: 'bridge' | 'tunnel',
 * }} RouteMeta
 */

/**
 * @type {Readonly<Record<string, RouteMeta>>}
 */
const PANYNJ_ROUTE_META = Object.freeze({
  217: { bridge: 'Bayonne Bridge', travelDirection: 'ToNJ', facilityType: 'bridge' },
  222: { bridge: 'Bayonne Bridge', travelDirection: 'ToNY', facilityType: 'bridge' },
  87: { bridge: 'Goethals Bridge', travelDirection: 'ToNJ', facilityType: 'bridge' },
  86: { bridge: 'Goethals Bridge', travelDirection: 'ToNY', facilityType: 'bridge' },
  260: { bridge: 'Outerbridge Crossing', travelDirection: 'ToNJ', facilityType: 'bridge' },
  2520: { bridge: 'Outerbridge Crossing', travelDirection: 'ToNY', facilityType: 'bridge' },
  12: {
    bridge: 'George Washington Bridge',
    travelDirection: 'ToNJ',
    deck: 'Upper',
    facilityType: 'bridge',
  },
  11: {
    bridge: 'George Washington Bridge',
    travelDirection: 'ToNJ',
    deck: 'Lower',
    facilityType: 'bridge',
  },
  211: {
    bridge: 'George Washington Bridge',
    travelDirection: 'ToNY',
    deck: 'Upper',
    facilityType: 'bridge',
  },
  212: {
    bridge: 'George Washington Bridge',
    travelDirection: 'ToNY',
    deck: 'Lower',
    facilityType: 'bridge',
  },
  259: { bridge: 'Holland Tunnel', travelDirection: 'ToNJ', facilityType: 'tunnel' },
  256: { bridge: 'Holland Tunnel', travelDirection: 'ToNY', facilityType: 'tunnel' },
  1: { bridge: 'Lincoln Tunnel', travelDirection: 'ToNJ', facilityType: 'tunnel' },
  224: { bridge: 'Lincoln Tunnel', travelDirection: 'ToNY', facilityType: 'tunnel' },
})

/** Preferred export order for known bridges (tunnels after bridges). */
const BRIDGE_SORT_ORDER = [
  'Bayonne Bridge',
  'Goethals Bridge',
  'Outerbridge Crossing',
  'George Washington Bridge',
  'Verrazzano-Narrows Bridge',
  'Holland Tunnel',
  'Lincoln Tunnel',
]

/**
 * @param {string} s
 */
function slugPart(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * @param {RouteMeta & { routeId?: string }} meta
 * @returns {DirectionCode}
 */
function directionCode(meta) {
  return meta.travelDirection === 'ToNJ' ? 'to_nj' : 'to_ny'
}

/**
 * @param {DirectionCode} code
 */
function directionLabel(code) {
  if (code === 'to_nj') return 'To New Jersey'
  return 'To New York'
}

/**
 * @param {RouteMeta} meta
 */
function buildDisplayName(meta) {
  const dir = directionLabel(directionCode(meta))
  const deck = meta.deck ? `${meta.deck} deck` : ''
  if (deck) return `${meta.bridge} (${deck}) — ${dir}`
  return `${meta.bridge} — ${dir}`
}

/**
 * @param {RouteMeta & { routeId?: string }} meta
 */
function buildDatasetKey(meta) {
  const parts = [slugPart(meta.bridge)]
  if (meta.deck) parts.push(slugPart(meta.deck))
  parts.push(directionCode(meta))
  return parts.join('__')
}

/**
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function summarizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      observationCount: 0,
      firstRecordedAt: null,
      lastRecordedAt: null,
      historySpanHours: 0,
    }
  }
  const first = points[0].t
  const last = points[points.length - 1].t
  return {
    observationCount: points.length,
    firstRecordedAt: new Date(first).toISOString(),
    lastRecordedAt: new Date(last).toISOString(),
    historySpanHours: Math.round(((last - first) / 3_600_000) * 100) / 100,
  }
}

/**
 * @param {Array<{ t: number, m: number, s: number }>} points
 */
function formatObservations(points) {
  if (!Array.isArray(points)) return []
  return points.map((p) => ({
    recordedAt: new Date(p.t).toISOString(),
    crossingTimeMinutes: p.m,
    observedSpeedMph: p.s,
  }))
}

/**
 * @param {RouteMeta & { routeId: string }} meta
 * @param {Array<{ t: number, m: number, s: number }>} points
 * @param {'panynj' | 'verrazzano'} source
 */
function buildDataset(meta, points, source) {
  const dir = directionCode(meta)
  const summary = summarizePoints(points)
  return {
    datasetKey: buildDatasetKey(meta),
    displayName: buildDisplayName(meta),
    bridgeName: meta.bridge,
    deck: meta.deck ?? null,
    travelDirection: dir,
    travelDirectionLabel: directionLabel(dir),
    facilityType: meta.facilityType ?? 'bridge',
    dataSource: source,
    panynjRouteId: source === 'panynj' ? meta.routeId : null,
    pollIntervalMinutes: source === 'panynj' ? POLL_MS / 60_000 : null,
    maxStoredObservations: 500,
    ...summary,
    observations: formatObservations(points),
  }
}

/**
 * @param {{ datasetKey: string, displayName: string, observationCount: number, firstRecordedAt: string | null, lastRecordedAt: string | null }} ds
 */
function indexRow(ds) {
  return {
    datasetKey: ds.datasetKey,
    displayName: ds.displayName,
    observationCount: ds.observationCount,
    firstRecordedAt: ds.firstRecordedAt,
    lastRecordedAt: ds.lastRecordedAt,
  }
}

/**
 * @param {string} bridgeName
 */
function bridgeSortRank(bridgeName) {
  const i = BRIDGE_SORT_ORDER.indexOf(bridgeName)
  return i === -1 ? 999 : i
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

  /** @type {Array<ReturnType<typeof buildDataset>>} */
  const datasets = []

  const routeIds = Object.keys(panynjSt.pointsByRoute || {})
  for (const routeId of routeIds) {
    const raw = panynjSt.pointsByRoute[routeId]
    const points = Array.isArray(raw) ? raw : []
    const base = PANYNJ_ROUTE_META[routeId] || {
      bridge: `Unknown crossing (PANYNJ route ${routeId})`,
      travelDirection: /** @type {const} */ ('ToNY'),
      facilityType: /** @type {const} */ ('bridge'),
    }
    datasets.push(
      buildDataset({ ...base, routeId: String(routeId) }, points, 'panynj'),
    )
  }

  for (const travelDirection of /** @type {const} */ (['ToNY', 'ToNJ'])) {
    const points = Array.isArray(vzSt.pointsByDirection?.[travelDirection])
      ? vzSt.pointsByDirection[travelDirection]
      : []
    datasets.push(
      buildDataset(
        {
          bridge: 'Verrazzano-Narrows Bridge',
          travelDirection,
          facilityType: 'bridge',
          routeId: 'verrazzano',
        },
        points,
        'verrazzano',
      ),
    )
  }

  datasets.sort((a, b) => {
    const br = bridgeSortRank(a.bridgeName) - bridgeSortRank(b.bridgeName)
    if (br !== 0) return br
    const deckA = a.deck || ''
    const deckB = b.deck || ''
    if (deckA !== deckB) return deckA.localeCompare(deckB)
    return a.travelDirection.localeCompare(b.travelDirection)
  })

  const index = datasets.map(indexRow)

  return {
    exportInfo: {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      description:
        'Each item in crossingDatasets is one bridge (or tunnel) leg in one travel direction. Use datasetKey or displayName to identify the series.',
      observationFields: {
        recordedAt: 'ISO-8601 timestamp when the sample was stored',
        crossingTimeMinutes: 'PANYNJ / HERE corridor crossing time in minutes',
        observedSpeedMph: 'Observed speed in mph',
      },
    },
    storageInfo: {
      postgresTable: 'fedextool_kv',
      panynjSeriesKey: PANYNJ_KEY,
      verrazzanoSeriesKey: VERRAZZANO_KEY,
      panynjLastAppendAt:
        panynjSt.lastAppendTs > 0
          ? new Date(panynjSt.lastAppendTs).toISOString()
          : null,
      verrazzanoLastAppendAt:
        vzSt.lastAppendTs > 0
          ? new Date(vzSt.lastAppendTs).toISOString()
          : null,
    },
    datasetIndex: index,
    crossingDatasets: datasets,
  }
}
