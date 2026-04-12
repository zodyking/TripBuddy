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
  buildTrailerCards,
  buildDollySection,
} from '../utils/tripDetailsDisplay.js'
import { formatLinehaulLocationForDisplay } from '../utils/linehaulLocationDisplay.js'
import {
  maybeAnnounceNewTrip,
  cancelTripVoiceAnnouncement,
  unlockTripVoiceFromUserGesture,
  tripVoiceShowUnlockHint,
  isTripAlertEnabled,
} from '../utils/tripVoiceAnnouncement.js'

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

const tripReadyUi = computed(() => {
  if (linehaulFetching.value) {
    return { kind: 'loading', text: 'Checking…' }
  }
  if (linehaulLastFetchAt.value == null) {
    return { kind: 'idle', text: 'Not loaded' }
  }
  if (
    linehaulTripsBody.value != null &&
    hasTripOriginAndDestination(linehaulTripsBody.value)
  ) {
    return { kind: 'yes', text: 'Ready', fromTripDetails: true }
  }
  if (linehaulTripReadyError.value) {
    return {
      kind: 'error',
      text: linehaulTripReadyError.value,
    }
  }
  if (linehaulTripReadyBody.value != null) {
    const b = parseTripReadyBoolean(linehaulTripReadyBody.value)
    if (b === true) return { kind: 'yes', text: 'Ready' }
    if (b === false) return { kind: 'no', text: 'Not ready' }
    return { kind: 'unknown', text: 'Status unclear' }
  }
  return { kind: 'unknown', text: '—' }
})

const tripReadyDotClass = computed(() => {
  switch (tripReadyUi.value.kind) {
    case 'yes':
      return 'is-yes'
    case 'no':
      return 'is-no'
    case 'error':
      return 'is-error'
    case 'loading':
      return 'is-loading'
    case 'idle':
      return 'is-idle'
    default:
      return 'is-unknown'
  }
})

const tripReadyDetailTitle = computed(() => {
  if (tripReadyUi.value.fromTripDetails) {
    return 'Origin and destination are present in trip details (overrides trip-status when both are set).'
  }
  if (linehaulTripReadyError.value) return linehaulTripReadyError.value
  const body = linehaulTripReadyBody.value
  if (
    body != null &&
    typeof body === 'object' &&
    tripReadyUi.value.kind === 'unknown'
  ) {
    try {
      return JSON.stringify(body)
    } catch {
      return ''
    }
  }
  return ''
})

const tripOriginDest = computed(() => extractOriginDest(linehaulTripsBody.value))

const tripTrailerCards = computed(() =>
  buildTrailerCards(linehaulTripsBody.value),
)

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
      }
      return
    }

    if (e.checkInComplete === true) {
      checkInSuccessBanner.value = 'Check in successful'
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
  void loadQuickActions()
  void pollAutomationPreview()
  previewPollTimer = setInterval(pollAutomationPreview, 1600)
  void setupLinehaulPolling()
})

onActivated(() => {
  loadAssignment()
  void loadQuickActions()
  void setupLinehaulPolling()
})

