/**
 * Per-bridge / per-direction traffic thresholds.
 * Calibrated from Postgres history export (May 2026, ~500 samples per PANYNJ route).
 *
 * Classification order: standstill → high → medium → low.
 * Standstill is only assigned in code when speed ≤ 10 mph (see bridgeTrafficCondition.js).
 */

/** @typedef {'to_ny' | 'to_nj'} DirectionSlug */

/**
 * @typedef {object} BridgeTrafficProfile
 * @property {number} lowMaxMinutes — at or below with adequate speed → low
 * @property {number} lowMinSpeedMph — speed at or above → low (when time OK)
 * @property {number} mediumMaxMinutes — above low time cap, up to here → medium
 * @property {number} mediumMinSpeedMph — below this with time ≥ mediumMinMinutesIfSlow → medium
 * @property {number} [mediumMinMinutesIfSlow] — default 0
 * @property {number} highMaxMinutes — above medium cap, up to here → high
 * @property {number} highMinMinutesIfSlow — at or above with speed ≤ highMaxSpeedIfSlow → high
 * @property {number} highMaxSpeedIfSlow
 * @property {number} standstillMinMinutes — crossing time alone → standstill
 * @property {number} standstillMinMinutesIfSlow — with speed ≤ standstillMaxSpeedIfSlow
 * @property {number} standstillMaxSpeedIfSlow
 * @property {number} standstillMaxSpeedMph — at or below only if time ≥ standstillSpeedRequiresMinMinutes
 * @property {number} [standstillSpeedRequiresMinMinutes] — avoid flagging normal slow crawl
 */

