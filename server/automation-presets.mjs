/**
 * Pre-built automation templates that users can install.
 * These break down common flows into granular, editable actions.
 */

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

export const PRESETS = {
  check_in_full: {
    name: 'Full Check-In Flow',
    description:
      'Same path as dashboard Check in: dispatch home, sign-in gate, full form, banners, location retry, phone modal, TTS on success (no automated sign-out).',
    triggers: [
      { id: genId(), type: 'manual', buttonLabel: 'Check In' },
    ],
    conditions: [],
    actions: [
      {
        id: genId(),
        type: 'goto',
        url: 'dispatch_entry',
        waitUntil: 'domcontentloaded',
      },
      {
        id: genId(),
        type: 'checkInEndToEnd',
        tryOktaLogin: true,
      },
    ],
    variables: {},
  },

  navigate_and_wait: {
    name: 'Navigate to Dispatch',
    description: 'Simple navigation to FedEx dispatch entry with sign-in.',
    triggers: [
      { id: genId(), type: 'manual', buttonLabel: 'Open Dispatch' },
    ],
    conditions: [],
    actions: [
      {
        id: genId(),
        type: 'goto',
        url: 'dispatch_entry',
        waitUntil: 'domcontentloaded',
      },
      {
        id: genId(),
        type: 'ensureSignedIn',
        timeout: 60000,
      },
    ],
    variables: {},
  },

  inspect_checkout: {
    name: 'Inspect & Checkout',
    description: 'Open Inspect and Check Out menu, fill form fields.',
    triggers: [
      { id: genId(), type: 'manual', buttonLabel: 'Inspect/Checkout' },
    ],
    conditions: [],
    actions: [
      {
        id: genId(),
        type: 'goto',
        url: 'dispatch_entry',
        waitUntil: 'domcontentloaded',
      },
      {
        id: genId(),
        type: 'ensureSignedIn',
        timeout: 60000,
      },
      {
        id: genId(),
        type: 'openMenu',
        menuKey: 'inspectAndCheckOut',
      },
      {
        id: genId(),
        type: 'waitForLoadState',
        state: 'domcontentloaded',
        timeout: 30000,
      },
    ],
    variables: {},
  },

  arrive_full: {
    name: 'Full Arrive Flow',
    description:
      'Arrive at destination: dispatch home, sign-in, enter tractor number, confirm arrival, sign out.',
    triggers: [
      { id: genId(), type: 'manual', buttonLabel: 'Arrive' },
    ],
    conditions: [],
    actions: [
      {
        id: genId(),
        type: 'goto',
        url: 'dispatch_entry',
        waitUntil: 'domcontentloaded',
      },
      {
        id: genId(),
        type: 'arriveEndToEnd',
        tryOktaLogin: true,
      },
    ],
    variables: {},
  },
}

export function getPresetIds() {
  return Object.keys(PRESETS)
}

export function getPreset(id) {
  const preset = PRESETS[id]
  if (!preset) return null
  const copy = JSON.parse(JSON.stringify(preset))
  copy.id = genId()
  copy.createdAt = Date.now()
  copy.updatedAt = Date.now()
  copy.enabled = true
  return copy
}

export function listPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    description: p.description,
    actionCount: p.actions?.length || 0,
  }))
}
