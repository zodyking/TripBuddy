import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'
import {
  BRIDGE_TRAFFIC_PROFILES,
  mergeBridgeTrafficProfile,
} from '../src/utils/bridgeTrafficProfiles.js'

/**
 * @param {string} accountKey
 */
function kvKey(accountKey) {
  return userScopeKey('traffic:bridge-profiles', accountKey)
}

/**
 * @param {unknown} raw
 * @returns {Record<string, import('../src/utils/bridgeTrafficProfiles.js').BridgeTrafficProfile>}
 */
function sanitizeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  /** @type {Record<string, import('../src/utils/bridgeTrafficProfiles.js').BridgeTrafficProfile>} */
  const out = {}
  for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) {
    const base = BRIDGE_TRAFFIC_PROFILES[key]
    if (!base || !val || typeof val !== 'object' || Array.isArray(val)) continue
    out[key] = mergeBridgeTrafficProfile(base, /** @type {Partial<typeof base>} */ (val))
  }
  return out
}

/**
 * @param {string} accountKey
 */
export async function readBridgeTrafficProfileOverrides(accountKey) {
  if (!accountKey) return { overrides: {}, updatedAt: null }
  const doc = await readKeyJson(kvKey(accountKey), () => ({ overrides: {} }))
  const overrides = sanitizeOverrides(doc?.overrides)
  const updatedAt =
    typeof doc?.updatedAt === 'number' && Number.isFinite(doc.updatedAt) ? doc.updatedAt : null
  return { overrides, updatedAt }
}

/**
 * @param {string} accountKey
 * @param {Record<string, unknown>} rawOverrides
 */
export async function writeBridgeTrafficProfileOverrides(accountKey, rawOverrides) {
  if (!accountKey) throw new Error('Not signed in')
  const overrides = sanitizeOverrides(rawOverrides)
  const doc = { overrides, updatedAt: Date.now() }
  await writeKeyJson(kvKey(accountKey), doc)
  return doc
}
