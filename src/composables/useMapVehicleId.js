import { ref, computed, watch } from 'vue'
import { getCredentials } from '../api.js'
import { linehaulTractorBody } from '../stores/linehaulSnapshotStore.js'
import { vehicleIdForUserMapMarker } from '../utils/mapVehicleLabel.js'

/**
 * Reactive tractor / unit string for map “my location” chip (Linehaul snapshot + Settings tractor).
 */
export function useMapVehicleId() {
  const credSnap = ref(/** @type {Record<string, unknown> | null} */ (null))

  watch(
    linehaulTractorBody,
    () => {
      void getCredentials()
        .then((c) => {
          credSnap.value =
            c && typeof c === 'object' ? /** @type {Record<string, unknown>} */ (c) : null
        })
        .catch(() => {})
    },
    { immediate: true },
  )

  const vehicleId = computed(() =>
    vehicleIdForUserMapMarker(linehaulTractorBody.value, credSnap.value),
  )

  return { vehicleId }
}
