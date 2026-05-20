import { ref, computed } from 'vue'
import {
  fetchFedexLinehaulTractor,
  fetchFedexLinehaulDriver,
  fetchFedexLinehaulTripStatus,
  fetchFedexLinehaulTrips,
  getCredentials,
  getAssignment,
  putAssignment,
  postLinehaulCaptureBearer,
  syncDollyFromLinehaul,
  fetchFedexLinehaulViewTripInfoDetails,
} from '../api.js'
import { applyHelpersLocationPrefsFromCredentials } from '../utils/helpersLocationPrefs.js'
import { pushLiveLog } from './liveLogStore.js'
import {
  buildHistoryDispatchHeaderFromBody,
  buildHistoryTripDetailsFromBody,
} from '../utils/tripHistorySnapshot.js'
import {
  extractOriginDest,
  extractTripDispatchInstructions,
  extractTripOrgIds,
} from '../utils/tripDetailsDisplay.js'

/**
 * ============================================================================
 * STABLE TRIP STATE - Gated state object for Trip/Dispatch data
 * ============================================================================
 * API responses flow through logic gates before updating this object.
 * This guarantees:
 * - Trailers/dolly never cleared by sparse DSPCH responses
 * - Watchers only fire when data actually changes
 * - History always receives complete data
 */
export const stableTripState = ref({
  dailyTripLegSequence: null,
  tripStatus: '',
  origin: { number: '', name: '', abbrv: '', display: '—' },
  destination: { number: '', name: '', abbrv: '', display: '—' },
  trailers: [],
  dolly: { number1: '', number2: '', seq1: '', seq2: '' },
  tractorNumber: '',
  instructions: '',
  _fingerprint: '',
  _lastUpdatedAt: null,
  _updateReason: '',
})

/** Raw API body for debugging - UI should read from stableTripState instead */
export const _rawApiBody = ref(null)

/** Last fingerprint used in processApiResponse - prevents re-processing identical data */
let _lastProcessedFingerprint = ''

/**
 * Compute stable fingerprint for change detection.
 * Captures meaningful fields, ignores timestamps and whitespace.
 * @param {unknown} body
 * @returns {string}
 */
function computeTripFingerprint(body) {
  if (!body || typeof body !== 'object') return 'empty'
  const b = /** @type {Record<string, unknown>} */ (body)

  const seq = String(b.dailyTripLegSequence ?? '')
  const status = String(b.tripStatus ?? '').toUpperCase()
  const dest = String(b.tripDestNumber ?? '')
  const origin = String(b.currentLocationNumber ?? b.originLocation ?? '')

  const trailers = Array.isArray(b.trailers) ? b.trailers : []
  const trailerFp = trailers
    .map((t) => {
      const tr = t && typeof t === 'object' ? /** @type {Record<string, unknown>} */ (t) : {}
      return `${tr.trlrNbr ?? ''}:${tr.sealNumber ?? ''}:${tr.pkgWeight ?? ''}:${tr.detlCodeLoadStatus ?? ''}`
    })
    .sort()
    .join('|')

  const dollyFp = `${b.dollyNumber1 ?? ''}:${b.dollyNumber2 ?? ''}`

  const instrFp = String(b.dispatchInstructions ?? b.specialInstructions ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 100)

  return `${seq}||${status}||${origin}->${dest}||${trailerFp}||${dollyFp}||${instrFp}`
}

/**
 * Compute fingerprint from stableTripState format
 * @param {typeof stableTripState.value} state
 * @returns {string}
 */
function computeStateFingerprint(state) {
  const trailerFp = (state.trailers || [])
    .map((t) => {
      const tr = t && typeof t === 'object' ? /** @type {Record<string, unknown>} */ (t) : {}
      return `${tr.trlrNbr ?? ''}:${tr.sealNumber ?? ''}:${tr.pkgWeight ?? ''}:${tr.detlCodeLoadStatus ?? ''}`
    })
    .sort()
    .join('|')

  const dollyFp = `${state.dolly?.number1 ?? ''}:${state.dolly?.number2 ?? ''}`

  return `${state.dailyTripLegSequence ?? ''}||${state.tripStatus}||${state.origin?.number ?? ''}->${state.destination?.number ?? ''}||${trailerFp}||${dollyFp}||${state.instructions?.trim().toLowerCase().slice(0, 100) ?? ''}`
}

/**
 * Score trailer array richness (for comparing data quality)
 * @param {unknown[]} trailers
 * @returns {number}
 */
function scoreTrailerRichness(trailers) {
  let score = 0
  for (const t of trailers) {
    if (!t || typeof t !== 'object') continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    if (tr.sealNumber) score += 3
    if (tr.pkgWeight != null && tr.pkgWeight !== '') score += 2
    if (tr.latitude != null && tr.longitude != null) score += 2
    if (tr.loadDestNumber) score += 1
    if (tr.dueDate) score += 1
    if (tr.trlrNbr) score += 1
  }
  return score
}

/**
 * Merge trailers by trlrNbr, keeping richer data from each source
 * @param {unknown[]} current
 * @param {unknown[]} incoming
 * @returns {unknown[]}
 */
function mergeTrailersByNbr(current, incoming) {
  const map = new Map()

  for (const t of current) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    const key = String(tr.trlrNbr ?? '')
    if (key) map.set(key, { ...tr })
  }

  for (const t of incoming) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    const tr = /** @type {Record<string, unknown>} */ (t)
    const key = String(tr.trlrNbr ?? '')
    if (!key) continue

    const existing = map.get(key)
    if (existing) {
      for (const [k, v] of Object.entries(tr)) {
        if (v !== null && v !== undefined && v !== '') {
          existing[k] = v
        }
      }
    } else {
      map.set(key, { ...tr })
    }
  }

  return Array.from(map.values())
}

/**
 * TRAILER GATE - Core preservation logic
 * @param {unknown} incoming
 * @param {unknown[]} current
 * @returns {{ update: boolean, value: unknown[], reason: string }}
 */
function gateTrailers(incoming, current) {
  const inc = Array.isArray(incoming) ? incoming : []
  const cur = Array.isArray(current) ? current : []

  if (inc.length === 0) {
    return { update: false, value: cur, reason: 'preserve_existing' }
  }

  if (cur.length === 0) {
    return { update: true, value: inc, reason: 'first_data' }
  }

  const incNbrs = new Set(inc.map((t) => String(/** @type {Record<string, unknown>} */ (t)?.trlrNbr ?? '')).filter(Boolean))
  const curNbrs = new Set(cur.map((t) => String(/** @type {Record<string, unknown>} */ (t)?.trlrNbr ?? '')).filter(Boolean))
  const sameTrailers = incNbrs.size === curNbrs.size && [...incNbrs].every((n) => curNbrs.has(n))

  if (sameTrailers) {
    const merged = mergeTrailersByNbr(cur, inc)
    // Always update with merged data - allows field changes (like detlCodeLoadStatus)
    // to flow through even when richness score doesn't improve
    return { update: true, value: merged, reason: 'same_trailers_merged' }
  }

  return { update: true, value: inc, reason: 'new_trailers' }
}

/**
 * DOLLY GATE
 * @param {unknown} incoming
 * @param {{ number1: string, number2: string, seq1: string, seq2: string }} current
 * @returns {{ update: boolean, value?: { number1: string, number2: string, seq1: string, seq2: string }, reason: string }}
 */
function gateDolly(incoming, current) {
  if (!incoming || typeof incoming !== 'object') {
    return { update: false, reason: 'no_incoming' }
  }
  const inc = /** @type {Record<string, unknown>} */ (incoming)
  const inc1 = String(inc.dollyNumber1 ?? '').trim()
  const inc2 = String(inc.dollyNumber2 ?? '').trim()
  const incHas = Boolean(inc1 || inc2)

  const curHas = Boolean(current.number1 || current.number2)

  if (!incHas && curHas) {
    return { update: false, reason: 'preserve_existing' }
  }

  if (incHas) {
    const newDolly = {
      number1: inc1,
      number2: inc2,
      seq1: String(inc.dollyEquipmentSequence1 ?? '').trim(),
      seq2: String(inc.dollyEquipmentSequence2 ?? '').trim(),
    }
    if (newDolly.number1 !== current.number1 || newDolly.number2 !== current.number2) {
      return { update: true, value: newDolly, reason: 'new_dolly' }
    }
  }

  return { update: false, reason: 'no_change' }
}

