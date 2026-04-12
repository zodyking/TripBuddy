<script setup>
import {
  ref,
  watch,
  computed,
  onMounted,
  onUnmounted,
  onActivated,
  nextTick,
} from 'vue'
import {
  getAssignment,
  getCredentials,
  postCancelRun,
  getAutomationPreview,
  getHealth,
  listAutomations,
  runAutomation,
  postRetryLocation,
  postCancelRetry,
  fetchFedexLinehaulLocation,
} from '../api.js'
import {
  linehaulTractorBody,
  linehaulDriverBody,
  linehaulTractorError,
  linehaulDriverError,
  linehaulTripReadyBody,
  linehaulTripReadyError,
  linehaulTripsBody,
  linehaulTripsError,
  linehaulTripsNoActive,
  linehaulLastFetchAt,
  linehaulFetching,
  linehaulLocationMatch,
  refreshLinehaulApis,
  tripPhase,
  linehaulDriverIdFromCredMeta,
} from '../stores/linehaulSnapshotStore.js'
import {
  registerApiRecover,
  ensureFedexApiReady,
} from '../composables/useApiHealth.js'
import {
  liveLogEntries,
  registerAssignmentListener,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import { formatRunErrorForUser } from '../utils/runErrorFormat.js'
import { isCheckInLocationMismatchMessage } from '../utils/checkInLocationMismatch.js'
import { parseTripReadyBoolean } from '../utils/tripReadyParse.js'
import {
  extractOriginDest,
  hasTripOriginAndDestination,
  buildEnhancedTrailerCards,
  buildDollySection,
} from '../utils/tripDetailsDisplay.js'
import { formatLinehaulLocationForDisplay } from '../utils/linehaulLocationDisplay.js'
import {
  maybeAnnounceNewTrip,
  cancelTripVoiceAnnouncement,
  unlockTripVoiceFromUserGesture,
  tripVoiceShowUnlockHint,
  isTripAlertEnabled,
  maybeAnnounceStatusChange,
  maybeAnnounceTrailerStatusChange,
  clearTrailerStatusTracking,
  clearTripPhaseTracking,
} from '../utils/tripVoiceAnnouncement.js'
import {
  announceTractorChange,
  announceDriverChange,
  announceCheckInSuccess,
  announceCheckInFail,
  cancelAllAlerts,
} from '../utils/alertAudioQueue.js'

const PORTAL_Z_BANNER = 2_147_483_000
const PORTAL_Z_MODAL = 2_147_483_001
const PORTAL_Z_LOCATION_MODAL = 2_147_483_002

const assignmentAlert = ref(null)
const loadError = ref(null)
const runMsg = ref(null)
const runErrorBanner = ref(null)
const runStartTs = ref(null)

const checkInSuccessBanner = ref(null)
const checkInFailureText = ref(null)

const locationRetryOpen = ref(false)
const locationRetryFedexMessage = ref('')
const locationRetryInput = ref('')
const locationRetrySubmitting = ref(false)
const inBrowserRetryRunId = ref(null)
const streamBannerHandledKey = ref(null)

const destLocationModalOpen = ref(false)
const destLocationLoading = ref(false)
const destLocationError = ref('')
/** @type {import('vue').Ref<unknown>} */
const destLocationBody = ref(null)

const trailerGpsModalOpen = ref(false)
/** @type {import('vue').Ref<{ order: string, trlrNbr: string, lat: number, lng: number } | null>} */
const trailerGpsData = ref(null)

const instructions = ref('')
const tractorLocation = ref('')

const automationPreview = ref(null)
const automationPreviewHidden = ref(false)
let previewPollTimer = null
/** @type {ReturnType<typeof setInterval> | null} */
let linehaulPollTimer = null
const lastPreviewBusy = ref(false)

const quickActionAutomations = ref([])
const runningAutomationId = ref(null)

const tripStatusUi = computed(() => {
  const phase = tripPhase.value
  if (phase === 'dispatched') return { kind: 'dispatched', text: 'Dispatched' }
  if (phase === 'assigned') return { kind: 'assigned', text: 'Assigned' }
  if (linehaulTripsNoActive.value) return { kind: 'none', text: 'None' }
  if (linehaulLastFetchAt.value == null) return { kind: 'idle', text: 'Not loaded' }
  return { kind: 'none', text: 'None' }
})

const tripStatusDotClass = computed(() => {
  switch (tripStatusUi.value.kind) {
    case 'dispatched':
      return 'is-dispatched'
    case 'assigned':
      return 'is-assigned'
    case 'none':
      return 'is-none'
    case 'idle':
      return 'is-idle'
    default:
      return 'is-none'
  }
})

const tripStatusDetailTitle = computed(() => {
  const phase = tripPhase.value
  if (phase === 'dispatched') {
    return 'Trip is dispatched (DSPCH or driver/tractor ENRT).'
  }
  if (phase === 'assigned') {
    return 'Trip is assigned (APRVD) and ready to dispatch.'
  }
  return ''
})

const tripOriginDest = computed(() => extractOriginDest(linehaulTripsBody.value))

const tripTrailerCards = computed(() =>
  buildEnhancedTrailerCards(linehaulTripsBody.value),
)

const expandedTrailers = ref({})

const tripDollySection = computed(() =>
  buildDollySection(linehaulTripsBody.value),
)

/** Trip destination location number for v2 transportation-network API (path param). */
const tripDestLocationId = computed(() => {
  const b = linehaulTripsBody.value
  if (!b || typeof b !== 'object') return ''
  const n = /** @type {Record<string, unknown>} */ (b).tripDestNumber
  return n != null && String(n).trim() !== '' ? String(n).trim() : ''
})

/** originId header for Linehaul calls: tractor snapshot, else trip current location. */
const linehaulOriginIdForApi = computed(() => {
  const tid = linehaulTractorBody.value?.locationId
  if (tid != null && String(tid).trim() !== '') return String(tid).trim()
  const b = linehaulTripsBody.value
  if (b && typeof b === 'object') {
    const o = /** @type {Record<string, unknown>} */ (b)
    const cur = o.originLocation ?? o.currentLocationNumber
    if (cur != null && String(cur).trim() !== '') return String(cur).trim()
  }
  return ''
})

const destLocationFormatted = computed(() =>
  formatLinehaulLocationForDisplay(destLocationBody.value),
)

const showSealOrTripPanel = computed(
  () =>
    linehaulTripsBody.value != null ||
    linehaulTripsError.value != null ||
    linehaulTripsNoActive.value,
)

const tripVoiceUnlockHint = ref(false)
const tripAlertOn = computed(() => isTripAlertEnabled())

function syncTripVoiceUnlockHint() {
  tripVoiceUnlockHint.value = tripVoiceShowUnlockHint()
}

function onUnlockTripVoiceTap() {
  unlockTripVoiceFromUserGesture()
  syncTripVoiceUnlockHint()
}

async function loadQuickActions() {
  try {
    const all = await listAutomations()
    quickActionAutomations.value = all.filter((a) => a.enabled && a.hasManualTrigger)
  } catch {
    /* ignore */
  }
}

async function runQuickAction(auto) {
  if (runningAutomationId.value) return
  runningAutomationId.value = auto.id
  runStartTs.value = Date.now()
  streamBannerHandledKey.value = null
  dismissRunErrorBanner()
  dismissCheckInSuccess()
  dismissCheckInFailure()
  automationPreviewHidden.value = false
  try {
    if (!(await ensureFedexApiReady())) {
      setRunErrorBanner(
        'API is not running on port 3847. With vite-only dev, wait a few seconds for autostart, or run npm run dev from the project root.',
      )
      return
    }
    const result = await runAutomation(auto.id, { headless: true })
    if (result.ok) {
      if (result.variables?._bannerDetected === false) {
        checkInSuccessBanner.value = `${auto.manualButtonLabel || auto.name} completed`
      } else {
        runMsg.value = `${auto.manualButtonLabel || auto.name} completed`
      }
    } else {
      setRunErrorBanner(result.error || 'Failed')
    }
  } catch (e) {
    setRunErrorBanner(e instanceof Error ? e.message : String(e))
  } finally {
    runningAutomationId.value = null
    runStartTs.value = null
  }
}

function clearAutomationPreviewNow() {
  lastPreviewBusy.value = false
  automationPreview.value = null
}

async function dismissAutomationPreview() {
  automationPreviewHidden.value = true
  clearAutomationPreviewNow()
  try {
    await postCancelRun()
  } catch (e) {
    setRunErrorBanner(e instanceof Error ? e.message : String(e))
  }
}

function dismissRunErrorBanner() {
  runErrorBanner.value = null
}

function setRunErrorBanner(message) {
  const raw = typeof message === 'string' ? message : String(message)
  runErrorBanner.value = formatRunErrorForUser(raw)
}

function dismissCheckInFailure() {
  checkInFailureText.value = null
}

function dismissCheckInSuccess() {
  checkInSuccessBanner.value = null
}

async function openLocationRetryModal(bannerText, runId = null) {
  checkInFailureText.value = null
  locationRetryFedexMessage.value = bannerText
  locationRetryInput.value = ''
  if (runId) inBrowserRetryRunId.value = runId
  await nextTick()
  locationRetryOpen.value = true
}

async function cancelLocationRetry() {
  if (locationRetrySubmitting.value) return
  const msg = locationRetryFedexMessage.value
  const rid = inBrowserRetryRunId.value
  locationRetryOpen.value = false
  locationRetryFedexMessage.value = ''
  locationRetryInput.value = ''
  if (rid) {
    try {
      await postCancelRetry(rid)
    } catch {
      /* run may have ended */
    }
    inBrowserRetryRunId.value = null
  }
  if (msg) checkInFailureText.value = msg
}

async function saveLocationAndRetry() {
  if (locationRetrySubmitting.value) return
  const v = locationRetryInput.value.trim()
  if (!v) return
  locationRetrySubmitting.value = true
  dismissRunErrorBanner()
  try {
    const rid = inBrowserRetryRunId.value
    if (rid) {
      await postRetryLocation(rid, v)
      tractorLocation.value = v
      locationRetryOpen.value = false
      locationRetryFedexMessage.value = ''
      locationRetryInput.value = ''
      inBrowserRetryRunId.value = null
    }
  } catch (e) {
    setRunErrorBanner(e instanceof Error ? e.message : String(e))
  } finally {
    locationRetrySubmitting.value = false
  }
}

function handleCheckInBannerFromLiveLog() {
  if (!runningAutomationId.value) return
  const start = runStartTs.value
  if (start == null) return
  const list = liveLogEntries.value
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.ts < start) break

    if (
      e.locationRetryNeeded === true &&
      typeof e.runId === 'string' &&
      typeof e.bannerText === 'string' &&
      e.bannerText.trim() !== ''
    ) {
      const key = `lr:${e.runId}:${e.ts}`
      if (streamBannerHandledKey.value === key) return
      streamBannerHandledKey.value = key
      void openLocationRetryModal(e.bannerText, e.runId)
      return
    }

    if (
      e.checkInBanner === true &&
      typeof e.bannerText === 'string' &&
      e.bannerText.trim() !== '' &&
      !e.locationRetryNeeded
    ) {
      const key = e.bannerText.trim()
      if (streamBannerHandledKey.value === key) return
      streamBannerHandledKey.value = key
      const mismatch =
        e.locationMismatch === true ||
        isCheckInLocationMismatchMessage(e.bannerText)
      if (mismatch) {
        void openLocationRetryModal(e.bannerText, e.runId || null)
      } else {
        checkInFailureText.value = e.bannerText
        announceCheckInFail()
      }
      return
    }

    if (e.checkInComplete === true) {
      checkInSuccessBanner.value = 'Check in successful'
      announceCheckInSuccess()
      return
    }
  }
}

