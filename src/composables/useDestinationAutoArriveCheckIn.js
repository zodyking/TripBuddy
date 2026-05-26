import { ref, watch, onMounted, onBeforeUnmount, unref } from 'vue'
import { fetchFedexLinehaulLocation } from '../api.js'
import { extractLocationForDirectory } from '../utils/linehaulLocationDisplay.js'
import { haversineM } from '../utils/polylineSnap.js'
import {
  helpersAutoArriveNearDestEnabledRef,
  helpersAutoArriveRadiusNmRef,
  HELPERS_RADIUS_NM_DEFAULT,
  HELPERS_RADIUS_NM_MAX,
  HELPERS_RADIUS_NM_MIN,
} from '../utils/helpersLocationPrefs.js'
import { enqueueAnnouncement } from '../utils/alertAudioQueue.js'
import { appGeoLat, appGeoLng, appGeoAccuracyM } from './useAppGeolocationWatch.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** Must stay inside the trigger circle this long before running (filters single-sample GPS spikes). */
const DWELL_MS = 40_000

/**
 * @param {unknown} raw
 * @returns {number}
 */
function clampRadiusNm(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return HELPERS_RADIUS_NM_DEFAULT
  return Math.min(HELPERS_RADIUS_NM_MAX, Math.max(HELPERS_RADIUS_NM_MIN, n))
}

/**
 * Tie geofence scale to leg length (same NM scale as Home leg progress). Never wider than the user's setting.
 * @param {number} userNm
 * @param {number | null | undefined} capNm
 */
function effectiveProximityRadiusNm(userNm, capNm) {
  if (capNm == null || !Number.isFinite(capNm) || capNm < 12) return userNm
  const scaled = Math.max(HELPERS_RADIUS_NM_MIN, capNm * 0.075)
  return Math.min(userNm, scaled)
}

/**
 * When the driver enters the destination radius (and ENRT), announce and run arrive → check-in.
 *
 * @param {{
 *   suppressHomeLinehaulErrors: import('vue').Ref<boolean>,
 *   tripDestLocationId: import('vue').ComputedRef<string>,
 *   linehaulOriginIdForApi: import('vue').ComputedRef<string>,
 *   currentTripLegSeq: import('vue').ComputedRef<string>,
 *   isEnrtEligible: () => boolean,
 *   isAutomationRunning: () => boolean,
 *   runArriveThenCheckIn: () => Promise<void>,
 *   notifyInApp: (message: string, kind?: 'info' | 'warning' | 'error') => void,
 *   legProgressCapNm?: import('vue').ComputedRef<number>,
 * }} opts
 */
