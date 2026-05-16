<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import TrailerLocationMap from '../components/TrailerLocationMap.vue'
import { fetchFedexLinehaulLocation } from '../api.js'
import { formatLinehaulLocationForDisplay } from '../utils/linehaulLocationDisplay.js'
import {
  TRAILER_GPS_USER_PATCH_EVENT,
  readTrailerGpsSession,
  clearTrailerGpsSession,
} from '../utils/trailerGpsMapSession.js'
import {
  maybeAnnounceNearTrailer,
  isTripAlertEnabled,
  isTrailerGpsTtsEnabled,
  tripVoiceShowUnlockHint,
} from '../utils/tripVoiceAnnouncement.js'

const router = useRouter()

/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const pageData = ref(null)

/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const sessionMeta = ref(null)

/** @type {import('vue').Ref<unknown[]>} */
const proximityTrailers = ref([])

const tripVoiceUnlockHint = ref(false)

function syncTripVoiceUnlockHintLocal() {
  tripVoiceUnlockHint.value = tripVoiceShowUnlockHint()
}

/** @type {number | null} */
let tripProximityWatchId = null

function stopTripProximityWatch() {
  if (
    tripProximityWatchId != null &&
    typeof navigator !== 'undefined' &&
    navigator.geolocation &&
    typeof navigator.geolocation.clearWatch === 'function'
  ) {
    navigator.geolocation.clearWatch(tripProximityWatchId)
  }
  tripProximityWatchId = null
}

function tryStartTripProximityWatch() {
  if (!isTripAlertEnabled()) {
    stopTripProximityWatch()
    return
  }
  if (!isTrailerGpsTtsEnabled()) {
    stopTripProximityWatch()
    return
  }
  syncTripVoiceUnlockHintLocal()
  if (tripVoiceUnlockHint.value) {
    stopTripProximityWatch()
    return
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation?.watchPosition) return
  stopTripProximityWatch()
  tripProximityWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const tr = proximityTrailers.value
      if (!Array.isArray(tr)) return
      maybeAnnounceNearTrailer(pos.coords.latitude, pos.coords.longitude, tr, {
        mapOpen: true,
      })
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  )
}

/** @type {(() => void) | null} */
let unlistenUserPatch = null

function closePage() {
  stopTripProximityWatch()
  clearTrailerGpsSession()
  void router.push({ name: 'home' })
}

/**
 * Hydrate terminal cards (phone / name) from Linehaul API when skeleton slots are loading.
 */
async function hydrateTerminalPair() {
  const data = pageData.value
  const pair = data?.terminalPair
  if (!pair || typeof pair !== 'object') return

  const meta = sessionMeta.value
  const linehaulOriginIdForApi =
    meta && typeof meta.linehaulOriginIdForApi === 'string'
      ? String(meta.linehaulOriginIdForApi).trim()
      : ''
  const tripDestLocationId =
    meta && typeof meta.tripDestLocationId === 'string' ? String(meta.tripDestLocationId).trim() : ''
  const tripOriginLocationId =
    meta && typeof meta.tripOriginLocationId === 'string' ? String(meta.tripOriginLocationId).trim() : ''

  /**
   * @param {'origin' | 'destination'} slotKey
   * @param {string} id
   * @param {string} [otherTripLegId]
   */
  async function fillSlot(slotKey, id, otherTripLegId) {
    const idStr = String(id).trim()
    if (!idStr) return
    const cur = pageData.value
    const slot0 = cur?.terminalPair?.[slotKey]
    if (!slot0 || slot0.loading !== true || String(slot0.locationId) !== idStr) return

    const r = await fetchFedexLinehaulLocation({
      locationId: idStr,
      originId: otherTripLegId || linehaulOriginIdForApi || undefined,
    })
    const curPair = pageData.value?.terminalPair
    if (!curPair?.[slotKey] || String(curPair[slotKey].locationId) !== idStr) return

    const body = r.ok ? r.body : null
    const cur2 = pageData.value?.terminalPair
    if (!cur2?.[slotKey] || String(cur2[slotKey].locationId) !== idStr) return

    if (!body || typeof body !== 'object') {
      pageData.value = {
        ...pageData.value,
        terminalPair: {
          ...cur2,
          [slotKey]: { ...cur2[slotKey], loading: false },
        },
      }
      return
    }
    const fmt = formatLinehaulLocationForDisplay(body)
    const locRow = fmt.rows.find((x) => x.label === 'Location')
    const phoneR = fmt.rows.find((x) => x.label === 'Phone')
    const fallbackName = String(cur2[slotKey].name ?? '').trim() || `Location ${idStr}`
    pageData.value = {
      ...pageData.value,
      terminalPair: {
        ...cur2,
        [slotKey]: {
          locationId: idStr,
          name: (locRow?.value && String(locRow.value).trim()) || fallbackName,
          phoneDisplay: phoneR?.value ? String(phoneR.value).trim() : '',
          telHref: phoneR?.href ? String(phoneR.href) : '',
          loading: false,
        },
      },
    }
  }

  await Promise.all([
    pair.origin?.locationId && pair.origin.loading === true
      ? fillSlot('origin', String(pair.origin.locationId), tripDestLocationId || undefined)
      : Promise.resolve(),
    pair.destination?.locationId && pair.destination.loading === true
      ? fillSlot('destination', String(pair.destination.locationId), tripOriginLocationId || undefined)
      : Promise.resolve(),
  ])
}

