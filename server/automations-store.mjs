import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LOCAL_DIR } from './config.mjs'

const AUTOMATIONS_FILE = path.join(LOCAL_DIR, 'automations.json')

/**
 * Block type definitions for the automation builder.
 * Matches Home Assistant's action/trigger/condition model.
 */

export const BLOCK_CATEGORIES = {
  navigation: {
    label: 'Navigation',
    icon: 'globe',
    blocks: ['goto', 'goBack', 'goForward', 'reload'],
  },
  timing: {
    label: 'Wait / Timing',
    icon: 'clock',
    blocks: ['delay', 'waitForLoadState', 'waitForSelector', 'waitForUrl'],
  },
  interaction: {
    label: 'Element Interaction',
    icon: 'pointer',
    blocks: ['click', 'fill', 'clear', 'check', 'uncheck', 'selectOption', 'hover', 'focus', 'press'],
  },
  inspection: {
    label: 'Page Inspection',
    icon: 'eye',
    blocks: ['screenshot', 'getText', 'getAttribute', 'evaluate'],
  },
  controlFlow: {
    label: 'Control Flow',
    icon: 'git-branch',
    blocks: ['if', 'choose', 'repeat', 'parallel', 'stop', 'runAutomation'],
  },
  fedex: {
    label: 'FedEx Specific',
    icon: 'truck',
    blocks: [
      'ensureSignedIn',
      'checkInEndToEnd',
      'openMenu',
      'fillCheckInForm',
      'handleBanner',
      'fillPhoneModal',
      'contactLinehaulConfirm',
      'assistanceConfirm',
      'signOut',
    ],
  },
}

