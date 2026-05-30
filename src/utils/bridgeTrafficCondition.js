/**
 * Per-bridge / per-direction traffic severity from crossing time + observed speed.
 * Baseline comes from PANYNJ `routeTravelTimeHist` / `routeSpeedHist` when present,
 * else calibrated static profiles, else median of stored history series.
 */

/** @typedef {'low' | 'medium' | 'high' | 'standstill'} BridgeTrafficLevel */
/** @typedef {'green' | 'orange' | 'red'} BridgeDelayTier */

/**
 * Static fallbacks when API hist is missing (Verrazzano uses direction key).
 * Each routeId is already direction-specific in PANYNJ data.
 * @type {Readonly<Record<string, { baselineMinutes: number, baselineSpeedMph: number }>>}
 */
export const BRIDGE_TRAFFIC_STATIC_BASELINES = Object.freeze({
  217: { baselineMinutes: 2, baselineSpeedMph: 45 },
  222: { baselineMinutes: 2, baselineSpeedMph: 45 },
  87: { baselineMinutes: 2, baselineSpeedMph: 45 },
  86: { baselineMinutes: 3, baselineSpeedMph: 40 },
  260: { baselineMinutes: 4, baselineSpeedMph: 47 },
  2520: { baselineMinutes: 7, baselineSpeedMph: 40 },
  12: { baselineMinutes: 12, baselineSpeedMph: 28 },
  11: { baselineMinutes: 11, baselineSpeedMph: 28 },
  211: { baselineMinutes: 20, baselineSpeedMph: 18 },
  212: { baselineMinutes: 17, baselineSpeedMph: 20 },
  verrazzano: {
    ToNY: { baselineMinutes: 24, baselineSpeedMph: 34 },
    ToNJ: { baselineMinutes: 10.5, baselineSpeedMph: 42 },
  },
})

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function finitePositive(v) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * @param {number[]} sorted
 */
function medianSorted(sorted) {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * @param {Array<{ m?: number, s?: number }> | null | undefined} series
 * @param {number} [minPoints=12]
 */
export function medianFromSeries(series, minPoints = 12) {
  if (!Array.isArray(series) || series.length < minPoints) return null
  const minutes = series
    .map((p) => (p && typeof p === 'object' ? p.m : NaN))
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => a - b)
  const speeds = series
    .map((p) => (p && typeof p === 'object' ? p.s : NaN))
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b)
  const baselineMinutes = medianSorted(minutes)
  const baselineSpeedMph = medianSorted(speeds)
  if (baselineMinutes == null) return null
  return {
    baselineMinutes,
    baselineSpeedMph: baselineSpeedMph ?? null,
  }
}

/**
 * @param {string} routeId
 * @param {'ToNY' | 'ToNJ' | ''} [travelDirection]
 */
export function staticBaselineForRoute(routeId, travelDirection = '') {
  const id = String(routeId ?? '').trim()
  if (!id) return null
  if (id === 'verrazzano') {
    const dir =
      travelDirection === 'ToNY' || travelDirection === 'ToNJ' ? travelDirection : 'ToNY'
    const row = /** @type {Record<string, { baselineMinutes: number, baselineSpeedMph: number }>} */ (
      BRIDGE_TRAFFIC_STATIC_BASELINES.verrazzano
    )[dir]
    return row ?? null
  }
  const row = BRIDGE_TRAFFIC_STATIC_BASELINES[id]
  return row ?? null
}

/**
 * @typedef {{
 *   routeId?: string | number,
 *   travelDirection?: string,
 *   routeTravelTime?: number | string | null,
 *   routeSpeed?: number | string | null,
 *   routeTravelTimeHist?: number | string | null,
 *   routeSpeedHist?: number | string | null,
 *   series?: Array<{ m?: number, s?: number }>,
 * }} BridgeTrafficInput
 */

/**
 * Resolve typical crossing time + speed for a route.
 * @param {BridgeTrafficInput} input
 */
export function resolveBridgeBaseline(input) {
  const histM = finitePositive(input?.routeTravelTimeHist)
  const histS = finitePositive(input?.routeSpeedHist)
  if (histM != null) {
    return {
      baselineMinutes: histM,
      baselineSpeedMph: histS,
      source: /** @type {const} */ ('hist'),
    }
  }

  const fromSeries = medianFromSeries(input?.series)
  if (fromSeries) {
    return {
      baselineMinutes: fromSeries.baselineMinutes,
      baselineSpeedMph: fromSeries.baselineSpeedMph,
      source: /** @type {const} */ ('series'),
    }
  }

  const dir = normalizeTravelDir(input?.travelDirection)
  const fromStatic = staticBaselineForRoute(String(input?.routeId ?? ''), dir)
  if (fromStatic) {
    return {
      baselineMinutes: fromStatic.baselineMinutes,
      baselineSpeedMph: fromStatic.baselineSpeedMph,
      source: /** @type {const} */ ('static'),
    }
  }

  return null
}

