import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { getDataAccountKey, userScopeKey, keyForUser } from './scope-kv.mjs'
import { emitLog } from './log-bus.mjs'
import { publishInAppForAccount } from './notification-publish.mjs'
import { inferTravelDirectionFromTripBody } from './bridge-travel-context.mjs'

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

const TRIP_OUTCOMES = new Set(['delivered', 'rejected', 'removed', 'none'])

/**
 * @param {unknown} originId
 * @param {unknown} destId
 * @returns {string} empty if invalid
 */
function odPairKey(originId, destId) {
  const o = String(originId ?? '').trim()
  const d = String(destId ?? '').trim()
  if (!/^\d+$/.test(o) || !/^\d+$/.test(d)) return ''
  return `${o}|${d}`
}

/**
 * Normalize Linehaul viewTripInfoDetails JSON for storage / tripDetails.mileage.
 * @param {unknown} body
 * @returns {Record<string, unknown> | null}
 */
function mileagePayloadFromApiBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = /** @type {Record<string, unknown>} */ (body)
  const totalMiles = b.totalMiles != null ? String(b.totalMiles).trim() : ''
  const runH = b.runTimeHours
  const runTimeHours =
    typeof runH === 'number' && Number.isFinite(runH) ? runH : null
  const origin = b.origin != null ? String(b.origin).trim() : ''
  const destination = b.destination != null ? String(b.destination).trim() : ''
  const directionList = Array.isArray(b.directionList) ? b.directionList : []
  /** @type {Record<string, unknown>} */
  const out = {
    fetchedAt: Date.now(),
    directionList,
    source: 'linehaul_api',
  }
  if (totalMiles) out.totalMiles = totalMiles
  if (runTimeHours != null) out.runTimeHours = runTimeHours
  if (origin) out.origin = origin
  if (destination) out.destination = destination
  return out
}

/**
 * @param {Record<string, unknown>} td
 * @param {Record<string, unknown>} mileageObj
 */
function mergeTripDetailsMileage(td, mileageObj) {
  const prev =
    td.mileage && typeof td.mileage === 'object' && !Array.isArray(td.mileage)
      ? /** @type {Record<string, unknown>} */ ({ ...td.mileage })
      : {}
  return {
    ...td,
    mileage: { ...prev, ...mileageObj },
  }
}

/**
 * Millisecond timestamp for ordering ledger rows (older = smaller).
 * @param {unknown} entry
 */
function entryLedgerTime(entry) {
  if (!entry || typeof entry !== 'object') return 0
  const e = /** @type {Record<string, unknown>} */ (entry)
  const r = e.recordedAt
  if (typeof r === 'number' && Number.isFinite(r) && r > 0) return r
  const c = e.completedAt
  if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c
  return 0
}

/**
 * True when trip already has mileage data we must not replace (API or prior copy).
 * @param {unknown} td
 */
function tripDetailsHasUsableMileage(td) {
  if (!td || typeof td !== 'object' || Array.isArray(td)) return false
  const m =
    /** @type {Record<string, unknown>} */ (td).mileage &&
    typeof /** @type {Record<string, unknown>} */ (td).mileage === 'object' &&
    !Array.isArray(/** @type {Record<string, unknown>} */ (td).mileage)
      ? /** @type {Record<string, unknown>} */ (
          /** @type {Record<string, unknown>} */ (td).mileage
        )
      : null
  if (!m) return false
  const tm = m.totalMiles != null ? String(m.totalMiles).trim() : ''
  if (tm !== '') return true
  const rt = m.runTimeHours
  return typeof rt === 'number' && Number.isFinite(rt) && rt > 0
}

/**
 * Payload to merge into a row missing mileage (subset of donor mileage only).
 * @param {unknown} entry donor row
 * @returns {Record<string, unknown> | null}
 */
function mileageSliceFromPriorOdEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const td = /** @type {Record<string, unknown>} */ (entry).tripDetails
  if (!td || typeof td !== 'object' || Array.isArray(td)) return null
  const mil = /** @type {Record<string, unknown>} */ (td).mileage
  if (!mil || typeof mil !== 'object' || Array.isArray(mil)) return null
  const m = /** @type {Record<string, unknown>} */ (mil)
  const totalMiles = m.totalMiles != null ? String(m.totalMiles).trim() : ''
  const runH = m.runTimeHours
  const hasRt = typeof runH === 'number' && Number.isFinite(runH) && runH > 0
  if (totalMiles === '' && !hasRt) return null
  /** @type {Record<string, unknown>} */
  const out = {
    copiedFromPriorOd: true,
    copiedAt: Date.now(),
  }
  if (totalMiles !== '') out.totalMiles = totalMiles
  if (hasRt) out.runTimeHours = runH
  const dl = m.directionList
  if (Array.isArray(dl) && dl.length > 0) out.directionList = dl
  const origin = m.origin != null ? String(m.origin).trim() : ''
  const destination = m.destination != null ? String(m.destination).trim() : ''
  if (origin) out.origin = origin
  if (destination) out.destination = destination
  const src = m.source != null ? String(m.source).trim() : ''
  if (src) out.source = `${src}_prior_od_copy`
  return out
}

/**
 * True when mileage came from a prior-O/D copy (do not use as donor for forward fill).
 * @param {unknown} td
 */
function mileageIsPriorOdCopy(td) {
  if (!td || typeof td !== 'object' || Array.isArray(td)) return false
  const m =
    /** @type {Record<string, unknown>} */ (td).mileage &&
    typeof /** @type {Record<string, unknown>} */ (td).mileage === 'object' &&
    !Array.isArray(/** @type {Record<string, unknown>} */ (td).mileage)
      ? /** @type {Record<string, unknown>} */ (
          /** @type {Record<string, unknown>} */ (td).mileage
        )
      : null
  return Boolean(m && m.copiedFromPriorOd === true)
}

/**
 * For each trip missing mileage, copy totalMiles / runTimeHours from another trip with the same
 * origin/destination ids: prefer the nearest **older** row with usable mileage; if none, the nearest
 * **newer** row that has real (non-copied) mileage. Never overwrites rows that already have mileage.
 * @param {unknown[]} ledger
 * @returns {{ ledger: unknown[], changed: boolean }}
 */