/**
 * ROUTE GATE - Origin/Destination
 * @param {unknown} incoming
 * @param {typeof stableTripState.value} prev
 * @returns {{ updateOrigin: boolean, updateDestination: boolean, origin?: typeof prev.origin, destination?: typeof prev.destination }}
 */
function gateRoute(incoming, prev) {
  const result = { updateOrigin: false, updateDestination: false }
  if (!incoming || typeof incoming !== 'object') return result

  const inc = /** @type {Record<string, unknown>} */ (incoming)
  const incOriginNum = String(inc.currentLocationNumber ?? inc.originLocation ?? '').trim()
  const incOriginName = String(inc.currentLocationName ?? inc.currentLocationAbbrv ?? '').trim()
  const incDestNum = String(inc.tripDestNumber ?? '').trim()
  const incDestName = String(inc.tripDest ?? inc.tripDestAbbrv ?? '').trim()

  if (incOriginNum && incOriginNum !== prev.origin.number) {
    result.updateOrigin = true
    result.origin = {
      number: incOriginNum,
      name: incOriginName,
      abbrv: String(inc.currentLocationAbbrv ?? '').trim(),
      display: incOriginName ? `${incOriginNum} · ${incOriginName}` : incOriginNum,
    }
  } else if (!prev.origin.name && incOriginName && prev.origin.number) {
    result.updateOrigin = true
    result.origin = {
      ...prev.origin,
      name: incOriginName,
      abbrv: String(inc.currentLocationAbbrv ?? '').trim() || prev.origin.abbrv,
      display: `${prev.origin.number} · ${incOriginName}`,
    }
  }

  if (incDestNum && incDestNum !== prev.destination.number) {
    result.updateDestination = true
    result.destination = {
      number: incDestNum,
      name: incDestName,
      abbrv: String(inc.tripDestAbbrv ?? '').trim(),
      display: incDestName ? `${incDestNum} · ${incDestName}` : incDestNum,
    }
  } else if (!prev.destination.name && incDestName && prev.destination.number) {
    result.updateDestination = true
    result.destination = {
      ...prev.destination,
      name: incDestName,
      abbrv: String(inc.tripDestAbbrv ?? '').trim() || prev.destination.abbrv,
      display: `${prev.destination.number} · ${incDestName}`,
    }
  }

  return result
}

/**
 * INSTRUCTIONS GATE - Merge assignment + API, detect actual changes
 * @param {unknown} incoming
 * @param {string} assignmentInstructions
 * @param {string} current
 * @returns {{ update: boolean, value?: string }}
 */
function gateInstructions(incoming, assignmentInstructions, current) {
  const fromApi = extractTripDispatchInstructions(incoming)
  const fromAssign = String(assignmentInstructions ?? '').trim()

  let merged = ''
  if (fromAssign && fromApi) {
    merged = `${fromAssign}\n\n${fromApi}`
  } else {
    merged = fromAssign || fromApi
  }

  const normalizedMerged = merged.replace(/\s+/g, ' ').trim()
  const normalizedCurrent = current.replace(/\s+/g, ' ').trim()

  if (normalizedMerged !== normalizedCurrent) {
    return { update: true, value: merged }
  }

  return { update: false }
}

/**
 * @param {unknown} body
 * @returns {string | null}
 */
function _tripBodyDailySeq(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null
  const s = /** @type {Record<string, unknown>} */ (body).dailyTripLegSequence
  if (s == null) return null
  const str = String(s).trim()
  return /^\d+$/.test(str) ? str : null
}

/**
 * MASTER GATE: Process API response and update stableTripState
 * @param {Record<string, unknown> | null} mergedApiBody
 * @param {string} assignmentInstructions
 * @param {{ prePlanSnapshot: unknown, hiddenSequences: string[] }} context
 * @returns {{ changed: boolean, reason: string }}
 */
function processApiResponse(mergedApiBody, assignmentInstructions, context) {
  _rawApiBody.value = mergedApiBody

  if (!mergedApiBody || typeof mergedApiBody !== 'object') {
    return { changed: false, reason: 'no_api_body' }
  }

  const incSeq = _tripBodyDailySeq(mergedApiBody)
  const hidden = new Set(
    (Array.isArray(context.hiddenSequences) ? context.hiddenSequences : [])
      .map((s) => String(s).trim())
      .filter((s) => /^\d+$/.test(s)),
  )
  if (incSeq && hidden.has(incSeq)) {
    return { changed: false, reason: 'seq_hidden_from_home' }
  }

  const incomingFp = computeTripFingerprint(mergedApiBody)
  if (incomingFp === _lastProcessedFingerprint && incomingFp !== 'empty') {
    return { changed: false, reason: 'identical_fingerprint' }
  }

  const prev = stableTripState.value
  const next = { ...prev }
  const updates = []

  const prePlanSeq = _tripBodyDailySeq(context.prePlanSnapshot)

  if (prePlanSeq && incSeq === prePlanSeq) {
    return { changed: false, reason: 'incoming_is_preplan' }
  }

  if (incSeq && incSeq !== prev.dailyTripLegSequence) {
    const isNewTrip = prev.dailyTripLegSequence && incSeq !== prev.dailyTripLegSequence
    next.dailyTripLegSequence = incSeq
    updates.push('sequence')

    if (isNewTrip) {
      next.trailers = []
      next.dolly = { number1: '', number2: '', seq1: '', seq2: '' }
      next.origin = { number: '', name: '', abbrv: '', display: '—' }
      next.destination = { number: '', name: '', abbrv: '', display: '—' }
      updates.push('reset_for_new_trip')
    }
  }

  const incStatus = String(mergedApiBody.tripStatus ?? '').trim().toUpperCase()
  if (incStatus && incStatus !== prev.tripStatus) {
    next.tripStatus = incStatus
    updates.push('status')
  }

  const trailerGate = gateTrailers(mergedApiBody.trailers, prev.trailers)
  if (trailerGate.update) {
    next.trailers = trailerGate.value
    updates.push(`trailers:${trailerGate.reason}`)
  }

  const dollyGate = gateDolly(mergedApiBody, prev.dolly)
  if (dollyGate.update && dollyGate.value) {
    next.dolly = dollyGate.value
    updates.push(`dolly:${dollyGate.reason}`)
  }

  const routeGate = gateRoute(mergedApiBody, prev)
  if (routeGate.updateOrigin && routeGate.origin) {
    next.origin = routeGate.origin
    updates.push('origin')
  }
  if (routeGate.updateDestination && routeGate.destination) {
    next.destination = routeGate.destination
    updates.push('destination')
  }

  const instrGate = gateInstructions(mergedApiBody, assignmentInstructions, prev.instructions)
  if (instrGate.update && instrGate.value !== undefined) {
    next.instructions = instrGate.value
    updates.push('instructions')
  }

  const incTractor = String(mergedApiBody.tractorNumber ?? '').trim()
  if (incTractor && incTractor !== prev.tractorNumber) {
    next.tractorNumber = incTractor
    updates.push('tractor')
  }

  if (updates.length > 0) {
    next._fingerprint = computeStateFingerprint(next)
    next._lastUpdatedAt = Date.now()
    next._updateReason = updates.join(', ')
    stableTripState.value = next
    _lastProcessedFingerprint = incomingFp
    return { changed: true, reason: next._updateReason }
  }

  _lastProcessedFingerprint = incomingFp
  return { changed: false, reason: 'no_updates_passed_gates' }
}

/**
 * Reset stableTripState to initial values
 */
