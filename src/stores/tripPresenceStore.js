import { ref } from 'vue'

/**
 * Snapshot of trip / tractor presence for WhatsApp auto-replies (updated from MainDashboard).
 * @type {import('vue').Ref<{
 *   tractorLocationId: string,
 *   tripDestLocationId: string,
 *   tripOriginLocationId: string,
 *   tripPhase: string,
 *   remainingDistM: number | null,
 * }>}
 */
export const tripPresenceSnapshot = ref({
  tractorLocationId: '',
  tripDestLocationId: '',
  tripOriginLocationId: '',
  tripPhase: '',
  remainingDistM: null,
})

/**
 * @param {Partial<{
 *   tractorLocationId: string,
 *   tripDestLocationId: string,
 *   tripOriginLocationId: string,
 *   tripPhase: string,
 *   remainingDistM: number | null,
 * }>} patch
 */
export function setTripPresenceSnapshot(patch) {
  if (!patch || typeof patch !== 'object') return
  const cur = tripPresenceSnapshot.value
  tripPresenceSnapshot.value = {
    tractorLocationId:
      patch.tractorLocationId !== undefined
        ? String(patch.tractorLocationId ?? '').trim()
        : cur.tractorLocationId,
    tripDestLocationId:
      patch.tripDestLocationId !== undefined
        ? String(patch.tripDestLocationId ?? '').trim()
        : cur.tripDestLocationId,
    tripOriginLocationId:
      patch.tripOriginLocationId !== undefined
        ? String(patch.tripOriginLocationId ?? '').trim()
        : cur.tripOriginLocationId,
    tripPhase:
      patch.tripPhase !== undefined ? String(patch.tripPhase ?? '').trim() : cur.tripPhase,
    remainingDistM:
      patch.remainingDistM !== undefined
        ? patch.remainingDistM == null || !Number.isFinite(+patch.remainingDistM)
          ? null
          : +patch.remainingDistM
        : cur.remainingDistM,
  }
}