export const BLOCK_DEFINITIONS = {
  goto: {
    type: 'goto',
    label: 'Navigate to URL',
    category: 'navigation',
    icon: 'globe',
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://... or dispatch_entry', required: true },
      { key: 'waitUntil', label: 'Wait until', type: 'select', options: ['domcontentloaded', 'load', 'networkidle'], default: 'domcontentloaded' },
    ],
  },
  goBack: {
    type: 'goBack',
    label: 'Go Back',
    category: 'navigation',
    icon: 'arrow-left',
    fields: [],
  },
  goForward: {
    type: 'goForward',
    label: 'Go Forward',
    category: 'navigation',
    icon: 'arrow-right',
    fields: [],
  },
  reload: {
    type: 'reload',
    label: 'Reload Page',
    category: 'navigation',
    icon: 'refresh',
    fields: [
      { key: 'waitUntil', label: 'Wait until', type: 'select', options: ['domcontentloaded', 'load', 'networkidle'], default: 'domcontentloaded' },
    ],
  },
  delay: {
    type: 'delay',
    label: 'Wait / Delay',
    category: 'timing',
    icon: 'clock',
    fields: [
      { key: 'ms', label: 'Milliseconds', type: 'number', min: 0, max: 300000, default: 1000, required: true },
    ],
  },
  waitForLoadState: {
    type: 'waitForLoadState',
    label: 'Wait for Load State',
    category: 'timing',
    icon: 'loader',
    fields: [
      { key: 'state', label: 'State', type: 'select', options: ['load', 'domcontentloaded', 'networkidle'], default: 'domcontentloaded', required: true },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', min: 0, max: 120000, default: 30000 },
    ],
  },
  waitForSelector: {
    type: 'waitForSelector',
    label: 'Wait for Element',
    category: 'timing',
    icon: 'search',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
      { key: 'state', label: 'State', type: 'select', options: ['visible', 'hidden', 'attached', 'detached'], default: 'visible' },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', min: 0, max: 120000, default: 30000 },
    ],
  },
  waitForUrl: {
    type: 'waitForUrl',
    label: 'Wait for URL',
    category: 'timing',
    icon: 'link',
    fields: [
      { key: 'url', label: 'URL pattern', type: 'text', placeholder: 'Exact URL or regex pattern', required: true },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', min: 0, max: 120000, default: 30000 },
    ],
  },
  click: {
    type: 'click',
    label: 'Click Element',
    category: 'interaction',
    icon: 'pointer',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
      { key: 'button', label: 'Button', type: 'select', options: ['left', 'right', 'middle'], default: 'left' },
      { key: 'clickCount', label: 'Click count', type: 'number', min: 1, max: 3, default: 1 },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', min: 0, max: 60000, default: 30000 },
    ],
  },
  fill: {
    type: 'fill',
    label: 'Fill Input',
    category: 'interaction',
    icon: 'edit',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'Text to type (supports {{variables}})', required: true },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', min: 0, max: 60000, default: 30000 },
    ],
  },
  clear: {
    type: 'clear',
    label: 'Clear Input',
    category: 'interaction',
    icon: 'x',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
    ],
  },
  check: {
    type: 'check',
    label: 'Check Checkbox',
    category: 'interaction',
    icon: 'check-square',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
    ],
  },
  uncheck: {
    type: 'uncheck',
    label: 'Uncheck Checkbox',
    category: 'interaction',
    icon: 'square',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
    ],
  },
  selectOption: {
    type: 'selectOption',
    label: 'Select Dropdown',
    category: 'interaction',
    icon: 'chevron-down',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'Option value or label', required: true },
    ],
  },
  hover: {
    type: 'hover',
    label: 'Hover Over Element',
    category: 'interaction',
    icon: 'mouse-pointer',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
    ],
  },
  focus: {
    type: 'focus',
    label: 'Focus Element',
    category: 'interaction',
    icon: 'crosshair',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
    ],
  },
  press: {
    type: 'press',
    label: 'Press Key',
    category: 'interaction',
    icon: 'keyboard',
    fields: [
      { key: 'key', label: 'Key', type: 'text', placeholder: 'Enter, Tab, Escape, etc.', required: true },
      { key: 'selector', label: 'Selector (optional)', type: 'text', placeholder: 'Focus element first' },
    ],
  },
  screenshot: {
    type: 'screenshot',
    label: 'Take Screenshot',
    category: 'inspection',
    icon: 'camera',
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Screenshot name', default: 'screenshot' },
      { key: 'fullPage', label: 'Full page', type: 'boolean', default: false },
    ],
  },
  getText: {
    type: 'getText',
    label: 'Get Element Text',
    category: 'inspection',
    icon: 'type',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
      { key: 'variable', label: 'Store in variable', type: 'text', placeholder: 'Variable name', required: true },
    ],
  },
  getAttribute: {
    type: 'getAttribute',
    label: 'Get Attribute',
    category: 'inspection',
    icon: 'tag',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', placeholder: 'CSS, XPath, or text selector', required: true },
      { key: 'attribute', label: 'Attribute', type: 'text', placeholder: 'href, class, data-*, etc.', required: true },
      { key: 'variable', label: 'Store in variable', type: 'text', placeholder: 'Variable name', required: true },
    ],
  },
  evaluate: {
    type: 'evaluate',
    label: 'Run JavaScript',
    category: 'inspection',
    icon: 'code',
    fields: [
      { key: 'script', label: 'JavaScript', type: 'textarea', placeholder: 'return document.title', required: true },
      { key: 'variable', label: 'Store result in variable', type: 'text', placeholder: 'Variable name' },
    ],
  },
  if: {
    type: 'if',
    label: 'If / Then / Else',
    category: 'controlFlow',
    icon: 'git-branch',
    isContainer: true,
    fields: [
      { key: 'conditionType', label: 'Condition type', type: 'select', options: ['elementVisible', 'elementHidden', 'urlMatches', 'variableEquals'], default: 'elementVisible' },
      { key: 'selector', label: 'Selector', type: 'text', showIf: { conditionType: ['elementVisible', 'elementHidden'] } },
      { key: 'pattern', label: 'URL pattern', type: 'text', showIf: { conditionType: ['urlMatches'] } },
      { key: 'variable', label: 'Variable', type: 'text', showIf: { conditionType: ['variableEquals'] } },
      { key: 'value', label: 'Value', type: 'text', showIf: { conditionType: ['variableEquals'] } },
    ],
    children: { then: [], else: [] },
  },
  choose: {
    type: 'choose',
    label: 'Choose (Switch)',
    category: 'controlFlow',
    icon: 'list',
    isContainer: true,
    fields: [],
    children: { options: [], default: [] },
  },
  repeat: {
    type: 'repeat',
    label: 'Repeat Loop',
    category: 'controlFlow',
    icon: 'repeat',
    isContainer: true,
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['count', 'while', 'until'], default: 'count' },
      { key: 'count', label: 'Count', type: 'number', min: 1, max: 100, default: 3, showIf: { mode: ['count'] } },
      { key: 'conditionType', label: 'Condition type', type: 'select', options: ['elementVisible', 'elementHidden', 'variableEquals'], showIf: { mode: ['while', 'until'] } },
      { key: 'selector', label: 'Selector', type: 'text', showIf: { mode: ['while', 'until'], conditionType: ['elementVisible', 'elementHidden'] } },
      { key: 'variable', label: 'Variable', type: 'text', showIf: { mode: ['while', 'until'], conditionType: ['variableEquals'] } },
      { key: 'value', label: 'Value', type: 'text', showIf: { mode: ['while', 'until'], conditionType: ['variableEquals'] } },
    ],
    children: { sequence: [] },
  },
  parallel: {
    type: 'parallel',
    label: 'Run in Parallel',
    category: 'controlFlow',
    icon: 'layers',
    isContainer: true,
    fields: [],
    children: { branches: [] },
  },
  stop: {
    type: 'stop',
    label: 'Stop Automation',
    category: 'controlFlow',
    icon: 'stop-circle',
    fields: [
      { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Optional stop message' },
    ],
  },
  runAutomation: {
    type: 'runAutomation',
    label: 'Run Another Automation',
    category: 'controlFlow',
    icon: 'play',
    fields: [
      { key: 'automationId', label: 'Automation', type: 'automationPicker', required: true },
    ],
  },
  ensureSignedIn: {
    type: 'ensureSignedIn',
    label: 'Ensure Signed In',
    category: 'fedex',
    icon: 'log-in',
    fields: [
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', min: 0, max: 300000, default: 60000 },
    ],
  },
  openMenu: {
    type: 'openMenu',
    label: 'Open Menu Item',
    category: 'fedex',
    icon: 'menu',
    fields: [
      { key: 'menuKey', label: 'Menu item', type: 'select', options: ['checkIn', 'beginNewCheckIn', 'arrive', 'inspectAndCheckOut', 'reviewAndStartTrip', 'viewTripAndRouting'], required: true },
      { key: 'optional', label: 'Do not fail if unavailable', type: 'boolean', default: false },
    ],
  },
  checkInEndToEnd: {
    type: 'checkInEndToEnd',
    label: 'Check in (full pipeline)',
    category: 'fedex',
    icon: 'check-circle',
    fields: [
      { key: 'tryOktaLogin', label: 'Auto Okta login if needed', type: 'boolean', default: true },
    ],
  },
  arriveEndToEnd: {
    type: 'arriveEndToEnd',
    label: 'Arrive (full pipeline)',
    category: 'fedex',
    icon: 'map-pin',
    fields: [
      { key: 'tryOktaLogin', label: 'Auto Okta login if needed', type: 'boolean', default: true },
    ],
  },
  fillCheckInForm: {
    type: 'fillCheckInForm',
    label: 'Fill Check-In Form',
    category: 'fedex',
    icon: 'clipboard',
    fields: [
      { key: 'tractorSource', label: 'Tractor number from', type: 'select', options: ['settings', 'variable', 'literal'], default: 'settings' },
      { key: 'tractorValue', label: 'Value', type: 'text', showIf: { tractorSource: ['variable', 'literal'] } },
      { key: 'locationSource', label: 'Location from', type: 'select', options: ['settings', 'variable', 'literal'], default: 'settings' },
      { key: 'locationValue', label: 'Value', type: 'text', showIf: { locationSource: ['variable', 'literal'] } },
    ],
  },
  handleBanner: {
    type: 'handleBanner',
    label: 'Handle FedEx Banner',
    category: 'fedex',
    icon: 'alert-triangle',
    fields: [
      { key: 'timeout', label: 'Poll timeout (ms)', type: 'number', min: 0, max: 60000, default: 11000 },
      { key: 'onMismatch', label: 'On location mismatch', type: 'select', options: ['stop', 'retry', 'continue'], default: 'stop' },
    ],
  },
  fillPhoneModal: {
    type: 'fillPhoneModal',
    label: 'Fill Phone Modal',
    category: 'fedex',
    icon: 'phone',
    fields: [
      { key: 'phoneSource', label: 'Phone from', type: 'select', options: ['settings', 'variable', 'literal'], default: 'settings' },
      { key: 'phoneValue', label: 'Value', type: 'text', showIf: { phoneSource: ['variable', 'literal'] } },
    ],
  },
  contactLinehaulConfirm: {
    type: 'contactLinehaulConfirm',
    label: 'Contact Linehaul Confirm',
    category: 'fedex',
    icon: 'check-square',
    fields: [],
  },
  assistanceConfirm: {
    type: 'assistanceConfirm',
    label: 'Assistance Confirm',
    category: 'fedex',
    icon: 'check-square',
    fields: [],
  },
  signOut: {
    type: 'signOut',
    label: 'Sign Out',
    category: 'fedex',
    icon: 'log-in',
    fields: [],
  },
}