/** @type {Readonly<Record<string, BridgeTrafficProfile>>} */
export const BRIDGE_TRAFFIC_PROFILES = Object.freeze({
  bayonne_bridge__to_nj: {
    lowMaxMinutes: 2,
    lowMinSpeedMph: 40,
    mediumMaxMinutes: 3,
    mediumMinSpeedMph: 32,
    mediumMinMinutesIfSlow: 2,
    highMaxMinutes: 5,
    highMinMinutesIfSlow: 4,
    highMaxSpeedIfSlow: 28,
    standstillMinMinutes: 8,
    standstillMinMinutesIfSlow: 4,
    standstillMaxSpeedIfSlow: 22,
    standstillMaxSpeedMph: 15,
    standstillSpeedRequiresMinMinutes: 3,
  },
  bayonne_bridge__to_ny: {
    lowMaxMinutes: 2,
    lowMinSpeedMph: 38,
    mediumMaxMinutes: 3,
    mediumMinSpeedMph: 30,
    mediumMinMinutesIfSlow: 2,
    highMaxMinutes: 5,
    highMinMinutesIfSlow: 4,
    highMaxSpeedIfSlow: 28,
    standstillMinMinutes: 8,
    standstillMinMinutesIfSlow: 4,
    standstillMaxSpeedIfSlow: 22,
    standstillMaxSpeedMph: 15,
    standstillSpeedRequiresMinMinutes: 3,
  },
  goethals_bridge__to_nj: {
    lowMaxMinutes: 2,
    lowMinSpeedMph: 42,
    mediumMaxMinutes: 3,
    mediumMinSpeedMph: 35,
    mediumMinMinutesIfSlow: 2,
    highMaxMinutes: 6,
    highMinMinutesIfSlow: 4,
    highMaxSpeedIfSlow: 30,
    standstillMinMinutes: 9,
    standstillMinMinutesIfSlow: 5,
    standstillMaxSpeedIfSlow: 18,
    standstillMaxSpeedMph: 12,
    standstillSpeedRequiresMinMinutes: 4,
  },
  goethals_bridge__to_ny: {
    lowMaxMinutes: 3,
    lowMinSpeedMph: 36,
    mediumMaxMinutes: 5,
    mediumMinSpeedMph: 28,
    mediumMinMinutesIfSlow: 3,
    highMaxMinutes: 9,
    highMinMinutesIfSlow: 6,
    highMaxSpeedIfSlow: 22,
    standstillMinMinutes: 11,
    standstillMinMinutesIfSlow: 7,
    standstillMaxSpeedIfSlow: 16,
    standstillMaxSpeedMph: 10,
    standstillSpeedRequiresMinMinutes: 5,
  },
  outerbridge_crossing__to_nj: {
    lowMaxMinutes: 5,
    lowMinSpeedMph: 42,
    mediumMaxMinutes: 7,
    mediumMinSpeedMph: 36,
    mediumMinMinutesIfSlow: 5,
    highMaxMinutes: 11,
    highMinMinutesIfSlow: 8,
    highMaxSpeedIfSlow: 28,
    standstillMinMinutes: 15,
    standstillMinMinutesIfSlow: 9,
    standstillMaxSpeedIfSlow: 20,
    standstillMaxSpeedMph: 12,
    standstillSpeedRequiresMinMinutes: 6,
  },
  outerbridge_crossing__to_ny: {
    lowMaxMinutes: 7,
    lowMinSpeedMph: 44,
    mediumMaxMinutes: 9,
    mediumMinSpeedMph: 38,
    mediumMinMinutesIfSlow: 7,
    highMaxMinutes: 13,
    highMinMinutesIfSlow: 10,
    highMaxSpeedIfSlow: 30,
    standstillMinMinutes: 16,
    standstillMinMinutesIfSlow: 11,
    standstillMaxSpeedIfSlow: 22,
    standstillMaxSpeedMph: 14,
    standstillSpeedRequiresMinMinutes: 8,
  },
  george_washington_bridge__upper__to_nj: {
    lowMaxMinutes: 18,
    lowMinSpeedMph: 18,
    mediumMaxMinutes: 24,
    mediumMinSpeedMph: 15,
    mediumMinMinutesIfSlow: 16,
    highMaxMinutes: 36,
    highMinMinutesIfSlow: 26,
    highMaxSpeedIfSlow: 14,
    standstillMinMinutes: 42,
    standstillMinMinutesIfSlow: 30,
    standstillMaxSpeedIfSlow: 12,
    standstillMaxSpeedMph: 8,
    standstillSpeedRequiresMinMinutes: 22,
  },
  george_washington_bridge__upper__to_ny: {
    lowMaxMinutes: 28,
    lowMinSpeedMph: 11,
    mediumMaxMinutes: 38,
    mediumMinSpeedMph: 9,
    mediumMinMinutesIfSlow: 20,
    highMaxMinutes: 52,
    highMinMinutesIfSlow: 32,
    highMaxSpeedIfSlow: 10,
    standstillMinMinutes: 58,
    standstillMinMinutesIfSlow: 44,
    standstillMaxSpeedIfSlow: 9,
    standstillMaxSpeedMph: 6,
    standstillSpeedRequiresMinMinutes: 36,
  },
  george_washington_bridge__lower__to_nj: {
    lowMaxMinutes: 16,
    lowMinSpeedMph: 16,
    mediumMaxMinutes: 21,
    mediumMinSpeedMph: 12,
    mediumMinMinutesIfSlow: 14,
    highMaxMinutes: 30,
    highMinMinutesIfSlow: 22,
    highMaxSpeedIfSlow: 12,
    standstillMinMinutes: 34,
    standstillMinMinutesIfSlow: 24,
    standstillMaxSpeedIfSlow: 10,
    standstillMaxSpeedMph: 8,
    standstillSpeedRequiresMinMinutes: 18,
  },
  george_washington_bridge__lower__to_ny: {
    lowMaxMinutes: 20,
    lowMinSpeedMph: 14,
    mediumMaxMinutes: 24,
    mediumMinSpeedMph: 12,
    mediumMinMinutesIfSlow: 16,
    highMaxMinutes: 30,
    highMinMinutesIfSlow: 22,
    highMaxSpeedIfSlow: 12,
    standstillMinMinutes: 32,
    standstillMinMinutesIfSlow: 24,
    standstillMaxSpeedIfSlow: 11,
    standstillMaxSpeedMph: 8,
    standstillSpeedRequiresMinMinutes: 20,
  },
  verrazzano_narrows_bridge__to_nj: {
    lowMaxMinutes: 11.5,
    lowMinSpeedMph: 36,
    mediumMaxMinutes: 13.5,
    mediumMinSpeedMph: 32,
    mediumMinMinutesIfSlow: 11,
    highMaxMinutes: 16,
    highMinMinutesIfSlow: 13,
    highMaxSpeedIfSlow: 28,
    standstillMinMinutes: 18,
    standstillMinMinutesIfSlow: 14,
    standstillMaxSpeedIfSlow: 10,
    standstillMaxSpeedMph: 10,
    standstillSpeedRequiresMinMinutes: 12,
  },
  verrazzano_narrows_bridge__to_ny: {
    lowMaxMinutes: 30,
    lowMinSpeedMph: 30,
    mediumMaxMinutes: 34,
    mediumMinSpeedMph: 28,
    mediumMinMinutesIfSlow: 26,
    highMaxMinutes: 38,
    highMinMinutesIfSlow: 32,
    highMaxSpeedIfSlow: 26,
    standstillMinMinutes: 40,
    standstillMinMinutesIfSlow: 35,
    standstillMaxSpeedIfSlow: 10,
    standstillMaxSpeedMph: 10,
    standstillSpeedRequiresMinMinutes: 28,
  },
  holland_tunnel__to_nj: {
    lowMaxMinutes: 10,
    lowMinSpeedMph: 22,
    mediumMaxMinutes: 14,
    mediumMinSpeedMph: 18,
    mediumMinMinutesIfSlow: 9,
    highMaxMinutes: 19,
    highMinMinutesIfSlow: 14,
    highMaxSpeedIfSlow: 14,
    standstillMinMinutes: 22,
    standstillMinMinutesIfSlow: 16,
    standstillMaxSpeedIfSlow: 12,
    standstillMaxSpeedMph: 9,
    standstillSpeedRequiresMinMinutes: 12,
  },
  holland_tunnel__to_ny: {
    lowMaxMinutes: 14,
    lowMinSpeedMph: 16,
    mediumMaxMinutes: 20,
    mediumMinSpeedMph: 13,
    mediumMinMinutesIfSlow: 12,
    highMaxMinutes: 26,
    highMinMinutesIfSlow: 18,
    highMaxSpeedIfSlow: 11,
    standstillMinMinutes: 28,
    standstillMinMinutesIfSlow: 21,
    standstillMaxSpeedIfSlow: 10,
    standstillMaxSpeedMph: 8,
    standstillSpeedRequiresMinMinutes: 16,
  },
  lincoln_tunnel__to_nj: {
    lowMaxMinutes: 9,
    lowMinSpeedMph: 26,
    mediumMaxMinutes: 13,
    mediumMinSpeedMph: 20,
    mediumMinMinutesIfSlow: 8,
    highMaxMinutes: 18,
    highMinMinutesIfSlow: 13,
    highMaxSpeedIfSlow: 16,
    standstillMinMinutes: 22,
    standstillMinMinutesIfSlow: 15,
    standstillMaxSpeedIfSlow: 13,
    standstillMaxSpeedMph: 10,
    standstillSpeedRequiresMinMinutes: 11,
  },
  lincoln_tunnel__to_ny: {
    lowMaxMinutes: 22,
    lowMinSpeedMph: 12,
    mediumMaxMinutes: 36,
    mediumMinSpeedMph: 9,
    mediumMinMinutesIfSlow: 14,
    highMaxMinutes: 52,
    highMinMinutesIfSlow: 28,
    highMaxSpeedIfSlow: 10,
    standstillMinMinutes: 58,
    standstillMinMinutesIfSlow: 42,
    standstillMaxSpeedIfSlow: 9,
    standstillMaxSpeedMph: 6,
    standstillSpeedRequiresMinMinutes: 34,
  },
})

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
 * @param {unknown} v
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
export function normalizeTravelDir(v) {
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

/** @type {Readonly<Record<string, { bridge: string, travelDirection: 'ToNY' | 'ToNJ', deck?: string }>>} */
const ROUTE_META = Object.freeze({
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
 * @param {{ bridge: string, travelDirection: 'ToNY' | 'ToNJ', deck?: string }} meta
 */
export function profileKeyFromMeta(meta) {
  const parts = [slugPart(meta.bridge)]
  if (meta.deck) parts.push(slugPart(meta.deck))
  parts.push(meta.travelDirection === 'ToNJ' ? 'to_nj' : 'to_ny')
  return parts.join('__')
}

/**
 * @param {{ routeId?: string | number, travelDirection?: string, facilityModifier?: string, deck?: string }} input
 * @returns {string | null}
 */
export function resolveTrafficProfileKey(input) {
  const routeId = String(input?.routeId ?? '').trim()
  if (!routeId) return null
  if (routeId === 'verrazzano') {
    const dir = normalizeTravelDir(input?.travelDirection)
    return dir === 'ToNJ'
      ? 'verrazzano_narrows_bridge__to_nj'
      : 'verrazzano_narrows_bridge__to_ny'
  }
  const meta = ROUTE_META[routeId]
  if (!meta) return null
  let deck = input?.deck ? String(input.deck).trim() : ''
  if (!deck && input?.facilityModifier) {
    const mod = String(input.facilityModifier).trim()
    if (/^upper$/i.test(mod)) deck = 'Upper'
    if (/^lower$/i.test(mod)) deck = 'Lower'
  }
  return profileKeyFromMeta({
    bridge: meta.bridge,
    travelDirection: meta.travelDirection,
    deck: deck || meta.deck,
  })
}

/** @type {Readonly<Record<string, BridgeTrafficProfile>>} */
let profileOverrides = Object.freeze({})

/**
 * Replace user overrides (partial profiles per key). Called after loading from server.
 * @param {Record<string, Partial<BridgeTrafficProfile>> | null | undefined} overrides
 */
export function setBridgeTrafficProfileOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') {
    profileOverrides = Object.freeze({})
    return
  }
  /** @type {Record<string, BridgeTrafficProfile>} */
  const next = {}
  for (const [k, v] of Object.entries(overrides)) {
    if (!v || typeof v !== 'object') continue
    const base = BRIDGE_TRAFFIC_PROFILES[k]
    if (!base) continue
    next[k] = mergeBridgeTrafficProfile(base, v)
  }
  profileOverrides = Object.freeze(next)
}

/** @returns {Readonly<Record<string, BridgeTrafficProfile>>} */
export function getBridgeTrafficProfileOverrides() {
  return profileOverrides
}

/**
 * @param {BridgeTrafficProfile} base
 * @param {Partial<BridgeTrafficProfile>} patch
 * @returns {BridgeTrafficProfile}
 */
export function mergeBridgeTrafficProfile(base, patch) {
  return { ...base, ...patch }
}

/**
 * @param {string | null} key
 * @returns {BridgeTrafficProfile | null}
 */
export function trafficProfileForKey(key) {
  if (!key) return null
  const base = BRIDGE_TRAFFIC_PROFILES[key]
  const ov = profileOverrides[key]
  if (ov) return ov
  return base ?? null
}

/** UI-editable fields (advanced fields keep calibrated defaults). */
export const BRIDGE_THRESHOLD_FIELD_DEFS = Object.freeze([
  {
    key: 'lowMaxMinutes',
    label: 'Green max',
    unit: 'min',
    tier: 'green',
    hint: 'Crossing time at or below → light traffic',
  },
  {
    key: 'lowMinSpeedMph',
    label: 'Green min speed',
    unit: 'mph',
    tier: 'green',
    hint: 'Speed at or above → light traffic',
  },
  {
    key: 'mediumMaxMinutes',
    label: 'Orange max',
    unit: 'min',
    tier: 'orange',
    hint: 'Above green, up to here → moderate',
  },
  {
    key: 'highMaxMinutes',
    label: 'Red max',
    unit: 'min',
    tier: 'red',
    hint: 'Above orange, up to here → heavy',
  },
  {
    key: 'standstillMinMinutes',
    label: 'Standstill',
    unit: 'min',
    tier: 'standstill',
    hint: 'Crossing time alone → gridlock tier',
  },
])

/**
 * @param {string} profileKey
 */
function labelFromProfileKey(profileKey) {
  const parts = profileKey.split('__').filter(Boolean)
  const dirPart = parts[parts.length - 1]
  const dir =
    dirPart === 'to_ny' ? 'To NY' : dirPart === 'to_nj' ? 'To NJ' : dirPart.replace(/_/g, ' ')
  const body = parts.slice(0, -1)
  const deckIdx = body.findIndex((p) => p === 'upper' || p === 'lower')
  let deck = ''
  if (deckIdx >= 0) {
    deck = body[deckIdx] === 'upper' ? 'Upper' : 'Lower'
    body.splice(deckIdx, 1)
  }
  const bridge = body
    .join(' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/George Washington Bridge/i, 'GWB')
  return { bridge, deck, direction: dir }
}

/** @type {ReadonlyArray<{ key: string, bridge: string, deck: string, direction: string, directionSlug: 'ToNY' | 'ToNJ' }>} */
export const BRIDGE_PROFILE_CATALOG = Object.freeze(
  Object.keys(BRIDGE_TRAFFIC_PROFILES).map((key) => {
    const { bridge, deck, direction } = labelFromProfileKey(key)
    return {
      key,
      bridge,
      deck,
      direction,
      directionSlug: key.endsWith('__to_nj') ? /** @type {const} */ ('ToNJ') : /** @type {const} */ ('ToNY'),
    }
  }),
)