function resetStableTripState() {
  stableTripState.value = {
    dailyTripLegSequence: null,
    tripStatus: '',
    origin: { number: '', name: '', abbrv: '', display: '—' },
    destination: { number: '', name: '', abbrv: '', display: '—' },
    trailers: [],
    dolly: { number1: '', number2: '', seq1: '', seq2: '' },
    tractorNumber: '',
    instructions: '',
    _fingerprint: '',
    _lastUpdatedAt: null,
    _updateReason: '',
  }
  _rawApiBody.value = null
  _lastProcessedFingerprint = ''
}

/**
 * HISTORY GATE - Determines if trip should be stored in history
 * @param {typeof stableTripState.value} tripState
 * @param {{ prePlanSnapshot: unknown, tripPhase: string }} context
 * @returns {{ allow: boolean, reason: string }}
 */
function shouldUpsertToHistory(tripState, context) {
  const { prePlanSnapshot, tripPhase } = context

  if (tripPhase === 'none') {
    return { allow: false, reason: 'trip_phase_none' }
  }

  const seq = tripState.dailyTripLegSequence
  if (!seq || !/^\d+$/.test(seq)) {
    return { allow: false, reason: 'invalid_sequence' }
  }

  const prePlanSeq = _tripBodyDailySeq(prePlanSnapshot)
  if (prePlanSeq && seq === prePlanSeq) {
    return { allow: false, reason: 'is_preplan' }
  }

  const hasTrailers = Boolean(tripState.trailers?.length)
  const hasDest = Boolean(String(tripState.destination?.number ?? '').trim())
  const hasOrigin = Boolean(String(tripState.origin?.number ?? '').trim())
  const hasInstr = Boolean(String(tripState.instructions ?? '').trim())
  if (!hasTrailers && !hasDest && !hasOrigin && !hasInstr) {
    return { allow: false, reason: 'insufficient_data' }
  }

  return { allow: true, reason: 'passed_all_gates' }
}

/** History upsert queue - ensures serial execution */
let _historyUpsertQueue = Promise.resolve()
let _historyUpsertPending = null
let _historyUpsertTimer = null
const HISTORY_UPSERT_DEBOUNCE_MS = 1500

/** Prior poll: `tripPhase === 'dispatched'` per leg seq (first false→true sets pendingDispatchedAtMsBySeq). */
const prevDispatchSignalBySeq = new Map()
/** First dispatch instant (ms) to send on next successful history upsert for that leg. */
const pendingDispatchedAtMsBySeq = new Map()

/**
 * After Linehaul poll updates stable state, record first transition to dispatched for pay mileage.
 */
function noteFirstDispatchEdgeForActiveLeg() {
  const seqD = String(stableTripState.value.dailyTripLegSequence ?? '').trim()
  if (!/^\d+$/.test(seqD)) return
  const cur = tripPhase.value === 'dispatched'
  const prev = prevDispatchSignalBySeq.get(seqD) === true
  prevDispatchSignalBySeq.set(seqD, cur)
  if (cur && !prev) {
    pendingDispatchedAtMsBySeq.set(seqD, Date.now())
  }
}

/**
 * Schedule a history upsert (debounced, serialized)
 * @param {typeof stableTripState.value} tripState
 * @param {string} assignmentInstructions
 */
function scheduleHistoryUpsert(tripState, assignmentInstructions) {
  const fp = computeStateFingerprint(tripState)

  if (fp === lastHistoryUpsertOkFingerprint) return

  _historyUpsertPending = { tripState: { ...tripState }, fingerprint: fp, assignmentInstructions }

  if (_historyUpsertTimer) clearTimeout(_historyUpsertTimer)
  _historyUpsertTimer = setTimeout(() => {
    const pending = _historyUpsertPending
    _historyUpsertPending = null
    _historyUpsertTimer = null

    if (!pending) return

    _historyUpsertQueue = _historyUpsertQueue
      .then(() => executeHistoryUpsert(pending.tripState, pending.fingerprint, pending.assignmentInstructions))
      .catch(() => {})
  }, HISTORY_UPSERT_DEBOUNCE_MS)
}

/**
 * Merge the live Linehaul trip JSON (when the active leg matches) with gated stable fields
 * so history snapshots retain TMS-style fields (abbrv., TMS ref, ETA-like keys) for trip-form PDFs.
 * @param {typeof stableTripState.value} tripState
 * @returns {Record<string, unknown>}
 */
function buildLedgerSnapBodyForHistoryUpsert(tripState) {
  const seq = String(tripState.dailyTripLegSequence ?? '').trim()
  const raw = linehaulTripsBody.value
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && _tripBodyDailySeq(raw) === seq) {
    const merged = { .../** @type {Record<string, unknown>} */ (raw) }
    if (Array.isArray(tripState.trailers) && tripState.trailers.length > 0) {
      merged.trailers = tripState.trailers
    }
    merged.dollyNumber1 = tripState.dolly?.number1 ?? merged.dollyNumber1
    merged.dollyNumber2 = tripState.dolly?.number2 ?? merged.dollyNumber2
    merged.dollyEquipmentSequence1 = tripState.dolly?.seq1 ?? merged.dollyEquipmentSequence1
    merged.dollyEquipmentSequence2 = tripState.dolly?.seq2 ?? merged.dollyEquipmentSequence2
    merged.tractorNumber = tripState.tractorNumber || merged.tractorNumber
    merged.tripStatus = tripState.tripStatus || merged.tripStatus
    merged.currentLocationNumber = tripState.origin?.number || merged.currentLocationNumber
    merged.currentLocationName = tripState.origin?.name || merged.currentLocationName
    merged.currentLocationAbbrv = tripState.origin?.abbrv || merged.currentLocationAbbrv
    merged.tripDestNumber = tripState.destination?.number || merged.tripDestNumber
    merged.tripDest = tripState.destination?.name || merged.tripDest
    merged.tripDestAbbrv = tripState.destination?.abbrv || merged.tripDestAbbrv
    merged.dailyTripLegSequence = seq
    return merged
  }
  return {
    dailyTripLegSequence: seq,
    tripStatus: tripState.tripStatus,
    trailers: tripState.trailers,
    dollyNumber1: tripState.dolly?.number1,
    dollyNumber2: tripState.dolly?.number2,
    dollyEquipmentSequence1: tripState.dolly?.seq1,
    dollyEquipmentSequence2: tripState.dolly?.seq2,
    currentLocationNumber: tripState.origin?.number,
    currentLocationName: tripState.origin?.name,
    currentLocationAbbrv: tripState.origin?.abbrv,
    tripDestNumber: tripState.destination?.number,
    tripDest: tripState.destination?.name,
    tripDestAbbrv: tripState.destination?.abbrv,
    tractorNumber: tripState.tractorNumber,
  }
}

/**
 * Execute history upsert
 * @param {typeof stableTripState.value} tripState
 * @param {string} fingerprint
 * @param {string} assignmentInstructions
 */
async function executeHistoryUpsert(tripState, fingerprint, assignmentInstructions) {
  if (fingerprint === lastHistoryUpsertOkFingerprint) return

  const seqStr = String(seq).trim()
  if (!/^\d+$/.test(seqStr)) return

  const snapBody = buildLedgerSnapBodyForHistoryUpsert(tripState)

  const pendingD = pendingDispatchedAtMsBySeq.get(seqStr)
  /** @type {Record<string, unknown>} */
  const upsert = {
    id: `h-${seqStr}`,
    source: 'linehaul',
    dailyTripLegSequence: seqStr,
    recordedAt: Date.now(),
    dispatchHeader: buildHistoryDispatchHeaderFromBody(snapBody, {
      source: 'linehaul',
      instructions: tripState.instructions,
      instructionsFinal: true,
    }),
    tripDetails: buildHistoryTripDetailsFromBody(snapBody),
  }
  if (pendingD != null && Number.isFinite(pendingD) && pendingD > 0) {
    upsert.dispatchedAtMs = pendingD
  }

  try {
    await putAssignment({
      upsertTripHistoryEntry: upsert,
    })
    lastHistoryUpsertOkFingerprint = fingerprint
    pendingDispatchedAtMsBySeq.delete(seqStr)
  } catch {
    /* offline / 401: retry on next refresh */
  }
}