watch(
  liveLogEntries,
  () => {
    handleCheckInBannerFromLiveLog()
  },
  { deep: true },
)

watch(
  [linehaulTripsBody, linehaulTripsNoActive],
  () => {
    maybeAnnounceNewTrip(
      linehaulTripsBody.value,
      linehaulTripsNoActive.value,
    )
    syncTripVoiceUnlockHint()
  },
)

watch(
  tripPhase,
  (newPhase, oldPhase) => {
    if (oldPhase != null) {
      maybeAnnounceStatusChange(newPhase)
    }
    if (newPhase === 'none' && oldPhase !== 'none') {
      clearTrailerStatusTracking()
    }
  },
)

watch(
  () => {
    const body = linehaulTripsBody.value
    if (!body || typeof body !== 'object') return null
    const trailers = /** @type {Record<string, unknown>} */ (body).trailers
    return Array.isArray(trailers) ? trailers : null
  },
  (trailers) => {
    if (trailers) {
      maybeAnnounceTrailerStatusChange(trailers)
    }
  },
  { deep: true },
)

let prevTractorFingerprint = ''
let prevDriverFingerprint = ''

function getTractorFingerprint(body) {
  if (!body) return ''
  return JSON.stringify({
    locationId: body.locationId,
    tractorNbr: body.tractorNbr,
    tractorDomicileAbbrv: body.tractorDomicileAbbrv,
    detlCodeActvStat: body.detlCodeActvStat,
    detlCodeAvailStat: body.detlCodeAvailStat,
  })
}

function getDriverFingerprint(body) {
  if (!body) return ''
  return JSON.stringify({
    driverLocation: body.driverLocation,
    driverActvStat: body.driverActvStat,
    driverAvlStat: body.driverAvlStat,
  })
}

watch(
  linehaulTractorBody,
  (newVal, oldVal) => {
    if (!oldVal || !newVal) {
      prevTractorFingerprint = getTractorFingerprint(newVal)
      return
    }
    const newFp = getTractorFingerprint(newVal)
    if (prevTractorFingerprint && newFp !== prevTractorFingerprint) {
      announceTractorChange()
    }
    prevTractorFingerprint = newFp
  },
  { deep: true },
)

watch(
  linehaulDriverBody,
  (newVal, oldVal) => {
    if (!oldVal || !newVal) {
      prevDriverFingerprint = getDriverFingerprint(newVal)
      return
    }
    const newFp = getDriverFingerprint(newVal)
    if (prevDriverFingerprint && newFp !== prevDriverFingerprint) {
      announceDriverChange()
    }
    prevDriverFingerprint = newFp
  },
  { deep: true },
)

