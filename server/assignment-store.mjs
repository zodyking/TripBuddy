import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'

const ASSIGNMENT_FILE = path.join(LOCAL_DIR, 'assignment.json')

const MAX_SLOTS = 5
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/

export const PRESETS = {
  sealed_dual: {
    preset: 'sealed_dual',
    photoSlots: [
      { id: 'dolly', label: 'Dolly', kind: 'dolly' },
      { id: 'trailer1', label: 'Trailer 1 seal', kind: 'seal' },
      { id: 'trailer2', label: 'Trailer 2 seal', kind: 'seal' },
    ],
  },
  empty_dual: {
    preset: 'empty_dual',
    photoSlots: [
      { id: 'dolly', label: 'Dolly', kind: 'dolly' },
      { id: 'trailer1', label: 'Trailer 1 number', kind: 'trailer' },
      { id: 'trailer2', label: 'Trailer 2 number', kind: 'trailer' },
    ],
  },
  trailer_only: {
    preset: 'trailer_only',
    photoSlots: [{ id: 'trailer1', label: 'Trailer 1 seal', kind: 'seal' }],
  },
  dolly_t1: {
    preset: 'dolly_t1',
    photoSlots: [
      { id: 'dolly', label: 'Dolly', kind: 'dolly' },
      { id: 'trailer1', label: 'Trailer 1 seal', kind: 'seal' },
    ],
  },
  custom: {
    preset: 'custom',
    photoSlots: [],
  },
}

const DEFAULT_ASSIGNMENT = {
  instructions: '',
  tractorLocation: '',
  driverPhone: '',
  preset: 'sealed_dual',
  photoSlots: [...PRESETS.sealed_dual.photoSlots],
  fieldValues: {},
}

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_ASSIGNMENT))
}

export function getPreset(presetKey) {
  const p = PRESETS[presetKey]
  if (!p) return null
  if (presetKey === 'custom') {
    return { preset: 'custom', photoSlots: [] }
  }
  return {
    preset: presetKey,
    photoSlots: p.photoSlots.map((s) => ({ ...s })),
  }
}

function validateSlots(slots) {
  if (!Array.isArray(slots) || slots.length > MAX_SLOTS) {
    return `photoSlots must be an array with at most ${MAX_SLOTS} items`
  }
  const ids = new Set()
  for (const s of slots) {
    if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id)) {
      return 'Each slot needs id (lowercase letters, digits, underscore)'
    }
    if (ids.has(s.id)) return `Duplicate slot id: ${s.id}`
    ids.add(s.id)
    if (typeof s.label !== 'string' || !s.label.trim()) {
      return 'Each slot needs a non-empty label'
    }
    if (s.kind && typeof s.kind !== 'string') return 'slot.kind must be a string'
  }
  return null
}

export async function readAssignment() {
  try {
    const raw = await fs.readFile(ASSIGNMENT_FILE, 'utf8')
    const data = JSON.parse(raw)
    const err = validateSlots(data.photoSlots || [])
    if (err) return cloneDefault()
    return {
      instructions: typeof data.instructions === 'string' ? data.instructions : '',
      tractorLocation:
        typeof data.tractorLocation === 'string' ? data.tractorLocation : '',
      driverPhone: typeof data.driverPhone === 'string' ? data.driverPhone : '',
      preset: typeof data.preset === 'string' ? data.preset : 'custom',
      photoSlots: data.photoSlots,
      fieldValues:
        data.fieldValues && typeof data.fieldValues === 'object'
          ? data.fieldValues
          : {},
    }
  } catch {
    return cloneDefault()
  }
}

export async function writeAssignment(body) {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  const prev = await readAssignment()

  let photoSlots = body.photoSlots ?? prev.photoSlots
  let preset = body.preset ?? prev.preset

  if (body.applyPreset && PRESETS[body.applyPreset]) {
    if (body.applyPreset === 'custom') {
      preset = 'custom'
      photoSlots = body.photoSlots ?? prev.photoSlots
    } else {
      const applied = getPreset(body.applyPreset)
      preset = applied.preset
      photoSlots = applied.photoSlots
    }
  }

  const err = validateSlots(photoSlots)
  if (err) throw new Error(err)

  const fieldValues =
    body.fieldValues && typeof body.fieldValues === 'object'
      ? { ...prev.fieldValues, ...body.fieldValues }
      : prev.fieldValues

  const next = {
    instructions:
      typeof body.instructions === 'string'
        ? body.instructions
        : prev.instructions,
    tractorLocation:
      typeof body.tractorLocation === 'string'
        ? body.tractorLocation
        : prev.tractorLocation,
    driverPhone:
      typeof body.driverPhone === 'string' ? body.driverPhone : prev.driverPhone,
    preset,
    photoSlots,
    fieldValues,
  }

  await fs.writeFile(ASSIGNMENT_FILE, JSON.stringify(next, null, 2), 'utf8')
  return next
}