function applyPriorOdMileageBackfill(ledger) {
  if (!Array.isArray(ledger) || ledger.length === 0) {
    return { ledger, changed: false }
  }
  /** shallow row clones — we replace whole row objects when merging */
  const result = ledger.map((e) =>
    e && typeof e === 'object' && !Array.isArray(e)
      ? /** @type {Record<string, unknown>} */ ({ ...e })
      : e,
  )
  const order = result
    .map((e, i) => ({ i, t: entryLedgerTime(e) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)

  let changed = false

  function fillFromNeighbor(si, dir) {
    const i = order[si].i
    const e = result[i]
    if (!e || typeof e !== 'object') return
    const td0 =
      e.tripDetails && typeof e.tripDetails === 'object' && !Array.isArray(e.tripDetails)
        ? /** @type {Record<string, unknown>} */ ({ ...e.tripDetails })
        : {}
    if (tripDetailsHasUsableMileage(td0)) return

    const dh = e.dispatchHeader
    if (!dh || typeof dh !== 'object') return
    const o = leadingDigitsFromOdLabel(dh.origin)
    const d = leadingDigitsFromOdLabel(dh.destination)
    if (!o || !d || !odPairKey(o, d)) return

    let donorSlice = null
    if (dir === 'older') {
      for (let sj = si - 1; sj >= 0; sj--) {
        const j = order[sj].i
        const older = result[j]
        if (!older || typeof older !== 'object') continue
        if (!ledgerEntryMatchesOd(older, o, d)) continue
        if (!tripDetailsHasUsableMileage(older.tripDetails)) continue
        donorSlice = mileageSliceFromPriorOdEntry(older)
        break
      }
    } else {
      for (let sj = si + 1; sj < order.length; sj++) {
        const j = order[sj].i
        const newer = result[j]
        if (!newer || typeof newer !== 'object') continue
        if (!ledgerEntryMatchesOd(newer, o, d)) continue
        if (!tripDetailsHasUsableMileage(newer.tripDetails)) continue
        if (mileageIsPriorOdCopy(newer.tripDetails)) continue
        donorSlice = mileageSliceFromPriorOdEntry(newer)
        break
      }
    }
    if (!donorSlice) return

    result[i] = {
      ...e,
      tripDetails: mergeTripDetailsMileage(td0, donorSlice),
    }
    changed = true
  }

  for (let si = 0; si < order.length; si++) fillFromNeighbor(si, 'older')
  for (let si = 0; si < order.length; si++) fillFromNeighbor(si, 'newer')

  return { ledger: result, changed }
}

/**
 * @param {unknown} label
 */
function leadingDigitsFromOdLabel(label) {
  if (label == null) return ''
  const m = /^(\d+)/.exec(String(label).trim())
  return m ? m[1] : ''
}

/**
 * @param {unknown} entry
 * @param {string} o
 * @param {string} d
 */
function ledgerEntryMatchesOd(entry, o, d) {
  const dh = entry?.dispatchHeader
  if (!dh || typeof dh !== 'object') return false
  const lo = leadingDigitsFromOdLabel(dh.origin)
  const ld = leadingDigitsFromOdLabel(dh.destination)
  return lo === o && ld === d
}

/**
 * Legacy migration: copy mileage from deprecated `odMileageCache` into ledger rows (same DB blob).
 * @param {unknown[]} ledger
 * @param {Record<string, unknown>} odCache
 */
function applyOdCacheToLedger(ledger, odCache) {
  if (!Array.isArray(ledger) || ledger.length === 0) return ledger
  if (!odCache || typeof odCache !== 'object') return ledger
  return ledger.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const dh = entry.dispatchHeader
    if (!dh || typeof dh !== 'object') return entry
    const lo = leadingDigitsFromOdLabel(dh.origin)
    const ld = leadingDigitsFromOdLabel(dh.destination)
    if (!lo || !ld) return entry
    const pk = odPairKey(lo, ld)
    if (!pk) return entry
    const cached = odCache[pk]
    if (
      !cached ||
      typeof cached !== 'object' ||
      Array.isArray(cached)
    ) {
      return entry
    }
    const td =
      entry.tripDetails && typeof entry.tripDetails === 'object'
        ? /** @type {Record<string, unknown>} */ ({ ...entry.tripDetails })
        : {}
    const existing =
      td.mileage && typeof td.mileage === 'object' && !Array.isArray(td.mileage)
        ? /** @type {Record<string, unknown>} */ (td.mileage)
        : {}
    if (
      typeof existing.totalMiles === 'string' &&
      existing.totalMiles.trim() !== ''
    ) {
      return entry
    }
    return {
      ...entry,
      tripDetails: mergeTripDetailsMileage(td, /** @type {Record<string, unknown>} */ (cached)),
    }
  })
}
/**
 * @param {unknown[]} ledger
 * @param {string} originId
 * @param {string} destId
 * @param {Record<string, unknown>} mileageObj
 */
function applyOdMileageToLedgerByPair(ledger, originId, destId, mileageObj) {
  const o = String(originId).trim()
  const d = String(destId).trim()
  return ledger.map((entry) => {
    if (!ledgerEntryMatchesOd(entry, o, d)) return entry
    const td =
      entry.tripDetails && typeof entry.tripDetails === 'object'
        ? /** @type {Record<string, unknown>} */ ({ ...entry.tripDetails })
        : {}
    return {
      ...entry,
      tripDetails: mergeTripDetailsMileage(td, mileageObj),
    }
  })
}

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
  /** @type {Record<string, unknown> | null} */
  const legacyOdCache =
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    raw.odMileageCache &&
    typeof raw.odMileageCache === 'object' &&
    !Array.isArray(raw.odMileageCache)
      ? /** @type {Record<string, unknown>} */ (raw.odMileageCache)
      : null
  if (legacyOdCache && Object.keys(legacyOdCache).length > 0) {
    n.tripHistoryLedger = applyOdCacheToLedger(n.tripHistoryLedger, legacyOdCache)
    await writeKeyJson(key, n)
  }
  const odBack = applyPriorOdMileageBackfill(n.tripHistoryLedger)
  if (odBack.changed) {
    n.tripHistoryLedger = odBack.ledger
    await writeKeyJson(key, n)
  }
  return n
}