export const TRIGGER_DEFINITIONS = {
  manual: {
    type: 'manual',
    label: 'Manual / Dashboard',
    icon: 'hand',
    fields: [
      { key: 'buttonLabel', label: 'Button label', type: 'text', default: 'Run' },
    ],
  },
  schedule: {
    type: 'schedule',
    label: 'Schedule',
    icon: 'calendar',
    fields: [
      { key: 'cron', label: 'Cron expression', type: 'text', placeholder: '0 6 * * *', required: true },
      { key: 'timezone', label: 'Timezone', type: 'text', default: 'America/New_York' },
    ],
  },
  webhook: {
    type: 'webhook',
    label: 'Webhook',
    icon: 'zap',
    fields: [
      { key: 'path', label: 'Webhook path', type: 'text', placeholder: '/my-hook', required: true },
    ],
  },
  apiCall: {
    type: 'apiCall',
    label: 'API Call',
    icon: 'server',
    fields: [],
  },
}

export const CONDITION_DEFINITIONS = {
  elementVisible: {
    type: 'elementVisible',
    label: 'Element is visible',
    icon: 'eye',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', required: true },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', default: 5000 },
    ],
  },
  elementHidden: {
    type: 'elementHidden',
    label: 'Element is hidden',
    icon: 'eye-off',
    fields: [
      { key: 'selector', label: 'Selector', type: 'text', required: true },
      { key: 'timeout', label: 'Timeout (ms)', type: 'number', default: 5000 },
    ],
  },
  urlMatches: {
    type: 'urlMatches',
    label: 'URL matches',
    icon: 'link',
    fields: [
      { key: 'pattern', label: 'URL pattern', type: 'text', required: true },
    ],
  },
  timeWindow: {
    type: 'timeWindow',
    label: 'Time window',
    icon: 'clock',
    fields: [
      { key: 'after', label: 'After (HH:mm)', type: 'text', placeholder: '06:00' },
      { key: 'before', label: 'Before (HH:mm)', type: 'text', placeholder: '22:00' },
      { key: 'days', label: 'Days', type: 'multiselect', options: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    ],
  },
  variableEquals: {
    type: 'variableEquals',
    label: 'Variable equals',
    icon: 'hash',
    fields: [
      { key: 'variable', label: 'Variable', type: 'text', required: true },
      { key: 'value', label: 'Value', type: 'text', required: true },
    ],
  },
}

