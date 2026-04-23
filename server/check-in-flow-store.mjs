import {
  CHECKIN_XPATH,
  CHECKIN_XPATH_KEYS,
} from './playwright/checkInXpathDefaults.mjs'
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

function checkinKey() {
  return userScopeKey('checkin:flow')
}

/** @typedef {{ instructions: string, xpaths: Partial<Record<string, string>> }} CheckInFlowDoc */

function defaultDoc() {
  return { instructions: '', xpaths: {} }
}

/**
 * @param {unknown} raw
 */
function validateCheckInFlowBody(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  const instructions =
    typeof raw.instructions === 'string' ? raw.instructions : ''
  const xpaths = raw.xpaths
  if (xpaths !== undefined && (typeof xpaths !== 'object' || xpaths === null)) {
    return { ok: false, error: 'xpaths must be an object' }
  }
  const xp = /** @type {Record<string, unknown>} */ (xpaths || {})
  const allowed = new Set(CHECKIN_XPATH_KEYS)
  for (const k of Object.keys(xp)) {
    if (!allowed.has(k)) {
      return { ok: false, error: `Unknown xpath key: ${k}` }
    }
    const v = xp[k]
    if (typeof v !== 'string' || !v.trim()) {
      return { ok: false, error: `xpaths.${k} must be a non-empty string` }
    }
  }
  return {
    ok: true,
    data: {
      instructions,
      xpaths: /** @type {Partial<Record<string, string>>} */ ({ ...xp }),
    },
  }
}

/**
 * Merged xpaths for Playwright (defaults + file overrides).
 */
export function mergeCheckInXpaths(overrides = {}) {
  return { ...CHECKIN_XPATH, ...overrides }
}

export async function readCheckInFlow() {
  const parsed = await readKeyJson(checkinKey(), () => defaultDoc())
  const v = validateCheckInFlowBody(parsed)
  if (!v.ok) return defaultDoc()
  return v.data
}

/**
 * For GET API: instructions, full merged xpaths for editor, and defaults reference.
 */
export async function getCheckInFlowPayload() {
  const doc = await readCheckInFlow()
  return {
    instructions: doc.instructions,
    xpaths: mergeCheckInXpaths(doc.xpaths),
    defaults: { ...CHECKIN_XPATH },
    xpathsOverrides: { ...doc.xpaths },
  }
}

/**
 * Save instructions + xpath overrides (partial). Pass empty xpaths to reset overrides.
 * @param {unknown} body
 */
export async function writeCheckInFlow(body) {
  const v = validateCheckInFlowBody(
    body && typeof body === 'object'
      ? body
      : { instructions: '', xpaths: {} },
  )
  if (!v.ok) {
    throw new Error(v.error)
  }
  await writeKeyJson(checkinKey(), v.data)
  return v.data
}

/**
 * PUT body may send full merged xpaths; we persist only keys that differ from defaults.
 * @param {{ instructions?: string, xpaths?: Record<string, string> }} body
 */
export async function writeCheckInFlowFromMerged(body) {
  const instructions =
    typeof body.instructions === 'string' ? body.instructions : ''
  const merged = body.xpaths
  if (!merged || typeof merged !== 'object') {
    throw new Error('xpaths must be an object with all check-in locator keys')
  }
  const allowed = new Set(CHECKIN_XPATH_KEYS)
  for (const k of CHECKIN_XPATH_KEYS) {
    const v = merged[k]
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error(`Missing or empty xpath for: ${k}`)
    }
  }
  for (const k of Object.keys(merged)) {
    if (!allowed.has(k)) {
      throw new Error(`Unknown xpath key: ${k}`)
    }
  }
  /** @type {Partial<Record<string, string>>} */
  const overrides = {}
  for (const k of CHECKIN_XPATH_KEYS) {
    if (merged[k] !== CHECKIN_XPATH[k]) {
      overrides[k] = merged[k]
    }
  }
  return writeCheckInFlow({ instructions, xpaths: overrides })
}