/**
 * Read assignment for a specific account (no AsyncLocalStorage request context).
 * Used by background jobs (e.g. bridge notifications) keyed by last-active user.
 * @param {string} accountKey
 */
export async function readAssignmentForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return cloneDefault()
  const key = keyForUser(ak, 'assignment')
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
  } else if (typeof body.removeHiddenDailyTripLegSequence === 'string') {
    const one = body.removeHiddenDailyTripLegSequence.trim()
    if (/^\d+$/.test(one)) {
      hiddenDailyTripLegSequences = hiddenDailyTripLegSequences.filter((x) => String(x) !== one)
    }
  } else if (Array.isArray(body.removeHiddenDailyTripLegSequences)) {
    const drop = new Set(
      body.removeHiddenDailyTripLegSequences
        .map((x) => String(x).trim())
        .filter((s) => /^\d+$/.test(s)),
    )
    if (drop.size) {
      hiddenDailyTripLegSequences = hiddenDailyTripLegSequences.filter((x) => !drop.has(String(x)))
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
    const atComplete =
      typeof e.completedAt === 'number' && Number.isFinite(e.completedAt)
        ? e.completedAt
        : Date.now()
    const entry = {
      id,
      source,
      completedAt: atComplete,
      /** Same instant as completedAt for day grouping / display. */
      recordedAt: atComplete,
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
      const incomingAt =
        typeof e.recordedAt === 'number' && Number.isFinite(e.recordedAt)
          ? e.recordedAt
          : typeof e.completedAt === 'number' && Number.isFinite(e.completedAt)
            ? e.completedAt
            : Date.now()
      const existingForSeq = tripHistoryLedger.find(
        (x) => x && String(x.dailyTripLegSequence) === seq,
      )
      const existingForId =
        !existingForSeq && id
          ? tripHistoryLedger.find((x) => x && x.id === id)
          : null
      const prior = existingForSeq || existingForId
      const priorAt =
        prior && typeof prior.recordedAt === 'number' && Number.isFinite(prior.recordedAt) && prior.recordedAt > 0
          ? prior.recordedAt
          : prior &&
              typeof prior.completedAt === 'number' &&
              Number.isFinite(prior.completedAt) &&
              prior.completedAt > 0
            ? prior.completedAt
            : 0
      /** First-seen instant only — do not move forward on every Linehaul poll. */
      const at = priorAt > 0 ? priorAt : incomingAt
      const newDh =
        e.dispatchHeader && typeof e.dispatchHeader === 'object' ? e.dispatchHeader : {}
      const oldDh =
        prior && prior.dispatchHeader && typeof prior.dispatchHeader === 'object'
          ? prior.dispatchHeader
          : {}
      const mergedDispatchHeader = { ...oldDh, ...newDh }
      const newTd = e.tripDetails && typeof e.tripDetails === 'object' ? e.tripDetails : {}
      const oldTd = prior && prior.tripDetails && typeof prior.tripDetails === 'object' ? prior.tripDetails : {}
      const mergedTripDetails = { ...oldTd, ...newTd }
      const nextEntry = {
        id,
        source: typeof e.source === 'string' && e.source.trim() ? e.source.trim() : 'linehaul',
        /** API snapshots: first poll only; later polls must not change this. */
        recordedAt: at,
        completedAt: at,
        dailyTripLegSequence: seq,
        dispatchHeader: mergedDispatchHeader,
        tripDetails: mergedTripDetails,
      }
      const rest = tripHistoryLedger.filter(
        (x) => x && String(x.dailyTripLegSequence) !== seq && x.id !== id,
      )
      tripHistoryLedger = [nextEntry, ...rest].slice(0, MAX_TRIP_HISTORY)
    }
  } else if (body.applyOdMileageFromFetch && typeof body.applyOdMileageFromFetch === 'object') {
    const p = body.applyOdMileageFromFetch
    const oid = String(p.originId ?? '').trim()
    const did = String(p.destinationId ?? '').trim()
    const pk = odPairKey(oid, did)
    const rawBody = p.body
    const mileageObj = mileagePayloadFromApiBody(rawBody)
    if (pk && mileageObj) {
      tripHistoryLedger = applyOdMileageToLedgerByPair(
        tripHistoryLedger,
        oid,
        did,
        mileageObj,
      )
    }
  } else if (body.patchTripHistoryEntry && typeof body.patchTripHistoryEntry === 'object') {
    const p = body.patchTripHistoryEntry
    const seq = String(p.dailyTripLegSequence ?? '').trim()
    const out =
      typeof p.outcome === 'string' && TRIP_OUTCOMES.has(p.outcome.trim().toLowerCase())
        ? p.outcome.trim().toLowerCase()
        : 'none'
    if (/^\d+$/.test(seq)) {
      const at =
        typeof p.touchedAt === 'number' && Number.isFinite(p.touchedAt)
          ? p.touchedAt
          : Date.now()
      tripHistoryLedger = tripHistoryLedger
        .map((x) => {
          if (!x || String(x.dailyTripLegSequence) !== seq) return x
          const o = { ...x, outcome: out, outcomeTouchedAt: at }
          if (o.dispatchHeader && typeof o.dispatchHeader === 'object') {
            o.dispatchHeader = { ...o.dispatchHeader, historyOutcome: out, historyOutcomeAt: at }
          }
          return o
        })
        .slice(0, MAX_TRIP_HISTORY)
    }
  }

  const odFill = applyPriorOdMileageBackfill(tripHistoryLedger)
  tripHistoryLedger = odFill.ledger

  const instructionsTouched = 'instructions' in body
  const nextInstructions =
    typeof body.instructions === 'string' ? body.instructions : prev.instructions
  const instructionsChanged =
    instructionsTouched && String(nextInstructions ?? '') !== String(prev.instructions ?? '')

  const next = {
    instructions: nextInstructions,
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

  if ('persistedLinehaulTripSnapshot' in body) {
    const ak = getDataAccountKey()
    const nextSnap = next.persistedLinehaulTripSnapshot
    const prevSnap = prev.persistedLinehaulTripSnapshot
    if (
      ak &&
      nextSnap &&
      typeof nextSnap === 'object' &&
      !Array.isArray(nextSnap) &&
      (!prevSnap ||
        typeof prevSnap !== 'object' ||
        JSON.stringify(prevSnap) !== JSON.stringify(nextSnap))
    ) {
      const dir = inferTravelDirectionFromTripBody(nextSnap)
      if (dir === 'ToNY' || dir === 'ToNJ') {
        void publishInAppForAccount(ak, {
          type: 'info',
          message: `Trip leg updated — bridge alerts will follow ${dir === 'ToNY' ? 'NY-bound' : 'NJ-bound'} crossings`,
          source: 'dispatch',
          extra: { watchDir: dir },
        })
      }
    }
  }

  if (instructionsChanged) {
    const ak = getDataAccountKey()
    if (ak) {
      try {
        const n = String(nextInstructions ?? '').trim()
        const r = await publishInAppForAccount(ak, {
          type: 'assignment',
          message: n
            ? 'Dispatch instructions were updated'
            : 'Dispatch instructions were cleared',
          source: 'dispatch',
          extra: { hint: n ? n.slice(0, 200) : '' },
        })
        if (!r?.item) {
          emitLog('assignment', 'Dispatch instructions updated (in-app notify skipped)', {
            source: 'save',
          })
        }
      } catch {
        /* still emit legacy assignment log for refresh */
      }
    }
    emitLog('assignment', 'Dispatch instructions updated', { source: 'save' })
  }

  return next
}