function generateId() {
  return randomUUID().slice(0, 8)
}

function createEmptyAutomation() {
  return {
    id: generateId(),
    name: 'New Automation',
    description: '',
    enabled: true,
    triggers: [{ id: generateId(), type: 'manual', buttonLabel: 'Run' }],
    conditions: [],
    actions: [],
    variables: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function defaultStore() {
  return {
    version: 1,
    automations: [],
  }
}

function validateAction(action, path = 'action') {
  if (!action || typeof action !== 'object') {
    return { ok: false, error: `${path}: must be object` }
  }
  if (!action.id || typeof action.id !== 'string') {
    return { ok: false, error: `${path}: missing id` }
  }
  if (!action.type || typeof action.type !== 'string') {
    return { ok: false, error: `${path}: missing type` }
  }
  const def = BLOCK_DEFINITIONS[action.type]
  if (!def) {
    return { ok: false, error: `${path}: unknown action type "${action.type}"` }
  }
  if (def.isContainer && action.children) {
    for (const [key, arr] of Object.entries(action.children)) {
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          const r = validateAction(arr[i], `${path}.children.${key}[${i}]`)
          if (!r.ok) return r
        }
      }
    }
  }
  return { ok: true }
}

function validateTrigger(trigger, path = 'trigger') {
  if (!trigger || typeof trigger !== 'object') {
    return { ok: false, error: `${path}: must be object` }
  }
  if (!trigger.id || typeof trigger.id !== 'string') {
    return { ok: false, error: `${path}: missing id` }
  }
  if (!trigger.type || typeof trigger.type !== 'string') {
    return { ok: false, error: `${path}: missing type` }
  }
  if (!TRIGGER_DEFINITIONS[trigger.type]) {
    return { ok: false, error: `${path}: unknown trigger type "${trigger.type}"` }
  }
  return { ok: true }
}