export const linehaulTractorBody = ref(null)
export const linehaulDriverBody = ref(null)
export const linehaulTractorError = ref(null)
export const linehaulDriverError = ref(null)
export const linehaulTripReadyBody = ref(null)
export const linehaulTripReadyError = ref(null)
export const linehaulTripsBody = ref(null)
export const linehaulTripsError = ref(null)
/** FedEx returned HTTP 204 — no trip payload (not an error). */
export const linehaulTripsNoActive = ref(false)
/** Last `dailyTripLegSequence` seen from any successful trip payload (for dispatch-era refetch). */
export const lastDailyTripLegSequence = ref(null)
export const linehaulLastFetchAt = ref(null)
export const linehaulFetching = ref(false)
/** True while Playwright bearer capture runs after FedEx 401/403 (avoid flashing errors in cards). */
export const linehaulAuthRecoveryInProgress = ref(false)

/** Cached full trip snapshot (from APRVD) with trailer details for persistence after dispatch. */
export const cachedTripSnapshot = ref(null)
/** Pre-plan trip: a second APRVD trip with different dailyTripLegSequence while current trip exists. */
export const prePlanTripSnapshot = ref(null)
/** User-marked completed trip leg sequences (persisted server-side; hide matching API data). */
export const hiddenDailyTripLegSequences = ref(/** @type {string[]} */ ([]))
/** Previous driver availability status to detect ENRT→ACT transition. */
let prevDriverAvlStat = null

/**
 * Fingerprint of the last *successful* history upsert for the active leg — avoids
 * duplicate PUTs on every poll, but still retries after failures and re-syncs when
 * route / trip data / instructions change.
 */
let lastHistoryUpsertOkFingerprint = null

/** Last successful mileage fetch per active leg (avoid duplicate Apigee calls). */
let lastTripMileageOkKey = ''

/** Clear in-memory trip state (call on sign-out; hidden seq comes from getAssignment on next sign-in). */
export function resetLinehaulSession() {
  linehaulTractorBody.value = null
  linehaulDriverBody.value = null
  linehaulTractorError.value = null
  linehaulDriverError.value = null
  linehaulTripReadyBody.value = null
  linehaulTripReadyError.value = null
  linehaulTripsBody.value = null
  linehaulTripsError.value = null
  linehaulTripsNoActive.value = false
  lastDailyTripLegSequence.value = null
  linehaulLastFetchAt.value = null
  linehaulAuthRecoveryInProgress.value = false
  cachedTripSnapshot.value = null
  prePlanTripSnapshot.value = null
  hiddenDailyTripLegSequences.value = []
  lastHistoryUpsertOkFingerprint = null
  prevDriverAvlStat = null
  lastTripMileageOkKey = ''
  prevDispatchSignalBySeq.clear()
  pendingDispatchedAtMsBySeq.clear()
  resetStableTripState()
  if (_historyUpsertTimer) {
    clearTimeout(_historyUpsertTimer)
    _historyUpsertTimer = null
  }
  _historyUpsertPending = null
  if (persistTripDebounceTimer) {
    clearTimeout(persistTripDebounceTimer)
    persistTripDebounceTimer = null
  }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let persistTripDebounceTimer = null
const PERSIST_TRIP_DEBOUNCE_MS = 900

async function persistLinehaulTripSnapshotsNow() {
  try {
    await putAssignment({
      persistedLinehaulTripSnapshot: linehaulTripsBody.value,
      persistedPrePlanTripSnapshot: prePlanTripSnapshot.value,
      persistedCachedTripSnapshot: cachedTripSnapshot.value,
      lastDailyTripLegSequencePersisted: lastDailyTripLegSequence.value,
    })
  } catch {
    /* offline or auth */
  }
}

function schedulePersistLinehaulTripSnapshots() {
  if (persistTripDebounceTimer) clearTimeout(persistTripDebounceTimer)
  persistTripDebounceTimer = setTimeout(() => {
    persistTripDebounceTimer = null
    void persistLinehaulTripSnapshotsNow()
  }, PERSIST_TRIP_DEBOUNCE_MS)
}

function applyHiddenTripFilter() {
  const hidden = new Set(
    hiddenDailyTripLegSequences.value.map((s) => String(s).trim()).filter(Boolean),
  )
  if (!hidden.size) return
  let needPersist = false
  const stSeq = String(stableTripState.value.dailyTripLegSequence ?? '').trim()
  if (stSeq && /^\d+$/.test(stSeq) && hidden.has(stSeq)) {
    resetStableTripState()
    needPersist = true
  }
  const cur = linehaulTripsBody.value
  const seqCur = tripBodyDailySeq(cur)
  if (seqCur && hidden.has(seqCur)) {
    linehaulTripsBody.value = null
    linehaulTripsNoActive.value = true
    needPersist = true
  }
  const pre = prePlanTripSnapshot.value
  const seqPre = tripBodyDailySeq(pre)
  if (seqPre && hidden.has(seqPre)) {
    prePlanTripSnapshot.value = null
    needPersist = true
  }
  const c = cachedTripSnapshot.value
  const seqC = tripBodyDailySeq(c)
  if (seqC && hidden.has(seqC)) {
    cachedTripSnapshot.value = null
    needPersist = true
  }
  const lp = lastDailyTripLegSequence.value
  if (lp != null && /^\d+$/.test(String(lp)) && hidden.has(String(lp).trim())) {
    lastDailyTripLegSequence.value = null
    needPersist = true
  }
  if (needPersist) {
    void persistLinehaulTripSnapshotsNow()
  }
}

/**
 * Resolve trip payload for history when completing or backfilling a leg.
 * @param {string} seq
 * @returns {Record<string, unknown> | null}
 */
function snapBodyForHistoryLeg(seq) {
  const want = String(seq).trim()
  if (!/^\d+$/.test(want)) return null
  const candidates = [
    linehaulTripsBody.value,
    cachedTripSnapshot.value,
    prePlanTripSnapshot.value,
  ]
  for (const b of candidates) {
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (tripBodyDailySeq(b) === want) {
        return { .../** @type {Record<string, unknown>} */ (b) }
      }
    }
  }
  const st = stableTripState.value
  if (String(st.dailyTripLegSequence ?? '').trim() === want) {
    return {
      dailyTripLegSequence: want,
      tripStatus: st.tripStatus,
      trailers: st.trailers,
      dollyNumber1: st.dolly?.number1,
      dollyNumber2: st.dolly?.number2,
      dollyEquipmentSequence1: st.dolly?.seq1,
      dollyEquipmentSequence2: st.dolly?.seq2,
      currentLocationNumber: st.origin?.number,
      currentLocationName: st.origin?.name,
      tripDestNumber: st.destination?.number,
      tripDest: st.destination?.name,
      tractorNumber: st.tractorNumber,
    }
  }
  return null
}

/**
 * User completed trip — persist hidden seq, ledger row marked delivered, and clear matching UI state.
 * @param {string} dailyTripLegSequence
 */
