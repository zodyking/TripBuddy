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
    standstillMinMinutesIfSlow: Math.round(p90t * 1.1 * 10) / 10,
    standstillMaxSpeedIfSlow: STANDSTILL_CRAWL_MAX_SPEED_MPH,
    standstillMaxSpeedMph: STANDSTILL_CRAWL_MAX_SPEED_MPH,
    standstillSpeedRequiresMinMinutes: Math.round(p90t * 10) / 10,
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

/** Crossing time (min) at or above → standstill regardless of other rules. */
export const STANDSTILL_ABSOLUTE_MINUTES = 30

/** Max speed (mph) for crawl-based standstill when time is below 30 min. */
export const STANDSTILL_CRAWL_MAX_SPEED_MPH = 10

/**
 * @param {number} minutes
 * @param {number | null} speed
 * @param {BridgeTrafficProfile} profile
 * @returns {boolean}
 */
export function isStandstillTraffic(minutes, speed, profile) {
  if (minutes >= STANDSTILL_ABSOLUTE_MINUTES) {
    return true
  }

  if (speed == null || !Number.isFinite(speed)) {
    return false
  }

  const sp = speed
  const p = profile

  return (
    (sp <= 5 && minutes >= p.highMinMinutesIfSlow) ||
    (sp <= 8 && minutes >= p.mediumMaxMinutes) ||
    (sp <= STANDSTILL_CRAWL_MAX_SPEED_MPH &&
      minutes >= p.standstillMinMinutesIfSlow) ||
    (sp <= STANDSTILL_CRAWL_MAX_SPEED_MPH &&
      minutes >= p.lowMaxMinutes * 2) ||
    (sp <= 12 &&
      minutes >= p.highMaxMinutes &&
      minutes < STANDSTILL_ABSOLUTE_MINUTES)
  )
}

/**
 * @param {number} minutes
 * @param {number | null} speed
 * @param {BridgeTrafficProfile} profile
 * @returns {boolean}
 */
export function isHighTraffic(minutes, speed, profile) {
  const p = profile
  const sp = speed

  return (
    minutes > p.highMaxMinutes ||
    (sp != null &&
      minutes >= p.highMinMinutesIfSlow &&
      sp <= p.highMaxSpeedIfSlow) ||
    (sp != null && minutes >= p.mediumMaxMinutes && sp < p.mediumMinSpeedMph) ||
    (sp != null &&
      minutes >= p.lowMaxMinutes * 1.5 &&
      sp < p.lowMinSpeedMph) ||
    (minutes >= p.highMinMinutesIfSlow &&
      sp != null &&
      sp <= Math.min(p.highMaxSpeedIfSlow, 15)) ||
    (minutes >= p.mediumMaxMinutes * 1.15 &&
      sp != null &&
      sp < p.mediumMinSpeedMph * 0.85)
  )
}

/**
 * @param {number} minutes
 * @param {number | null} speed
 * @param {BridgeTrafficProfile} profile
 * @returns {boolean}
 */
export function isMediumTraffic(minutes, speed, profile) {
  const p = profile
  const sp = speed

  return (
    minutes > p.mediumMaxMinutes ||
    (sp != null &&
      minutes >= (p.mediumMinMinutesIfSlow ?? p.lowMaxMinutes) &&
      sp < p.mediumMinSpeedMph) ||
    (sp != null && minutes > p.lowMaxMinutes && sp < p.lowMinSpeedMph) ||
    (sp != null &&
      minutes >= p.lowMaxMinutes &&
      minutes <= p.highMaxMinutes &&
      sp >= p.lowMinSpeedMph * 0.7 &&
      sp < p.lowMinSpeedMph) ||
    (minutes > p.lowMaxMinutes && minutes <= p.highMaxMinutes && sp == null)
  )
}

/**
 * @param {number} minutes
 * @param {number | null} speed
 * @param {BridgeTrafficProfile} profile
 * @returns {boolean}
 */
export function isLowTraffic(minutes, speed, profile) {
  const p = profile
  const sp = speed

  if (minutes > p.lowMaxMinutes) {
    return false
  }
  if (sp == null) {
    return true
  }
  return sp >= p.lowMinSpeedMph
}

/**
 * @param {number} minutes
 * @param {number | null} speed
 * @param {BridgeTrafficProfile} profile
 * @returns {BridgeTrafficLevel}
 */
export function levelFromProfile(minutes, speed, profile) {
  const sp = speed

  if (isStandstillTraffic(minutes, sp, profile)) {
    return 'standstill'
  }
  if (isHighTraffic(minutes, sp, profile)) {
    return 'high'
  }
  if (isMediumTraffic(minutes, sp, profile)) {
    return 'medium'
  }
  if (isLowTraffic(minutes, sp, profile)) {
    return 'low'
  }
  return 'medium'
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
  if (minutes >= STANDSTILL_ABSOLUTE_MINUTES) {
    level = 'standstill'
  } else if (
    speed != null &&
    speed <= STANDSTILL_CRAWL_MAX_SPEED_MPH &&
    minutes >= 15
  ) {
    level = 'standstill'
  } else if (minutes >= 20 || (speed != null && speed <= 12 && minutes >= 12)) {
    level = 'high'
  } else if (minutes >= 5 || (speed != null && speed < 25 && minutes >= 4)) {
    level = 'medium'
  } else if (minutes > 3) {
    level = 'medium'
  }
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