async function loadAssignment() {
  loadError.value = null
  try {
    const a = await getAssignment()
    instructions.value = a.instructions ?? ''
    tractorLocation.value = a.tractorLocation ?? ''
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
}

function dismissAlert() {
  assignmentAlert.value = null
}

async function openDestLocationModal() {
  if (!tripDestLocationId.value) return
  destLocationModalOpen.value = true
  destLocationLoading.value = true
  destLocationError.value = ''
  destLocationBody.value = null
  const r = await fetchFedexLinehaulLocation({
    locationId: tripDestLocationId.value,
    originId: linehaulOriginIdForApi.value || undefined,
  })
  destLocationLoading.value = false
  if (!r.ok) {
    destLocationError.value = r.error || `Request failed (${r.status})`
    destLocationBody.value = r.body ?? null
    return
  }
  destLocationBody.value = r.body ?? null
}

function closeDestLocationModal() {
  destLocationModalOpen.value = false
}

function openTrailerGpsModal(card) {
  if (!card.hasGps || card.lat == null || card.lng == null) return
  trailerGpsData.value = {
    order: card.order,
    trlrNbr: card.trlrNbr,
    lat: card.lat,
    lng: card.lng,
  }
  trailerGpsModalOpen.value = true
}

function closeTrailerGpsModal() {
  trailerGpsModalOpen.value = false
  trailerGpsData.value = null
}

const trailerGpsMapUrl = computed(() => {
  if (!trailerGpsData.value) return ''
  const { lat, lng } = trailerGpsData.value
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
})

const trailerGpsEmbedUrl = computed(() => {
  if (!trailerGpsData.value) return ''
  const { lat, lng } = trailerGpsData.value
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.003},${lng + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lng}`
})

/** Credentials snapshot for Driver ID row (same rule as header badges used). */
const linehaulCredMeta = ref(null)

const linehaulDriverIdDisplay = computed(() =>
  linehaulDriverIdFromCredMeta(linehaulCredMeta.value ?? {}),
)

async function refreshLinehaulCredMeta() {
  try {
    linehaulCredMeta.value = await getCredentials()
  } catch {
    linehaulCredMeta.value = null
  }
}

async function setupLinehaulPolling() {
  if (linehaulPollTimer) {
    clearInterval(linehaulPollTimer)
    linehaulPollTimer = null
  }
  if (!(await ensureFedexApiReady())) return
  try {
    await refreshLinehaulApis()
  } catch {
    /* ignore */
  }
  try {
    const c = await getCredentials()
    const raw =
      typeof c.linehaulPollMinutes === 'number' ? c.linehaulPollMinutes : 0
    const m = Math.max(0, Math.min(60, Math.floor(raw)))
    if (m > 0) {
      linehaulPollTimer = setInterval(() => {
        void refreshLinehaulApis()
      }, m * 60 * 1000)
    }
  } catch {
    /* ignore */
  }
}

async function pollAutomationPreview() {
  try {
    const health = await getHealth()
    lastPreviewBusy.value = Boolean(health.busy)
    if (!health.busy) {
      automationPreview.value = null
      return
    }
    const p = await getAutomationPreview()
    if (p.busy && p.image) {
      automationPreview.value = {
        src: `data:image/jpeg;base64,${p.image}`,
        ts: p.ts ?? Date.now(),
      }
    } else if (!p.busy) {
      automationPreview.value = null
    }
  } catch {
    /* API down */
  }
}

let unregisterRecover = () => {}
let unregisterAssignment = () => {}

onMounted(async () => {
  unregisterAssignment = registerAssignmentListener((data) => {
    assignmentAlert.value = {
      ts: data.ts,
      message: data.message || 'Assignment change detected',
      detail: data.current ?? data,
    }
  })
  unregisterRecover = registerApiRecover(reconnectLiveLogStream)
  await loadAssignment()
  void refreshLinehaulCredMeta()
  void loadQuickActions()
  void pollAutomationPreview()
  previewPollTimer = setInterval(pollAutomationPreview, 1600)
  void setupLinehaulPolling()
})

onActivated(() => {
  loadAssignment()
  void refreshLinehaulCredMeta()
  void loadQuickActions()
  void setupLinehaulPolling()
})

onUnmounted(() => {
  cancelTripVoiceAnnouncement()
  cancelAllAlerts()
  clearTrailerStatusTracking()
  clearTripPhaseTracking()
  unregisterAssignment()
  unregisterRecover()
  if (previewPollTimer) {
    clearInterval(previewPollTimer)
    previewPollTimer = null
  }
  if (linehaulPollTimer) {
    clearInterval(linehaulPollTimer)
    linehaulPollTimer = null
  }
})
</script>

<template>
  <div class="main">
    <Teleport to="body">
      <div
        v-if="checkInFailureText"
        class="portal-checkin-banner"
        :style="{ zIndex: PORTAL_Z_BANNER }"
        role="alert"
        aria-live="assertive"
      >
        <div class="portal-checkin-banner-inner">
          <strong>FedEx message</strong>
          <p class="checkin-fail-text">{{ checkInFailureText }}</p>
        </div>
        <button type="button" class="tap icon-close" aria-label="Dismiss" @click="dismissCheckInFailure">
          ×
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="checkInSuccessBanner"
        class="portal-checkin-success"
        :style="{ zIndex: PORTAL_Z_BANNER }"
        role="status"
        aria-live="polite"
      >
        <div class="portal-checkin-success-inner">
          <strong>Success</strong>
          <p class="checkin-success-text">{{ checkInSuccessBanner }}</p>
        </div>
        <button type="button" class="tap icon-close-success" aria-label="Dismiss" @click="dismissCheckInSuccess">
          ×
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="locationRetryOpen"
        class="portal-modal-backdrop"
        :style="{ zIndex: PORTAL_Z_MODAL }"
        role="presentation"
        @click.self="cancelLocationRetry"
      >
        <div
          class="portal-modal loc-retry-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="loc-retry-title"
          @click.stop
        >
          <div class="loc-retry-header">
            <h3 id="loc-retry-title" class="loc-retry-title">Wrong dispatch location</h3>
            <button
              type="button"
              class="loc-retry-close tap"
              aria-label="Close"
              @click="cancelLocationRetry"
            >
              ×
            </button>
          </div>
          <p class="loc-retry-desc">
            Your saved <strong>Current location</strong> does not match FedEx. Enter the correct code below; it
            is saved to your assignment and the open browser session retries immediately.
          </p>
          <div class="portal-fedex-quote-box" role="note">
            <span class="portal-fedex-quote-label">FedEx message</span>
            <p class="portal-fedex-quote">{{ locationRetryFedexMessage }}</p>
          </div>
          <label class="modal-lbl" for="loc-retry-inp">New location code</label>
          <input
            id="loc-retry-inp"
            v-model="locationRetryInput"
            class="modal-inp loc-retry-inp"
            type="text"
            autocomplete="off"
            :disabled="locationRetrySubmitting"
            @keyup.enter="saveLocationAndRetry"
          />
          <div class="modal-actions loc-retry-actions">
            <button type="button" class="btn secondary tap loc-retry-btn-secondary" @click="cancelLocationRetry">
              Cancel
            </button>
            <button
              type="button"
              class="btn primary tap loc-retry-btn-primary"
              :disabled="locationRetrySubmitting || !locationRetryInput.trim()"
              title="Save location to assignment and retry"
              aria-label="Save location and retry"
              @click="saveLocationAndRetry"
            >
              {{ locationRetrySubmitting ? 'Saving…' : 'Save & retry' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="destLocationModalOpen"
        class="portal-modal-backdrop"
        :style="{ zIndex: PORTAL_Z_LOCATION_MODAL }"
        role="presentation"
        @click.self="closeDestLocationModal"
      >
        <div
          class="portal-modal dest-location-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dest-loc-title"
          @click.stop
        >
          <div class="dest-loc-header">
            <h3 id="dest-loc-title" class="dest-loc-title">Destination location</h3>
            <button
              type="button"
              class="dest-loc-close tap"
              aria-label="Close"
              @click="closeDestLocationModal"
            >
              ×
            </button>
          </div>
          <p v-if="tripDestLocationId" class="dest-loc-id">Trip destination · ID {{ tripDestLocationId }}</p>
          <div v-if="destLocationLoading" class="dest-loc-loading" aria-live="polite">Loading…</div>
          <p v-else-if="destLocationError" class="err dest-loc-err">{{ destLocationError }}</p>
          <template v-else>
            <dl v-if="destLocationFormatted.rows.length" class="dest-loc-dl">
              <template v-for="row in destLocationFormatted.rows" :key="row.label + row.value + (row.href || '')">
                <dt>{{ row.label }}</dt>
                <dd>
                  <a
                    v-if="row.href"
                    :href="row.href"
                    class="dest-loc-link"
                    :target="row.href.startsWith('tel:') ? undefined : '_blank'"
                    :rel="row.href.startsWith('http') ? 'noopener noreferrer' : undefined"
                    @click.stop
                  >
                    {{ row.value }}
                  </a>
                  <template v-else>{{ row.value }}</template>
                </dd>
              </template>
            </dl>
            <p v-else class="dest-loc-empty">No location fields could be parsed from the response.</p>
            <details
              v-if="destLocationFormatted.rawJson"
              class="dest-loc-raw-details"
            >
              <summary class="dest-loc-raw-summary">Raw API response</summary>
              <pre class="dest-loc-raw" aria-label="Raw API response">{{ destLocationFormatted.rawJson }}</pre>
            </details>
          </template>
          <div class="modal-actions dest-loc-actions">
            <button type="button" class="btn primary tap" @click="closeDestLocationModal">Close</button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="trailerGpsModalOpen && trailerGpsData"
        class="portal-modal-backdrop"
        :style="{ zIndex: PORTAL_Z_LOCATION_MODAL }"
        role="presentation"
        @click.self="closeTrailerGpsModal"
      >
        <div
          class="portal-modal trailer-gps-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trailer-gps-title"
          @click.stop
        >
          <div class="trailer-gps-header">
            <h3 id="trailer-gps-title" class="trailer-gps-title">
              Trailer {{ trailerGpsData.order }} Location
            </h3>
            <button
              type="button"
              class="trailer-gps-close tap"
              aria-label="Close"
              @click="closeTrailerGpsModal"
            >
              ×
            </button>
          </div>
          <p v-if="trailerGpsData.trlrNbr" class="trailer-gps-id">
            Trailer #{{ trailerGpsData.trlrNbr }}
          </p>
          <div class="trailer-gps-coords">
            <span>{{ trailerGpsData.lat.toFixed(5) }}, {{ trailerGpsData.lng.toFixed(5) }}</span>
          </div>
          <div class="trailer-gps-map-wrap">
            <iframe
              :src="trailerGpsEmbedUrl"
              class="trailer-gps-map"
              loading="lazy"
              referrerpolicy="no-referrer"
              title="Trailer location map"
            />
          </div>
          <div class="modal-actions trailer-gps-actions">
            <a
              :href="trailerGpsMapUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="btn secondary tap"
            >
              Open in OpenStreetMap
            </a>
            <button type="button" class="btn primary tap" @click="closeTrailerGpsModal">
              Close
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <div
      v-if="runErrorBanner"
      class="run-error-banner"
      role="alert"
      aria-live="polite"
    >
      <div class="run-error-inner">
        <strong>Run error</strong>
        <p class="run-error-text">{{ runErrorBanner }}</p>
      </div>
      <button type="button" class="tap icon-close" aria-label="Dismiss" @click="dismissRunErrorBanner">
        ×
      </button>
    </div>

    <div v-if="assignmentAlert" class="banner" role="status">
      <span>{{ assignmentAlert.message }}</span>
      <button type="button" class="tap dismiss" @click="dismissAlert">Dismiss</button>
    </div>

    <p v-if="loadError" class="err">{{ loadError }}</p>
    <p v-if="runMsg" class="msg">{{ runMsg }}</p>

    <section
      v-if="lastPreviewBusy && !automationPreviewHidden"
      class="panel preview-panel"
      aria-label="Browser automation preview"
    >
      <button
        type="button"
        class="preview-close tap"
        aria-label="Stop automation and close preview"
        @click="dismissAutomationPreview"
      >
        ×
      </button>
      <div v-if="automationPreview" class="preview-frame">
        <img
          :src="automationPreview.src"
          alt=""
          class="preview-img"
        />
      </div>
      <div v-else class="preview-frame preview-frame-empty" aria-hidden="true" />
    </section>

    <section class="panel driver-status-panel">
      <div class="driver-status-card-head">
        <h2 class="driver-status-heading">Driver Status</h2>
        <span
          v-if="linehaulLocationMatch !== null && (linehaulTractorBody || linehaulDriverBody)"
          class="driver-status-loc-pill"
          :class="linehaulLocationMatch ? 'is-aligned' : 'is-mismatch'"
          role="status"
          :aria-label="
            linehaulLocationMatch
              ? 'Tractor and driver locations match'
              : 'Tractor and driver locations do not match'
          "
        >
          {{ linehaulLocationMatch ? 'Aligned' : 'Mismatch' }}
        </span>
      </div>
      <div class="driver-status-surface">
        <p v-if="linehaulFetching" class="driver-status-fetching" aria-live="polite">Updating…</p>
        <p
          v-else-if="linehaulLastFetchAt != null"
          class="driver-status-fetched-at"
        >
          <time :datetime="new Date(linehaulLastFetchAt).toISOString()">{{
            new Date(linehaulLastFetchAt).toLocaleString()
          }}</time>
        </p>

        <div v-if="linehaulTractorError || linehaulDriverError" class="linehaul-errors">
          <p v-if="linehaulTractorError" class="err">Tractor Details: {{ linehaulTractorError }}</p>
          <p v-if="linehaulDriverError" class="err">Driver Details: {{ linehaulDriverError }}</p>
        </div>
        <div class="driver-status-cards">
          <div v-if="linehaulTractorBody" class="linehaul-block">
            <h4 class="linehaul-h3">Tractor</h4>
            <dl class="linehaul-dl">
              <div v-if="linehaulTractorBody.locationId != null" class="linehaul-dl-row">
                <dt>Location</dt>
                <dd>{{ linehaulTractorBody.locationId }}</dd>
              </div>
              <div v-if="linehaulTractorBody.tractorNbr != null" class="linehaul-dl-row">
                <dt>Tractor</dt>
                <dd>{{ linehaulTractorBody.tractorNbr }}</dd>
              </div>
              <div v-if="linehaulTractorBody.tractorDomicileAbbrv" class="linehaul-dl-row">
                <dt>Domicile</dt>
                <dd>{{ linehaulTractorBody.tractorDomicileAbbrv }}</dd>
              </div>
              <div v-if="linehaulTractorBody.detlCodeActvStat" class="linehaul-dl-row">
                <dt>Active</dt>
                <dd>{{ linehaulTractorBody.detlCodeActvStat }}</dd>
              </div>
              <div v-if="linehaulTractorBody.detlCodeAvailStat" class="linehaul-dl-row">
                <dt>Status</dt>
                <dd>{{ linehaulTractorBody.detlCodeAvailStat }}</dd>
              </div>
            </dl>
          </div>

          <div v-if="linehaulDriverBody" class="linehaul-block">
            <h4 class="linehaul-h3">Driver</h4>
            <dl class="linehaul-dl">
              <div
                v-if="linehaulDriverBody.driverLocation != null && linehaulDriverBody.driverLocation !== ''"
                class="linehaul-dl-row"
              >
                <dt>Location</dt>
                <dd>{{ linehaulDriverBody.driverLocation }}</dd>
              </div>
              <div v-if="linehaulDriverIdDisplay" class="linehaul-dl-row">
                <dt>Driver ID</dt>
                <dd>{{ linehaulDriverIdDisplay }}</dd>
              </div>
              <div v-if="linehaulDriverBody.driverActvStat" class="linehaul-dl-row">
                <dt>Active</dt>
                <dd>{{ linehaulDriverBody.driverActvStat }}</dd>
              </div>
              <div v-if="linehaulDriverBody.driverAvlStat" class="linehaul-dl-row">
                <dt>Status</dt>
                <dd>{{ linehaulDriverBody.driverAvlStat }}</dd>
              </div>
            </dl>
          </div>
        </div>

        <p
          v-if="
            !linehaulFetching &&
            linehaulLastFetchAt == null &&
            !linehaulTractorError &&
            !linehaulDriverError
          "
          class="empty driver-status-idle"
        >
          Linehaul not loaded — use Settings → Manual fetch or set a refresh interval (save credentials).
        </p>
      </div>
    </section>

    <section class="panel dispatch-instructions-panel">
      <div class="dispatch-card-toolbar">
        <h2 class="dispatch-instructions-title">Dispatch Instructions</h2>
        <div
          class="trip-status-inline"
          role="status"
          :aria-label="`Trip Status: ${tripStatusUi.text}`"
          :title="tripStatusDetailTitle || undefined"
        >
          <span class="trip-status-dot" :class="tripStatusDotClass" aria-hidden="true" />
          <span class="trip-status-heading">Trip Status</span>
          <span class="trip-status-state">{{ tripStatusUi.text }}</span>
        </div>
      </div>
      <div
        v-if="tripVoiceUnlockHint && tripAlertOn"
        class="trip-voice-unlock-banner"
        role="status"
      >
        <button type="button" class="tap trip-voice-unlock-btn" @click="onUnlockTripVoiceTap">
          Tap to enable trip alerts
        </button>
        <span class="trip-voice-unlock-sub">Some phones and tablets require a tap before alerts can play.</span>
      </div>
      <div
        v-if="linehaulTripsBody && !linehaulTripsError"
        class="dispatch-od-row"
        aria-label="Trip origin and destination"
      >
        <div class="dispatch-od-pair dispatch-od-pair--origin">
          <span class="dispatch-od-label">Origin</span>
          <span class="dispatch-od-val">{{ tripOriginDest.origin }}</span>
        </div>
        <span class="dispatch-od-arrow" aria-hidden="true">→</span>
        <button
          type="button"
          class="dispatch-od-pair dispatch-od-pair--dest dispatch-od-dest-btn tap"
          :disabled="!tripDestLocationId || !!linehaulTripsError"
          :title="
            tripDestLocationId
              ? 'View destination details from FedEx'
              : 'No destination location id on trip'
          "
          @click="openDestLocationModal"
        >
          <span class="dispatch-od-label">Destination</span>
          <span class="dispatch-od-val">{{ tripOriginDest.destination }}</span>
        </button>
      </div>
      <p v-if="!instructions.trim()" class="empty">No instructions yet.</p>
      <p v-else class="read dispatch-instructions-body">{{ instructions }}</p>
    </section>

    <section v-if="showSealOrTripPanel" class="panel trip-details-panel">
      <h2>Trip Details</h2>
      <p
        v-if="
          linehaulTripsBody &&
          typeof linehaulTripsBody === 'object' &&
          linehaulTripsBody.tripStatus === 'DSPCH'
        "
        class="hint"
      >
        Dispatch snapshot (DSPCH); merged with approved trip fields when both are available.
      </p>

      <template v-if="linehaulTripsBody">
        <div class="trip-details-wrap">
          <details v-if="tripDollySection.show" class="trip-details-block" open>
            <summary class="trip-details-summary">Dolly</summary>
            <dl class="trip-details-dl">
              <template v-for="row in tripDollySection.rows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </template>
            </dl>
          </details>

          <div
            v-for="card in tripTrailerCards"
            :key="card.id"
            class="trailer-card"
          >
            <div
              class="trailer-card-header"
              role="button"
              tabindex="0"
              :aria-expanded="!!expandedTrailers[card.id]"
              @click="expandedTrailers[card.id] = !expandedTrailers[card.id]"
              @keydown.enter.space.prevent="expandedTrailers[card.id] = !expandedTrailers[card.id]"
            >
              <div class="trailer-card-main">
                <div class="trailer-card-title-row">
                  <span class="trailer-order">Trailer {{ card.order }}</span>
                  <span v-if="card.trlrNbr" class="trailer-nbr">#{{ card.trlrNbr }}</span>
                </div>
                <div class="trailer-card-badges">
                  <span class="trailer-size-badge" :class="card.size === '20ft' ? 'size-20' : 'size-53'">
                    {{ card.size }}
                  </span>
                  <span class="trailer-status-badge" :class="card.statusClass">
                    {{ card.statusLabel }}
                  </span>
                  <span class="trailer-load-badge" :class="card.loadTypeClass">
                    {{ card.loadType }}
                  </span>
                </div>
              </div>
              <div class="trailer-card-actions">
                <button
                  v-if="card.hasGps"
                  type="button"
                  class="trailer-location-btn tap"
                  title="View trailer location on map"
                  aria-label="View trailer location"
                  @click.stop="openTrailerGpsModal(card)"
                >
                  <svg class="trailer-location-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                    <circle cx="12" cy="9" r="2.5"/>
                  </svg>
                </button>
                <span class="trailer-expand-icon" aria-hidden="true">
                  {{ expandedTrailers[card.id] ? '−' : '+' }}
                </span>
              </div>
            </div>

            <div v-if="card.summaryRows.length" class="trailer-card-summary">
              <dl class="trailer-summary-dl">
                <template v-for="row in card.summaryRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
            </div>

            <div v-if="expandedTrailers[card.id] && card.detailRows.length" class="trailer-card-details">
              <dl class="trailer-details-dl">
                <template v-for="row in card.detailRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </template>
              </dl>
            </div>
          </div>
        </div>
      </template>
      <p v-else-if="linehaulTripsNoActive" class="empty trip-details-idle">No active trip</p>
      <p v-else-if="linehaulTripsError" class="err trip-details-fetch-err">
        Trip details: {{ linehaulTripsError }}
      </p>
    </section>

    <section class="panel actions">
      <h2>Quick actions</h2>
      <p v-if="!quickActionAutomations.length" class="empty">
        No automations yet. Create one in Settings → Automation with a Manual trigger.
      </p>
      <div v-else class="quick-actions-grid">
        <button
          v-for="auto in quickActionAutomations"
          :key="auto.id"
          type="button"
          class="btn primary tap quick-action-btn"
          :disabled="runningAutomationId !== null"
          @click="runQuickAction(auto)"
        >
          {{ runningAutomationId === auto.id ? 'Running…' : (auto.manualButtonLabel || auto.name) }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.main {
  padding: var(--space-4, 1rem) 0 var(--space-6, 1.5rem);
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
}
.portal-checkin-banner {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  padding-top: max(0.65rem, env(safe-area-inset-top));
  background: #3e1a1a;
  border-bottom: 1px solid #e57373;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  max-height: min(42vh, 320px);
  overflow-y: auto;
  font-size: 0.9rem;
  box-sizing: border-box;
}
.portal-checkin-banner-inner {
  min-width: 0;
}
.portal-checkin-banner-inner strong {
  display: block;
  margin-bottom: 0.35rem;
  color: #ffcdd2;
}
.checkin-fail-text {
  margin: 0;
  line-height: 1.4;
  color: var(--text, #e8f5e9);
  white-space: pre-wrap;
}
.portal-checkin-success {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  padding-top: max(0.65rem, env(safe-area-inset-top));
  background: #1b2e1b;
  border-bottom: 1px solid #81c784;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  font-size: 0.9rem;
  box-sizing: border-box;
}
.portal-checkin-success-inner {
  min-width: 0;
}
.portal-checkin-success-inner strong {
  display: block;
  margin-bottom: 0.35rem;
  color: #c8e6c9;
}
.checkin-success-text {
  margin: 0;
  line-height: 1.4;
  color: var(--text, #e8f5e9);
  white-space: pre-wrap;
}
.portal-checkin-banner .icon-close,
.portal-checkin-success .icon-close-success {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}
.portal-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  box-sizing: border-box;
}
.portal-modal {
  width: 100%;
  max-width: 22rem;
  max-height: min(90vh, 560px);
  overflow-y: auto;
  background: var(--card, #1a1a21);
  border: 1px solid var(--border, #2e2e38);
  border-radius: 12px;
  padding: 1.25rem;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.55);
}
.dest-location-modal {
  max-width: 26rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.dest-loc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.dest-loc-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.dest-loc-close {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}
.dest-loc-id {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted, #9898a8);
}
.dest-loc-loading {
  margin: 0;
  color: #90caf9;
  font-size: 0.9rem;
}
.dest-loc-err {
  margin: 0;
  font-size: 0.88rem;
}
.dest-loc-dl {
  display: grid;
  grid-template-columns: minmax(6.5rem, 0.35fr) 1fr;
  gap: 0.5rem 1rem;
  margin: 0;
  padding: 0.65rem 0.75rem;
  font-size: 0.88rem;
  line-height: 1.4;
  border: 1px solid #34343e;
  border-radius: 10px;
  background: #1e1e26;
}
.dest-loc-dl dt {
  margin: 0;
  color: var(--muted, #9898a8);
  font-weight: 600;
  font-size: 0.78rem;
}
.dest-loc-dl dd {
  margin: 0;
  font-weight: 600;
  word-break: break-word;
  color: var(--text, #e8e8ee);
  font-size: 0.92rem;
}
.dest-loc-link {
  color: #90caf9;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dest-loc-link:hover {
  color: #b3e5fc;
}
.dest-loc-empty {
  margin: 0;
  font-size: 0.88rem;
  color: var(--muted, #9898a8);
}
.dest-loc-raw-details {
  margin-top: 0.65rem;
}
.dest-loc-raw-summary {
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  list-style: none;
}
.dest-loc-raw-summary::-webkit-details-marker {
  display: none;
}
.dest-loc-raw {
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.6rem;
  font-size: 0.72rem;
  line-height: 1.35;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: #12121a;
  border: 1px solid #2e2e38;
  border-radius: 8px;
  color: var(--text, #e8e8ee);
}
.dest-loc-actions {
  margin-top: 0.25rem;
}
.driver-status-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0 0 var(--space-3, 0.75rem);
  min-width: 0;
}
.driver-status-heading {
  margin: 0;
  font-size: var(--text-md, 1rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: var(--tracking-tight, -0.02em);
  flex: 1;
  min-width: 0;
}
.panel.driver-status-panel h2.driver-status-heading {
  margin-bottom: 0;
}
.driver-status-loc-pill {
  flex-shrink: 0;
  box-sizing: border-box;
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1.15;
  padding: 0.22rem 0.45rem;
  border-radius: 9999px;
  white-space: nowrap;
}
.driver-status-loc-pill.is-aligned {
  background: var(--color-success-muted, rgba(34, 197, 94, 0.15));
  color: var(--color-success, #22c55e);
  border: 1px solid var(--color-success-border, rgba(34, 197, 94, 0.35));
}
.driver-status-loc-pill.is-mismatch {
  background: var(--color-error-muted, rgba(239, 68, 68, 0.15));
  color: var(--color-error, #ef4444);
  border: 1px solid var(--color-error-border, rgba(239, 68, 68, 0.3));
}
.driver-status-surface {
  margin-top: 0.15rem;
  border: 1px solid #34343e;
  border-radius: 10px;
  background: #18181f;
  padding: 0.5rem 0.6rem 0.6rem;
}
.driver-status-fetching {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  color: #90caf9;
}
.driver-status-fetched-at {
  margin: 0 0 0.4rem;
  font-size: 0.72rem;
  color: var(--muted, #9898a8);
}
.driver-status-fetched-at time {
  font-variant-numeric: tabular-nums;
}
.driver-status-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;
}
@media (min-width: 560px) {
  .driver-status-cards {
    grid-template-columns: 1fr 1fr;
  }
}
.driver-status-idle {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
}
.linehaul-dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}
.linehaul-dl-row {
  display: grid;
  grid-template-columns: minmax(4.5rem, 32%) 1fr;
  gap: 0.35rem 0.5rem;
  align-items: baseline;
  font-size: 0.78rem;
  line-height: 1.35;
}
.linehaul-dl-row dt {
  margin: 0;
  font-weight: 600;
  color: var(--muted, #9898a8);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
}
.linehaul-dl-row dd {
  margin: 0;
  color: var(--text, #e8e8ee);
  font-weight: 500;
  word-break: break-word;
}
.loc-retry-modal {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem 1.1rem;
}
.loc-retry-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.loc-retry-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--text, #e8e8ee);
}
.loc-retry-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  margin: -0.2rem -0.25rem 0 0;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #25252e;
  color: var(--text, #e8e8ee);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}
.loc-retry-desc {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: var(--muted, #9898a8);
}
.loc-retry-desc strong {
  color: var(--text, #e8e8ee);
  font-weight: 600;
}
.portal-fedex-quote-box {
  margin: 0;
  padding: 0.5rem 0.65rem 0.55rem;
  background: #12121a;
  border-radius: 8px;
  border: 1px solid #3d2727;
  border-left: 3px solid #e57373;
}
.portal-fedex-quote-label {
  display: block;
  margin: 0 0 0.3rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #e57373;
}
.portal-fedex-quote {
  margin: 0;
  padding: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--text, #e0e0e8);
  white-space: pre-wrap;
  word-break: break-word;
}
.modal-lbl {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
  color: var(--text, #e8e8ee);
}
.modal-inp {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  min-height: 44px;
  font-size: 1rem;
  box-sizing: border-box;
}
.loc-retry-inp {
  margin-bottom: 0;
}
.modal-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
.loc-retry-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.15rem;
}
.loc-retry-btn-primary,
.loc-retry-btn-secondary {
  min-height: 48px;
  padding: 0.55rem 0.65rem;
  font-size: 0.9rem;
}
.loc-retry-btn-primary {
  font-weight: 700;
}
.loc-retry-btn-primary:disabled {
  opacity: 0.85;
}
@media (max-width: 380px) {
  .loc-retry-actions {
    grid-template-columns: 1fr;
  }
  .loc-retry-btn-secondary {
    order: 2;
  }
  .loc-retry-btn-primary {
    order: 1;
  }
}
.run-error-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
  background: #2a1f08;
  border: 1px solid #d97706;
  border-radius: 10px;
  font-size: 0.9rem;
}
.run-error-inner {
  min-width: 0;
}
.run-error-inner strong {
  display: block;
  margin-bottom: 0.35rem;
  color: #fcd34d;
}
.run-error-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.4;
  color: var(--text, #e8e8ee);
}
.run-error-banner .icon-close {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3, 0.75rem);
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  background: var(--color-warning-muted, rgba(245, 158, 11, 0.15));
  border: 1px solid var(--color-warning-border, rgba(245, 158, 11, 0.3));
  border-radius: var(--radius-lg, 0.75rem);
  font-size: var(--text-sm, 0.8125rem);
  animation: slide-up var(--duration-normal, 200ms) var(--ease-out);
}
.dismiss {
  flex-shrink: 0;
  padding: var(--space-1-5, 0.375rem) var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-surface, #16161d);
  color: var(--color-text-primary, #f4f4f8);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  cursor: pointer;
  transition: var(--transition-colors);
}
.dismiss:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}
.err {
  color: #ff8a80;
}
.msg {
  color: #90caf9;
  font-size: 0.9rem;
}
.panel {
  position: relative;
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-lg, 20px));
  -webkit-backdrop-filter: blur(var(--blur-lg, 20px));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-xl, 1rem);
  padding: var(--space-4, 1rem);
  box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.3)),
              inset 0 1px 0 var(--color-glass-highlight, rgba(255, 255, 255, 0.03));
  animation: slide-up var(--duration-slow, 300ms) var(--ease-out) both;
}
.panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: var(--space-4, 1rem);
  right: var(--space-4, 1rem);
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-accent-purple, #7b4db5), var(--color-accent-orange, #ff6b1a), transparent);
  opacity: 0.4;
  border-radius: var(--radius-full, 9999px);
}
.panel h2 {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-md, 1rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: var(--tracking-tight, -0.02em);
}
.hint {
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-tertiary, #6e6e7e);
  margin: 0 0 var(--space-3, 0.75rem);
  line-height: var(--leading-relaxed, 1.65);
}
.empty {
  margin: 0;
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: var(--text-base, 0.9375rem);
  font-style: italic;
}
.read {
  margin: 0;
  white-space: pre-wrap;
  line-height: var(--leading-relaxed, 1.65);
  font-size: var(--text-base, 0.9375rem);
  color: var(--color-text-primary, #f4f4f8);
}
.subhead {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted, #9898a8);
  margin: 0.85rem 0 0.35rem;
}
.driver-status-surface .linehaul-errors {
  margin-bottom: 0.4rem;
}
.linehaul-errors .err {
  margin: 0.25rem 0;
  font-size: 0.85rem;
}
.driver-status-cards .linehaul-block {
  margin-top: 0;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  border: 1px solid #34343e;
  background: #22222c;
}
.linehaul-block {
  margin-top: 0.5rem;
}
.linehaul-h3 {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text, #e8e8ee);
  letter-spacing: 0.02em;
}
.dispatch-card-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-bottom: 0.65rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #2e2e38;
}
.dispatch-instructions-panel h2.dispatch-instructions-title {
  margin: 0;
  font-size: 1rem;
  flex: 1 1 auto;
  min-width: 0;
}
.dispatch-instructions-panel .dispatch-card-toolbar + .empty {
  margin-top: 0;
}
.trip-status-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
  max-width: 100%;
  font-size: 0.85rem;
}
.trip-status-heading {
  color: var(--muted, #9898a8);
  font-weight: 600;
}
.trip-status-state {
  font-weight: 600;
  color: var(--text, #e8e8ee);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}
.trip-status-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-full, 9999px);
  flex-shrink: 0;
  transition: var(--transition-colors);
}
.trip-status-dot.is-dispatched {
  background: var(--color-accent-purple, #7b4db5);
  box-shadow: 0 0 8px rgba(123, 77, 181, 0.5), 0 0 0 2px rgba(123, 77, 181, 0.2);
}
.trip-status-dot.is-assigned {
  background: var(--color-success, #22c55e);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5), 0 0 0 2px rgba(34, 197, 94, 0.2);
}
.trip-status-dot.is-none {
  background: var(--color-text-tertiary, #6e6e7e);
}
.trip-status-dot.is-idle {
  background: var(--color-text-tertiary, #6e6e7e);
  opacity: 0.6;
}
.dispatch-instructions-body {
  margin-top: 0;
}
.trip-voice-unlock-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #3d5a80;
  background: rgba(100, 181, 246, 0.08);
  font-size: 0.78rem;
}
.trip-voice-unlock-btn {
  flex: 0 0 auto;
  padding: 0.35rem 0.65rem;
  border-radius: 6px;
  border: 1px solid #64b5f6;
  background: #2a3f5a;
  color: #e8f4ff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.trip-voice-unlock-btn:focus-visible {
  outline: 2px solid #64b5f6;
  outline-offset: 2px;
}
.trip-voice-unlock-sub {
  flex: 1 1 12rem;
  color: var(--muted, #9898a8);
  line-height: 1.35;
}
.dispatch-od-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.5rem 0.75rem;
  margin: 0 0 0.85rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  background: #22222c;
  border: 1px solid #34343e;
  font-size: 0.85rem;
  width: 100%;
  box-sizing: border-box;
}
.dispatch-od-pair {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1 1 0;
}
.dispatch-od-pair--origin {
  align-items: flex-start;
  text-align: left;
}
.dispatch-od-pair--dest {
  align-items: flex-end;
  text-align: right;
}
.dispatch-od-dest-btn {
  background: transparent;
  border: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  padding: 0;
  margin: 0;
}
.dispatch-od-dest-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.dispatch-od-dest-btn:focus-visible {
  outline: 2px solid #64b5f6;
  outline-offset: 2px;
  border-radius: 6px;
}
.dispatch-od-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted, #9898a8);
}
.dispatch-od-val {
  font-weight: 600;
  word-break: break-word;
  line-height: 1.3;
}
.dispatch-od-arrow {
  color: var(--muted, #9898a8);
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0.15rem;
}
.trip-details-fetch-err {
  margin: 0 0 0.65rem;
  font-size: 0.88rem;
}
.trip-details-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-bottom: 0.5rem;
}
.trip-details-block {
  border: 1px solid #34343e;
  border-radius: 8px;
  background: #25252e;
  overflow: hidden;
}
.trip-details-summary {
  cursor: pointer;
  padding: 0.5rem 0.65rem;
  font-size: 0.88rem;
  font-weight: 600;
  list-style: none;
  color: var(--text, #e8e8ee);
}
.trip-details-summary::-webkit-details-marker {
  display: none;
}
.trip-details-dl {
  display: grid;
  grid-template-columns: minmax(6.5rem, auto) 1fr;
  gap: 0.4rem 0.85rem;
  margin: 0;
  padding: 0 0.65rem 0.6rem;
  font-size: 0.84rem;
  line-height: 1.35;
}
.trip-details-dl dt {
  margin: 0;
  color: var(--muted, #9898a8);
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: capitalize;
}
.trip-details-dl dd {
  margin: 0;
  font-weight: 600;
  word-break: break-word;
}
.linehaul-kv li {
  padding: 0.35rem 0;
  font-size: 0.88rem;
}
.kv {
  list-style: none;
  margin: 0;
  padding: 0;
}
.kv li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #2e2e38;
  font-size: 0.95rem;
}
.kv li:last-child {
  border-bottom: none;
}
.k {
  color: var(--muted, #9898a8);
}
.v {
  font-weight: 600;
  text-align: right;
  word-break: break-all;
}
.actions .btn + .btn {
  margin-top: 0.5rem;
}
.btn {
  min-height: var(--touch-target, 2.75rem);
  padding: 0 var(--space-4, 1rem);
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid transparent;
  font-size: var(--text-base, 0.9375rem);
  font-weight: var(--weight-semibold, 600);
  cursor: pointer;
  transition: var(--transition-all);
  position: relative;
  overflow: hidden;
}
.btn.primary {
  background: var(--color-accent-purple, #7b4db5);
  color: white;
  border: none;
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.25));
}
.btn.primary:hover {
  box-shadow: var(--shadow-glow-purple, 0 0 20px rgba(123, 77, 181, 0.25));
  transform: translateY(-1px);
}
.btn.primary:active {
  transform: translateY(0);
}
.btn.secondary {
  background: var(--color-bg-surface, #16161d);
  color: var(--color-text-primary, #f4f4f8);
  border-color: var(--color-border, rgba(255, 255, 255, 0.08));
}
.btn.secondary:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
  border-color: var(--color-accent-purple, #7b4db5);
}
.tap:active {
  opacity: 0.88;
}
.preview-panel {
  position: relative;
  padding-top: 2.5rem;
}
.preview-close {
  position: absolute;
  top: 0.5rem;
  right: 0.65rem;
  z-index: 2;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-panel .preview-frame {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border, #2e2e38);
  background: #0a0a0f;
  line-height: 0;
}
.preview-frame-empty {
  min-height: 120px;
}
.preview-img {
  width: 100%;
  height: auto;
  display: block;
  max-height: min(55vh, 520px);
  object-fit: contain;
  object-position: top center;
}
.quick-actions-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}
.quick-action-btn {
  width: 100%;
  min-height: var(--touch-target, 2.75rem);
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  font-size: var(--text-base, 0.9375rem);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPONSIVE — Mobile-first breakpoints
   ═══════════════════════════════════════════════════════════════════════════ */

@media (max-width: 374px) {
  .main {
    padding: var(--space-3, 0.75rem) 0;
    gap: var(--space-3, 0.75rem);
  }

  .panel {
    padding: var(--space-3, 0.75rem);
    border-radius: var(--radius-lg, 0.75rem);
  }

  .panel h2 {
    font-size: var(--text-base, 0.9375rem);
  }

}

@media (min-width: 420px) {
  .panel {
    padding: var(--space-5, 1.25rem);
  }
}

@media (min-width: 640px) {
  .main {
    padding: var(--space-5, 1.25rem) 0 var(--space-8, 2rem);
    gap: var(--space-5, 1.25rem);
  }

  .panel {
    padding: var(--space-6, 1.5rem);
    border-radius: var(--radius-2xl, 1.25rem);
  }

  .panel h2 {
    font-size: var(--text-lg, 1.125rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel,
  .banner {
    animation: none;
  }

  .btn.primary:hover {
    transform: none;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRAILER CARDS — Enhanced design
   ═══════════════════════════════════════════════════════════════════════════ */

.trailer-card {
  border: 1px solid #34343e;
  border-radius: 10px;
  background: #1e1e26;
  overflow: hidden;
  transition: border-color 0.15s ease;
}
.trailer-card:hover {
  border-color: #48485a;
}
.trailer-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  cursor: pointer;
  user-select: none;
  background: #22222c;
}
.trailer-card-header:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: -2px;
}
.trailer-card-main {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}
.trailer-card-title-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.trailer-order {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--text, #e8e8ee);
}
.trailer-nbr {
  font-size: 0.78rem;
  color: var(--muted, #9898a8);
  font-family: monospace;
}
.trailer-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.trailer-size-badge,
.trailer-status-badge,
.trailer-load-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.trailer-size-badge {
  background: #2a3a4a;
  color: #7dd3fc;
  border: 1px solid #3d5a80;
}
.trailer-size-badge.size-20 {
  background: #3a2a4a;
  color: #c4b5fd;
  border-color: #5d4a80;
}
.trailer-status-badge {
  background: #2e2e38;
  color: #9898a8;
  border: 1px solid #3e3e48;
}
.trailer-status-badge.status-loading {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.3);
}
.trailer-status-badge.status-closed {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border-color: rgba(34, 197, 94, 0.3);
}
.trailer-load-badge {
  background: #2e2e38;
  color: #9898a8;
  border: 1px solid #3e3e48;
}
.trailer-load-badge.load-full {
  background: rgba(251, 146, 60, 0.15);
  color: #fb923c;
  border-color: rgba(251, 146, 60, 0.3);
}
.trailer-load-badge.load-empty {
  background: rgba(156, 163, 175, 0.1);
  color: #9ca3af;
  border-color: rgba(156, 163, 175, 0.25);
}
.trailer-card-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}
.trailer-location-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 6px;
  border: 1px solid #3d5a80;
  background: #2a3a4a;
  color: #7dd3fc;
  cursor: pointer;
  transition: all 0.15s ease;
}
.trailer-location-btn:hover {
  background: #3a4a5a;
  border-color: #5d7a9a;
}
.trailer-location-btn:focus-visible {
  outline: 2px solid #7dd3fc;
  outline-offset: 2px;
}
.trailer-location-icon {
  width: 1rem;
  height: 1rem;
}
.trailer-expand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--muted, #9898a8);
}
.trailer-card-summary {
  padding: 0.5rem 0.75rem;
  border-top: 1px solid #2e2e38;
  background: #1a1a22;
}
.trailer-summary-dl {
  display: grid;
  grid-template-columns: minmax(4.5rem, auto) 1fr;
  gap: 0.3rem 0.65rem;
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.35;
}
.trailer-summary-dl dt {
  margin: 0;
  color: var(--muted, #9898a8);
  font-weight: 600;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.trailer-summary-dl dd {
  margin: 0;
  color: var(--text, #e8e8ee);
  font-weight: 600;
  word-break: break-word;
}
.trailer-card-details {
  padding: 0.5rem 0.75rem 0.65rem;
  border-top: 1px solid #2e2e38;
  background: #16161e;
}
.trailer-details-dl {
  display: grid;
  grid-template-columns: minmax(5rem, auto) 1fr;
  gap: 0.3rem 0.65rem;
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.35;
}
.trailer-details-dl dt {
  margin: 0;
  color: var(--muted, #9898a8);
  font-weight: 600;
  font-size: 0.68rem;
}
.trailer-details-dl dd {
  margin: 0;
  color: var(--text, #c8c8d8);
  word-break: break-word;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRAILER GPS MODAL
   ═══════════════════════════════════════════════════════════════════════════ */

.trailer-gps-modal {
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.trailer-gps-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.trailer-gps-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.trailer-gps-close {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}
.trailer-gps-id {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted, #9898a8);
}
.trailer-gps-coords {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: #12121a;
  border: 1px solid #2e2e38;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.8rem;
  color: #7dd3fc;
}
.trailer-gps-map-wrap {
  position: relative;
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #34343e;
  background: #0a0a0f;
}
.trailer-gps-map {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.trailer-gps-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.25rem;
}
.trailer-gps-actions .btn {
  flex: 1;
  text-align: center;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@media (min-width: 400px) {
  .trailer-gps-actions .btn {
    flex: 0 1 auto;
  }
}
</style>