function validateCondition(condition, path = 'condition') {
  if (!condition || typeof condition !== 'object') {
    return { ok: false, error: `${path}: must be object` }
  }
  if (!condition.id || typeof condition.id !== 'string') {
    return { ok: false, error: `${path}: missing id` }
  }
  if (!condition.type || typeof condition.type !== 'string') {
    return { ok: false, error: `${path}: missing type` }
  }
  if (!CONDITION_DEFINITIONS[condition.type]) {
    return { ok: false, error: `${path}: unknown condition type "${condition.type}"` }
  }
  return { ok: true }
}

export function validateAutomation(auto) {
  if (!auto || typeof auto !== 'object') {
    return { ok: false, error: 'Automation must be object' }
  }
  if (!auto.id || typeof auto.id !== 'string') {
    return { ok: false, error: 'Missing automation id' }
  }
  if (!auto.name || typeof auto.name !== 'string') {
    return { ok: false, error: 'Missing automation name' }
  }
  if (!Array.isArray(auto.triggers)) {
    return { ok: false, error: 'triggers must be array' }
  }
  for (let i = 0; i < auto.triggers.length; i++) {
    const r = validateTrigger(auto.triggers[i], `triggers[${i}]`)
    if (!r.ok) return r
  }
  if (!Array.isArray(auto.conditions)) {
    return { ok: false, error: 'conditions must be array' }
  }
  for (let i = 0; i < auto.conditions.length; i++) {
    const r = validateCondition(auto.conditions[i], `conditions[${i}]`)
    if (!r.ok) return r
  }
  if (!Array.isArray(auto.actions)) {
    return { ok: false, error: 'actions must be array' }
  }
  for (let i = 0; i < auto.actions.length; i++) {
    const r = validateAction(auto.actions[i], `actions[${i}]`)
    if (!r.ok) return r
  }
  return { ok: true }
}

export async function readAutomations() {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  try {
    const raw = await fs.readFile(AUTOMATIONS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.automations)) {
      return defaultStore()
    }
    return parsed
  } catch {
    return defaultStore()
  }
}

async function writeStore(store) {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  await fs.writeFile(AUTOMATIONS_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

export async function getAutomation(id) {
  const store = await readAutomations()
  return store.automations.find((a) => a.id === id) || null
}

export async function listAutomations() {
  const store = await readAutomations()
  return store.automations.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    triggerCount: a.triggers?.length || 0,
    actionCount: a.actions?.length || 0,
    updatedAt: a.updatedAt,
    hasManualTrigger: a.triggers?.some((t) => t.type === 'manual') || false,
    manualButtonLabel: a.triggers?.find((t) => t.type === 'manual')?.buttonLabel || a.name,
  }))
}

export async function createAutomation(data = {}) {
  const store = await readAutomations()
  const auto = {
    ...createEmptyAutomation(),
    ...data,
    id: data.id || generateId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const v = validateAutomation(auto)
  if (!v.ok) throw new Error(v.error)
  store.automations.push(auto)
  await writeStore(store)
  return auto
}

export async function updateAutomation(id, data) {
  const store = await readAutomations()
  const idx = store.automations.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error(`Automation not found: ${id}`)
  const existing = store.automations[idx]
  const updated = {
    ...existing,
    ...data,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  }
  const v = validateAutomation(updated)
  if (!v.ok) throw new Error(v.error)
  store.automations[idx] = updated
  await writeStore(store)
  return updated
}

export async function deleteAutomation(id) {
  const store = await readAutomations()
  const idx = store.automations.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error(`Automation not found: ${id}`)
  store.automations.splice(idx, 1)
  await writeStore(store)
  return { ok: true }
}

export async function duplicateAutomation(id) {
  const store = await readAutomations()
  const source = store.automations.find((a) => a.id === id)
  if (!source) throw new Error(`Automation not found: ${id}`)
  const copy = JSON.parse(JSON.stringify(source))
  copy.id = generateId()
  copy.name = `${source.name} (copy)`
  copy.createdAt = Date.now()
  copy.updatedAt = Date.now()
  store.automations.push(copy)
  await writeStore(store)
  return copy
}

export { BLOCK_DEFINITIONS as blockDefs, TRIGGER_DEFINITIONS as triggerDefs, CONDITION_DEFINITIONS as conditionDefs }
