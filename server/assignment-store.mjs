import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

/**
 * @returns {string}
 */
function assignmentKvKey() {
  return userScopeKey('assignment')
}

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

/** Max ledger entries per user (newest first). */
const MAX_TRIP_HISTORY = 150

const DEFAULT_ASSIGNMENT = {
  instructions: '',
  driverPhone: '',
  preset: 'sealed_dual',
  photoSlots: [...PRESETS.sealed_dual.photoSlots],
  fieldValues: {},
  /** FedEx `dailyTripLegSequence` values user marked complete (hide until API changes). */
  hiddenDailyTripLegSequences: [],
  /** Last merged trip body (Linehaul) for cross-device continuity. */
  persistedLinehaulTripSnapshot: null,
  persistedPrePlanTripSnapshot: null,
  persistedCachedTripSnapshot: null,
  lastDailyTripLegSequencePersisted: null,
  /** Completed trips ledger: { id, completedAt, dailyTripLegSequence, dispatchHeader, tripDetails } */
  tripHistoryLedger: [],
}

function cloneDefault() {
  const o = JSON.parse(JSON.stringify(DEFAULT_ASSIGNMENT))
  if (!Array.isArray(o.hiddenDailyTripLegSequences)) {
    o.hiddenDailyTripLegSequences = []
  }
  return o
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

function normalizeAssignmentData(data) {
  if (!data) return null
  let photoSlots
  if (data.photoSlots == null) {
    photoSlots = []
  } else if (Array.isArray(data.photoSlots)) {
    photoSlots = data.photoSlots
  } else {
    return null
  }
  const err = validateSlots(photoSlots)
  if (err) return null
  const hiddenRaw = data.hiddenDailyTripLegSequences
  const hiddenDailyTripLegSequences = Array.isArray(hiddenRaw)
    ? hiddenRaw
        .map((s) => String(s).trim())
        .filter((s) => /^\d+$/.test(s))
    : []
  const ledgerRaw = data.tripHistoryLedger
  const tripHistoryLedger = Array.isArray(ledgerRaw)
    ? ledgerRaw
        .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
        .slice(0, MAX_TRIP_HISTORY)
    : []

  const base = {
    instructions: typeof data.instructions === 'string' ? data.instructions : '',
    driverPhone: typeof data.driverPhone === 'string' ? data.driverPhone : '',
    preset: typeof data.preset === 'string' ? data.preset : 'custom',
    photoSlots,
    fieldValues:
      data.fieldValues && typeof data.fieldValues === 'object' ? data.fieldValues : {},
    hiddenDailyTripLegSequences,
    tripHistoryLedger,
    persistedLinehaulTripSnapshot:
      data.persistedLinehaulTripSnapshot != null &&
      typeof data.persistedLinehaulTripSnapshot === 'object'
        ? data.persistedLinehaulTripSnapshot
        : null,
    persistedPrePlanTripSnapshot:
      data.persistedPrePlanTripSnapshot != null &&
      typeof data.persistedPrePlanTripSnapshot === 'object'
        ? data.persistedPrePlanTripSnapshot
        : null,
    persistedCachedTripSnapshot:
      data.persistedCachedTripSnapshot != null &&
      typeof data.persistedCachedTripSnapshot === 'object'
        ? data.persistedCachedTripSnapshot
        : null,
    lastDailyTripLegSequencePersisted:
      typeof data.lastDailyTripLegSequencePersisted === 'string' &&
      /^\d+$/.test(data.lastDailyTripLegSequencePersisted)
        ? data.lastDailyTripLegSequencePersisted
        : null,
  }
  if (!Array.isArray(base.hiddenDailyTripLegSequences)) {
    base.hiddenDailyTripLegSequences = []
  }
  return base
}

export async function readAssignment() {
  const key = assignmentKvKey()
  let raw = await readKeyJson(key, () => null)
  if (raw == null) raw = {}
  const n = normalizeAssignmentData(raw)
  if (!n) return cloneDefault()
  if (!Array.isArray(n.hiddenDailyTripLegSequences)) n.hiddenDailyTripLegSequences = []
  if (!('persistedLinehaulTripSnapshot' in n)) n.persistedLinehaulTripSnapshot = null
  if (!('persistedPrePlanTripSnapshot' in n)) n.persistedPrePlanTripSnapshot = null
  if (!('persistedCachedTripSnapshot' in n)) n.persistedCachedTripSnapshot = null
  if (!('lastDailyTripLegSequencePersisted' in n)) n.lastDailyTripLegSequencePersisted = null
  if (!Array.isArray(n.tripHistoryLedger)) n.tripHistoryLedger = []
  return n
}

export async function writeAssignment(body) {
  const key = assignmentKvKey()

  const prev = await readAssignment()

  let photoSlots = Array.isArray(body?.photoSlots)
    ? body.photoSlots
    : prev.photoSlots
  if (!Array.isArray(photoSlots)) {
    const sealed = getPreset('sealed_dual')
    photoSlots = sealed ? sealed.photoSlots.map((s) => ({ ...s })) : []
  }
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

  let hiddenDailyTripLegSequences = prev.hiddenDailyTripLegSequences ?? []
  if (Array.isArray(body.hiddenDailyTripLegSequences)) {
    hiddenDailyTripLegSequences = body.hiddenDailyTripLegSequences
      .map((s) => String(s).trim())
      .filter((s) => /^\d+$/.test(s))
  } else if (typeof body.appendHiddenDailyTripLegSequence === 'string') {
    const one = body.appendHiddenDailyTripLegSequence.trim()
    if (/^\d+$/.test(one)) {
      const set = new Set(hiddenDailyTripLegSequences)
      set.add(one)
      hiddenDailyTripLegSequences = Array.from(set)
    }
  }

  let persistedLinehaulTripSnapshot = prev.persistedLinehaulTripSnapshot ?? null
  let persistedPrePlanTripSnapshot = prev.persistedPrePlanTripSnapshot ?? null
  let persistedCachedTripSnapshot = prev.persistedCachedTripSnapshot ?? null
  let lastDailyTripLegSequencePersisted =
    prev.lastDailyTripLegSequencePersisted ?? null

  if ('persistedLinehaulTripSnapshot' in body) {
    const v = body.persistedLinehaulTripSnapshot
    persistedLinehaulTripSnapshot =
      v != null && typeof v === 'object' ? v : null
  }
  if ('persistedPrePlanTripSnapshot' in body) {
    const v = body.persistedPrePlanTripSnapshot
    persistedPrePlanTripSnapshot =
      v != null && typeof v === 'object' ? v : null
  }
  if ('persistedCachedTripSnapshot' in body) {
    const v = body.persistedCachedTripSnapshot
    persistedCachedTripSnapshot =
      v != null && typeof v === 'object' ? v : null
  }
  if ('lastDailyTripLegSequencePersisted' in body) {
    const s = body.lastDailyTripLegSequencePersisted
    lastDailyTripLegSequencePersisted =
      typeof s === 'string' && /^\d+$/.test(s) ? s : null
  }

  let tripHistoryLedger = Array.isArray(prev.tripHistoryLedger)
    ? prev.tripHistoryLedger
    : []
  if (Array.isArray(body.tripHistoryLedger)) {
    tripHistoryLedger = body.tripHistoryLedger
      .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
      .slice(0, MAX_TRIP_HISTORY)
  } else if (body.appendTripHistoryEntry && typeof body.appendTripHistoryEntry === 'object') {
    const e = body.appendTripHistoryEntry
    const id =
      typeof e.id === 'string' && e.id.trim()
        ? e.id.trim()
        : `h-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const seq = String(e.dailyTripLegSequence ?? '').trim()
    const source =
      typeof e.source === 'string' && e.source.trim() ? e.source.trim() : 'complete'
    const entry = {
      id,
      source,
      completedAt:
        typeof e.completedAt === 'number' && Number.isFinite(e.completedAt)
          ? e.completedAt
          : Date.now(),
      dailyTripLegSequence: /^\d+$/.test(seq) ? seq : '',
      dispatchHeader: {
        ...(e.dispatchHeader && typeof e.dispatchHeader === 'object' ? e.dispatchHeader : {}),
        source,
      },
      tripDetails:
        e.tripDetails && typeof e.tripDetails === 'object' ? e.tripDetails : {},
    }
    if (source === 'linehaul' || source === 'complete') {
      if (/^\d+$/.test(seq)) {
        tripHistoryLedger = tripHistoryLedger.filter(
          (x) =>
            String(x?.dailyTripLegSequence) !== seq && !(x && x.id && String(x.id) === id),
        )
      } else if (id) {
        tripHistoryLedger = tripHistoryLedger.filter(
          (x) => !(x && x.id && String(x.id) === id),
        )
      }
    }
    tripHistoryLedger = [entry, ...tripHistoryLedger].slice(0, MAX_TRIP_HISTORY)
  } else if (body.upsertTripHistoryEntry && typeof body.upsertTripHistoryEntry === 'object') {
    const e = body.upsertTripHistoryEntry
    const seq = String(e.dailyTripLegSequence ?? '').trim()
    if (!/^\d+$/.test(seq)) {
      /* invalid */
    } else {
      const id =
        typeof e.id === 'string' && e.id.trim() ? e.id.trim() : `h-${seq}`
      const at =
        typeof e.recordedAt === 'number' && Number.isFinite(e.recordedAt)
          ? e.recordedAt
          : typeof e.completedAt === 'number' && Number.isFinite(e.completedAt)
            ? e.completedAt
            : Date.now()
      const nextEntry = {
        id,
        source: typeof e.source === 'string' && e.source.trim() ? e.source.trim() : 'linehaul',
        /** API snapshots use recordedAt; completion entries keep completedAt */
        recordedAt: at,
        completedAt: at,
        dailyTripLegSequence: seq,
        dispatchHeader:
          e.dispatchHeader && typeof e.dispatchHeader === 'object' ? e.dispatchHeader : {},
        tripDetails:
          e.tripDetails && typeof e.tripDetails === 'object' ? e.tripDetails : {},
      }
      const rest = tripHistoryLedger.filter(
        (x) => x && String(x.dailyTripLegSequence) !== seq && x.id !== id,
      )
      tripHistoryLedger = [nextEntry, ...rest].slice(0, MAX_TRIP_HISTORY)
    }
  }

  const next = {
    instructions:
      typeof body.instructions === 'string'
        ? body.instructions
        : prev.instructions,
    driverPhone:
      typeof body.driverPhone === 'string' ? body.driverPhone : prev.driverPhone,
    preset,
    photoSlots,
    fieldValues,
    hiddenDailyTripLegSequences,
    persistedLinehaulTripSnapshot,
    persistedPrePlanTripSnapshot,
    persistedCachedTripSnapshot,
    lastDailyTripLegSequencePersisted,
    tripHistoryLedger,
  }

  await writeKeyJson(key, next)
  return next
}
