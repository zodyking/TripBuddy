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
} from '../api.js'
import { pushLiveLog } from './liveLogStore.js'

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

/** Cached full trip snapshot (from APRVD) with trailer details for persistence after dispatch. */
export const cachedTripSnapshot = ref(null)
/** Pre-plan trip: a second APRVD trip with different dailyTripLegSequence while current trip exists. */
export const prePlanTripSnapshot = ref(null)
/** User-marked completed trip leg sequences (persisted server-side; hide matching API data). */
export const hiddenDailyTripLegSequences = ref(/** @type {string[]} */ ([]))
/** Previous driver availability status to detect ENRT→ACT transition. */
let prevDriverAvlStat = null

function applyHiddenTripFilter() {
  const hidden = new Set(
    hiddenDailyTripLegSequences.value.map((s) => String(s).trim()).filter(Boolean),
  )
  if (!hidden.size) return
  const cur = linehaulTripsBody.value
  const seqCur = tripBodyDailySeq(cur)
  if (seqCur && hidden.has(seqCur)) {
    linehaulTripsBody.value = null
    linehaulTripsNoActive.value = true
  }
  const pre = prePlanTripSnapshot.value
  const seqPre = tripBodyDailySeq(pre)
  if (seqPre && hidden.has(seqPre)) {
    prePlanTripSnapshot.value = null
  }
  const c = cachedTripSnapshot.value
  const seqC = tripBodyDailySeq(c)
  if (seqC && hidden.has(seqC)) {
    cachedTripSnapshot.value = null
  }
}

/**
 * User completed trip — persist hidden seq and clear matching UI state.
 * @param {string} dailyTripLegSequence
 */
export async function markTripLegSequenceCompleted(dailyTripLegSequence) {
  const seq = String(dailyTripLegSequence ?? '').trim()
  if (!/^\d+$/.test(seq)) return
  const a = await putAssignment({ appendHiddenDailyTripLegSequence: seq })
  hiddenDailyTripLegSequences.value = Array.isArray(a.hiddenDailyTripLegSequences)
    ? a.hiddenDailyTripLegSequences.map(String)
    : []
  applyHiddenTripFilter()
}

/**
 * Trip lifecycle phase: 'none' | 'assigned' | 'dispatched'.
 * Dispatched = tripStatus DSPCH or driver/tractor status ENRT.
 * Assigned = tripStatus APRVD with trip body present.
 * None = no active trip.
 */
export const tripPhase = computed(() => {
  const tb = linehaulTripsBody.value
  const dBody = linehaulDriverBody.value
  const tBody = linehaulTractorBody.value

  const tripStatus =
    tb != null && typeof tb === 'object' && !Array.isArray(tb)
      ? /** @type {Record<string, unknown>} */ (tb).tripStatus
      : null

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
  if (tripStatus === 'APRVD' && tb != null) {
    return 'assigned'
  }
  if (tb != null) {
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
  try {
    const assign = await getAssignment()
    hiddenDailyTripLegSequences.value = Array.isArray(assign.hiddenDailyTripLegSequences)
      ? assign.hiddenDailyTripLegSequences.map(String)
      : []
  } catch {
    hiddenDailyTripLegSequences.value = []
  }

  linehaulTractorError.value = null
  linehaulDriverError.value = null
  linehaulTripReadyError.value = null
  linehaulTripsError.value = null
  linehaulTripsNoActive.value = false
  const [tr, dr] = await Promise.all([
    fetchFedexLinehaulTractor(),
    fetchFedexLinehaulDriver(),
  ])
  let cred = {}
  try {
    cred = await getCredentials()
  } catch {
    cred = {}
  }
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
  const refId = computeLinehaulReferenceId(tractorBody, driverId)

  /** @type {{ ok: boolean, status: number, body?: unknown, error?: string } | null} */
  let trip = null
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
  } else {
    trip = await fetchFedexLinehaulTripStatus({ referenceId: refId })
    if (trip.ok && trip.body !== undefined) {
      linehaulTripReadyBody.value = trip.body
      linehaulTripReadyError.value = null
    } else {
      linehaulTripReadyBody.value = null
      linehaulTripReadyError.value =
        trip.error || 'Trip Ready request failed'
    }
  }

  const tripsAprvd = await fetchFedexLinehaulTrips({})

  let seqFromAprvd = null
  if (tripsAprvd.ok && tripsAprvd.body != null && typeof tripsAprvd.body === 'object') {
    seqFromAprvd = tripBodyDailySeq(tripsAprvd.body)
  }
  if (seqFromAprvd) {
    lastDailyTripLegSequence.value = seqFromAprvd
  }
  const seqForLeg = seqFromAprvd ?? lastDailyTripLegSequence.value

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
    // Promote pre-plan to current if exists, else clear
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

  // Detect pre-plan trip vs normal caching
  const currentSeq = tripBodyDailySeq(cachedTripSnapshot.value)
  const incomingSeq = tripBodyDailySeq(aprvdBody)

  if (
    cachedTripSnapshot.value != null &&
    incomingSeq != null &&
    currentSeq != null &&
    incomingSeq !== currentSeq
  ) {
    // New trip with different sequence while current exists = pre-plan
    prePlanTripSnapshot.value = { ...aprvdBody }
  } else if (aprvdBody && Array.isArray(aprvdBody.trailers) && aprvdBody.trailers.length > 0) {
    // Normal path: update cached trip
    cachedTripSnapshot.value = { ...aprvdBody }
  }

  const cached =
    cachedTripSnapshot.value != null &&
    typeof cachedTripSnapshot.value === 'object'
      ? /** @type {Record<string, unknown>} */ (cachedTripSnapshot.value)
      : null

  const merged = deepMergeNonEmpty(cached, aprvdBody, dspchBody)

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

  const authFailed =
    attempt === 0 &&
    (isAuthFailure(tr) ||
      isAuthFailure(dr) ||
      isAuthFailure(trip) ||
      isAuthFailure(tripsAprvd) ||
      (tripsByLeg != null && isAuthFailure(tripsByLeg)))

  if (authFailed) {
    pushLiveLog({
      type: 'info',
      message:
        'Linehaul returned 401/403 — refreshing bearer from browser, then retrying…',
      ts: Date.now(),
    })
    try {
      const cap = await postLinehaulCaptureBearer({
        bypassValidityProbe: true,
        clearSession: false,
        tryOktaLogin: true,
        headless: true,
      })
      if (cap && cap.ok === true && cap.saved === true) {
        await refreshLinehaulApisImpl(1)
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
    }
  }

  applyHiddenTripFilter()
}