export async function markTripLegSequenceCompleted(dailyTripLegSequence) {
  const seq = String(dailyTripLegSequence ?? '').trim()
  if (!/^\d+$/.test(seq)) return
  const now = Date.now()
  const snapBody = snapBodyForHistoryLeg(seq)
  const instr =
    typeof stableTripState.value.instructions === 'string'
      ? stableTripState.value.instructions.trim()
      : ''

  /** @type {Record<string, unknown>} */
  const upsertTripHistoryEntry = snapBody
    ? {
        id: `h-${seq}`,
        source: 'linehaul',
        dailyTripLegSequence: seq,
        recordedAt: now,
        completedAt: now,
        dispatchHeader: {
          ...buildHistoryDispatchHeaderFromBody(snapBody, {
            source: 'linehaul',
            instructions: instr,
            instructionsFinal: true,
          }),
          historyOutcome: 'delivered',
          historyOutcomeAt: now,
        },
        tripDetails: buildHistoryTripDetailsFromBody(snapBody),
      }
    : {
        id: `h-${seq}`,
        source: 'linehaul',
        dailyTripLegSequence: seq,
        recordedAt: now,
        completedAt: now,
        dispatchHeader: {
          source: 'linehaul',
          tripStatusText: '—',
          tripStatusKind: 'linehaul',
          origin: '—',
          destination: '—',
          instructions: '',
          historyOutcome: 'delivered',
          historyOutcomeAt: now,
        },
        tripDetails: {},
      }

  const body = {
    appendHiddenDailyTripLegSequence: seq,
    upsertTripHistoryEntry,
  }
  const a = await putAssignment(body)
  hiddenDailyTripLegSequences.value = Array.isArray(a.hiddenDailyTripLegSequences)
    ? a.hiddenDailyTripLegSequences.map(String)
    : []
  applyHiddenTripFilter()
  await persistLinehaulTripSnapshotsNow()
}

/**
 * Ledger rows marked delivered — keep hidden-from-home even when FedEx still lists the leg.
 * @param {unknown[]} ledger
 * @returns {Set<string>}
 */
function deliveredSeqSetFromLedger(ledger) {
  const set = new Set()
  if (!Array.isArray(ledger)) return set
  for (const x of ledger) {
    if (!x || typeof x !== 'object') continue
    const seq = String(x.dailyTripLegSequence ?? '').trim()
    if (!/^\d+$/.test(seq)) continue
    const raw = /** @type {Record<string, unknown>} */ (x)
    const fromOutcome =
      typeof raw.outcome === 'string' ? raw.outcome.trim().toLowerCase() : ''
    const dh = raw.dispatchHeader
    const fromDh =
      dh && typeof dh === 'object'
        ? String(/** @type {Record<string, unknown>} */ (dh).historyOutcome ?? '')
            .trim()
            .toLowerCase()
        : ''
    if (fromOutcome === 'delivered' || fromDh === 'delivered') set.add(seq)
  }
  return set
}

/**
 * FedEx still reports this leg — remove it from the hidden list so Home shows the assignment again.
 * Does not unhide legs the user marked delivered (manual trip complete).
 * @param {string[]} dailyTripLegSequences
 * @param {unknown[]} [tripHistoryLedger]
 */
export async function unhideTripLegSequencesIfHidden(dailyTripLegSequences, tripHistoryLedger = []) {
  const raw = Array.isArray(dailyTripLegSequences) ? dailyTripLegSequences : []
  const want = new Set(
    raw.map((x) => String(x).trim()).filter((s) => /^\d+$/.test(s)),
  )
  if (!want.size) return
  const hidden = new Set(
    hiddenDailyTripLegSequences.value.map((s) => String(s).trim()).filter(Boolean),
  )
  const delivered = deliveredSeqSetFromLedger(tripHistoryLedger)
  const toRemove = [...want].filter((s) => hidden.has(s) && !delivered.has(s))
  if (!toRemove.length) return
  try {
    const a = await putAssignment({
      removeHiddenDailyTripLegSequences: toRemove,
    })
    hiddenDailyTripLegSequences.value = Array.isArray(a.hiddenDailyTripLegSequences)
      ? a.hiddenDailyTripLegSequences.map(String)
      : []
    applyHiddenTripFilter()
    await persistLinehaulTripSnapshotsNow()
  } catch {
    /* offline */
  }
}

/**
 * Hydrate trip UI from server-stored JSON (another device may have saved it).
 * @param {Record<string, unknown>} assign
 */
function hydrateTripSnapshotsFromAssignment(assign) {
  if (!assign || typeof assign !== 'object') return
  /** Do not re-apply a snapshot for a leg the user marked complete (DB may still hold stale JSON). */
  const hidden = new Set(
    (Array.isArray(assign.hiddenDailyTripLegSequences)
      ? assign.hiddenDailyTripLegSequences
      : []
    )
      .map((s) => String(s).trim())
      .filter((s) => /^\d+$/.test(s)),
  )
  const merged = assign.persistedLinehaulTripSnapshot
  if (merged != null && typeof merged === 'object' && !Array.isArray(merged)) {
    const pSeq = tripBodyDailySeq(merged)
    if (pSeq && hidden.has(pSeq)) {
      /* skip */
    } else {
      const curSeq = tripBodyDailySeq(linehaulTripsBody.value)
      const canApply =
        linehaulTripsBody.value == null ||
        (Boolean(pSeq) && Boolean(curSeq) && pSeq === curSeq)
      if (canApply) {
        linehaulTripsBody.value = /** @type {Record<string, unknown>} */ (merged)
        linehaulTripsNoActive.value = false
        linehaulTripsError.value = null
      }
    }
  }
  const pre = assign.persistedPrePlanTripSnapshot
  if (pre != null && typeof pre === 'object' && !Array.isArray(pre)) {
    const s = tripBodyDailySeq(/** @type {Record<string, unknown>} */ (pre))
    if (s && hidden.has(s)) {
      prePlanTripSnapshot.value = null
    } else {
      prePlanTripSnapshot.value = /** @type {Record<string, unknown>} */ (pre)
    }
  }

  // Duplicate check: clear pre-plan if it matches current trip sequence
  const curSeq = tripBodyDailySeq(linehaulTripsBody.value)
  const preSeq = tripBodyDailySeq(prePlanTripSnapshot.value)
  if (curSeq && preSeq && curSeq === preSeq) {
    prePlanTripSnapshot.value = null
  }

  const c = assign.persistedCachedTripSnapshot
  if (c != null && typeof c === 'object' && !Array.isArray(c)) {
    const s = tripBodyDailySeq(/** @type {Record<string, unknown>} */ (c))
    if (s && hidden.has(s)) {
      cachedTripSnapshot.value = null
    } else {
      cachedTripSnapshot.value = /** @type {Record<string, unknown>} */ (c)
    }
  }
  const lp = assign.lastDailyTripLegSequencePersisted
  if (typeof lp === 'string' && /^\d+$/.test(lp)) {
    lastDailyTripLegSequence.value = hidden.has(lp) ? null : lp
  }
}

/**
 * Trip lifecycle phase: 'none' | 'assigned' | 'dispatched'.
 * Dispatched = tripStatus DSPCH or driver/tractor status ENRT.
 * Assigned = tripStatus APRVD with trip body present.
 * None = no active trip.
 */
export const tripPhase = computed(() => {
  const stableState = stableTripState.value
  const dBody = linehaulDriverBody.value
  const tBody = linehaulTractorBody.value

  const tripStatus = stableState.tripStatus || (
    linehaulTripsBody.value != null && typeof linehaulTripsBody.value === 'object' && !Array.isArray(linehaulTripsBody.value)
      ? /** @type {Record<string, unknown>} */ (linehaulTripsBody.value).tripStatus
      : null
  )

  const driverStat =
    dBody != null && typeof dBody === 'object'
      ? String(dBody.driverAvlStat ?? '').toUpperCase()
      : ''
  const tractorStat =
    tBody != null && typeof tBody === 'object'
      ? String(tBody.detlCodeAvailStat ?? '').toUpperCase()
      : ''

  if (
    tripStatus === 'DSPCH' ||
    driverStat === 'ENRT' ||
    tractorStat === 'ENRT'
  ) {
    return 'dispatched'
  }

  const hasTrip = stableState.dailyTripLegSequence || linehaulTripsBody.value != null

  if (tripStatus === 'APRVD' && hasTrip) {
    return 'assigned'
  }
  if (hasTrip) {
    return 'assigned'
  }
  return 'none'
})

/** True when a pre-plan trip is queued (different sequence than current). */
export const hasPrePlanTrip = computed(() => prePlanTripSnapshot.value != null)

