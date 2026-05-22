import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { fetchFedexLinehaulLocation } from '../api.js'
import { extractLocationForDirectory } from '../utils/linehaulLocationDisplay.js'
import { haversineM } from '../utils/polylineSnap.js'
import {
  helpersAutoArriveNearDestEnabledRef,
  helpersAutoArriveRadiusNmRef,
} from '../utils/helpersLocationPrefs.js'
import { enqueueAnnouncement } from '../utils/alertAudioQueue.js'
import { appGeoLat, appGeoLng, appGeoAccuracyM } from './useAppGeolocationWatch.js'

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
 * }} opts
 */
export function useDestinationAutoArriveCheckIn(opts) {
  const destLat = ref(/** @type {number | null} */ (null))
  const destLng = ref(/** @type {number | null} */ (null))

  /** When false, next "inside" event may trigger (after leaving radius). */
  let armed = true

  watch(
    () =>
      `${String(opts.currentTripLegSeq.value ?? '').trim()}|${String(opts.tripDestLocationId.value ?? '').trim()}`,
    () => {
      armed = true
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

    const maxM = helpersAutoArriveRadiusNmRef.value * 1852
    const acc = appGeoAccuracyM.value
    const accM = acc != null && Number.isFinite(acc) ? Math.max(0, acc) : 0
    const slackM = Math.min(800, accM)
    const d = haversineM(ulat, ulng, dlat, dlng)
    const inside = d <= maxM + slackM

    if (!inside) {
      armed = true
      return
    }

    if (!armed) return

    enqueueAnnouncement('Auto arrive and check in running', {
      category: 'helpersAutoArriveProx',
    })
    armed = false
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
