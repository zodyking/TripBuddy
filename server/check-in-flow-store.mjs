import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CHECKIN_XPATH,
  CHECKIN_XPATH_KEYS,
} from './playwright/checkInXpathDefaults.mjs'
import { LOCAL_DIR } from './config.mjs'

const CHECK_IN_FLOW_FILE = path.join(LOCAL_DIR, 'check-in-flow.json')

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
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  try {
    const raw = await fs.readFile(CHECK_IN_FLOW_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    const v = validateCheckInFlowBody(parsed)
    if (!v.ok) return defaultDoc()
    return v.data
  } catch {
    return defaultDoc()
  }
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
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  await fs.writeFile(
    CHECK_IN_FLOW_FILE,
    `${JSON.stringify(v.data, null, 2)}\n`,
    'utf8',
  )
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