export function useDestinationAutoArriveCheckIn(opts) {
  const destLat = ref(/** @type {number | null} */ (null))
  const destLng = ref(/** @type {number | null} */ (null))

  /** When false, next "inside" event may trigger (after leaving radius). */
  let armed = true

  /** Monotonic clock (ms) when we first saw a strict inside + acceptable accuracy; cleared when outside or accuracy bad. */
  let insideSinceMs = /** @type {number | null} */ (null)

  function resetDwell() {
    insideSinceMs = null
  }

  watch(
    () =>
      `${String(opts.currentTripLegSeq.value ?? '').trim()}|${String(opts.tripDestLocationId.value ?? '').trim()}`,
    () => {
      armed = true
      resetDwell()
    },
  )

  watch(
    () =>
      `${String(opts.tripDestLocationId.value ?? '').trim()}|${String(opts.linehaulOriginIdForApi.value ?? '').trim()}`,
    async () => {
      const id = String(opts.tripDestLocationId.value ?? '').trim()
      destLat.value = null
      destLng.value = null
      armed = true
      resetDwell()
      if (!id) return

      const origin = String(opts.linehaulOriginIdForApi.value ?? '').trim()
      try {
        const r = await fetchFedexLinehaulLocation({
          locationId: id,
          originId: origin || undefined,
        })
        if (String(opts.tripDestLocationId.value ?? '').trim() !== id) return
        if (!r.ok || !r.body) {
          opts.notifyInApp('Proximity helper: could not load trip destination coordinates.', 'warning')
          return
        }
        const ex = extractLocationForDirectory(r.body)
        if (ex?.latitude != null && ex?.longitude != null) {
          destLat.value = ex.latitude
          destLng.value = ex.longitude
        } else {
          opts.notifyInApp('Proximity helper: destination has no lat/long in Linehaul data.', 'warning')
        }
      } catch (e) {
        opts.notifyInApp(
          e instanceof Error ? e.message : 'Proximity helper: destination fetch failed.',
          'warning',
        )
      }
    },
    { immediate: true },
  )

  function maybeTriggerProximityAutoArrive() {
    if (!helpersAutoArriveNearDestEnabledRef.value) return
    if (opts.suppressHomeLinehaulErrors.value) return
    if (!opts.isEnrtEligible()) return
    if (opts.isAutomationRunning()) return

    const destId = String(opts.tripDestLocationId.value ?? '').trim()
    if (!destId) {
      armed = true
      resetDwell()
      return
    }

    const ulat = appGeoLat.value
    const ulng = appGeoLng.value
    const dlat = destLat.value
    const dlng = destLng.value
    if (
      ulat == null ||
      ulng == null ||
      dlat == null ||
      dlng == null ||
      !Number.isFinite(ulat) ||
      !Number.isFinite(ulng) ||
      !Number.isFinite(dlat) ||
      !Number.isFinite(dlng)
    ) {
      return
    }

    if (Math.abs(dlat) > 90 || Math.abs(dlng) > 180) {
      resetDwell()
      return
    }

    const userNm = clampRadiusNm(helpersAutoArriveRadiusNmRef.value)
    const capLeg = opts.legProgressCapNm != null ? unref(opts.legProgressCapNm) : null
    const effNm = effectiveProximityRadiusNm(userNm, capLeg)
    const maxM = effNm * 1852
    const d = haversineM(ulat, ulng, dlat, dlng)

    /** Strict geofence — do not add accuracy slack (it widened the circle and caused early triggers). */
    const strictInside = d <= maxM

    if (!strictInside) {
      armed = true
      resetDwell()
      return
    }

    const acc = appGeoAccuracyM.value
    const accM = acc != null && Number.isFinite(acc) ? Math.max(0, acc) : 0
    /** Ignore fixes whose reported uncertainty is huge relative to the allowed radius. */
    const maxAccAllowed = Math.min(2500, maxM * 0.45)
    if (accM > maxAccAllowed) {
      resetDwell()
      return
    }

    const now = Date.now()
    if (insideSinceMs == null) insideSinceMs = now
    if (now - insideSinceMs < DWELL_MS) return

    if (!armed) return

    const dNm = d / 1852
    const capStr =
      capLeg != null && Number.isFinite(capLeg) && capLeg >= 12
        ? `, leg cap ${capLeg.toFixed(1)} NM → eff ${effNm.toFixed(2)} NM (max ${userNm.toFixed(2)} NM)`
        : ''
    pushLiveLog({
      type: 'info',
      message: `[Proximity auto arrive] firing: ~${dNm.toFixed(2)} NM from Linehaul dest coords (threshold ${effNm.toFixed(2)} NM${capStr}), GPS accuracy ~${Math.round(accM)} m`,
      ts: now,
    })

    enqueueAnnouncement('Auto arrive and check in running', {
      category: 'helpersAutoArriveProx',
    })
    armed = false
    resetDwell()
    void opts.runArriveThenCheckIn().catch((e) => {
      const code = e && typeof e === 'object' && 'code' in e ? /** @type {{ code?: string }} */ (e).code : null
      if (code === 'HELPERS_SKIP') {
        armed = true
        return
      }
      opts.notifyInApp(e instanceof Error ? e.message : String(e), 'error')
      armed = true
    })
  }

  watch(
    [
      appGeoLat,
      appGeoLng,
      appGeoAccuracyM,
      destLat,
      destLng,
      opts.tripDestLocationId,
      opts.currentTripLegSeq,
      opts.suppressHomeLinehaulErrors,
      helpersAutoArriveNearDestEnabledRef,
      helpersAutoArriveRadiusNmRef,
      ...(opts.legProgressCapNm ? [opts.legProgressCapNm] : []),
    ],
    () => {
      maybeTriggerProximityAutoArrive()
    },
  )

  const PROX_POLL_MS = 45_000
  /** @type {ReturnType<typeof setInterval> | null} */
  let intervalId = null

  function onVisibility() {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    maybeTriggerProximityAutoArrive()
  }

  onMounted(() => {
    intervalId = setInterval(() => {
      maybeTriggerProximityAutoArrive()
    }, PROX_POLL_MS)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
  })

  onBeforeUnmount(() => {
    if (intervalId != null) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })
}