/**
 * @param {unknown} v
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
function normalizeTravelDir(v) {
  const s = String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (s === 'TONY' || s === 'TOWARDNY') return 'ToNY'
  if (s === 'TONJ' || s === 'TOWARDNJ') return 'ToNJ'
  if (s.includes('TO') && s.includes('NY') && !s.includes('NJ')) return 'ToNY'
  if (s.includes('TO') && s.includes('NJ') && !s.includes('NY')) return 'ToNJ'
  return ''
}

/**
 * @param {BridgeTrafficInput} input
 * @returns {{
 *   level: BridgeTrafficLevel,
 *   tier: BridgeDelayTier,
 *   baselineMinutes: number | null,
 *   baselineSpeedMph: number | null,
 *   timeRatio: number | null,
 *   speedRatio: number | null,
 * }}
 */
export function classifyBridgeTraffic(input) {
  const minutes = finitePositive(input?.routeTravelTime)
  if (minutes == null) {
    return {
      level: /** @type {const} */ ('medium'),
      tier: /** @type {const} */ ('orange'),
      baselineMinutes: null,
      baselineSpeedMph: null,
      timeRatio: null,
      speedRatio: null,
    }
  }

  const speed = finitePositive(input?.routeSpeed)
  const baseline = resolveBridgeBaseline(input)

  if (!baseline) {
    return classifyWithGlobalFallback(minutes, speed)
  }

  const bm = Math.max(0.75, baseline.baselineMinutes)
  const bs =
    baseline.baselineSpeedMph != null && baseline.baselineSpeedMph > 0
      ? baseline.baselineSpeedMph
      : null

  const timeRatio = minutes / bm
  const speedRatio = speed != null && bs != null ? speed / bs : null

  const level = levelFromRatios({
    minutes,
    speed,
    baselineMinutes: bm,
    timeRatio,
    speedRatio,
  })

  return {
    level,
    tier: tierFromLevel(level),
    baselineMinutes: bm,
    baselineSpeedMph: bs,
    timeRatio,
    speedRatio,
  }
}

/**
 * @param {{
 *   minutes: number,
 *   speed: number | null,
 *   baselineMinutes: number,
 *   timeRatio: number,
 *   speedRatio: number | null,
 * }} p
 * @returns {BridgeTrafficLevel}
 */
function levelFromRatios(p) {
  const { minutes, speed, baselineMinutes, timeRatio, speedRatio } = p
  const sr = speedRatio ?? 1

  const standstill =
    (speed != null && speed <= 8) ||
    timeRatio >= 3.25 ||
    (timeRatio >= 2.35 && speed != null && speed <= 12) ||
    (minutes >= baselineMinutes + 20 && timeRatio >= 2)

  if (standstill) return 'standstill'

  const high =
    timeRatio >= 1.85 ||
    (timeRatio >= 1.55 && sr < 0.68) ||
    (timeRatio >= 1.4 && sr < 0.55) ||
    minutes >= baselineMinutes + 14

  if (high) return 'high'

  const medium =
    timeRatio >= 1.28 ||
    (timeRatio >= 1.14 && sr < 0.8) ||
    sr < 0.62 ||
    minutes >= baselineMinutes + 5

  if (medium) return 'medium'

  return 'low'
}

/**
 * Legacy global bands when no bridge baseline exists.
 * @param {number} minutes
 * @param {number | null} speed
 */
function classifyWithGlobalFallback(minutes, speed) {
  let level = /** @type {BridgeTrafficLevel} */ ('low')
  if (speed != null && speed <= 8) level = 'standstill'
  else if (minutes >= 25) level = 'standstill'
  else if (minutes >= 12) level = 'high'
  else if (minutes >= 5) level = 'medium'
  else if (minutes > 3) level = 'medium'
  return {
    level,
    tier: tierFromLevel(level),
    baselineMinutes: null,
    baselineSpeedMph: null,
    timeRatio: null,
    speedRatio: null,
  }
}

/**
 * @param {BridgeTrafficLevel} level
 * @returns {BridgeDelayTier}
 */
export function tierFromLevel(level) {
  if (level === 'low') return 'green'
  if (level === 'medium') return 'orange'
  return 'red'
}

/**
 * @param {BridgeTrafficLevel} level
 */
export function trafficLevelLabel(level) {
  if (level === 'standstill') return 'standstill / gridlock'
  if (level === 'high') return 'heavy traffic'
  if (level === 'medium') return 'moderate traffic'
  return 'light traffic'
}

/**
 * @param {unknown} row PANYNJ live row or synthetic Verrazzano row
 * @param {{ series?: Array<{ m?: number, s?: number }> }} [opts]
 * @returns {BridgeDelayTier}
 */
export function bridgeDelayTierForRow(row, opts = {}) {
  if (row == null || typeof row !== 'object') return 'orange'
  const o = /** @type {Record<string, unknown>} */ (row)
  const { tier } = classifyBridgeTraffic({
    routeId: o.routeId,
    travelDirection: o.travelDirection,
    routeTravelTime: o.routeTravelTime,
    routeSpeed: o.routeSpeed,
    routeTravelTimeHist: o.routeTravelTimeHist,
    routeSpeedHist: o.routeSpeedHist,
    series: opts.series,
  })
  return tier
}

/**
 * @param {number} minutes
 * @param {BridgeTrafficInput} [ctx]
 * @returns {BridgeDelayTier}
 */
export function bridgeDelayTier(minutes, ctx) {
  if (ctx && typeof ctx === 'object') {
    return classifyBridgeTraffic({ ...ctx, routeTravelTime: minutes }).tier
  }
  const m = Number(minutes)
  if (!Number.isFinite(m)) return 'orange'
  return classifyWithGlobalFallback(m, null).tier
}