onUnmounted(() => {
  cancelTripVoiceAnnouncement()
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
      <h2>Driver Status</h2>
      <p class="hint driver-status-hint">
        Assignment vs tractor and driver from FedEx Linehaul. Credentials and Home refresh: Settings → Driver
        Credentials.
      </p>
      <details class="driver-status-details">
        <summary class="driver-status-summary">Driver &amp; Linehaul details</summary>
        <div class="driver-status-details-inner">
          <div class="driver-status-section">
            <h3 class="driver-status-section-title">Check-in / assignment</h3>
            <p v-if="!tractorLocation.trim()" class="empty driver-status-section-body">
              Not set — edit Tractor location under Settings → Dispatch.
            </p>
            <p v-else class="read driver-status-section-body">{{ tractorLocation }}</p>
          </div>

          <div class="driver-status-section driver-status-section--snapshot">
            <div class="driver-status-snapshot-head">
              <h3 class="driver-status-section-title">Linehaul snapshot</h3>
              <div v-if="linehaulFetching" class="linehaul-loading" aria-live="polite">Loading…</div>
              <p v-else-if="linehaulLastFetchAt != null" class="linehaul-meta">
                {{ new Date(linehaulLastFetchAt).toLocaleString() }}
              </p>
            </div>

            <div v-if="linehaulTractorError || linehaulDriverError" class="linehaul-errors">
              <p v-if="linehaulTractorError" class="err">Tractor Details: {{ linehaulTractorError }}</p>
              <p v-if="linehaulDriverError" class="err">Driver Details: {{ linehaulDriverError }}</p>
            </div>
            <div
              v-if="linehaulLocationMatch !== null && (linehaulTractorBody || linehaulDriverBody)"
              class="match-row"
            >
              <span class="match-label">Tractor vs driver location</span>
              <span :class="linehaulLocationMatch ? 'badge match-yes' : 'badge match-no'">
                {{ linehaulLocationMatch ? 'Aligned' : 'Mismatch' }}
              </span>
            </div>

            <div class="driver-status-cards">
              <div v-if="linehaulTractorBody" class="linehaul-block">
                <h4 class="linehaul-h3">Tractor Details</h4>
                <div class="linehaul-compact">
                  <div class="linehaul-row">
                    <span v-if="linehaulTractorBody.locationId != null" class="linehaul-chip">
                      <span class="k">location</span> {{ linehaulTractorBody.locationId }}
                    </span>
                    <span v-if="linehaulTractorBody.tractorNbr != null" class="linehaul-chip">
                      <span class="k">tractor</span> {{ linehaulTractorBody.tractorNbr }}
                    </span>
                  </div>
                  <div class="linehaul-row">
                    <span v-if="linehaulTractorBody.tractorDomicileAbbrv" class="linehaul-chip">
                      <span class="k">domicile</span> {{ linehaulTractorBody.tractorDomicileAbbrv }}
                    </span>
                    <span v-if="linehaulTractorBody.detlCodeActvStat" class="linehaul-chip">
                      <span class="k">active</span> {{ linehaulTractorBody.detlCodeActvStat }}
                    </span>
                    <span v-if="linehaulTractorBody.detlCodeAvailStat" class="linehaul-chip">
                      <span class="k">avail</span> {{ linehaulTractorBody.detlCodeAvailStat }}
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="linehaulDriverBody" class="linehaul-block">
                <h4 class="linehaul-h3">Driver Details</h4>
                <div class="linehaul-compact">
                  <div class="linehaul-row">
                    <span
                      v-if="linehaulDriverBody.driverLocation != null && linehaulDriverBody.driverLocation !== ''"
                      class="linehaul-chip"
                    >
                      <span class="k">location</span> {{ linehaulDriverBody.driverLocation }}
                    </span>
                    <span v-if="linehaulDriverBody.driverActvStat" class="linehaul-chip">
                      <span class="k">active</span> {{ linehaulDriverBody.driverActvStat }}
                    </span>
                    <span v-if="linehaulDriverBody.driverAvlStat" class="linehaul-chip">
                      <span class="k">avail</span> {{ linehaulDriverBody.driverAvlStat }}
                    </span>
                  </div>
                </div>
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
        </div>
      </details>
    </section>

    <section class="panel dispatch-instructions-panel">
      <div class="dispatch-card-toolbar">
        <h2 class="dispatch-instructions-title">Dispatch instructions</h2>
        <div
          class="trip-ready-inline"
          role="status"
          :aria-label="`Trip Ready: ${tripReadyUi.text}`"
          :title="tripReadyDetailTitle || undefined"
        >
          <span class="trip-ready-dot" :class="tripReadyDotClass" aria-hidden="true" />
          <span class="trip-ready-heading">Trip Ready</span>
          <span class="trip-ready-state" :class="{ 'trip-ready-state-err': tripReadyUi.kind === 'error' }">{{
            tripReadyUi.text
          }}</span>
        </div>
      </div>
      <p class="hint trip-voice-hint" role="note">
        Trip alerts (speech and/or bell) play on this device’s speaker or headset (not the server). Turn the volume up.
        Change mode under Settings → Audio.
      </p>
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
      <p v-if="!instructions.trim()" class="empty">No instructions yet — edit in Settings.</p>
      <p v-else class="read dispatch-instructions-body">{{ instructions }}</p>
    </section>

    <section v-if="showSealOrTripPanel" class="panel trip-details-panel">
      <h2>Trip details</h2>
      <p class="hint">FedEx trip payload when Linehaul loads (trailers and dolly when present).</p>

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

          <details
            v-for="card in tripTrailerCards"
            :key="card.id"
            class="trip-details-block"
          >
            <summary class="trip-details-summary">{{ card.title }}</summary>
            <dl class="trip-details-dl">
              <template v-for="row in card.rows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </template>
            </dl>
          </details>
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
  padding: 0.75rem 0 0;
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
.driver-status-hint {
  margin-bottom: 0.65rem;
}
.driver-status-details {
  margin-top: 0.2rem;
  border: 1px solid #34343e;
  border-radius: 10px;
  background: #18181f;
  overflow: hidden;
}
.driver-status-summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
  list-style: none;
  padding: 0.55rem 0.75rem;
  margin: 0;
  background: #1e1e26;
  border-bottom: 1px solid transparent;
}
.driver-status-details[open] .driver-status-summary {
  border-bottom-color: #2e2e38;
}
.driver-status-summary::-webkit-details-marker {
  display: none;
}
.driver-status-summary::before {
  content: '';
  flex-shrink: 0;
  width: 0.4rem;
  height: 0.4rem;
  border-right: 2px solid var(--muted, #9898a8);
  border-bottom: 2px solid var(--muted, #9898a8);
  transform: rotate(-45deg);
  transition: transform 0.15s ease;
  margin-top: -0.15rem;
}
.driver-status-details[open] .driver-status-summary::before {
  transform: rotate(45deg);
  margin-top: 0.1rem;
}
.driver-status-details-inner {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
}
.driver-status-section {
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #34343e;
  background: #1e1e26;
}
.driver-status-section-title {
  margin: 0 0 0.45rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted, #9898a8);
}
.driver-status-section-body {
  margin: 0;
}
.driver-status-section--snapshot {
  padding-bottom: 0.55rem;
}
.driver-status-snapshot-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.5rem;
}
.driver-status-snapshot-head .driver-status-section-title {
  margin: 0;
}
.driver-status-snapshot-head .linehaul-loading {
  margin: 0;
  font-size: 0.82rem;
}
.driver-status-snapshot-head .linehaul-meta {
  margin: 0;
  font-size: 0.78rem;
}
.driver-status-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
}
@media (min-width: 560px) {
  .driver-status-cards {
    grid-template-columns: 1fr 1fr;
  }
}
.driver-status-idle {
  margin: 0.35rem 0 0;
  font-size: 0.88rem;
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
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #2a1f08;
  border: 1px solid #d97706;
  border-radius: 10px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}
.dismiss {
  flex-shrink: 0;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
}
.err {
  color: #ff8a80;
}
.msg {
  color: #90caf9;
  font-size: 0.9rem;
}
.panel {
  background: var(--card, #1a1a21);
  border: 1px solid var(--border, #2e2e38);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1rem;
}
.panel h2 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}
.hint {
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  margin: 0 0 0.75rem;
  line-height: 1.4;
}
.empty {
  margin: 0;
  color: var(--muted, #9898a8);
  font-size: 0.95rem;
}
.read {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.45;
  font-size: 0.95rem;
}
.subhead {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted, #9898a8);
  margin: 0.85rem 0 0.35rem;
}
.linehaul-meta {
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  margin: 0 0 0.5rem;
}
.linehaul-loading {
  font-size: 0.9rem;
  color: #90caf9;
  margin: 0.25rem 0 0.5rem;
}
.driver-status-section--snapshot .linehaul-errors {
  margin-bottom: 0.45rem;
}
.linehaul-errors .err {
  margin: 0.25rem 0;
  font-size: 0.85rem;
}
.driver-status-section--snapshot .match-row {
  margin-top: 0;
  margin-bottom: 0.6rem;
}
.match-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.5rem 0 0.75rem;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: #22222c;
}
.match-label {
  font-size: 0.85rem;
}
.badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
}
.match-yes {
  background: #1b3d2e;
  color: #a5d6a7;
  border: 1px solid #43a047;
}
.match-no {
  background: #3d1f1f;
  color: #ffcdd2;
  border: 1px solid #e57373;
}
.driver-status-cards .linehaul-block {
  margin-top: 0;
  padding: 0.55rem 0.6rem;
  border-radius: 8px;
  border: 1px solid #34343e;
  background: #25252e;
}
.linehaul-block {
  margin-top: 0.5rem;
}
.linehaul-h3 {
  margin: 0 0 0.45rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
  letter-spacing: 0.01em;
}
.linehaul-compact {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.linehaul-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.55rem;
}
.linehaul-chip {
  font-size: 0.8rem;
  line-height: 1.35;
  padding: 0.22rem 0.5rem;
  border-radius: 6px;
  background: #1a1a22;
  border: 1px solid #3a3a48;
}
.linehaul-chip .k {
  margin-right: 0.25rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
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
.trip-ready-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-shrink: 0;
  max-width: 100%;
  font-size: 0.85rem;
}
.trip-ready-heading {
  color: var(--muted, #9898a8);
  font-weight: 600;
}
.trip-ready-state {
  font-weight: 600;
  color: var(--text, #e8e8ee);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 14rem;
}
.trip-ready-state-err {
  color: #ffab91;
  white-space: normal;
  max-width: min(18rem, 100%);
}
.trip-ready-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.trip-ready-dot.is-yes {
  background: #66bb6a;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.35);
}
.trip-ready-dot.is-no {
  background: #ef5350;
  box-shadow: 0 0 0 2px rgba(244, 67, 54, 0.35);
}
.trip-ready-dot.is-error {
  background: #ff9800;
}
.trip-ready-dot.is-unknown {
  background: #78909c;
}
.trip-ready-dot.is-idle {
  background: #546e7a;
  opacity: 0.85;
}
.trip-ready-dot.is-loading {
  background: #64b5f6;
  animation: tripReadyPulse 1s ease-in-out infinite;
}
@keyframes tripReadyPulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.92);
  }
}
@media (prefers-reduced-motion: reduce) {
  .trip-ready-dot.is-loading {
    animation: none;
    opacity: 0.75;
  }
}
.dispatch-instructions-body {
  margin-top: 0;
}
.trip-voice-hint {
  margin: 0 0 0.65rem;
  font-size: 0.78rem;
  line-height: 1.35;
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
  min-height: 48px;
  padding: 0 1rem;
  border-radius: 10px;
  border: none;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent, #5c2d91);
  color: #fff;
}
.btn.secondary {
  background: #2a2a34;
  color: var(--text, #e8e8ee);
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
  gap: 0.5rem;
}
.quick-action-btn {
  width: 100%;
  min-height: 48px;
  padding: 0.65rem 1rem;
  font-size: 0.95rem;
}
</style>