/**
 * Merge trailer arrays by trlrOrder, keeping the richer object (more non-empty fields).
 * @param {unknown[]} base
 * @param {unknown[]} incoming
 * @returns {unknown[]}
 */
function mergeTrailerArrays(base, incoming) {
  const map = new Map()
  for (const t of base) {
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const order = /** @type {Record<string, unknown>} */ (t).trlrOrder
      const key = order != null ? String(order) : `_idx_${map.size}`
      map.set(key, { .../** @type {Record<string, unknown>} */ (t) })
    }
  }
  for (const t of incoming) {
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      const inc = /** @type {Record<string, unknown>} */ (t)
      const order = inc.trlrOrder
      const key = order != null ? String(order) : `_idx_${map.size}`
      const existing = map.get(key)
      if (existing) {
        for (const [k, v] of Object.entries(inc)) {
          if (v !== null && v !== undefined && v !== '') {
            existing[k] = v
          }
        }
      } else {
        map.set(key, { ...inc })
      }
    }
  }
  return Array.from(map.values())
}

/**
 * Deep merge preserving non-empty values. Empty = null, undefined, '', or empty array [].
 * Trailers array is merged by trlrOrder.
 * @param {Record<string, unknown> | null} base
 * @param  {...(Record<string, unknown> | null | undefined)} sources
 * @returns {Record<string, unknown> | null}
 */
function deepMergeNonEmpty(base, ...sources) {
  if (!base) base = {}
  const result = { ...base }
  for (const src of sources) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === undefined || v === '') continue
      if (Array.isArray(v) && v.length === 0) continue
      if (k === 'trailers' && Array.isArray(v)) {
        const baseTrailers = Array.isArray(result.trailers) ? result.trailers : []
        result.trailers = mergeTrailerArrays(baseTrailers, v)
      } else {
        result[k] = v
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

/**
 * Avoid merging `trailers` across different daily legs — `mergeTrailerArrays` unions by
 * `trlrOrder`, so a pre-plan leg plus cached prior leg produced phantom extra trailers.
 * @param {unknown} body
 * @param {string | null} primarySeq active trip leg # for this merge
 */
function bodyOmitTrailersIfDifferentLeg(body, primarySeq) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return body
  if (!primarySeq) return body
  const seq = tripBodyDailySeq(body)
  if (!seq || seq === primarySeq) return body
  const { trailers: _omit, ...rest } = /** @type {Record<string, unknown>} */ (body)
  return rest
}

/**
 * @param {unknown} body
 * @returns {string | null}
 */
export function tripBodyDailySeq(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null
  const s = /** @type {Record<string, unknown>} */ (body).dailyTripLegSequence
  if (s == null) return null
  const str = String(s).trim()
  return /^\d+$/.test(str) ? str : null
}

/**
 * Fingerprint for trip-history upserts: changes when O/D, status, or merged instructions
 * change so we re-save without spamming identical PUTs every poll.
 * @param {string} dailySeq
 * @param {string} fromAssign
 * @param {Record<string, unknown>} body
 */
function historyLedgerFingerprint(dailySeq, fromAssign, body) {
  const status = String(body.tripStatus ?? '').trim()
  const { origin, destination } = extractOriginDest(body)
  const fromApi = extractTripDispatchInstructions(body)
  const merged =
    fromAssign && fromApi
      ? `${fromAssign}\n\n${fromApi}`
      : fromAssign || fromApi
  return [dailySeq, status, origin, destination, merged].join('|||')
}

/** Same rule as server getLinehaulDriverId: digits-only username, else employeeNumber. */
export function linehaulDriverIdFromCredMeta(meta) {
  const u = typeof meta.username === 'string' ? meta.username.trim() : ''
  if (u && /^\d+$/.test(u)) return u
  const e =
    typeof meta.employeeNumber === 'string' ? meta.employeeNumber.trim() : ''
  if (e && /^\d+$/.test(e)) return e
  return ''
}

/** FedEx trip-status path: driverId + tractorNbr + locationId (all digit strings). */
export function computeLinehaulReferenceId(tractorBody, driverId) {
  if (!driverId || !tractorBody) return null
  const tn = tractorBody.tractorNbr
  const lid = tractorBody.locationId
  if (tn == null || lid == null) return null
  return `${driverId}${String(tn)}${String(lid)}`
}

export const linehaulLocationMatch = computed(() => {
  const t = linehaulTractorBody.value
  const d = linehaulDriverBody.value
  if (!t || d == null) return null
  const tl = t.locationId
  const dl = d.driverLocation
  if (tl === undefined || dl === undefined) return null
  return String(tl) === String(dl)
})

/**
 * @param {{ status?: number } | null | undefined} res
 */
function isAuthFailure(res) {
  if (!res || typeof res.status !== 'number') return false
  return res.status === 401 || res.status === 403
}

/**
 * Apply tractor/driver/trip-ready/trips merge + stableTripState from one Linehaul poll.
 * @param {{
 *   tr: object,
 *   dr: object,
 *   cred: Record<string, unknown>,
 *   trip: object | null,
 *   tripsAprvd: object,
 *   tripsByLeg: object | null,
 *   assignmentInstructions: string,
 *   refId: string | null,
 * }} p
 */