function onUserPatchEvent(/** @type {Event} */ e) {
  const ce = /** @type {CustomEvent<Record<string, unknown>>} */ (e)
  const d = ce.detail
  if (!d || typeof d !== 'object') return
  if (!pageData.value) return
  pageData.value = { ...pageData.value, ...d }
  tryStartTripProximityWatch()
}

onMounted(() => {
  syncTripVoiceUnlockHintLocal()
  const raw = readTrailerGpsSession()
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('map' in raw) ||
    !raw.map ||
    typeof raw.map !== 'object'
  ) {
    void router.replace({ name: 'home' })
    return
  }
  const m = /** @type {{ map: Record<string, unknown>, meta?: Record<string, unknown> }} */ (raw)
  pageData.value = { ...m.map }
  sessionMeta.value = m.meta && typeof m.meta === 'object' ? { ...m.meta } : null
  const pt = m.meta?.proximityTrailers
  proximityTrailers.value = Array.isArray(pt) ? pt : []

  void hydrateTerminalPair()

  if (typeof window !== 'undefined') {
    window.addEventListener(TRAILER_GPS_USER_PATCH_EVENT, onUserPatchEvent)
    unlistenUserPatch = () => window.removeEventListener(TRAILER_GPS_USER_PATCH_EVENT, onUserPatchEvent)
  }

  tryStartTripProximityWatch()
})

onBeforeUnmount(() => {
  stopTripProximityWatch()
  if (unlistenUserPatch) unlistenUserPatch()
})

const trailerMapPins = computed(() =>
  Array.isArray(pageData.value?.trailerMapPins) ? pageData.value.trailerMapPins : [],
)
const terminalPairProp = computed(() => pageData.value?.terminalPair ?? null)
const trailerLabelText = computed(() => {
  const p = pageData.value
  if (!p) return 'Trailer'
  const o = p.order != null ? String(p.order) : ''
  const n = p.trlrNbr ? String(p.trlrNbr) : ''
  return `Trailer ${o}${n ? ` · #${n}` : ''}`
})

watch(
  () =>
    pageData.value && [
      pageData.value.userLat,
      pageData.value.userLng,
      pageData.value.userGpsPending,
      pageData.value.userGeoDenied,
    ],
  () => {
    tryStartTripProximityWatch()
  },
)
</script>

<template>
  <div v-if="pageData" class="trailer-gps-page" role="region" aria-label="Trailer location map">
    <div class="trailer-gps-topbar">
      <div
        class="trailer-gps-topbar-info"
        role="group"
        :aria-label="String(sessionMeta?.odHeaderSingleLine || 'Trip route')"
      >
        <p class="trailer-gps-od-single">
          {{ sessionMeta?.odHeaderSingleLine ?? 'Origin: — · Destination: —' }}
        </p>
        <span
          v-if="pageData.lat != null && pageData.lng != null"
          class="sr-only"
        >Selected trailer coordinates {{ Number(pageData.lat).toFixed(5) }}, {{ Number(pageData.lng).toFixed(5) }}</span>
      </div>
      <button
        type="button"
        class="trailer-gps-close tap"
        aria-label="Close"
        @click="closePage"
      >
        ×
      </button>
    </div>
    <div class="trailer-gps-map-wrap">
      <TrailerLocationMap
        :trailers="trailerMapPins"
        :heavy-trailer-order="String(pageData.heavyTrailerOrder || '')"
        :terminal-pair="terminalPairProp"
        :user-lat="pageData.userLat"
        :user-lng="pageData.userLng"
        :user-location-pending="!!pageData.userGpsPending"
        :user-location-denied="!!pageData.userGeoDenied"
        :user-location-accuracy-m="
          pageData.userAccuracyM != null && Number.isFinite(Number(pageData.userAccuracyM))
            ? Number(pageData.userAccuracyM)
            : null
        "
        :user-vehicle-id="String(pageData.userVehicleId || '')"
        :trailer-label="trailerLabelText"
      />
    </div>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Match prior full-screen modal chrome (MainDashboard trailer GPS) */
.trailer-gps-page {
  width: 100%;
  max-width: none;
  height: 100%;
  min-height: 0;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #0a0a0f;
}

.trailer-gps-topbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  padding-top: max(0.5rem, env(safe-area-inset-top, 0px));
  background: #0a0a0f;
  border-bottom: 1px solid #1e1e28;
}

.trailer-gps-topbar-info {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  flex: 1;
}

.trailer-gps-od-single {
  margin: 0;
  min-width: 0;
  flex: 1;
  font-size: clamp(0.72rem, 2.2vw + 0.15vh, 0.92rem);
  font-weight: 600;
  line-height: 1.28;
  color: #ececf4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trailer-gps-close {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(40, 40, 50, 0.8);
  color: #e8e8ee;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.trailer-gps-close:hover {
  background: rgba(60, 60, 70, 0.9);
}

.trailer-gps-map-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: #0a0a0f;
}
</style>
