import { MENU } from './playwright/selectors.mjs'
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

function flowKey() {
  return userScopeKey('flow:scripts')
}

/** @typedef {{ useCustom: boolean, notes: string, steps: object[] }} ScenarioFlowConfig */

export const FLOW_SCENARIO_IDS = [
  'navigate_home',
  'check_in',
  'begin_new_check_in',
  'arrive',
  'view_trip',
  'inspect_checkout',
]

const ALLOWED_BUILTIN = new Set(FLOW_SCENARIO_IDS)

const ALLOWED_OPS = new Set([
  'goto',
  'waitMs',
  'waitLoadState',
  'clickMenu',
  'fill',
  'click',
  'pressKey',
  'builtin',
])

const MENU_KEYS = new Set(Object.keys(MENU))

function defaultScenarios() {
  /** @type {Record<string, ScenarioFlowConfig>} */
  const scenarios = {}
  for (const id of FLOW_SCENARIO_IDS) {
    scenarios[id] = { useCustom: false, notes: '', steps: [] }
  }
  return { version: 1, scenarios }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function validateFlowScriptsPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  const version = raw.version
  if (version !== 1 && version !== undefined) {
    return { ok: false, error: 'Unsupported version (expected 1)' }
  }
  const scenarios = raw.scenarios
  if (!scenarios || typeof scenarios !== 'object') {
    return { ok: false, error: 'Missing scenarios object' }
  }
  for (const id of FLOW_SCENARIO_IDS) {
    const s = scenarios[id]
    if (s == null) {
      return { ok: false, error: `Missing scenario: ${id}` }
    }
    if (typeof s !== 'object') {
      return { ok: false, error: `Invalid scenario config: ${id}` }
    }
    if (typeof s.useCustom !== 'boolean') {
      return { ok: false, error: `${id}: useCustom must be boolean` }
    }
    if (typeof s.notes !== 'string') {
      return { ok: false, error: `${id}: notes must be string` }
    }
    if (!Array.isArray(s.steps)) {
      return { ok: false, error: `${id}: steps must be array` }
    }
    for (let i = 0; i < s.steps.length; i++) {
      const step = s.steps[i]
      if (!step || typeof step !== 'object') {
        return { ok: false, error: `${id} step ${i}: must be object` }
      }
      const op = step.op
      if (typeof op !== 'string' || !ALLOWED_OPS.has(op)) {
        return {
          ok: false,
          error: `${id} step ${i}: unknown or missing op (allowed: ${[...ALLOWED_OPS].join(', ')})`,
        }
      }
      if (op === 'goto') {
        const url = step.url
        if (url !== 'dispatch_entry' && typeof url !== 'string') {
          return {
            ok: false,
            error: `${id} step ${i}: goto requires url string or "dispatch_entry"`,
          }
        }
      }
      if (op === 'waitMs') {
        if (typeof step.ms !== 'number' || step.ms < 0 || step.ms > 600_000) {
          return { ok: false, error: `${id} step ${i}: waitMs.ms 0–600000` }
        }
      }
      if (op === 'waitLoadState') {
        const st = step.state
        if (!['load', 'domcontentloaded', 'networkidle'].includes(st)) {
          return {
            ok: false,
            error: `${id} step ${i}: waitLoadState.state invalid`,
          }
        }
      }
      if (op === 'clickMenu') {
        if (typeof step.key !== 'string' || !MENU_KEYS.has(step.key)) {
          return {
            ok: false,
            error: `${id} step ${i}: clickMenu.key must be menu key: ${[...MENU_KEYS].join(', ')}`,
          }
        }
      }
      if (op === 'fill' || op === 'click') {
        if (typeof step.selector !== 'string' || !step.selector.trim()) {
          return {
            ok: false,
            error: `${id} step ${i}: ${op} requires non-empty selector`,
          }
        }
      }
      if (op === 'fill' && typeof step.value !== 'string') {
        return { ok: false, error: `${id} step ${i}: fill requires value string` }
      }
      if (op === 'pressKey') {
        if (typeof step.key !== 'string' || !step.key.trim()) {
          return { ok: false, error: `${id} step ${i}: pressKey requires key` }
        }
      }
      if (op === 'builtin') {
        if (typeof step.name !== 'string' || !ALLOWED_BUILTIN.has(step.name)) {
          return {
            ok: false,
            error: `${id} step ${i}: builtin.name must be one of: ${[...ALLOWED_BUILTIN].join(', ')}`,
          }
        }
      }
    }
  }
  for (const k of Object.keys(scenarios)) {
    if (!FLOW_SCENARIO_IDS.includes(k)) {
      return { ok: false, error: `Unknown scenario key: ${k}` }
    }
  }
  return { ok: true, data: { version: 1, scenarios } }
}

export async function readFlowScripts() {
  const parsed = await readKeyJson(flowKey(), () => null)
  if (parsed == null) {
    return defaultScenarios()
  }
  const v = validateFlowScriptsPayload(parsed)
  if (!v.ok) {
    return defaultScenarios()
  }
  return v.data
}

/**
 * @param {object} body
 */
export async function writeFlowScripts(body) {
  const v = validateFlowScriptsPayload(body)
  if (!v.ok) {
    throw new Error(v.error)
  }
  await writeKeyJson(flowKey(), v.data)
  return v.data
}

/**
 * @param {string} scenarioId
 */
export async function getScenarioFlowConfig(scenarioId) {
  const doc = await readFlowScripts()
  const s = doc.scenarios[scenarioId]
  if (!s) return null
  return s
}
