/**
 * Per-bridge / per-direction traffic severity from crossing time + observed speed.
 * Uses calibrated profiles (from stored history); optional live series refines unknown routes.
 */

import {
  normalizeTravelDir,
  resolveTrafficProfileKey,
  trafficProfileForKey,
} from './bridgeTrafficProfiles.js'

/** @typedef {'low' | 'medium' | 'high' | 'standstill'} BridgeTrafficLevel */
/** @typedef {'green' | 'orange' | 'red'} BridgeDelayTier */
/** @typedef {import('./bridgeTrafficProfiles.js').BridgeTrafficProfile} BridgeTrafficProfile */

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
 * @param {number} [minPoints=24]
 */
export function medianFromSeries(series, minPoints = 24) {
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
 * Build a profile from live series percentiles when no static profile exists.
 * @param {Array<{ m?: number, s?: number }>} series
 * @returns {BridgeTrafficProfile | null}
 */
function profileFromSeries(series) {
  const med = medianFromSeries(series, 24)
  if (!med) return null
  const minutes = series
    .map((p) => p.m)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const speeds = series
    .map((p) => p.s)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const pct = (arr, p) => {
    if (!arr.length) return med.baselineMinutes
    const i = (arr.length - 1) * p
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    if (lo === hi) return arr[lo]
    return arr[lo] + (arr[hi] - arr[lo]) * (i - lo)
  }
  const p75t = pct(minutes, 0.75)
  const p90t = pct(minutes, 0.9)
  const p95t = pct(minutes, 0.95)
  const p25s = pct(speeds, 0.25)
  const p10s = pct(speeds, 0.1)
  const p50t = med.baselineMinutes
  const p50s = med.baselineSpeedMph ?? p25s

  return {
    lowMaxMinutes: Math.round(p75t * 10) / 10,
    lowMinSpeedMph: Math.max(8, Math.round(p25s * 0.85)),
    mediumMaxMinutes: Math.round(p90t * 1.05 * 10) / 10,
    mediumMinSpeedMph: Math.max(8, Math.round(p10s * 0.95)),
    mediumMinMinutesIfSlow: Math.round(p75t * 0.9 * 10) / 10,
    highMaxMinutes: Math.round(Math.max(p95t * 1.15, p90t * 1.2) * 10) / 10,
    highMinMinutesIfSlow: Math.round(p90t * 10) / 10,
    highMaxSpeedIfSlow: Math.max(8, Math.round(p25s * 0.65)),
    standstillMinMinutes: Math.round(Math.max(p95t * 1.2, p50t * 2.2) * 10) / 10,
    standstillMinMinutesIfSlow: Math.round(p90t * 10) / 10,
    standstillMaxSpeedIfSlow: Math.max(8, Math.round(p25s * 0.55)),
    standstillMaxSpeedMph: Math.max(6, Math.round(p10s * 0.75)),
    standstillSpeedRequiresMinMinutes: Math.round(p75t * 10) / 10,
  }
}

/**
 * @typedef {{
 *   routeId?: string | number,
 *   travelDirection?: string,
 *   facilityModifier?: string,
 *   deck?: string,
 *   routeTravelTime?: number | string | null,
 *   routeSpeed?: number | string | null,
 *   series?: Array<{ m?: number, s?: number }>,
 * }} BridgeTrafficInput
 */

/**
 * @param {number} minutes
 * @param {number | null} speed
 * @param {BridgeTrafficProfile} profile
 * @returns {BridgeTrafficLevel}
 */
export function levelFromProfile(minutes, speed, profile) {
  const sp = speed
  const crawlMin = profile.standstillSpeedRequiresMinMinutes ?? 0

  if (sp != null && sp <= profile.standstillMaxSpeedMph && minutes >= crawlMin) {
    return 'standstill'
  }
  if (
    sp != null &&
    minutes >= profile.standstillMinMinutesIfSlow &&
    sp <= profile.standstillMaxSpeedIfSlow
  ) {
    return 'standstill'
  }
  if (minutes >= profile.standstillMinMinutes) {
    return 'standstill'
  }

  if (
    sp != null &&
    minutes >= profile.highMinMinutesIfSlow &&
    sp <= profile.highMaxSpeedIfSlow
  ) {
    return 'high'
  }
  if (minutes > profile.highMaxMinutes) {
    return 'high'
  }

  const medSlowAt = profile.mediumMinMinutesIfSlow ?? 0
  if (sp != null && minutes >= medSlowAt && sp < profile.mediumMinSpeedMph) {
    return 'medium'
  }
  if (minutes > profile.mediumMaxMinutes) {
    return 'medium'
  }

  if (sp != null) {
    if (minutes <= profile.lowMaxMinutes && sp >= profile.lowMinSpeedMph) {
      return 'low'
    }
    if (minutes <= profile.lowMaxMinutes) {
      return 'medium'
    }
    return minutes <= profile.highMaxMinutes ? 'medium' : 'high'
  }

  if (minutes <= profile.lowMaxMinutes) return 'low'
  if (minutes <= profile.mediumMaxMinutes) return 'medium'
  return 'high'
}

/**
 * @param {BridgeTrafficInput} input
 */
function resolveProfile(input) {
  const key = resolveTrafficProfileKey(input)
  const staticProfile = trafficProfileForKey(key)
  if (staticProfile) return { profile: staticProfile, profileKey: key, source: 'calibrated' }
  if (input.series?.length) {
    const fromSeries = profileFromSeries(input.series)
    if (fromSeries) return { profile: fromSeries, profileKey: key, source: 'series' }
  }
  return { profile: null, profileKey: key, source: 'none' }
}

/**
 * @param {BridgeTrafficInput} input
 */
export function classifyBridgeTraffic(input) {
  const minutes = finitePositive(input?.routeTravelTime)
  if (minutes == null) {
    return {
      level: /** @type {const} */ ('medium'),
      tier: /** @type {const} */ ('orange'),
      profileKey: null,
      baselineMinutes: null,
      baselineSpeedMph: null,
    }
  }

  const speed = finitePositive(input?.routeSpeed)
  const { profile, profileKey, source } = resolveProfile(input)

  if (!profile) {
    const fb = classifyWithGlobalFallback(minutes, speed)
    return { ...fb, profileKey }
  }

  const level = levelFromProfile(minutes, speed, profile)

  return {
    level,
    tier: tierFromLevel(level),
    profileKey,
    profileSource: source,
    baselineMinutes: profile.lowMaxMinutes,
    baselineSpeedMph: profile.lowMinSpeedMph,
  }
}

/**
 * @param {number} minutes
 * @param {number | null} speed
 */
function classifyWithGlobalFallback(minutes, speed) {
  let level = /** @type {BridgeTrafficLevel} */ ('low')
  if (speed != null && speed <= 8 && minutes >= 10) level = 'standstill'
  else if (minutes >= 25) level = 'standstill'
  else if (minutes >= 12) level = 'high'
  else if (minutes >= 5) level = 'medium'
  else if (minutes > 3) level = 'medium'
  return {
    level,
    tier: tierFromLevel(level),
    baselineMinutes: null,
    baselineSpeedMph: null,
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
 * @param {unknown} row
 * @param {{ series?: Array<{ m?: number, s?: number }> }} [opts]
 * @returns {BridgeDelayTier}
 */
export function bridgeDelayTierForRow(row, opts = {}) {
  if (row == null || typeof row !== 'object') return 'orange'
  const o = /** @type {Record<string, unknown>} */ (row)
  const { tier } = classifyBridgeTraffic({
    routeId: o.routeId,
    travelDirection: o.travelDirection,
    facilityModifier: o.facilityModifier,
    routeTravelTime: o.routeTravelTime,
    routeSpeed: o.routeSpeed,
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

export { normalizeTravelDir, resolveTrafficProfileKey, trafficProfileForKey }