function applyLinehaulFedexPollSnapshot(p) {
  const { tr, dr, cred, trip, tripsAprvd, tripsByLeg, assignmentInstructions, refId } = p

  linehaulTractorError.value = null
  linehaulDriverError.value = null
  linehaulTripReadyError.value = null
  linehaulTripsError.value = null
  linehaulTripsNoActive.value = false

  if (tr.ok && tr.body !== undefined) {
    linehaulTractorBody.value = tr.body
    linehaulTractorError.value = null
  } else {
    linehaulTractorBody.value = null
    linehaulTractorError.value = tr.error || 'Tractor request failed'
  }
  if (dr.ok && dr.body !== undefined) {
    linehaulDriverBody.value = dr.body
    linehaulDriverError.value = null
  } else {
    linehaulDriverBody.value = null
    linehaulDriverError.value = dr.error || 'Driver request failed'
  }

  const driverId = linehaulDriverIdFromCredMeta(cred)
  const tractorBody = tr.ok && tr.body !== undefined ? tr.body : null

  if (!refId) {
    linehaulTripReadyBody.value = null
    if (!driverId) {
      linehaulTripReadyError.value =
        'Trip Ready: set digits-only Username or Employee # to build reference id.'
    } else if (
      !tractorBody ||
      tractorBody.tractorNbr == null ||
      tractorBody.locationId == null
    ) {
      linehaulTripReadyError.value =
        'Trip Ready: need tractor locationId and tractorNbr (tractor API must succeed).'
    } else {
      linehaulTripReadyError.value = null
    }
  } else if (trip) {
    if (trip.ok && trip.body !== undefined) {
      linehaulTripReadyBody.value = trip.body
      linehaulTripReadyError.value = null
    } else {
      linehaulTripReadyBody.value = null
      linehaulTripReadyError.value =
        trip.error || 'Trip Ready request failed'
    }
  }

  let seqFromAprvd = null
  if (tripsAprvd.ok && tripsAprvd.body != null && typeof tripsAprvd.body === 'object') {
    seqFromAprvd = tripBodyDailySeq(tripsAprvd.body)
  }

  const prePlanSeqAtPollStart = tripBodyDailySeq(prePlanTripSnapshot.value)

  const driverStatPoll =
    dr.ok && dr.body && typeof dr.body === 'object'
      ? String(dr.body.driverAvlStat ?? '').toUpperCase()
      : ''
  const tractorStatPoll =
    tr.ok && tr.body && typeof tr.body === 'object'
      ? String(tr.body.detlCodeAvailStat ?? '').toUpperCase()
      : ''
  const aprvdListStatus =
    tripsAprvd.ok && tripsAprvd.body != null && typeof tripsAprvd.body === 'object'
      ? String(/** @type {Record<string, unknown>} */ (tripsAprvd.body).tripStatus ?? '')
          .trim()
          .toUpperCase()
      : ''

  const treatAsDispatchedPoll =
    driverStatPoll === 'ENRT' ||
    tractorStatPoll === 'ENRT' ||
    aprvdListStatus === 'DSPCH'

  const activeLegGuess =
    stableTripState.value.dailyTripLegSequence ||
    tripBodyDailySeq(cachedTripSnapshot.value) ||
    tripBodyDailySeq(linehaulTripsBody.value)

  const aprvdListIsPrePlanLeg = Boolean(
    seqFromAprvd &&
      prePlanSeqAtPollStart &&
      seqFromAprvd === prePlanSeqAtPollStart,
  )

  const fetchActiveLegInsteadOfAprvdList =
    aprvdListIsPrePlanLeg &&
    treatAsDispatchedPoll &&
    Boolean(activeLegGuess && activeLegGuess !== seqFromAprvd)

  if (tripsByLeg?.ok && tripsByLeg.body != null && typeof tripsByLeg.body === 'object') {
    const seqL = tripBodyDailySeq(tripsByLeg.body)
    if (seqL) lastDailyTripLegSequence.value = seqL
  }

  const currentDriverAvlStat =
    dr.ok && dr.body && typeof dr.body === 'object'
      ? String(dr.body.driverAvlStat ?? '').toUpperCase()
      : ''

  if (
    prevDriverAvlStat === 'ENRT' &&
    currentDriverAvlStat !== 'ENRT' &&
    currentDriverAvlStat !== ''
  ) {
    if (prePlanTripSnapshot.value != null) {
      cachedTripSnapshot.value = prePlanTripSnapshot.value
      prePlanTripSnapshot.value = null
    } else {
      cachedTripSnapshot.value = null
    }
    lastDailyTripLegSequence.value = null
  }
  prevDriverAvlStat = currentDriverAvlStat

  /** @type {Record<string, unknown> | null} */
  let aprvdBody = null
  if (tripsAprvd.ok && tripsAprvd.body != null && !tripsAprvd.noActiveTrip) {
    const b = tripsAprvd.body
    if (typeof b === 'object' && !Array.isArray(b)) {
      aprvdBody = /** @type {Record<string, unknown>} */ (b)
    }
  }

  /** @type {Record<string, unknown> | null} */
  let dspchBody = null
  if (
    tripsByLeg != null &&
    tripsByLeg.ok &&
    tripsByLeg.body != null &&
    !tripsByLeg.noActiveTrip
  ) {
    const leg = tripsByLeg.body
    if (typeof leg === 'object' && leg !== null && !Array.isArray(leg)) {
      dspchBody = /** @type {Record<string, unknown>} */ (leg)
    }
  }

  const incomingSeq = tripBodyDailySeq(aprvdBody)
  const cachedSeq = tripBodyDailySeq(cachedTripSnapshot.value)

  if (aprvdBody && Array.isArray(aprvdBody.trailers) && aprvdBody.trailers.length > 0) {
    if (!cachedSeq || cachedSeq === incomingSeq) {
      const cacheWouldPolluteActiveWithPrePlanAprvd =
        fetchActiveLegInsteadOfAprvdList &&
        incomingSeq != null &&
        prePlanSeqAtPollStart != null &&
        incomingSeq === prePlanSeqAtPollStart
      if (!cacheWouldPolluteActiveWithPrePlanAprvd) {
        cachedTripSnapshot.value = { ...aprvdBody }
      }
    }
  }

  const cached =
    cachedTripSnapshot.value != null &&
    typeof cachedTripSnapshot.value === 'object'
      ? /** @type {Record<string, unknown>} */ (cachedTripSnapshot.value)
      : null

  const mergePrimarySeq =
    tripBodyDailySeq(dspchBody) ||
    tripBodyDailySeq(cached) ||
    tripBodyDailySeq(aprvdBody)

  const merged = deepMergeNonEmpty(
    bodyOmitTrailersIfDifferentLeg(aprvdBody, mergePrimarySeq),
    bodyOmitTrailersIfDifferentLeg(dspchBody, mergePrimarySeq),
    bodyOmitTrailersIfDifferentLeg(cached, mergePrimarySeq),
  )

  if (merged != null) {
    linehaulTripsBody.value = merged
    linehaulTripsError.value = null
    linehaulTripsNoActive.value = false
  } else if (
    tripsAprvd.noActiveTrip &&
    !(
      tripsByLeg != null &&
      tripsByLeg.ok &&
      tripsByLeg.body != null &&
      !tripsByLeg.noActiveTrip
    ) &&
    cachedTripSnapshot.value == null
  ) {
    linehaulTripsBody.value = null
    linehaulTripsError.value = null
    linehaulTripsNoActive.value = true
  } else {
    if (cachedTripSnapshot.value != null) {
      linehaulTripsBody.value = cachedTripSnapshot.value
      linehaulTripsError.value = null
      linehaulTripsNoActive.value = false
    } else {
      linehaulTripsBody.value = null
      linehaulTripsNoActive.value = false
      const aprErr =
        tripsAprvd.ok || tripsAprvd.noActiveTrip ? null : tripsAprvd.error
      const legErr =
        tripsByLeg && !tripsByLeg.ok && !tripsByLeg.noActiveTrip
          ? tripsByLeg.error
          : null
      linehaulTripsError.value =
        aprErr || legErr || 'Trip details request failed'
    }
  }

  const mergedSeq = tripBodyDailySeq(linehaulTripsBody.value)
  const existingPrePlanSeq = tripBodyDailySeq(prePlanTripSnapshot.value)

  if (
    incomingSeq != null &&
    mergedSeq != null &&
    incomingSeq !== mergedSeq &&
    existingPrePlanSeq !== incomingSeq
  ) {
    prePlanTripSnapshot.value = { ...aprvdBody }
  }

  if (mergedSeq && existingPrePlanSeq && mergedSeq === existingPrePlanSeq) {
    prePlanTripSnapshot.value = null
  }

  const { changed: stateChanged } = processApiResponse(
    /** @type {Record<string, unknown> | null} */ (linehaulTripsBody.value),
    assignmentInstructions,
    {
      prePlanSnapshot: prePlanTripSnapshot.value,
      hiddenSequences: hiddenDailyTripLegSequences.value,
    },
  )

  noteFirstDispatchEdgeForActiveLeg()

  if (stateChanged) {
    const historyGate = shouldUpsertToHistory(stableTripState.value, {
      prePlanSnapshot: prePlanTripSnapshot.value,
      tripPhase: tripPhase.value,
    })

    if (historyGate.allow) {
      scheduleHistoryUpsert(stableTripState.value, assignmentInstructions)
    }

    const seq = stableTripState.value.dailyTripLegSequence
    if (seq) {
      void syncDollyFromLinehaul(seq, stableTripState.value).catch(() => {})
    }
  }
  return { aprvdBody, dspchBody }
}

/**
 * Mileage fetch, unhide legs, persist snapshots — after poll results are applied.
 * @param {unknown[]} tripHistoryLedgerSnapshot
 * @param {Record<string, unknown> | null} aprvdBody
 * @param {Record<string, unknown> | null} dspchBody
 */
async function finishLinehaulPollSideEffects(
  tripHistoryLedgerSnapshot,
  aprvdBody,
  dspchBody,
) {
  void maybeFetchTripMileageAfterDispatched()

  const legsFromApi = new Set()
  for (const b of [
    linehaulTripsBody.value,
    prePlanTripSnapshot.value,
    cachedTripSnapshot.value,
    aprvdBody,
    dspchBody,
  ]) {
    const s = tripBodyDailySeq(b)
    if (s) legsFromApi.add(s)
  }
  await unhideTripLegSequencesIfHidden([...legsFromApi], tripHistoryLedgerSnapshot)

  applyHiddenTripFilter()
  schedulePersistLinehaulTripSnapshots()
}

/**
 * Fetches Linehaul tractor, driver, trip-ready (when reference id can be built), and trip details.
 * On 401/403 (attempt 0), runs browser bearer capture once then retries fetch.
 */
