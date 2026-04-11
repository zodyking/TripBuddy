import { ref, computed } from 'vue'
import {
  fetchFedexLinehaulTractor,
  fetchFedexLinehaulDriver,
  fetchFedexLinehaulTripStatus,
  fetchFedexLinehaulTrips,
  getCredentials,
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
export const linehaulLastFetchAt = ref(null)
export const linehaulFetching = ref(false)

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

  const trips = await fetchFedexLinehaulTrips({})
  if (trips.noActiveTrip) {
    linehaulTripsBody.value = null
    linehaulTripsError.value = null
    linehaulTripsNoActive.value = true
  } else if (trips.ok && trips.body !== undefined) {
    linehaulTripsBody.value = trips.body
    linehaulTripsError.value = null
    linehaulTripsNoActive.value = false
  } else {
    linehaulTripsBody.value = null
    linehaulTripsNoActive.value = false
    linehaulTripsError.value = trips.error || 'Trip details request failed'
  }

  const authFailed =
    attempt === 0 &&
    (isAuthFailure(tr) ||
      isAuthFailure(dr) ||
      isAuthFailure(trip) ||
      isAuthFailure(trips))

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
}