export async function refreshLinehaulApis() {
  linehaulFetching.value = true
  try {
    await refreshLinehaulApisImpl(0)
  } finally {
    linehaulLastFetchAt.value = Date.now()
    linehaulFetching.value = false
  }
}

/**
 * @param {0 | 1} attempt
 */
async function refreshLinehaulApisImpl(attempt) {
  let assignmentInstructions = ''
  /** @type {unknown[]} */
  let tripHistoryLedgerSnapshot = []
  try {
    const assign = await getAssignment()
    assignmentInstructions =
      typeof assign.instructions === 'string' ? assign.instructions : ''
    tripHistoryLedgerSnapshot = Array.isArray(assign.tripHistoryLedger)
      ? assign.tripHistoryLedger
      : []
    hiddenDailyTripLegSequences.value = Array.isArray(assign.hiddenDailyTripLegSequences)
      ? assign.hiddenDailyTripLegSequences.map(String)
      : []
    hydrateTripSnapshotsFromAssignment(
      /** @type {Record<string, unknown>} */ (assign),
    )
    applyHiddenTripFilter()
  } catch {
    /* getAssignment failed — do not clear hidden list or trip UI (stale is safer than empty). */
  }

  const [tr, dr] = await Promise.all([
    fetchFedexLinehaulTractor(),
    fetchFedexLinehaulDriver(),
  ])
  let cred = {}
  try {
    cred = await getCredentials()
    applyHelpersLocationPrefsFromCredentials(cred)
  } catch {
    cred = {}
  }

  const driverId = linehaulDriverIdFromCredMeta(cred)
  const tractorBody = tr.ok && tr.body !== undefined ? tr.body : null
  const refId = computeLinehaulReferenceId(tractorBody, driverId)

  /** @type {{ ok: boolean, status: number, body?: unknown, error?: string } | null} */
  let trip = null
  if (refId) {
    trip = await fetchFedexLinehaulTripStatus({ referenceId: refId })
  }

  const tripsAprvd = await fetchFedexLinehaulTrips({})

  let seqFromAprvd = null
  if (tripsAprvd.ok && tripsAprvd.body != null && typeof tripsAprvd.body === 'object') {
    seqFromAprvd = tripBodyDailySeq(tripsAprvd.body)
  }

  /** Pre-plan seq at start of poll — APRVD list row often matches this while ENRT on prior leg. */
  const prePlanSeqAtPollStart = tripBodyDailySeq(prePlanTripSnapshot.value)

  const driverStatPoll =
    dr.ok && dr.body && typeof dr.body === 'object'
      ? String(dr.body.driverAvlStat ?? '').toUpperCase()
      : ''
  const tractorStatPoll =
    tr.ok && tr.body && typeof tr.body === 'object'
      ? String(tr.body.detlCodeAvailStat ?? '').toUpperCase()
      : ''
  const aprvdListStatus =
    tripsAprvd.ok && tripsAprvd.body != null && typeof tripsAprvd.body === 'object'
      ? String(/** @type {Record<string, unknown>} */ (tripsAprvd.body).tripStatus ?? '')
          .trim()
          .toUpperCase()
      : ''

  const treatAsDispatchedPoll =
    driverStatPoll === 'ENRT' ||
    tractorStatPoll === 'ENRT' ||
    aprvdListStatus === 'DSPCH'

  const activeLegGuess =
    stableTripState.value.dailyTripLegSequence ||
    tripBodyDailySeq(cachedTripSnapshot.value) ||
    tripBodyDailySeq(linehaulTripsBody.value)

  const aprvdListIsPrePlanLeg =
    Boolean(
      seqFromAprvd &&
        prePlanSeqAtPollStart &&
        seqFromAprvd === prePlanSeqAtPollStart,
    )

  /** Fetch DSPCH/detail for the active trip, not the APRVD list row, when list is the next leg only. */
  const fetchActiveLegInsteadOfAprvdList =
    aprvdListIsPrePlanLeg &&
    treatAsDispatchedPoll &&
    Boolean(activeLegGuess && activeLegGuess !== seqFromAprvd)

  if (seqFromAprvd && !fetchActiveLegInsteadOfAprvdList) {
    lastDailyTripLegSequence.value = seqFromAprvd
  }

  const seqForLeg = fetchActiveLegInsteadOfAprvdList
    ? activeLegGuess
    : seqFromAprvd ?? lastDailyTripLegSequence.value

  /** @type {{ ok: boolean, status: number, body?: unknown, error?: string, noActiveTrip?: boolean } | null} */
  let tripsByLeg = null
  if (seqForLeg) {
    const originId =
      tractorBody?.locationId != null &&
      String(tractorBody.locationId).trim() !== ''
        ? String(tractorBody.locationId).trim()
        : ''
    tripsByLeg = await fetchFedexLinehaulTrips({
      dailyTripLegSequence: seqForLeg,
      alreadyCalled: 'false',
      ...(originId ? { originId } : {}),
    })
  }

  const authFailed =
    attempt === 0 &&
    (isAuthFailure(tr) ||
      isAuthFailure(dr) ||
      isAuthFailure(trip) ||
      isAuthFailure(tripsAprvd) ||
      (tripsByLeg != null && isAuthFailure(tripsByLeg)))

  if (authFailed) {
    linehaulAuthRecoveryInProgress.value = true
    let recovered = false
    try {
      pushLiveLog({
        type: 'info',
        message:
          'Linehaul returned 401/403 — refreshing bearer from browser, then retrying…',
        ts: Date.now(),
      })
      const cap = await postLinehaulCaptureBearer({
        bypassValidityProbe: true,
        clearSession: false,
        tryOktaLogin: true,
        headless: true,
      })
      if (cap && cap.ok === true && cap.saved === true) {
        await refreshLinehaulApisImpl(1)
        recovered = true
      }
    } catch (e) {
      pushLiveLog({
        type: 'error',
        message:
          e instanceof Error
            ? e.message
            : `Linehaul bearer capture failed: ${String(e)}`,
        ts: Date.now(),
      })
    } finally {
      linehaulAuthRecoveryInProgress.value = false
    }
    if (recovered) return
  }

  const { aprvdBody, dspchBody } = applyLinehaulFedexPollSnapshot({
    tr,
    dr,
    cred,
    trip,
    tripsAprvd,
    tripsByLeg,
    assignmentInstructions,
    refId,
  })
  await finishLinehaulPollSideEffects(
    tripHistoryLedgerSnapshot,
    aprvdBody,
    dspchBody,
  )
}

/**
 * After dispatch (ENRT/DSPCH), fetch planned mileage once per leg from Linehaul
 * `viewTripInfoDetails` and persist for this leg + matching O/D history rows.
 */
async function maybeFetchTripMileageAfterDispatched() {
  if (tripPhase.value !== 'dispatched') return

  // Use stableTripState for origin/destination IDs
  const stable = stableTripState.value
  const seq = stable.dailyTripLegSequence
  const originId = stable.origin?.number || ''
  const destinationId = stable.destination?.number || ''

  if (!seq || !originId || !destinationId) return
  const fetchKey = `${seq}|${originId}|${destinationId}`
  if (lastTripMileageOkKey === fetchKey) return

  const tractorBody = linehaulTractorBody.value
  const originHeader =
    tractorBody &&
    typeof tractorBody === 'object' &&
    tractorBody.locationId != null &&
    String(tractorBody.locationId).trim() !== ''
      ? String(tractorBody.locationId).trim()
      : originId

  const res = await fetchFedexLinehaulViewTripInfoDetails({
    orgIdOrigin: originId,
    orgIdDest: destinationId,
    originId: originHeader,
  })
  if (!res.ok || res.body == null || typeof res.body !== 'object') return

  try {
    await putAssignment({
      applyOdMileageFromFetch: {
        originId,
        destinationId,
        body: res.body,
      },
    })
    lastTripMileageOkKey = fetchKey
  } catch {
    /* offline — retry next poll */
  }
}
