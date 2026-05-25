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
import { useRouter } from 'vue-router'
import {
  getAssignment,
  getCredentials,
  postCancelRun,
  getAutomationPreview,
  getHealth,
  listAutomations,
  runAutomation,
  postRetryLocation,
  postRetryInspectField,
  postCancelRetry,
  fetchFedexLinehaulLocation,
  saveLocationToDirectory,
  getDollyRegistry,
  putDollyNumber,
  patchDollyRating,
  getTrailerNumbers,
  putTrailerNumber,
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
  linehaulAuthRecoveryInProgress,
  linehaulLocationMatch,
  refreshLinehaulApis,
  tripPhase,
  linehaulDriverIdFromCredMeta,
  prePlanTripSnapshot,
  cachedTripSnapshot,
  hasPrePlanTrip,
  markTripLegSequenceCompleted,
  tripBodyDailySeq,
  lastDailyTripLegSequence,
  stableTripState,
  assignmentTripHistoryLedger,
} from '../stores/linehaulSnapshotStore.js'
import {
  apiOk,
  registerApiRecover,
  ensureFedexApiReady,
} from '../composables/useApiHealth.js'
import { useLateNightArriveCheckPrompt } from '../composables/useLateNightArriveCheckPrompt.js'
import { upsertTripHistoryAppCapturedArrival } from '../utils/tripHistoryAppArrivalStamp.js'
import { useDestinationAutoArriveCheckIn } from '../composables/useDestinationAutoArriveCheckIn.js'
import TripOdProgressBar from '../components/TripOdProgressBar.vue'
import { haversineM } from '../utils/polylineSnap.js'
import { appGeoLat, appGeoLng } from '../composables/useAppGeolocationWatch.js'
import {
  liveLogEntries,
  registerAssignmentListener,
  registerSessionListener,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import { pushInAppFromStream } from '../stores/inAppNotificationsStore.js'
import { formatRunErrorForUser } from '../utils/runErrorFormat.js'
import { isCheckInLocationMismatchMessage } from '../utils/checkInLocationMismatch.js'
import { parseTripReadyBoolean } from '../utils/tripReadyParse.js'
import {
  extractOriginDest,
  extractTripDispatchInstructions,
  buildEnhancedTrailerCards,
  buildDollySection,
  buildInspectAutomationTripData,
} from '../utils/tripDetailsDisplay.js'
import {
  formatLinehaulLocationForDisplay,
  extractLocationForDirectory,
} from '../utils/linehaulLocationDisplay.js'
import { writeTrailerGpsSession, patchTrailerGpsSessionMap } from '../utils/trailerGpsMapSession.js'
import { copyTextToClipboard } from '../utils/copyToClipboard.js'
import { vehicleIdForUserMapMarker } from '../utils/mapVehicleLabel.js'
import {
  maybeAnnounceNewTrip,
  maybeAnnouncePrePlanTrip,
  cancelTripVoiceAnnouncement,
  unlockTripVoiceFromUserGesture,
  tripVoiceShowUnlockHint,
  isTripAlertEnabled,
  syncTripPhaseVoiceStable,
  seedTripVoiceFromSnapshot,
  maybeAnnounceTrailerStatusChange,
  maybeAnnounceTrailerRelocated,
  clearTrailerStatusTracking,
  clearTrailerGpsTracking,
  clearTripPhaseTracking,
  announceGeofenceArrival,
  announceArrivalSuccess,
} from '../utils/tripVoiceAnnouncement.js'
import { applyHelpersLocationPrefsFromCredentials } from '../utils/helpersLocationPrefs.js'
import {
  announceTractorChange,
  announceDriverChange,
  announceCheckInSuccess,
  announceCheckInFail,
  announceCheckInTripReady,
  announceCheckInNewTrip,
  announceInspectCheckoutCancelled,
  announceInspectCheckoutNewTripDetails,
  cancelAllAlerts,
} from '../utils/alertAudioQueue.js'

const router = useRouter()

const PORTAL_Z_MODAL = 2_147_483_001
const PORTAL_Z_LOCATION_MODAL = 2_147_483_002

const loadError = ref(null)
const runErrorBanner = ref(null)
const runStartTs = ref(null)
/** Bumped on every quick-action tap so a prior `runAutomation` cannot apply after a newer run starts. */
const quickActionRunGeneration = ref(0)

const locationRetryOpen = ref(false)
const locationRetryFedexMessage = ref('')
const locationRetryInput = ref('')
const locationRetrySubmitting = ref(false)
const inBrowserRetryRunId = ref(null)
const streamBannerHandledKey = ref(null)

const inspectFieldOpen = ref(false)
const inspectFieldMessage = ref('')
const inspectFieldInput = ref('')
const inspectFieldSubmitting = ref(false)
const inspectFieldRunId = ref(null)
const inspectFieldKeyLabel = ref('')

const destLocationModalOpen = ref(false)
const destLocationLoading = ref(false)
const destLocationError = ref('')
/** @type {import('vue').Ref<unknown>} */
const destLocationBody = ref(null)

/** Destination terminal coords (from background Linehaul fetch for directory) — Home progress bar. */
const tripWatchDestLat = ref(/** @type {number | null} */ (null))
const tripWatchDestLng = ref(/** @type {number | null} */ (null))

/** Origin terminal coords (Linehaul location fetch) — OD leg length for Home progress bar. */
const tripWatchOriginLat = ref(/** @type {number | null} */ (null))
const tripWatchOriginLng = ref(/** @type {number | null} */ (null))

const originLocationModalOpen = ref(false)
const originLocationLoading = ref(false)
const originLocationError = ref('')
/** @type {import('vue').Ref<unknown>} */
const originLocationBody = ref(null)

const instructions = ref('')

/** 0 = current trip, 1 = pre-plan trip — must be declared before instruction computeds that read it. */
const dispatchSlideIndex = ref(0)

/** Merged: Settings assignment + FedEx instruction fields - now uses stableTripState */
const mergedDispatchInstructions = computed(() => {
  // Use stableTripState.instructions which is already merged and gated
  const stable = stableTripState.value
  if (stable.instructions) {
    return stable.instructions
  }
  // Fallback to old behavior for compatibility
  try {
    const body = linehaulTripsBody.value
    const fromApi = extractTripDispatchInstructions(body)
    const fromAssignment = String(instructions.value ?? '').trim()
    if (fromApi && fromAssignment) return `${fromAssignment}\n\n${fromApi}`
    return fromApi || fromAssignment
  } catch (e) {
    console.error('[mergedDispatchInstructions]', e)
    return String(instructions.value ?? '').trim()
  }
})

/** Same merge for the active Dispatch carousel slide (current vs pre-plan). */
const mergedDispatchInstructionsForSlide = computed(() => {
  try {
    // For pre-plan, still use the snapshot directly
    if (dispatchSlideIndex.value === 1 && prePlanTripSnapshot.value) {
      const fromAssignment = String(instructions.value ?? '').trim()
      const body = prePlanTripSnapshot.value
      const fromApi = extractTripDispatchInstructions(body)
      if (fromApi && fromAssignment) return `${fromAssignment}\n\n${fromApi}`
      return fromApi || fromAssignment
    }
    // For current trip, use stableTripState (already gated)
    return mergedDispatchInstructions.value
  } catch (e) {
    console.error('[mergedDispatchInstructionsForSlide]', e)
    return String(instructions.value ?? '').trim()
  }
})

const automationPreview = ref(null)
const automationPreviewHidden = ref(false)
let previewPollTimer = null
/** @type {ReturnType<typeof setInterval> | null} */
let linehaulPollTimer = null
const lastPreviewBusy = ref(false)

/** Home: while automation preview is active, only the preview is shown (fills main area); other cards unmount. */
const showAutomationPreviewFocus = computed(
  () => lastPreviewBusy.value && !automationPreviewHidden.value,
)

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

/** FedEx reports driver + tractor available — allow manual “trip complete” without dispatch-phase API. */
const driverAndVehicleAvailable = computed(() => {
  const d = linehaulDriverBody.value
  const t = linehaulTractorBody.value
  if (!d || typeof d !== 'object' || !t || typeof t !== 'object') return false
  const ds = String(
    /** @type {Record<string, unknown>} */ (d).driverAvlStat ?? '',
  )
    .trim()
    .toUpperCase()
  const ts = String(
    /** @type {Record<string, unknown>} */ (t).detlCodeAvailStat ?? '',
  )
    .trim()
    .toUpperCase()
  return ds === 'AVL' && ts === 'AVL'
})

const tripOriginDest = computed(() => {
  // Use stableTripState for current trip origin/dest (always has best data)
  const stable = stableTripState.value
  if (stable.origin?.display && stable.origin.display !== '—') {
    return {
      origin: stable.origin.display,
      destination: stable.destination?.display || '—',
    }
  }
  // Fallback for compatibility
  return extractOriginDest(linehaulTripsBody.value)
})
const prePlanOriginDest = computed(() => extractOriginDest(prePlanTripSnapshot.value))

const dispatchPanelRef = ref(/** @type {HTMLElement | null} */ (null))
const tripDetailsPanelRef = ref(/** @type {HTMLElement | null} */ (null))
const tripCompleteDialog = ref(false)
const tripCompleteBusy = ref(false)
/** Which trip leg seq to mark complete */
const tripCompleteTargetSeq = ref('')

let dispatchPointerStartX = 0
let dispatchPointerMoved = false
let tripPointerStartX = 0
let tripPointerMoved = false

/** Double-tap / double-click within this window counts as "complete trip" */
const DOUBLE_TAP_MS = 380
let dispatchFirstTapAt = 0
let tripFirstTapAt = 0

const SWIPE_THRESHOLD_PX = 48
const MOVE_CANCEL_PX = 14

function isInteractiveEventTarget(target) {
  if (!target || typeof target !== 'object') return false
  const el = /** @type {Node} */ (target)
  if (el.nodeType !== 1) return false
  return !!(/** @type {HTMLElement} */ (el).closest(
    'button, a, input, textarea, select, [role="button"], details, summary, label, .copyable-dd, .copyable-inline, .copyable-block',
  ))
}

const currentTripLegSeq = computed(() =>
  stableTripState.value.dailyTripLegSequence || tripBodyDailySeq(linehaulTripsBody.value),
)
const prePlanTripLegSeq = computed(() =>
  tripBodyDailySeq(prePlanTripSnapshot.value),
)

/** Ledger row for the active leg (from last assignment poll). */
const currentTripLedgerRow = computed(() => {
  const seq = String(currentTripLegSeq.value ?? '').trim()
  if (!/^\d+$/.test(seq)) return null
  for (const raw of assignmentTripHistoryLedger.value) {
    if (!raw || typeof raw !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (raw)
    if (String(row.dailyTripLegSequence ?? '').trim() === seq) return row
  }
  return null
})

/**
 * @param {Record<string, unknown> | null} row
 */
function ledgerDispatchedAtMsForTripProgress(row) {
  if (!row) return null
  const d = row.dispatchedAtMs
  if (!(typeof d === 'number' && Number.isFinite(d) && d > 0)) return null
  const rec = row.recordedAt
  const recMs = typeof rec === 'number' && Number.isFinite(rec) && rec > 0 ? rec : null
  if (recMs != null && d <= recMs) return null
  return d
}

const tripProgressAssignedMs = computed(() => {
  const row = currentTripLedgerRow.value
  if (!row) return null
  const ra = row.recordedAt
  if (typeof ra === 'number' && Number.isFinite(ra) && ra > 0) return ra
  const le = row.ledgerEventMs
  if (typeof le === 'number' && Number.isFinite(le) && le > 0) return le
  return null
})

const tripProgressDispatchedMs = computed(() => ledgerDispatchedAtMsForTripProgress(currentTripLedgerRow.value))

const tripProgressArrivedMs = computed(() => {
  const row = currentTripLedgerRow.value
  if (!row) return null
  const td = row.tripDetails && typeof row.tripDetails === 'object' ? /** @type {Record<string, unknown>} */ (row.tripDetails) : {}
  const a = td.appCapturedTripArrivalAtMs
  return typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : null
})

const tripProgressDistM = computed(() => {
  const dlat = tripWatchDestLat.value
  const dlng = tripWatchDestLng.value
  const ulat = appGeoLat.value
  const ulng = appGeoLng.value
  if (
    dlat == null ||
    dlng == null ||
    ulat == null ||
    ulng == null ||
    !Number.isFinite(+dlat) ||
    !Number.isFinite(+dlng) ||
    !Number.isFinite(+ulat) ||
    !Number.isFinite(+ulng)
  ) {
    return null
  }
  return haversineM(ulat, ulng, dlat, dlng)
})

/** Great-circle origin-terminal → destination-terminal leg (meters) for OD progress. */
const tripProgressOdLegM = computed(() => {
  const olat = tripWatchOriginLat.value
  const olng = tripWatchOriginLng.value
  const dlat = tripWatchDestLat.value
  const dlng = tripWatchDestLng.value
  if (
    olat == null ||
    olng == null ||
    dlat == null ||
    dlng == null ||
    !Number.isFinite(+olat) ||
    !Number.isFinite(+olng) ||
    !Number.isFinite(+dlat) ||
    !Number.isFinite(+dlng)
  ) {
    return null
  }
  return haversineM(olat, olng, dlat, dlng)
})

const tripProgressDenomNm = computed(() => {
  const row = currentTripLedgerRow.value
  const td = row?.tripDetails && typeof row.tripDetails === 'object' ? /** @type {Record<string, unknown>} */ (row.tripDetails) : {}
  const m = td.mileage && typeof td.mileage === 'object' && !Array.isArray(td.mileage) ? td.mileage : null
  if (m) {
    const mo = /** @type {Record<string, unknown>} */ (m)
    const raw =
      mo.linehaulRawTotalMiles != null ? String(mo.linehaulRawTotalMiles) : String(mo.totalMiles ?? '')
    const n = Number.parseFloat(raw.replace(/,/g, ''))
    if (Number.isFinite(n) && n > 1) return Math.max(25, n * 0.869)
  }
  return 180
})

const showTripOdProgressBar = computed(
  () => Boolean(linehaulTripsBody.value) && !linehaulTripsError.value && dispatchSlideIndex.value === 0,
)

/** Trip JSON shown in Trip Details (matches Dispatch carousel). */
const tripDetailsBodyForSlide = computed(() => {
  if (
    dispatchSlideIndex.value === 1 &&
    prePlanTripSnapshot.value &&
    typeof prePlanTripSnapshot.value === 'object'
  ) {
    return /** @type {Record<string, unknown>} */ (prePlanTripSnapshot.value)
  }
  // For current trip, build a body from stableTripState (has gated, preserved data)
  const stable = stableTripState.value
  if (stable.dailyTripLegSequence) {
    return {
      dailyTripLegSequence: stable.dailyTripLegSequence,
      tripStatus: stable.tripStatus,
      trailers: stable.trailers,
      dollyNumber1: stable.dolly?.number1,
      dollyNumber2: stable.dolly?.number2,
      dollyEquipmentSequence1: stable.dolly?.seq1,
      dollyEquipmentSequence2: stable.dolly?.seq2,
      currentLocationNumber: stable.origin?.number,
      currentLocationName: stable.origin?.name,
      tripDestNumber: stable.destination?.number,
      tripDest: stable.destination?.name,
      tractorNumber: stable.tractorNumber,
    }
  }
  // Fallback to raw body
  const m = linehaulTripsBody.value
  return m && typeof m === 'object' ? /** @type {Record<string, unknown>} */ (m) : null
})

watch([hasPrePlanTrip, dispatchSlideIndex], () => {
  if (!hasPrePlanTrip.value && dispatchSlideIndex.value !== 0) {
    dispatchSlideIndex.value = 0
  }
})

watch(dispatchSlideIndex, () => {
  expandedTrailers.value = {}
})

const activeDispatchTripSeq = computed(() => {
  if (dispatchSlideIndex.value === 1 && prePlanTripLegSeq.value) {
    return prePlanTripLegSeq.value
  }
  const cur = currentTripLegSeq.value
  if (cur) return cur
  const cachedSeq = tripBodyDailySeq(cachedTripSnapshot.value)
  if (cachedSeq) return cachedSeq
  const lp = lastDailyTripLegSequence.value
  if (typeof lp === 'string' && /^\d+$/.test(lp.trim())) return lp.trim()
  return ''
})

const tripTrailerCards = computed(() =>
  buildEnhancedTrailerCards(tripDetailsBodyForSlide.value),
)

const expandedTrailers = ref({})

const tripDollySection = computed(() =>
  buildDollySection(tripDetailsBodyForSlide.value),
)

const equipmentCopyText = computed(() => {
  const lines = []
  const dolly = dollyPrimaryDisplay.value
  if (dolly) lines.push(`Dolly: ${dolly}`)
  for (const card of tripTrailerCards.value) {
    const nbr = card.trlrNbr || trailerNbrForOrder(card.order)
    if (nbr) lines.push(`Trailer ${card.order}: ${nbr}`)
  }
  return lines.join('\n')
})

const copyToast = ref('')

const dollyReg = ref(/** @type {null | { lastPrimaryNbr: string | null, items: Record<string, { rating?: string, nbr?: string }> }} */ (null))
const dollyAddOpen = ref(false)
const dollyAddDigits = ref('')
const dollyPutBusy = ref(false)
const expandedDollyApi = ref(false)

function dollySix(raw) {
  if (raw == null) return ''
  const t = String(raw).replace(/\D/g, '').slice(0, 6)
  return t.length === 6 ? t : ''
}

const primaryDollyOnTrip = computed(() => {
  const b = tripDetailsBodyForSlide.value
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ''
  const o = /** @type {Record<string, unknown>} */ (b)
  return dollySix(o.dollyNumber1) || dollySix(o.dollyNumber2) || ''
})

const dollyPrimaryDisplay = computed(() => primaryDollyOnTrip.value || dollyReg.value?.lastPrimaryNbr || '')

const dollyRating = computed(() => {
  const n = dollyPrimaryDisplay.value
  if (!n || !dollyReg.value?.items?.[n]) return 'none'
  const r = dollyReg.value.items[n].rating
  if (r === 'good' || r === 'bad' || r === 'none') return r
  return 'none'
})

async function loadDollyRegistry() {
  try {
    dollyReg.value = await getDollyRegistry()
  } catch {
    dollyReg.value = null
  }
}

function onDollyAddInput(e) {
  const t = e?.target
  dollyAddDigits.value =
    t && 'value' in t
      ? String(/** @type {HTMLInputElement} */ (t).value)
          .replace(/\D/g, '')
          .slice(0, 6)
      : ''
}

async function onAddDollySubmit() {
  const n = dollySix(dollyAddDigits.value)
  if (!n) return
  dollyPutBusy.value = true
  try {
    dollyReg.value = await putDollyNumber({
      dollyNbr: n,
      legSeq: String(currentTripLegSeq.value || ''),
    })
    dollyAddOpen.value = false
    dollyAddDigits.value = ''
    void copyTripDetailValue(n, 'Dolly number')
  } catch {
    /* */
  } finally {
    dollyPutBusy.value = false
  }
}

function onDollyHeaderClick() {
  expandedDollyApi.value = !expandedDollyApi.value
}

watch(
  () => tripDollySection.value?.show,
  (ok) => {
    if (!ok) expandedDollyApi.value = false
  },
)

async function setDollyRate(r) {
  const n = dollyPrimaryDisplay.value
  if (!n) return
  try {
    dollyReg.value = await patchDollyRating({ dollyNbr: n, rating: r })
  } catch {
    /* */
  }
}

/* ═══════════ Pre-entered empty trailer numbers ═══════════ */
/** @type {import('vue').Ref<Record<string, string>>} */
const trailerNbrReg = ref({})
const trailerNbrAddKey = ref('')
const trailerNbrAddDigits = ref('')
const trailerNbrPutBusy = ref(false)

async function loadTrailerNumbers() {
  const seq = currentTripLegSeq.value
  if (!seq) { trailerNbrReg.value = {}; return }
  try {
    const res = await getTrailerNumbers(String(seq))
    trailerNbrReg.value = res?.numbers && typeof res.numbers === 'object' ? res.numbers : {}
  } catch { trailerNbrReg.value = {} }
}

function trailerNbrForOrder(order) {
  return trailerNbrReg.value[String(order)] || ''
}

function onTrailerNbrInput(e) {
  const t = e?.target
  trailerNbrAddDigits.value = t && 'value' in t
    ? String(/** @type {HTMLInputElement} */ (t).value).replace(/\D/g, '').slice(0, 8)
    : ''
}

async function onTrailerNbrSubmit(order) {
  const n = trailerNbrAddDigits.value.trim()
  if (!n) return
  const seq = currentTripLegSeq.value
  if (!seq) return
  trailerNbrPutBusy.value = true
  try {
    const res = await putTrailerNumber({ legSeq: String(seq), trailerIndex: Number(order), number: n })
    if (res?.numbers) trailerNbrReg.value = res.numbers
    trailerNbrAddKey.value = ''
    trailerNbrAddDigits.value = ''
    void copyTripDetailValue(n, `Trailer ${order} number`)
  } catch { /* */ }
  finally { trailerNbrPutBusy.value = false }
}

async function copyTripDetailValue(value, label) {
  const v = String(value ?? '').trim()
  if (!v || v === '—') return
  const ok = await copyTextToClipboard(v)
  copyToast.value = ok ? `Copied ${label}` : 'Could not copy'
  window.setTimeout(() => {
    copyToast.value = ''
  }, 2200)
}

function displayOrDash(value) {
  if (value == null) return '—'
  const s = String(value).trim()
  return s || '—'
}

function tripDetailsCompleteSeq() {
  const slideSeq = tripBodyDailySeq(tripDetailsBodyForSlide.value)
  return (
    slideSeq ||
    currentTripLegSeq.value ||
    tripBodyDailySeq(cachedTripSnapshot.value) ||
    (typeof lastDailyTripLegSequence.value === 'string' && /^\d+$/.test(lastDailyTripLegSequence.value.trim())
      ? lastDailyTripLegSequence.value.trim()
      : '')
  )
}

const tripRemovalBlockedReason = computed(() => {
  if (driverAndVehicleAvailable.value) return ''
  const p = tripPhase.value
  if (p === 'assigned') {
    return 'This trip is assigned — finish or wait for dispatch before removing it from Home.'
  }
  if (p === 'dispatched') {
    return 'This trip is en route / dispatched — it cannot be removed from Home until FedEx clears it.'
  }
  return ''
})

function openDispatchTripCompleteDialog() {
  const seq = activeDispatchTripSeq.value
  if (!seq) return
  if (tripRemovalBlockedReason.value) {
    copyToast.value = tripRemovalBlockedReason.value
    window.setTimeout(() => {
      copyToast.value = ''
    }, 3200)
    return
  }
  dispatchFirstTapAt = 0
  tripFirstTapAt = 0
  tripCompleteTargetSeq.value = seq
  tripCompleteDialog.value = true
}

function registerDispatchDoubleComplete() {
  const seq = activeDispatchTripSeq.value
  if (!seq) return
  if (tripRemovalBlockedReason.value) {
    copyToast.value = tripRemovalBlockedReason.value
    window.setTimeout(() => {
      copyToast.value = ''
    }, 3200)
    return
  }
  const now = Date.now()
  if (dispatchFirstTapAt && now - dispatchFirstTapAt < DOUBLE_TAP_MS) {
    openDispatchTripCompleteDialog()
  } else {
    dispatchFirstTapAt = now
  }
}

function registerTripDoubleComplete() {
  const seq = tripDetailsCompleteSeq()
  if (!seq) return
  if (tripRemovalBlockedReason.value) {
    copyToast.value = tripRemovalBlockedReason.value
    window.setTimeout(() => {
      copyToast.value = ''
    }, 3200)
    return
  }
  const now = Date.now()
  if (tripFirstTapAt && now - tripFirstTapAt < DOUBLE_TAP_MS) {
    tripFirstTapAt = 0
    dispatchFirstTapAt = 0
    tripCompleteTargetSeq.value = seq
    tripCompleteDialog.value = true
  } else {
    tripFirstTapAt = now
  }
}

function onDispatchPanelPointerDown(e) {
  if (e.button !== 0) return
  if (isInteractiveEventTarget(e.target)) return
  dispatchPointerStartX = e.clientX
  dispatchPointerMoved = false
}

function onDispatchPanelPointerMove(e) {
  if (Math.abs(e.clientX - dispatchPointerStartX) > MOVE_CANCEL_PX) {
    dispatchPointerMoved = true
  }
}

function onDispatchPanelPointerUp(e) {
  if (e.button !== 0) return
  const dx = e.clientX - dispatchPointerStartX
  if (hasPrePlanTrip.value && dispatchPointerMoved && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
    dispatchFirstTapAt = 0
    tripFirstTapAt = 0
    if (dx < 0 && dispatchSlideIndex.value === 0) {
      dispatchSlideIndex.value = 1
    } else if (dx > 0 && dispatchSlideIndex.value === 1) {
      dispatchSlideIndex.value = 0
    }
    dispatchPointerMoved = false
    return
  }
  if (!isInteractiveEventTarget(e.target) && !dispatchPointerMoved) {
    registerDispatchDoubleComplete()
  }
  dispatchPointerMoved = false
}

function onDispatchPanelPointerCancel() {
  dispatchPointerMoved = false
}

function onDispatchPanelDblClick(e) {
  if (isInteractiveEventTarget(e.target)) return
  e.preventDefault()
  openDispatchTripCompleteDialog()
}

/** Instructions are a nested control — panel pointer handlers never run here. */
function onDispatchInstructionsPointerUp(e) {
  if (e.button !== 0) return
  registerDispatchDoubleComplete()
}

function onTripPanelPointerDown(e) {
  if (e.button !== 0) return
  if (isInteractiveEventTarget(e.target)) return
  tripPointerStartX = e.clientX
  tripPointerMoved = false
}

function onTripPanelPointerMove(e) {
  if (Math.abs(e.clientX - tripPointerStartX) > MOVE_CANCEL_PX) {
    tripPointerMoved = true
  }
}

function onTripPanelPointerUp(e) {
  if (e.button !== 0) return
  const dx = e.clientX - tripPointerStartX
  if (hasPrePlanTrip.value && tripPointerMoved && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
    tripFirstTapAt = 0
    dispatchFirstTapAt = 0
    if (dx < 0 && dispatchSlideIndex.value === 0) {
      dispatchSlideIndex.value = 1
    } else if (dx > 0 && dispatchSlideIndex.value === 1) {
      dispatchSlideIndex.value = 0
    }
    tripPointerMoved = false
    return
  }
  if (!isInteractiveEventTarget(e.target) && !tripPointerMoved) {
    registerTripDoubleComplete()
  }
  tripPointerMoved = false
}

function onTripPanelPointerCancel() {
  tripPointerMoved = false
}

function onTripPanelDblClick(e) {
  if (isInteractiveEventTarget(e.target)) return
  e.preventDefault()
  registerTripDoubleComplete()
}

async function confirmTripCompleted() {
  const seq = tripCompleteTargetSeq.value
  if (!seq) {
    tripCompleteDialog.value = false
    return
  }
  if (tripRemovalBlockedReason.value) {
    tripCompleteDialog.value = false
    tripCompleteTargetSeq.value = ''
    copyToast.value = tripRemovalBlockedReason.value
    window.setTimeout(() => {
      copyToast.value = ''
    }, 3200)
    return
  }
  tripCompleteBusy.value = true
  try {
    await markTripLegSequenceCompleted(seq)
  } finally {
    tripCompleteBusy.value = false
    tripCompleteDialog.value = false
    tripCompleteTargetSeq.value = ''
  }
}

/** Trip destination location number for v2 transportation-network API (path param). */
const tripDestLocationId = computed(() => {
  const b = tripDetailsBodyForSlide.value
  if (!b || typeof b !== 'object') return ''
  const n = /** @type {Record<string, unknown>} */ (b).tripDestNumber
  return n != null && String(n).trim() !== '' ? String(n).trim() : ''
})

/** Trip origin / current location id (same notion as dispatch “where you are”). */
const tripOriginLocationId = computed(() => {
  const b = tripDetailsBodyForSlide.value
  if (!b || typeof b !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (b)
  const cur = o.currentLocationNumber ?? o.originLocation
  return cur != null && String(cur).trim() !== '' ? String(cur).trim() : ''
})

/** Trailer GPS modal top bar: origin / destination lines from active trip. */
const trailerGpsOdHeader = computed(() => {
  const b = tripDetailsBodyForSlide.value
  if (!b || typeof b !== 'object') {
    return {
      originLine: 'Origin: —',
      destLine: 'Destination: —',
      singleLine: 'Origin: — · Destination: —',
    }
  }
  const o = /** @type {Record<string, unknown>} */ (b)
  const oid = String(o.currentLocationNumber ?? o.originLocation ?? '').trim()
  const oname = String(o.currentLocationName ?? '').trim()
  const did = String(o.tripDestNumber ?? '').trim()
  const dname = String(o.tripDest ?? o.tripDestAbbrv ?? '').trim()
  const origin = [oid, oname].filter(Boolean).join(' · ') || '—'
  const dest = [did, dname].filter(Boolean).join(' · ') || '—'
  return {
    originLine: `Origin: ${origin}`,
    destLine: `Destination: ${dest}`,
    singleLine: `Origin: ${origin} · Destination: ${dest}`,
  }
})

function linehaulBodyLocationId(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  const o = /** @type {Record<string, unknown>} */ (body)
  const v = o.locationId ?? o.id
  return v != null && String(v).trim() !== '' ? String(v).trim() : ''
}

/**
 * Cached Linehaul location JSON from destination / origin modals (trailer map hydration).
 * @param {string} idStr
 */
function linehaulCachedBodyForId(idStr) {
  const want = String(idStr ?? '').trim()
  if (!want) return null
  for (const body of [destLocationBody.value, originLocationBody.value]) {
    if (
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      linehaulBodyLocationId(body) === want
    ) {
      return body
    }
  }
  return null
}

/**
 * One terminal row for the trailer GPS map (origin or destination).
 * Uses cached Linehaul location body when a location modal left a matching body in memory.
 */
function trailerGpsTerminalSlotSkeleton(locationId, tripLabel) {
  const id = String(locationId ?? '').trim()
  if (!id) return null
  const cached = linehaulCachedBodyForId(id)
  if (cached) {
    const fmt = formatLinehaulLocationForDisplay(cached)
    const locRow = fmt.rows.find((x) => x.label === 'Location')
    const phoneR = fmt.rows.find((x) => x.label === 'Phone')
    const name =
      (locRow?.value && String(locRow.value).trim()) ||
      String(tripLabel ?? '').trim() ||
      `Location ${id}`
    return {
      locationId: id,
      name,
      phoneDisplay: phoneR?.value ? String(phoneR.value).trim() : '',
      telHref: phoneR?.href ? String(phoneR.href) : '',
      loading: false,
    }
  }
  return {
    locationId: id,
    name: String(tripLabel ?? '').trim() || `Location ${id}`,
    phoneDisplay: '',
    telHref: '',
    loading: true,
  }
}

/**
 * Origin (default) + destination terminals for the trailer map overlay.
 */
function buildTrailerGpsTerminalPair() {
  const origId = tripOriginLocationId.value
  const destId = tripDestLocationId.value
  if (!origId && !destId) return null
  if (origId && destId && origId === destId) {
    const b = tripDetailsBodyForSlide.value
    const o = b && typeof b === 'object' ? /** @type {Record<string, unknown>} */ (b) : {}
    const label =
      String(o.currentLocationName ?? '').trim() ||
      String(o.tripDest ?? o.tripDestAbbrv ?? '').trim() ||
      ''
    return {
      origin: trailerGpsTerminalSlotSkeleton(origId, label),
      destination: null,
    }
  }
  const b = tripDetailsBodyForSlide.value
  const o = b && typeof b === 'object' ? /** @type {Record<string, unknown>} */ (b) : {}
  const origLabel = String(o.currentLocationName ?? '').trim()
  const destLabel = String(o.tripDest ?? o.tripDestAbbrv ?? '').trim()
  return {
    origin: origId ? trailerGpsTerminalSlotSkeleton(origId, origLabel) : null,
    destination: destId ? trailerGpsTerminalSlotSkeleton(destId, destLabel) : null,
  }
}

/** originId header for Linehaul calls: tractor snapshot, else trip current location (active slide). */
const linehaulOriginIdForApi = computed(() => {
  const tid = linehaulTractorBody.value?.locationId
  if (tid != null && String(tid).trim() !== '') return String(tid).trim()
  const b = tripDetailsBodyForSlide.value
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

const originLocationFormatted = computed(() =>
  formatLinehaulLocationForDisplay(originLocationBody.value),
)

const showSealOrTripPanel = computed(
  () =>
    linehaulTripsBody.value != null ||
    prePlanTripSnapshot.value != null ||
    cachedTripSnapshot.value != null ||
    linehaulTripsError.value != null ||
    linehaulTripsNoActive.value,
)

const tripVoiceUnlockHint = ref(false)
const tripAlertOn = computed(() => isTripAlertEnabled())

/**
 * Hide Linehaul error strings while the app API is unreachable or before the first
 * snapshot fetch finishes — show loading placeholders instead.
 */
const suppressHomeLinehaulErrors = computed(
  () =>
    apiOk.value !== true ||
    linehaulLastFetchAt.value == null ||
    linehaulAuthRecoveryInProgress.value === true,
)

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

/** Quick action outcomes go to the header notification inbox (no page overlay). */
function notifyQuickActionInApp(message, kind = 'info') {
  const raw = typeof message === 'string' ? message : String(message)
  const m = (kind === 'error' ? formatRunErrorForUser(raw) : raw).trim()
  if (!m) return
  pushInAppFromStream({
    id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    message: m,
    type: kind,
    source: 'Quick action',
    ts: Date.now(),
    read: false,
  })
}

/**
 * @returns {Promise<{ ok: boolean, skipped?: boolean }>}
 * `skipped` means this invocation was superseded (user started another quick action) or is otherwise benign to ignore.
 */
async function runQuickAction(auto) {
  quickActionRunGeneration.value += 1
  const myGen = quickActionRunGeneration.value

  /* Server allows one Playwright run at a time — cancel any in-flight run (prior quick action or run started elsewhere) before this one. */
  try {
    await postCancelRun()
  } catch {
    /* no active run or server already idle */
  }
  clearAutomationPreviewNow()

  runningAutomationId.value = auto.id
  runStartTs.value = Date.now()
  streamBannerHandledKey.value = null
  dismissRunErrorBanner()
  automationPreviewHidden.value = false
  try {
    if (!(await ensureFedexApiReady())) {
      if (quickActionRunGeneration.value !== myGen) return { ok: false, skipped: true }
      notifyQuickActionInApp(
        'API is not running on port 3847. With vite-only dev, wait a few seconds for autostart, or run npm run dev from the project root.',
        'error',
      )
      return { ok: false }
    }
    // Same equipment JSON as Trip Details cards on the home page
    const slideBody = tripDetailsBodyForSlide.value
    const tripData =
      slideBody && typeof slideBody === 'object' && !Array.isArray(slideBody)
        ? buildInspectAutomationTripData(slideBody)
        : buildInspectAutomationTripData({
            dollyNumber1: stableTripState.value.dolly?.number1,
            dollyNumber2: stableTripState.value.dolly?.number2,
            trailers: stableTripState.value.trailers,
            tractorNumber: stableTripState.value.tractorNumber,
          })
    // Dolly card on home page uses registry as fallback — ensure the automation gets it
    const dollyFromCard = dollyPrimaryDisplay.value
    if (dollyFromCard && !tripData.dolly?.number1) {
      if (!tripData.dolly) tripData.dolly = {}
      tripData.dolly.number1 = dollyFromCard
    }
    const legSeq = currentTripLegSeq.value
    if (legSeq) tripData.dailyTripLegSequence = String(legSeq)
    const result = await runAutomation(auto.id, { headless: true, tripData })
    if (quickActionRunGeneration.value !== myGen) return { ok: false, skipped: true }
    const inspectReCheckin = result.variables?._inspectCheckoutContinue
    if (inspectReCheckin?.requiresReCheckin === true) {
      announceInspectCheckoutNewTripDetails()
      notifyQuickActionInApp('Inspect failed: new trip details. Running check-in…', 'warning')
      const scheduleGen = myGen
      setTimeout(() => {
        if (quickActionRunGeneration.value !== scheduleGen) return
        void autoRunCheckInQuickAction()
      }, 2000)
      return { ok: true }
    }
    if (result.ok) {
      if (result.variables?._inspectCheckoutCancelled === true) {
        notifyQuickActionInApp('No trip to inspect', 'info')
        announceInspectCheckoutCancelled()
        return { ok: true }
      }
      const arrivePayload = result.variables?._arrivePayload
      if (arrivePayload && typeof arrivePayload === 'object') {
        if (arrivePayload.alreadyArrivedByGeofence === true) {
          announceGeofenceArrival()
        } else {
          announceArrivalSuccess()
        }
      }
      const checkInPayload = result.variables?._checkInPayload
      if (checkInPayload && typeof checkInPayload === 'object') {
        if (checkInPayload.checkInNewTripFound === true) {
          announceCheckInNewTrip()
        } else if (checkInPayload.tripReadyAcknowledged === true) {
          announceCheckInTripReady()
        } else if (
          checkInPayload.missionComplete === true ||
          checkInPayload.signedOut === true
        ) {
          announceCheckInSuccess()
        } else if (checkInPayload.success === false) {
          announceCheckInFail()
        }
      }
      notifyQuickActionInApp(`${auto.manualButtonLabel || auto.name} completed`, 'success')
      return { ok: true }
    }
    notifyQuickActionInApp(result.error || 'Failed', 'error')
    return { ok: false }
  } catch (e) {
    if (quickActionRunGeneration.value === myGen) {
      notifyQuickActionInApp(e instanceof Error ? e.message : String(e), 'error')
      return { ok: false }
    }
    return { ok: false, skipped: true }
  } finally {
    if (quickActionRunGeneration.value === myGen) {
      runningAutomationId.value = null
      runStartTs.value = null
      setTimeout(() => void refreshLinehaulApis(), 1500)
    }
  }
}

async function autoRunCheckInQuickAction() {
  const checkInAuto = quickActionAutomations.value.find(
    (a) =>
      /check[-\s]?in/i.test(a.name) ||
      /check[-\s]?in/i.test(a.manualButtonLabel || '') ||
      (a.actions && a.actions.some((act) => act.action === 'checkInEndToEnd'))
  )
  if (!checkInAuto) {
    notifyQuickActionInApp('No check-in quick action found to auto-run', 'warning')
    return { ok: false, skipped: false }
  }
  notifyQuickActionInApp(`Auto-running ${checkInAuto.manualButtonLabel || checkInAuto.name}…`, 'info')
  return await runQuickAction(checkInAuto)
}

function findArriveQuickAction() {
  return quickActionAutomations.value.find(
    (a) =>
      /arrive/i.test(a.name || '') ||
      /arrive/i.test(a.manualButtonLabel || '') ||
      (a.actions &&
        a.actions.some(
          (act) => act.action === 'arriveEndToEnd' || act.action === 'arrive',
        )),
  )
}

async function stampTripHistoryAfterAutomatedArriveCheckIn() {
  const seq = String(currentTripLegSeq.value ?? '').trim()
  if (!/^\d+$/.test(seq)) return
  try {
    await upsertTripHistoryAppCapturedArrival(seq)
  } catch (e) {
    notifyQuickActionInApp(
      e instanceof Error ? e.message : 'Could not save arrival time on trip history.',
      'warning',
    )
  }
}

async function helpersProxRunArriveChain() {
  const arrive = findArriveQuickAction()
  if (!arrive) {
    notifyQuickActionInApp(
      'Proximity helper: no Arrive quick action found. Add a manual-trigger automation with Arrive (arriveEndToEnd).',
      'warning',
    )
    const e = new Error('HELPERS_SKIP')
    /** @type {Error & { code?: string }} */ (e).code = 'HELPERS_SKIP'
    throw e
  }
  const r1 = await runQuickAction(arrive)
  if (r1?.skipped) {
    const e = new Error('HELPERS_SKIP')
    /** @type {Error & { code?: string }} */ (e).code = 'HELPERS_SKIP'
    throw e
  }
  if (!r1?.ok) {
    throw new Error(String(r1?.error || 'Arrive quick action failed'))
  }
  const r2 = await autoRunCheckInQuickAction()
  if (r2?.skipped) {
    const e = new Error('HELPERS_SKIP')
    /** @type {Error & { code?: string }} */ (e).code = 'HELPERS_SKIP'
    throw e
  }
  if (!r2?.ok) {
    throw new Error(String(r2?.error || 'Check-in quick action failed'))
  }
  await stampTripHistoryAfterAutomatedArriveCheckIn()
}

async function runLateNightArriveThenCheckIn() {
  const arrive = findArriveQuickAction()
  if (!arrive) {
    notifyQuickActionInApp(
      'No arrive quick action found. Enable an automation with a manual trigger and Arrive (arriveEndToEnd).',
      'warning',
    )
    return
  }
  const r1 = await runQuickAction(arrive)
  if (r1?.skipped) return
  if (!r1?.ok) return
  const r2 = await autoRunCheckInQuickAction()
  if (r2?.skipped) return
  if (!r2?.ok) return
  await stampTripHistoryAfterAutomatedArriveCheckIn()
}

const {
  lateNightArriveCheckOpen,
  lateNightArriveCheckBusy,
  confirmLateNightArriveCheckYes,
  confirmLateNightArriveCheckNo,
} = useLateNightArriveCheckPrompt({
  isEligible: () => {
    if (suppressHomeLinehaulErrors.value) return false
    const ds = String(linehaulDriverBody.value?.driverAvlStat ?? '')
      .trim()
      .toUpperCase()
    if (ds !== 'ENRT') return false
    if (linehaulTripsNoActive.value) return false
    const b = linehaulTripsBody.value
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false
    return true
  },
  isAutomationRunning: () => runningAutomationId.value != null,
  onYes: runLateNightArriveThenCheckIn,
})

useDestinationAutoArriveCheckIn({
  suppressHomeLinehaulErrors,
  tripDestLocationId,
  linehaulOriginIdForApi,
  currentTripLegSeq,
  isEnrtEligible: () => {
    if (suppressHomeLinehaulErrors.value) return false
    const ds = String(linehaulDriverBody.value?.driverAvlStat ?? '').trim().toUpperCase()
    if (ds !== 'ENRT') return false
    if (linehaulTripsNoActive.value) return false
    const b = linehaulTripsBody.value
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false
    return true
  },
  isAutomationRunning: () => runningAutomationId.value != null,
  runArriveThenCheckIn: helpersProxRunArriveChain,
  notifyInApp: (msg, kind) => notifyQuickActionInApp(msg, kind || 'info'),
})

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
    notifyQuickActionInApp(e instanceof Error ? e.message : String(e), 'error')
  }
}

function dismissRunErrorBanner() {
  runErrorBanner.value = null
}

function setRunErrorBanner(message) {
  const raw = typeof message === 'string' ? message : String(message)
  runErrorBanner.value = formatRunErrorForUser(raw)
}

async function openLocationRetryModal(bannerText, runId = null) {
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
  if (msg) notifyQuickActionInApp(msg, 'error')
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

function formatInspectFieldLabel(field) {
  if (!field) return 'Value'
  const f = String(field).toLowerCase()
  if (f === 'dolly') return 'Dolly Number'
  if (f.includes('seal')) {
    const match = f.match(/trailer(\d+)/)
    if (match) return `Trailer ${match[1]} Seal Number`
    return 'Seal Number'
  }
  if (f.includes('number') || f.includes('trailer')) {
    const match = f.match(/trailer(\d+)/)
    if (match) return `Trailer ${match[1]} Number`
    return 'Trailer Number'
  }
  if (f === 'tractor' || f.includes('tractor')) return 'Tractor Number'
  return 'Value'
}

async function openInspectFieldModal(message, runId, fieldLabel = '') {
  inspectFieldMessage.value = message
  inspectFieldInput.value = ''
  inspectFieldKeyLabel.value = formatInspectFieldLabel(fieldLabel)
  if (runId) inspectFieldRunId.value = runId
  await nextTick()
  inspectFieldOpen.value = true
}

async function cancelInspectField() {
  if (inspectFieldSubmitting.value) return
  const rid = inspectFieldRunId.value
  inspectFieldOpen.value = false
  inspectFieldMessage.value = ''
  inspectFieldInput.value = ''
  inspectFieldKeyLabel.value = ''
  if (rid) {
    try {
      await postCancelRetry(rid)
    } catch {
      /* run may have ended */
    }
    inspectFieldRunId.value = null
  }
}

async function saveInspectField() {
  if (inspectFieldSubmitting.value) return
  const v = inspectFieldInput.value.trim()
  if (!v) return
  inspectFieldSubmitting.value = true
  dismissRunErrorBanner()
  try {
    const rid = inspectFieldRunId.value
    if (rid) {
      await postRetryInspectField(rid, v)
      inspectFieldOpen.value = false
      inspectFieldMessage.value = ''
      inspectFieldInput.value = ''
      inspectFieldKeyLabel.value = ''
      inspectFieldRunId.value = null
    }
  } catch (e) {
    setRunErrorBanner(e instanceof Error ? e.message : String(e))
  } finally {
    inspectFieldSubmitting.value = false
  }
}

function handleInspectFieldFromLiveLog() {
  if (!runningAutomationId.value) return
  const start = runStartTs.value
  if (start == null) return
  const list = liveLogEntries.value
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.ts < start) break
    if (
      e.inspectFieldRetryNeeded === true &&
      typeof e.runId === 'string' &&
      typeof e.message === 'string' &&
      e.message.trim() !== ''
    ) {
      const key = `inf:${e.runId}:${e.ts}:${e.field != null ? String(e.field) : ''}`
      if (streamBannerHandledKey.value === key) return
      streamBannerHandledKey.value = key
      void openInspectFieldModal(e.message, e.runId, e.field != null ? String(e.field) : '')
      return
    }
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
        notifyQuickActionInApp(e.bannerText, 'error')
        announceCheckInFail()
      }
      return
    }

    if (e.checkInComplete === true) {
      if (e.checkInNewTripFound === true) {
        announceCheckInNewTrip()
      } else if (e.tripReadyAcknowledged === true) {
        announceCheckInTripReady()
      } else {
        notifyQuickActionInApp('Check in successful', 'success')
        announceCheckInSuccess()
      }
      return
    }
  }
}

watch(
  liveLogEntries,
  () => {
    handleInspectFieldFromLiveLog()
    handleCheckInBannerFromLiveLog()
  },
  { deep: true },
)

/** Track last fingerprint to prevent false TTS triggers */
let _lastVoiceTriggerFingerprint = ''

watch(
  [() => stableTripState.value._fingerprint, linehaulTripsNoActive, prePlanTripSnapshot, linehaulLastFetchAt],
  ([newFp]) => {
    // Only process if fingerprint actually changed (or on first load)
    if (newFp && newFp === _lastVoiceTriggerFingerprint) {
      return // Same data, skip TTS
    }
    _lastVoiceTriggerFingerprint = newFp || ''

    seedTripVoiceFromSnapshot(
      linehaulTripsBody.value,
      linehaulTripsNoActive.value,
      prePlanTripSnapshot.value,
    )
    maybeAnnounceNewTrip(
      linehaulTripsBody.value,
      linehaulTripsNoActive.value,
    )
    maybeAnnouncePrePlanTrip(prePlanTripSnapshot.value)
    syncTripVoiceUnlockHint()
  },
)

watch(linehaulLastFetchAt, () => {
  void loadDollyRegistry()
  void loadTrailerNumbers()
})

/** Debounce phase TTS so Linehaul poll flicker does not spam speech. */
/** @type {ReturnType<typeof setTimeout> | null} */
let tripPhaseVoiceTimer = null
watch(tripPhase, (newPhase, oldPhase) => {
  if (tripPhaseVoiceTimer) clearTimeout(tripPhaseVoiceTimer)
  tripPhaseVoiceTimer = setTimeout(() => {
    tripPhaseVoiceTimer = null
    syncTripPhaseVoiceStable(newPhase)
  }, 850)

  if (newPhase === 'none' && oldPhase !== 'none') {
    clearTrailerStatusTracking()
    clearTrailerGpsTracking()
  }
})

watch(
  () => {
    const body = tripDetailsBodyForSlide.value
    if (!body || typeof body !== 'object') return null
    const trailers = /** @type {Record<string, unknown>} */ (body).trailers
    return Array.isArray(trailers) ? trailers : null
  },
  (trailers) => {
    if (trailers) {
      maybeAnnounceTrailerStatusChange(trailers)
      maybeAnnounceTrailerRelocated(trailers)
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
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
}

/** Dedupe directory writes for the same trip destination + origin pair. */
let lastAutoSavedDestKey = ''
/** Cancels stale async saves when destination or origin changes mid-flight. */
let destDirectoryAutoSaveGen = 0

/**
 * Upsert directory entry from Linehaul location API body (same as modal).
 * @param {unknown} body
 */
async function persistFetchedLocationToDirectory(body) {
  const dirEntry = extractLocationForDirectory(body)
  if (dirEntry?.locationId) {
    await saveLocationToDirectory(dirEntry)
  }
}

/**
 * When trip data includes a destination location id, fetch full location from the API
 * and save to the directory without requiring the user to open the modal.
 */
async function fetchAndPersistTripDestinationToDirectory() {
  const id = tripDestLocationId.value
  if (!id) return
  const origin = linehaulOriginIdForApi.value || ''
  const key = `${id}|${origin}`
  if (key === lastAutoSavedDestKey) return
  const myGen = ++destDirectoryAutoSaveGen
  const r = await fetchFedexLinehaulLocation({
    locationId: id,
    originId: origin || undefined,
  })
  if (myGen !== destDirectoryAutoSaveGen) return
  if (!r.ok) {
    tripWatchDestLat.value = null
    tripWatchDestLng.value = null
    return
  }
  const ex = extractLocationForDirectory(r.body)
  if (ex?.latitude != null && ex?.longitude != null && Number.isFinite(ex.latitude) && Number.isFinite(ex.longitude)) {
    tripWatchDestLat.value = ex.latitude
    tripWatchDestLng.value = ex.longitude
  } else {
    tripWatchDestLat.value = null
    tripWatchDestLng.value = null
  }
  try {
    await persistFetchedLocationToDirectory(r.body)
    if (myGen !== destDirectoryAutoSaveGen) return
    lastAutoSavedDestKey = key
  } catch {
    /* ignore persist errors */
  }
}

watch(
  [tripDestLocationId, linehaulOriginIdForApi],
  () => {
    const id = tripDestLocationId.value
    if (!id) {
      lastAutoSavedDestKey = ''
      destDirectoryAutoSaveGen += 1
      tripWatchDestLat.value = null
      tripWatchDestLng.value = null
      return
    }
    void fetchAndPersistTripDestinationToDirectory()
  },
  { immediate: true },
)

/** Dedupe directory writes for the same trip origin + destination pair. */
let lastAutoSavedOriginKey = ''
let originDirectoryAutoSaveGen = 0

/**
 * When trip data includes an origin location id, fetch full location from the API
 * and save to the directory without requiring the user to open the modal.
 */
async function fetchAndPersistTripOriginToDirectory() {
  const id = tripOriginLocationId.value
  if (!id) return
  const dest = tripDestLocationId.value || ''
  const key = `${id}|${dest}`
  if (key === lastAutoSavedOriginKey) return
  const myGen = ++originDirectoryAutoSaveGen
  const r = await fetchFedexLinehaulLocation({
    locationId: id,
    originId: dest || undefined,
  })
  if (myGen !== originDirectoryAutoSaveGen) return
  if (!r.ok) {
    tripWatchOriginLat.value = null
    tripWatchOriginLng.value = null
    return
  }
  const ex = extractLocationForDirectory(r.body)
  if (ex?.latitude != null && ex?.longitude != null && Number.isFinite(ex.latitude) && Number.isFinite(ex.longitude)) {
    tripWatchOriginLat.value = ex.latitude
    tripWatchOriginLng.value = ex.longitude
  } else {
    tripWatchOriginLat.value = null
    tripWatchOriginLng.value = null
  }
  try {
    await persistFetchedLocationToDirectory(r.body)
    if (myGen !== originDirectoryAutoSaveGen) return
    lastAutoSavedOriginKey = key
  } catch {
    /* ignore persist errors */
  }
}

watch(
  [tripOriginLocationId, tripDestLocationId],
  () => {
    const id = tripOriginLocationId.value
    if (!id) {
      lastAutoSavedOriginKey = ''
      originDirectoryAutoSaveGen += 1
      tripWatchOriginLat.value = null
      tripWatchOriginLng.value = null
      return
    }
    void fetchAndPersistTripOriginToDirectory()
  },
  { immediate: true },
)

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
  void persistFetchedLocationToDirectory(r.body).catch(() => {})
}

function closeDestLocationModal() {
  destLocationModalOpen.value = false
}

async function openOriginLocationModal() {
  if (!tripOriginLocationId.value) return
  originLocationModalOpen.value = true
  originLocationLoading.value = true
  originLocationError.value = ''
  originLocationBody.value = null
  const r = await fetchFedexLinehaulLocation({
    locationId: tripOriginLocationId.value,
    originId: tripDestLocationId.value || undefined,
  })
  originLocationLoading.value = false
  if (!r.ok) {
    originLocationError.value = r.error || `Request failed (${r.status})`
    originLocationBody.value = r.body ?? null
    return
  }
  originLocationBody.value = r.body ?? null
  void persistFetchedLocationToDirectory(r.body).catch(() => {})
}

function closeOriginLocationModal() {
  originLocationModalOpen.value = false
}

/**
 * @param {unknown} body
 */
function extractProximityTrailersForTrailerMap(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const tr = /** @type {Record<string, unknown>} */ (body).trailers
  return Array.isArray(tr) ? tr : []
}

/**
 * WebKit (iOS Safari / Chrome) only ties geolocation permission to a **synchronous**
 * call from a user gesture. Calling getCurrentPosition from the map component’s
 * mount runs after the gesture stack ends, so the prompt never appears. Invoke it
 * here in the same tick as the pin button click, then pass coords into the map page.
 */
function openTrailerGpsModal(card) {
  if (!card.hasGps || card.lat == null || card.lng == null) return
  const hasGeo =
    typeof navigator !== 'undefined' && !!navigator.geolocation

  const all = tripTrailerCards.value.filter(
    (c) => c.hasGps && c.lat != null && c.lng != null,
  )
  /** @type {{ lat: number, lng: number, order: string, trlrNbr: string, size: string, sealNumber: string, pkgWeightLbs?: number | null }[]} */
  const trailerMapPins = all.map((c) => {
    const sealRow = (c.summaryRows || []).find((r) => r.label === 'Seal')
    const sealRaw =
      sealRow && typeof sealRow.value === 'string' ? sealRow.value.trim() : ''
    const sealNumber =
      sealRaw && sealRaw !== '—' && sealRaw.toLowerCase() !== 'none' ? sealRaw : ''
    const w = c.pkgWeightLbs
    const pkgWeightLbs =
      w != null && Number.isFinite(/** @type {number} */ (w))
        ? /** @type {number} */ (w)
        : null
    return {
      lat: /** @type {number} */ (c.lat),
      lng: /** @type {number} */ (c.lng),
      order: String(c.order),
      trlrNbr: String(c.trlrNbr ?? '').trim(),
      size: String(c.size ?? '').trim(),
      sealNumber,
      pkgWeightLbs,
    }
  })

  const withWeight = all.filter(
    (c) =>
      c.pkgWeightLbs != null &&
      Number.isFinite(/** @type {number} */ (c.pkgWeightLbs)),
  )
  let heavyTrailerOrder = ''
  if (withWeight.length) {
    const maxW = Math.max(
      ...withWeight.map((c) => /** @type {number} */ (c.pkgWeightLbs)),
    )
    const top = withWeight.filter((c) => c.pkgWeightLbs === maxW)
    if (top.length === 1) heavyTrailerOrder = String(top[0].order)
  }
  if (!heavyTrailerOrder && all.length >= 2) {
    const ft53 = all.filter((c) => c.size === '53ft')
    if (ft53.length === 1) heavyTrailerOrder = String(ft53[0].order)
  }

  const terminalPair = buildTrailerGpsTerminalPair()

  const map = {
    order: card.order,
    trlrNbr: card.trlrNbr,
    size: card.size,
    lat: card.lat,
    lng: card.lng,
    trailerMapPins,
    heavyTrailerOrder,
    terminalPair,
    userLat: null,
    userLng: null,
    userAccuracyM: null,
    userGpsPending: hasGeo,
    userGeoDenied: !hasGeo,
    userVehicleId: vehicleIdForUserMapMarker(linehaulTractorBody.value, linehaulCredMeta.value),
  }

  const meta = {
    odHeaderSingleLine: trailerGpsOdHeader.value.singleLine,
    linehaulOriginIdForApi: linehaulOriginIdForApi.value,
    tripOriginLocationId: tripOriginLocationId.value,
    tripDestLocationId: tripDestLocationId.value,
    proximityTrailers: extractProximityTrailersForTrailerMap(tripDetailsBodyForSlide.value),
  }

  writeTrailerGpsSession({ map, meta })
  void router.push({ name: 'trailer-map' })

  if (!hasGeo) return

  const geoOpts = /** @type {PositionOptions} */ ({
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 25_000,
  })

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      patchTrailerGpsSessionMap({
        userLat: pos.coords.latitude,
        userLng: pos.coords.longitude,
        userAccuracyM:
          pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : null,
        userGpsPending: false,
        userGeoDenied: false,
      })
    },
    (err) => {
      if (err && err.code === 1) {
        patchTrailerGpsSessionMap({
          userLat: null,
          userLng: null,
          userAccuracyM: null,
          userGpsPending: false,
          userGeoDenied: true,
        })
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          patchTrailerGpsSessionMap({
            userLat: pos.coords.latitude,
            userLng: pos.coords.longitude,
            userAccuracyM:
              pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy)
                ? pos.coords.accuracy
                : null,
            userGpsPending: false,
            userGeoDenied: false,
          })
        },
        () => {
          patchTrailerGpsSessionMap({
            userLat: null,
            userLng: null,
            userAccuracyM: null,
            userGpsPending: false,
            userGeoDenied: true,
          })
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
      )
    },
    geoOpts,
  )
}

/** Credentials snapshot for Driver ID row (same rule as header badges used). */
const linehaulCredMeta = ref(null)

const linehaulDriverIdDisplay = computed(() =>
  linehaulDriverIdFromCredMeta(linehaulCredMeta.value ?? {}),
)

/**
 * If first or last segment is long, show two initials (avoids multiline layout breaks).
 * @param {string} raw
 */
function formatDriverNameForCard(raw) {
  const s = String(raw).trim()
  if (!s) return ''
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const MAX = 10
  if (parts.length === 1) {
    const w = parts[0]
    return w.length > MAX ? `${w.slice(0, 1).toUpperCase()}.` : w
  }
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (first.length > MAX || last.length > MAX) {
    const a = first[0] || ''
    const b = last[0] || ''
    return `${a}${b}`.toUpperCase()
  }
  return s
}

/** Driver name scraped from Okta userinfo during Linehaul capture. */
const driverDisplayName = computed(() => {
  const name = linehaulCredMeta.value?.driverName
  if (typeof name !== 'string' || !name.trim()) return ''
  return formatDriverNameForCard(name)
})

async function refreshLinehaulCredMeta() {
  try {
    linehaulCredMeta.value = await getCredentials()
    applyHelpersLocationPrefsFromCredentials(linehaulCredMeta.value)
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
    applyHelpersLocationPrefsFromCredentials(c)
    const raw =
      typeof c.linehaulPollMinutes === 'number' ? c.linehaulPollMinutes : 0
    const m = Math.max(0, Math.min(24 * 60, Math.floor(raw)))
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
let unregisterSession = () => {}

onMounted(async () => {
  unregisterAssignment = registerAssignmentListener((data) => {
    if (data.source === 'save') {
      void loadAssignment()
    }
  })
  unregisterSession = registerSessionListener((data) => {
    if (data?.code !== 'SESSION_REVOKED') return
    const base = import.meta.env.BASE_URL || '/'
    const loginPath = `${base.replace(/\/$/, '')}/login`
    window.location.assign(
      `${loginPath}?reason=signed_in_elsewhere&redirect=${encodeURIComponent(
        router.currentRoute.value.fullPath,
      )}`,
    )
  })
  unregisterRecover = registerApiRecover(reconnectLiveLogStream)
  await loadAssignment()
  void refreshLinehaulCredMeta()
  void loadQuickActions()
  void pollAutomationPreview()
  previewPollTimer = setInterval(pollAutomationPreview, 1600)
  void setupLinehaulPolling()
  void loadDollyRegistry()
  void loadTrailerNumbers()
  syncTripVoiceUnlockHint()
})

onActivated(() => {
  loadAssignment()
  void refreshLinehaulCredMeta()
  void loadDollyRegistry()
  void loadTrailerNumbers()
  void loadQuickActions()
  void setupLinehaulPolling()
  syncTripVoiceUnlockHint()
})

onUnmounted(() => {
  if (tripPhaseVoiceTimer) {
    clearTimeout(tripPhaseVoiceTimer)
    tripPhaseVoiceTimer = null
  }
  cancelTripVoiceAnnouncement()
  cancelAllAlerts()
  clearTrailerStatusTracking()
  clearTrailerGpsTracking()
  clearTripPhaseTracking()
  unregisterAssignment()
  unregisterSession()
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
  <div class="main" :class="{ 'main--automation-preview': showAutomationPreviewFocus }">
    <p v-if="copyToast" class="copy-toast" role="status" aria-live="polite">{{ copyToast }}</p>
    <Teleport to="body">
      <div
        v-if="tripCompleteDialog"
        class="trip-complete-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-complete-title"
        @click.self="tripCompleteDialog = false"
      >
        <div class="trip-complete-card">
          <h3 id="trip-complete-title" class="trip-complete-title">Remove trip from home?</h3>
          <p class="trip-complete-body">
            Double-tap or double-click the Dispatch or Trip Details card to open this. This only removes
            the trip from the home screen. Trips you load already appear in History. FedEx can still
            return the same leg; use again if the trip reappears.
          </p>
          <p v-if="tripRemovalBlockedReason" class="trip-complete-blocked" role="status">{{
            tripRemovalBlockedReason
          }}</p>
          <div class="trip-complete-actions">
            <button type="button" class="btn tap" @click="tripCompleteDialog = false">Cancel</button>
            <button
              type="button"
              class="btn primary tap"
              :disabled="tripCompleteBusy || Boolean(tripRemovalBlockedReason)"
              @click="confirmTripCompleted"
            >
              {{ tripCompleteBusy ? 'Saving…' : 'Remove from home' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="lateNightArriveCheckOpen"
        class="trip-complete-backdrop late-night-arrive-check-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="late-night-arrive-check-title"
        aria-describedby="late-night-arrive-check-desc"
      >
        <div class="trip-complete-card" @click.stop>
          <h3 id="late-night-arrive-check-title" class="trip-complete-title">Arrive and check in?</h3>
          <p id="late-night-arrive-check-desc" class="trip-complete-body">
            Do you want to arrive and check? Yes runs your Arrive quick action, then your check-in
            quick action.
          </p>
          <div class="trip-complete-actions">
            <button
              type="button"
              class="btn tap"
              :disabled="lateNightArriveCheckBusy"
              @click="confirmLateNightArriveCheckNo"
            >
              No
            </button>
            <button
              type="button"
              class="btn primary tap"
              :disabled="lateNightArriveCheckBusy"
              @click="confirmLateNightArriveCheckYes"
            >
              {{ lateNightArriveCheckBusy ? 'Running…' : 'Yes' }}
            </button>
          </div>
        </div>
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
            <h3 id="loc-retry-title" class="loc-retry-title">Location Mismatch Detected</h3>
            <button
              type="button"
              class="loc-retry-close tap"
              aria-label="Close"
              @click="cancelLocationRetry"
            >
              ×
            </button>
          </div>
          <label class="modal-lbl" for="loc-retry-inp">Enter correct location code</label>
          <input
            id="loc-retry-inp"
            v-model="locationRetryInput"
            class="modal-inp loc-retry-inp"
            type="text"
            autocomplete="off"
            placeholder="Location code"
            :disabled="locationRetrySubmitting"
            @keyup.enter="saveLocationAndRetry"
          />
          <div class="modal-actions loc-retry-actions">
            <button type="button" class="btn secondary tap" @click="cancelLocationRetry">
              Close
            </button>
            <button
              type="button"
              class="btn primary tap"
              :disabled="locationRetrySubmitting || !locationRetryInput.trim()"
              @click="saveLocationAndRetry"
            >
              {{ locationRetrySubmitting ? 'Submitting…' : 'Submit' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="inspectFieldOpen"
        class="portal-modal-backdrop"
        :style="{ zIndex: PORTAL_Z_MODAL }"
        role="presentation"
        @click.self="cancelInspectField"
      >
        <div
          class="portal-modal loc-retry-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-field-title"
          @click.stop
        >
          <div class="loc-retry-header">
            <h3 id="inspect-field-title" class="loc-retry-title">Inspect &amp; Check Out</h3>
            <button
              type="button"
              class="loc-retry-close tap"
              aria-label="Close"
              @click="cancelInspectField"
            >
              ×
            </button>
          </div>
          <p class="modal-lbl inspect-field-msg">{{ inspectFieldMessage }}</p>
          <label class="modal-lbl" for="inspect-field-inp">{{ inspectFieldKeyLabel }}</label>
          <input
            id="inspect-field-inp"
            v-model="inspectFieldInput"
            class="modal-inp loc-retry-inp"
            type="text"
            autocomplete="off"
            placeholder="Enter value"
            :disabled="inspectFieldSubmitting"
            @keyup.enter="saveInspectField"
          />
          <div class="modal-actions loc-retry-actions">
            <button type="button" class="btn secondary tap" @click="cancelInspectField">
              Close
            </button>
            <button
              type="button"
              class="btn primary tap"
              :disabled="inspectFieldSubmitting || !inspectFieldInput.trim()"
              @click="saveInspectField"
            >
              {{ inspectFieldSubmitting ? 'Submitting…' : 'Submit' }}
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
                <dd class="dest-loc-dd">
                  <template v-if="row.href">
                    <a
                      :href="row.href"
                      class="dest-loc-link"
                      :target="row.href.startsWith('tel:') ? undefined : '_blank'"
                      :rel="row.href.startsWith('http') ? 'noopener noreferrer' : undefined"
                    >
                      {{ row.value }}
                    </a>
                    <button
                      type="button"
                      class="dest-loc-copy-chip tap"
                      @click.stop="copyTripDetailValue(row.value, row.label)"
                    >
                      Copy
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="dest-loc-val-copy tap"
                    @click="copyTripDetailValue(row.value, row.label)"
                  >
                    {{ row.value }}
                  </button>
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
        v-if="originLocationModalOpen"
        class="portal-modal-backdrop"
        :style="{ zIndex: PORTAL_Z_LOCATION_MODAL }"
        role="presentation"
        @click.self="closeOriginLocationModal"
      >
        <div
          class="portal-modal dest-location-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="origin-loc-title"
          @click.stop
        >
          <div class="dest-loc-header">
            <h3 id="origin-loc-title" class="dest-loc-title">Origin location</h3>
            <button
              type="button"
              class="dest-loc-close tap"
              aria-label="Close"
              @click="closeOriginLocationModal"
            >
              ×
            </button>
          </div>
          <p v-if="tripOriginLocationId" class="dest-loc-id">Trip origin · ID {{ tripOriginLocationId }}</p>
          <div v-if="originLocationLoading" class="dest-loc-loading" aria-live="polite">Loading…</div>
          <p v-else-if="originLocationError" class="err dest-loc-err">{{ originLocationError }}</p>
          <template v-else>
            <dl v-if="originLocationFormatted.rows.length" class="dest-loc-dl">
              <template v-for="row in originLocationFormatted.rows" :key="row.label + row.value + (row.href || '')">
                <dt>{{ row.label }}</dt>
                <dd class="dest-loc-dd">
                  <template v-if="row.href">
                    <a
                      :href="row.href"
                      class="dest-loc-link"
                      :target="row.href.startsWith('tel:') ? undefined : '_blank'"
                      :rel="row.href.startsWith('http') ? 'noopener noreferrer' : undefined"
                    >
                      {{ row.value }}
                    </a>
                    <button
                      type="button"
                      class="dest-loc-copy-chip tap"
                      @click.stop="copyTripDetailValue(row.value, row.label)"
                    >
                      Copy
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="dest-loc-val-copy tap"
                    @click="copyTripDetailValue(row.value, row.label)"
                  >
                    {{ row.value }}
                  </button>
                </dd>
              </template>
            </dl>
            <p v-else class="dest-loc-empty">No location fields could be parsed from the response.</p>
            <details
              v-if="originLocationFormatted.rawJson"
              class="dest-loc-raw-details"
            >
              <summary class="dest-loc-raw-summary">Raw API response</summary>
              <pre class="dest-loc-raw" aria-label="Raw API response">{{ originLocationFormatted.rawJson }}</pre>
            </details>
          </template>
          <div class="modal-actions dest-loc-actions">
            <button type="button" class="btn primary tap" @click="closeOriginLocationModal">Close</button>
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

    <p v-if="loadError" class="err">{{ loadError }}</p>

    <div
      v-if="showAutomationPreviewFocus"
      class="automation-preview-host"
      aria-live="polite"
    >
      <section
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
    </div>

    <template v-if="!showAutomationPreviewFocus">
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
      <div
        v-if="
          !suppressHomeLinehaulErrors &&
          (linehaulTractorError || linehaulDriverError)
        "
        class="linehaul-errors"
      >
        <p v-if="linehaulTractorError" class="err">Tractor: {{ linehaulTractorError }}</p>
        <p v-if="linehaulDriverError" class="err">Driver: {{ linehaulDriverError }}</p>
      </div>
      <div
        v-else-if="suppressHomeLinehaulErrors && (linehaulTractorError || linehaulDriverError)"
        class="linehaul-loading-placeholder"
        aria-hidden="true"
      >
        <span class="linehaul-loading-dot" />
        <span class="linehaul-loading-dot" />
        <span class="linehaul-loading-dot" />
      </div>
      <div
        v-if="linehaulFetching || linehaulAuthRecoveryInProgress"
        class="driver-status-fetching"
        aria-live="polite"
      >
        {{ linehaulAuthRecoveryInProgress ? 'Refreshing FedEx session…' : 'Updating…' }}
      </div>
      <div class="driver-status-cards">
          <div v-if="linehaulTractorBody" class="linehaul-block">
            <h4 class="linehaul-h3">Tractor</h4>
            <dl class="linehaul-dl">
              <div v-if="linehaulTractorBody.locationId != null" class="linehaul-dl-row">
                <dt>Location</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulTractorBody.locationId) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulTractorBody.locationId, 'Location')"
                  >
                    {{ linehaulTractorBody.locationId }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulTractorBody.tractorNbr != null" class="linehaul-dl-row">
                <dt>Tractor</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulTractorBody.tractorNbr) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulTractorBody.tractorNbr, 'Tractor')"
                  >
                    {{ linehaulTractorBody.tractorNbr }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulTractorBody.tractorDomicileAbbrv" class="linehaul-dl-row">
                <dt>Domicile</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulTractorBody.tractorDomicileAbbrv) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulTractorBody.tractorDomicileAbbrv, 'Domicile')"
                  >
                    {{ linehaulTractorBody.tractorDomicileAbbrv }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulTractorBody.detlCodeActvStat" class="linehaul-dl-row">
                <dt>Active</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulTractorBody.detlCodeActvStat) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulTractorBody.detlCodeActvStat, 'Active')"
                  >
                    {{ linehaulTractorBody.detlCodeActvStat }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulTractorBody.detlCodeAvailStat" class="linehaul-dl-row">
                <dt>Status</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulTractorBody.detlCodeAvailStat) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulTractorBody.detlCodeAvailStat, 'Status')"
                  >
                    {{ linehaulTractorBody.detlCodeAvailStat }}
                  </button>
                </dd>
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
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulDriverBody.driverLocation) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulDriverBody.driverLocation, 'Location')"
                  >
                    {{ linehaulDriverBody.driverLocation }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulDriverIdDisplay" class="linehaul-dl-row">
                <dt>Driver ID</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulDriverIdDisplay) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulDriverIdDisplay, 'Driver ID')"
                  >
                    {{ linehaulDriverIdDisplay }}
                  </button>
                </dd>
              </div>
              <div v-if="driverDisplayName" class="linehaul-dl-row linehaul-dl-row--driver-name">
                <dt>NAME</dt>
                <dd class="linehaul-dd-name">
                  <button
                    type="button"
                    class="copyable-dd tap linehaul-dd-name-btn"
                    :disabled="displayOrDash(driverDisplayName) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(driverDisplayName, 'Name')"
                  >
                    {{ driverDisplayName }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulDriverBody.driverActvStat" class="linehaul-dl-row">
                <dt>Active</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulDriverBody.driverActvStat) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulDriverBody.driverActvStat, 'Active')"
                  >
                    {{ linehaulDriverBody.driverActvStat }}
                  </button>
                </dd>
              </div>
              <div v-if="linehaulDriverBody.driverAvlStat" class="linehaul-dl-row">
                <dt>Status</dt>
                <dd>
                  <button
                    type="button"
                    class="copyable-dd tap"
                    :disabled="displayOrDash(linehaulDriverBody.driverAvlStat) === '—'"
                    title="Tap to copy"
                    @click.stop="copyTripDetailValue(linehaulDriverBody.driverAvlStat, 'Status')"
                  >
                    {{ linehaulDriverBody.driverAvlStat }}
                  </button>
                </dd>
              </div>
            </dl>
          </div>
        </div>

      <p
        v-if="
          !linehaulFetching &&
          linehaulLastFetchAt == null &&
          !linehaulTractorError &&
          !linehaulDriverError &&
          apiOk === true
        "
        class="empty driver-status-idle"
      >
        Linehaul not loaded — use Settings to fetch.
      </p>
    </section>

    <section
      ref="dispatchPanelRef"
      class="panel trip-panel"
      @pointerdown="onDispatchPanelPointerDown"
      @pointermove="onDispatchPanelPointerMove"
      @pointerup="onDispatchPanelPointerUp"
      @pointercancel="onDispatchPanelPointerCancel"
      @dblclick="onDispatchPanelDblClick"
    >
      <div class="trip-panel-header">
        <h2 class="trip-panel-title">Trip</h2>
        <div class="trip-panel-header-actions">
          <button
            v-if="equipmentCopyText"
            type="button"
            class="trip-copy-all-btn tap"
            title="Copy all equipment numbers"
            @click.stop="copyTripDetailValue(equipmentCopyText, 'Equipment numbers')"
          >
            Copy All
          </button>
          <div
            class="trip-status-inline"
            role="status"
            :aria-label="`Trip Status: ${tripStatusUi.text}`"
            :title="tripStatusDetailTitle || undefined"
          >
            <span class="trip-status-dot" :class="tripStatusDotClass" aria-hidden="true" />
            <button
              type="button"
              class="trip-status-state copyable-inline tap"
              title="Tap to copy"
              @click.stop="copyTripDetailValue(tripStatusUi.text, 'Trip status')"
            >
              {{ tripStatusUi.text }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="tripVoiceUnlockHint && tripAlertOn"
        class="trip-voice-unlock-banner"
        role="status"
      >
        <button type="button" class="tap trip-voice-unlock-btn" @click="onUnlockTripVoiceTap">
          Tap to enable audio alerts
        </button>
        <span class="trip-voice-unlock-sub"
          >Some phones and tablets need a tap before text-to-speech can play.</span
        >
      </div>

      <div
        v-if="(linehaulTripsBody || prePlanTripSnapshot) && !linehaulTripsError"
        class="trip-route-section"
      >
        <div v-if="hasPrePlanTrip" class="dispatch-slide-dots" aria-hidden="true">
          <span class="dispatch-dot" :class="{ active: dispatchSlideIndex === 0 }" title="Current" />
          <span class="dispatch-dot" :class="{ active: dispatchSlideIndex === 1 }" title="Pre-plan" />
        </div>
        <p v-if="hasPrePlanTrip" class="dispatch-swipe-hint">Swipe to switch trips</p>

        <div class="trip-route-main-row">
          <div class="trip-route-od-cell">
            <div v-if="dispatchSlideIndex === 0 && linehaulTripsBody" class="dispatch-slide">
              <div class="dispatch-od-row" aria-label="Trip origin and destination">
                <div class="dispatch-od-pair dispatch-od-pair--origin">
                  <span class="dispatch-od-label">Origin</span>
                  <button
                    v-if="tripOriginLocationId && !linehaulTripsError"
                    type="button"
                    class="dispatch-od-val dispatch-od-dest-open tap"
                    title="View origin details"
                    @click.stop="openOriginLocationModal"
                  >
                    {{ tripOriginDest.origin }}
                  </button>
                  <span v-else class="dispatch-od-val dispatch-od-val--text">{{ tripOriginDest.origin }}</span>
                </div>
                <span class="dispatch-od-arrow" aria-hidden="true">→</span>
                <div class="dispatch-od-pair dispatch-od-pair--dest">
                  <span class="dispatch-od-label">Destination</span>
                  <button
                    v-if="tripDestLocationId && !linehaulTripsError"
                    type="button"
                    class="dispatch-od-val dispatch-od-dest-open tap"
                    title="View destination details"
                    @click.stop="openDestLocationModal"
                  >
                    {{ tripOriginDest.destination }}
                  </button>
                  <span v-else class="dispatch-od-val dispatch-od-val--text">{{ tripOriginDest.destination }}</span>
                </div>
              </div>
              <TripOdProgressBar
                v-if="showTripOdProgressBar"
                :trip-phase="tripPhase"
                :assigned-ms="tripProgressAssignedMs ?? undefined"
                :dispatched-ms="tripProgressDispatchedMs ?? undefined"
                :arrived-ms="tripProgressArrivedMs ?? undefined"
                :dist-meters="tripProgressDistM ?? undefined"
                :leg-od-meters="tripProgressOdLegM ?? undefined"
                :denom-nm="tripProgressDenomNm"
              />
            </div>

            <div v-if="dispatchSlideIndex === 1 && prePlanTripSnapshot" class="dispatch-slide">
              <span class="dispatch-preplan-badge">Pre-Plan</span>
              <div class="dispatch-od-row" aria-label="Pre-plan trip origin and destination">
                <div class="dispatch-od-pair dispatch-od-pair--origin">
                  <span class="dispatch-od-label">Origin</span>
                  <span class="dispatch-od-val dispatch-od-val--text">{{ prePlanOriginDest.origin }}</span>
                </div>
                <span class="dispatch-od-arrow" aria-hidden="true">→</span>
                <div class="dispatch-od-pair dispatch-od-pair--dest">
                  <span class="dispatch-od-label">Destination</span>
                  <span class="dispatch-od-val dispatch-od-val--text">{{ prePlanOriginDest.destination }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="mergedDispatchInstructionsForSlide.trim()" class="trip-instructions-section">
        <h3 class="trip-section-label">Instructions</h3>
        <button
          type="button"
          class="read dispatch-instructions-body copyable-block tap"
          title="Tap to copy; double-tap to mark trip complete"
          @click.stop="copyTripDetailValue(mergedDispatchInstructionsForSlide, 'Instructions')"
          @pointerup.stop="onDispatchInstructionsPointerUp"
          @dblclick.stop.prevent="openDispatchTripCompleteDialog"
        >
          {{ mergedDispatchInstructionsForSlide }}
        </button>
      </div>

      <div
        v-if="showSealOrTripPanel"
        ref="tripDetailsPanelRef"
        class="trip-equipment-section"
        @pointerdown.stop="onTripPanelPointerDown"
        @pointermove.stop="onTripPanelPointerMove"
        @pointerup.stop="onTripPanelPointerUp"
        @pointercancel.stop="onTripPanelPointerCancel"
        @dblclick.stop="onTripPanelDblClick"
      >
        <h3 class="trip-section-label">Equipment</h3>
        <p
          v-if="
            tripDetailsBodyForSlide &&
            typeof tripDetailsBodyForSlide === 'object' &&
            tripDetailsBodyForSlide.tripStatus === 'DSPCH'
          "
          class="hint"
        >
          DSPCH snapshot; merged with approved trip fields when available.
        </p>

        <div
          v-if="(linehaulTripsBody || linehaulTripsNoActive) && !(linehaulTripsError && suppressHomeLinehaulErrors)"
          class="trip-details-wrap"
        >
        <div class="trailer-card trailer-card--dolly" role="group" aria-label="Dolly">
          <div
            class="dolly-header"
            role="button"
            tabindex="0"
            :aria-expanded="!!expandedDollyApi"
            @click="onDollyHeaderClick"
            @keydown.enter.space.prevent="onDollyHeaderClick"
          >
            <button
              v-if="dollyPrimaryDisplay"
              type="button"
              class="dolly-number-display copyable-inline tap"
              title="Tap to copy dolly number"
              @click.stop="copyTripDetailValue(dollyPrimaryDisplay, 'Dolly number')"
            >
              Dolly #{{ dollyPrimaryDisplay }}
            </button>
            <span v-else class="dolly-number-display dolly-number-display--empty">Dolly —</span>
            <span class="trailer-expand-icon" aria-hidden="true">{{ expandedDollyApi ? '−' : '+' }}</span>
          </div>

          <div v-if="expandedDollyApi" class="dolly-body">
            <div class="dolly-body-row">
              <span
                v-if="dollyPrimaryDisplay"
                class="dolly-rating-pill"
                :class="`dolly-rating-pill--${dollyRating}`"
              >
                <template v-if="dollyRating === 'good'">Good</template>
                <template v-else-if="dollyRating === 'bad'">Bad</template>
                <template v-else>Unrated</template>
              </span>
              <div class="dolly-rate-inline" @click.stop>
                <button
                  v-for="opt in [
                    { k: 'good', t: '👍' },
                    { k: 'bad', t: '👎' },
                    { k: 'none', t: '·' },
                  ]"
                  :key="opt.k"
                  type="button"
                  class="trip-dolly-star tap dolly-star--header"
                  :class="{ 'trip-dolly-star--on': dollyRating === opt.k }"
                  :title="opt.k === 'none' ? 'Clear rating' : `Mark ${opt.k}`"
                  :disabled="!dollyPrimaryDisplay"
                  @click.stop="setDollyRate(opt.k)"
                >
                  {{ opt.t }}
                </button>
              </div>
              <button
                v-if="!dollyAddOpen"
                type="button"
                class="dolly-add-tile tap"
                title="Set dolly number"
                aria-label="Add or change dolly number"
                @click.stop="dollyAddOpen = true"
              >
                +
              </button>
              <button
                v-else
                type="button"
                class="dolly-add-tile dolly-add-tile--active tap"
                title="Close add dolly"
                aria-label="Close"
                @click.stop="(dollyAddOpen = false), (dollyAddDigits = '')"
              >
                ×
              </button>
            </div>

            <div v-if="dollyAddOpen" class="dolly-add-compact">
              <label class="sr-only" for="dolly-compact-inp">6 digit dolly number</label>
              <input
                id="dolly-compact-inp"
                :value="dollyAddDigits"
                class="dolly-compact-inp"
                inputmode="numeric"
                maxlength="6"
                placeholder="6 digits"
                @input="onDollyAddInput"
                @keydown.enter.prevent="dollyAddDigits.length === 6 && onAddDollySubmit()"
              />
              <button
                type="button"
                class="dolly-compact-btn btn primary"
                :disabled="dollyPutBusy || dollyAddDigits.length !== 6"
                @click.stop="onAddDollySubmit"
              >
                Add
              </button>
              <button
                type="button"
                class="dolly-compact-btn btn secondary"
                :disabled="dollyPutBusy"
                @click.stop="(dollyAddOpen = false), (dollyAddDigits = '')"
              >
                Cancel
              </button>
            </div>

            <div v-if="tripDollySection.show" class="dolly-api-section">
              <h3 class="dolly-api-sub">From trip (API)</h3>
              <dl class="trip-details-dl trip-details-dl--dolly-api">
                <template v-for="row in tripDollySection.rows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>
                    <button
                      type="button"
                      class="copyable-dd tap"
                      :disabled="row.value === '—' || !String(row.value).trim()"
                      :title="row.value === '—' ? '' : 'Tap to copy'"
                      @click="copyTripDetailValue(row.value, row.label)"
                    >
                      {{ row.value }}
                    </button>
                  </dd>
                </template>
              </dl>
            </div>
          </div>
        </div>

        <template v-if="tripDetailsBodyForSlide">
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
              <div class="trailer-card-header-inline">
                <button
                  type="button"
                  class="trailer-order copyable-inline tap"
                  title="Tap to copy"
                  @click.stop="copyTripDetailValue(card.order, 'Trailer order')"
                >
                  Trailer {{ card.order }}
                </button>
                <button
                  v-if="card.trlrNbr"
                  type="button"
                  class="trailer-nbr copyable-inline tap"
                  title="Tap to copy"
                  @click.stop="copyTripDetailValue(card.trlrNbr, 'Trailer number')"
                >
                  #{{ card.trlrNbr }}
                </button>
                <button
                  type="button"
                  class="trailer-size-badge copyable-inline tap"
                  :class="card.size === '20ft' ? 'size-20' : 'size-53'"
                  title="Tap to copy"
                  @click.stop="copyTripDetailValue(card.size, 'Trailer size')"
                >
                  {{ card.size }}
                </button>
                <button
                  type="button"
                  class="trailer-status-badge copyable-inline tap"
                  :class="card.statusClass"
                  title="Tap to copy"
                  @click.stop="copyTripDetailValue(card.statusLabel, 'Trailer status')"
                >
                  {{ card.statusLabel }}
                </button>
                <button
                  type="button"
                  class="trailer-load-badge copyable-inline tap"
                  :class="card.loadTypeClass"
                  title="Tap to copy"
                  @click.stop="copyTripDetailValue(card.loadType, 'Load type')"
                >
                  {{ card.loadType }}
                </button>
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

            <div v-if="expandedTrailers[card.id] && card.summaryRows.length" class="trailer-card-summary">
              <dl class="trailer-summary-dl">
                <template v-for="row in card.summaryRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd>
                    <button
                      type="button"
                      class="copyable-dd tap"
                      :disabled="row.value === '—' || !String(row.value).trim()"
                      :title="row.value === '—' ? '' : 'Tap to copy'"
                      @click.stop="copyTripDetailValue(row.value, row.label)"
                    >
                      {{ row.value }}
                    </button>
                  </dd>
                </template>
              </dl>
            </div>
            <div
              v-if="card.loadType === 'Empty'"
              class="trailer-card-summary trailer-nbr-entry"
              @click.stop
            >
              <template v-if="trailerNbrForOrder(card.order) && trailerNbrAddKey !== card.id">
                <span class="trailer-nbr-pre-label">Pre-entered #</span>
                <button
                  type="button"
                  class="trailer-nbr-pre-val copyable-inline tap"
                  title="Tap to copy"
                  @click.stop="copyTripDetailValue(trailerNbrForOrder(card.order), `Trailer ${card.order} number`)"
                >
                  {{ trailerNbrForOrder(card.order) }}
                </button>
                <button
                  type="button"
                  class="dolly-add-tile tap"
                  title="Change trailer number"
                  @click.stop="trailerNbrAddKey = card.id; trailerNbrAddDigits = trailerNbrForOrder(card.order)"
                >
                  +
                </button>
              </template>
              <template v-else-if="trailerNbrAddKey === card.id">
                <input
                  :value="trailerNbrAddDigits"
                  class="dolly-compact-inp"
                  inputmode="numeric"
                  maxlength="8"
                  placeholder="Trailer #"
                  @input="onTrailerNbrInput"
                  @click.stop
                  @keydown.enter.prevent="trailerNbrAddDigits.length >= 4 && onTrailerNbrSubmit(card.order)"
                />
                <button
                  type="button"
                  class="dolly-compact-btn btn primary"
                  :disabled="trailerNbrPutBusy || trailerNbrAddDigits.length < 4"
                  @click.stop="onTrailerNbrSubmit(card.order)"
                >
                  Save
                </button>
                <button
                  type="button"
                  class="dolly-compact-btn btn secondary"
                  :disabled="trailerNbrPutBusy"
                  @click.stop="trailerNbrAddKey = ''; trailerNbrAddDigits = ''"
                >
                  Cancel
                </button>
              </template>
              <template v-else>
                <button
                  type="button"
                  class="trailer-nbr-add-btn tap"
                  @click.stop="trailerNbrAddKey = card.id; trailerNbrAddDigits = ''"
                >
                  Enter trailer number
                </button>
              </template>
            </div>
          </div>
        </template>
      </div>
        <p v-else-if="linehaulTripsNoActive" class="empty trip-details-idle">No active trip</p>
        <p
          v-else-if="linehaulTripsError && !suppressHomeLinehaulErrors"
          class="err trip-details-fetch-err"
        >
          Trip details: {{ linehaulTripsError }}
        </p>
        <div
          v-else-if="linehaulTripsError && suppressHomeLinehaulErrors"
          class="trip-details-loading"
          aria-busy="true"
          aria-label="Loading trip details"
        >
          <span class="trip-details-loading-spinner" />
        </div>
      </div>

      <p v-if="!mergedDispatchInstructionsForSlide.trim() && !showSealOrTripPanel" class="empty">No trip data yet.</p>
    </section>

    <section class="panel actions actions-panel--ruled">
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
          @click="runQuickAction(auto)"
        >
          {{ runningAutomationId === auto.id ? 'Running…' : (auto.manualButtonLabel || auto.name) }}
        </button>
      </div>
    </section>
    </template>
  </div>
</template>

<style scoped>
.main {
  padding: var(--space-4, 1rem) 0 var(--space-6, 1.5rem);
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
  position: relative;
}

.main--automation-preview {
  flex: 1 1 0;
  min-height: 0;
  justify-content: flex-start;
  padding-block: var(--space-2, 0.5rem);
}

.automation-preview-host {
  box-sizing: border-box;
  width: 100%;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
}

.automation-preview-host .preview-panel {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  margin-inline: auto;
}

.automation-preview-host .preview-panel .preview-frame {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  position: relative;
}

/* Override generic .preview-img max-height so the live screenshot scales to fill the frame */
.automation-preview-host .preview-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  max-width: none;
  object-fit: contain;
  object-position: center center;
}

.main.main--automation-preview .preview-frame-empty {
  flex: 1 1 0;
  min-height: 12rem;
}

.copy-toast {
  position: fixed;
  bottom: calc(var(--nav-height, 4rem) + 1rem + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 10050;
  margin: 0;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #f4f4f8;
  background: rgba(30, 30, 38, 0.95);
  border: 1px solid rgba(123, 77, 181, 0.45);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.copyable-dd {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  text-align: inherit;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.12s ease;
}

.copyable-dd:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.copyable-dd:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 2px;
}

.copyable-dd:disabled {
  cursor: default;
  opacity: 0.85;
}

/* Tap-to-copy text that stays visually inline (not full-width block buttons) */
.copyable-inline {
  -webkit-tap-highlight-color: transparent;
}

.trip-status-state.copyable-inline {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.dispatch-od-val--text {
  font-weight: 600;
  word-break: break-word;
  line-height: 1.3;
}

.dispatch-od-dest-open {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
  word-break: break-word;
  line-height: 1.3;
  border-radius: 4px;
}

.dispatch-od-dest-open:hover {
  color: #93c5fd;
}

.dispatch-od-dest-open:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 2px;
}

.copyable-block.dispatch-instructions-body {
  display: block;
  width: 100%;
  margin: 0;
  background: transparent;
  border: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  line-height: 1.45;
}

button.trailer-order.copyable-inline,
button.trailer-nbr.copyable-inline {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-align: left;
}

.trailer-card-header-inline button.trailer-size-badge,
.trailer-card-header-inline button.trailer-status-badge,
.trailer-card-header-inline button.trailer-load-badge {
  cursor: pointer;
  font: inherit;
  font-family: inherit;
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
.dest-loc-dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
}
.dest-loc-val-copy {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 0.15rem 0;
  margin: 0;
  font: inherit;
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--text, #e8e8ee);
  cursor: pointer;
  word-break: break-word;
  border-radius: 4px;
}
.dest-loc-val-copy:hover {
  color: #c4b5fd;
}
.dest-loc-val-copy:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 2px;
}
.dest-loc-copy-chip {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  border: 1px solid rgba(123, 77, 181, 0.45);
  background: rgba(123, 77, 181, 0.12);
  color: #c4b5fd;
  cursor: pointer;
}
.dest-loc-copy-chip:hover {
  background: rgba(123, 77, 181, 0.22);
}
.dest-loc-link {
  color: #90caf9;
  text-decoration: underline;
  text-underline-offset: 2px;
  flex: 1;
  min-width: 0;
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
.driver-status-fetching {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  color: #90caf9;
}
.driver-status-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.45rem;
  align-items: start;
}
.driver-status-cards:has(> .linehaul-block:only-child) {
  grid-template-columns: 1fr;
}
.driver-status-cards .linehaul-dl-row {
  font-size: clamp(0.65rem, 1.8vw + 0.45rem, 0.78rem);
  gap: 0.2rem 0.35rem;
}
.driver-status-cards .linehaul-dl-row dt {
  font-size: clamp(0.58rem, 1.2vw + 0.42rem, 0.68rem);
}
.driver-status-cards .linehaul-dl-row--driver-name .linehaul-dd-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.driver-status-cards .linehaul-dd-name-btn {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.driver-status-cards .linehaul-h3 {
  font-size: clamp(0.65rem, 1vw + 0.5rem, 0.78rem);
  margin-bottom: 0.28rem;
}
.linehaul-loading-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.5rem 0;
  margin-bottom: 0.25rem;
}
.linehaul-loading-dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 999px;
  background: var(--color-text-tertiary, #6e6e7e);
  animation: linehaul-dot-pulse 1s ease-in-out infinite;
}
.linehaul-loading-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.linehaul-loading-dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes linehaul-dot-pulse {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}
.trip-details-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem 0;
}
.trip-details-loading-spinner {
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-top-color: var(--color-accent-purple, #7b4db5);
  border-radius: 50%;
  animation: trip-details-spin 0.75s linear infinite;
}
@keyframes trip-details-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 340px) {
  .driver-status-cards {
    grid-template-columns: 1fr;
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
  margin-top: 0.75rem;
}
@media (max-width: 380px) {
  .loc-retry-actions {
    grid-template-columns: 1fr;
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
.err {
  color: #ff8a80;
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
  min-width: 0;
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
/* ═══════════════════════════════════════════════════════════════════════════
   UNIFIED TRIP PANEL — merged dispatch + equipment
   ═══════════════════════════════════════════════════════════════════════════ */
.trip-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  touch-action: pan-y;
}
.trip-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.trip-panel-title {
  margin: 0 !important;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.trip-panel-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.trip-copy-all-btn {
  padding: 0.2rem 0.5rem;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #c4b5fd;
  background: rgba(123, 77, 181, 0.1);
  border: 1px solid rgba(123, 77, 181, 0.3);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.trip-copy-all-btn:hover {
  background: rgba(123, 77, 181, 0.2);
}
.trip-copy-all-btn:active {
  opacity: 0.8;
}
.trip-route-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.trip-route-main-row {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.55rem 0.75rem;
}
.trip-route-od-cell {
  flex: 1 1 14rem;
  min-width: 0;
}
.trip-route-od-cell .dispatch-slide {
  height: 100%;
}
.trip-instructions-section {
  margin-bottom: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid #2e2e38;
}
.trip-equipment-section {
  padding-top: 0.65rem;
  border-top: 1px solid #2e2e38;
}
.trip-section-label {
  margin: 0 0 0.5rem;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted, #9898a8);
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
.dispatch-slides-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dispatch-slide-dots {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}
.dispatch-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid #5a5a6a;
  background: transparent;
  transition: background 0.15s, border-color 0.15s;
}
.dispatch-swipe-hint,
.trip-details-swipe-hint {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  color: var(--muted, #9898a8);
  text-align: center;
}
.trip-details-swipe-hint {
  text-align: left;
}
.trip-complete-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
}
.late-night-arrive-check-backdrop {
  z-index: 2147483001;
}
.trip-complete-card {
  max-width: 22rem;
  padding: 1.25rem;
  border-radius: 12px;
  background: #1e1e26;
  border: 1px solid #34343e;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.trip-complete-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  color: var(--text, #e8e8ee);
}
.trip-complete-body {
  margin: 0 0 1rem;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--muted, #a8a8b8);
}
.trip-complete-blocked {
  margin: -0.35rem 0 1rem;
  font-size: 0.82rem;
  line-height: 1.4;
  color: #fbbf24;
}
.trip-complete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.actions-panel--ruled > h2:first-of-type {
  margin: 0 0 0.65rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #2e2e38;
}
.dispatch-dot.active {
  background: #7dd3fc;
  border-color: #7dd3fc;
}
.dispatch-slide {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.dispatch-preplan-badge {
  align-self: flex-start;
  padding: 0.2rem 0.5rem;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: #4a3f1a;
  color: #fcd34d;
  border-radius: 4px;
}
.dispatch-od-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: start;
  column-gap: 0.45rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
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
}
.dispatch-od-pair--origin {
  justify-self: start;
  align-items: flex-start;
  text-align: left;
}
.dispatch-od-pair--dest {
  justify-self: start;
  align-items: flex-start;
  text-align: left;
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
  justify-self: center;
  align-self: center;
  color: var(--muted, #9898a8);
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0.2rem;
}
.trip-details-fetch-err {
  margin: 0 0 0.65rem;
  font-size: 0.88rem;
}
.trip-details-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.trip-details-block {
  border: 1px solid #34343e;
  border-radius: 8px;
  background: #25252e;
  overflow: hidden;
}
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
/* ═══════════════════════════════════════════════════════════════════════════
   DOLLY CARD — centered header, dropdown body
   ═══════════════════════════════════════════════════════════════════════════ */
.dolly-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem 0.65rem;
  background: #22222c;
  cursor: pointer;
  user-select: none;
}
.dolly-number-display {
  font-weight: 700;
  font-size: 0.88rem;
  line-height: 1.1;
  color: var(--text, #e8e8ee);
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Code', 'Segoe UI Mono', monospace;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  letter-spacing: 0.02em;
}
.dolly-number-display:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 2px;
  border-radius: 4px;
}
.dolly-number-display--empty {
  color: var(--muted, #9898a8);
  cursor: default;
}
.dolly-header .trailer-expand-icon {
  position: absolute;
  right: 0.65rem;
}
.dolly-header {
  position: relative;
}
.dolly-body {
  padding: 0.55rem 0.65rem;
  border-top: 1px solid #2e2e38;
  background: #1a1a22;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dolly-body-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}
.dolly-api-section {
  border-top: 1px solid #2e2e38;
  padding-top: 0.5rem;
}
.dolly-rating-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.06rem 0.3rem;
  border-radius: 2px;
  font-size: 0.88em;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.01em;
  border: 1px solid #3e3e48;
  color: #9898a8;
  flex-shrink: 1;
  min-width: 0;
  white-space: nowrap;
  max-height: 1.1rem;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dolly-rating-pill--good {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border-color: rgba(34, 197, 94, 0.3);
}
.dolly-rating-pill--bad {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.35);
}
.dolly-rating-pill--none {
  color: #9ca3af;
}
.dolly-nbr--empty {
  color: #6e6e7e;
  font-weight: 600;
  font-size: 1em;
  flex: 0 0 auto;
}
.dolly-rate-inline {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  flex: 0 1 auto;
}
.trip-dolly-star {
  min-width: 1.9rem;
  min-height: 1.9rem;
  font-size: 0.9rem;
  line-height: 1;
  border: 1px solid #3a3a44;
  border-radius: 6px;
  background: #1a1a20;
  cursor: pointer;
  color: #b8b8c8;
}
.trip-dolly-star:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.trip-dolly-star.dolly-star--header {
  min-width: 1.35rem;
  min-height: 1.35rem;
  font-size: 0.72rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  border: 1px solid #3a3a44;
  border-radius: 6px;
  background: #1a1a20;
  cursor: pointer;
  color: #b8b8c8;
}
.trip-dolly-star--on {
  border-color: #7b4db5;
  background: rgba(123, 77, 181, 0.25);
}
.dolly-add-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 6px;
  border: 1px solid rgba(123, 77, 181, 0.4);
  background: rgba(123, 77, 181, 0.1);
  color: #c4b5fd;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.dolly-add-tile--active {
  border-color: #5a5a6a;
  background: #2a2a32;
  color: #c8c8d2;
  font-size: 1.05rem;
}
.trailer-card-header--dolly-static {
  cursor: default;
}
.trailer-card--dolly .trailer-card-header-inline {
  min-width: 0;
  flex: 1;
  justify-content: flex-start;
  gap: clamp(0.2rem, 1.2vw, 0.35rem);
  align-items: center;
}
.trailer-card--dolly .dolly-compact-btn {
  min-height: 1.9rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
}
.dolly-add-compact {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.5rem;
  padding: 0.4rem 0.65rem !important;
}
.dolly-compact-inp {
  flex: 1 1 8rem;
  min-width: 0;
  min-height: 2.2rem;
  max-width: 12rem;
  font-size: 0.95rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.08em;
  text-align: center;
  padding: 0.35rem 0.5rem;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: var(--color-bg-elevated, #0f0f14);
  color: var(--color-text-primary, #f4f4f8);
}
.dolly-compact-inp::placeholder {
  color: #6e6e7e;
  letter-spacing: 0.02em;
}
.dolly-compact-inp:focus {
  outline: none;
  border-color: #7b4db5;
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.2);
}
.trip-dolly-api-block {
  text-align: left;
}
.dolly-api-sub {
  margin: 0 0 0.45rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8a8a98;
  font-weight: 600;
}
.trip-details-dl--dolly-api {
  padding: 0;
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
  min-width: 0;
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
  width: 100%;
  max-width: min(40rem, 100%);
  margin-inline: auto;
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
  object-position: center center;
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
  .panel {
    animation: none;
  }

  .btn.primary:hover {
    transform: none;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LANDSCAPE GRID — wider-than-tall on screens >= 768px wide
   ═══════════════════════════════════════════════════════════════════════════ */

@media (orientation: landscape) and (min-width: 768px) {
  .main {
    display: grid;
    grid-template-columns: minmax(14rem, 1fr) minmax(0, 1.8fr);
    grid-template-rows: auto auto 1fr;
    grid-template-areas:
      "status  trip"
      "actions trip"
      ".       trip";
    align-items: start;
    align-content: start;
    gap: var(--space-3, 0.75rem);
    padding: var(--space-3, 0.75rem) 0;
  }

  .main > .copy-toast { grid-area: 1 / 1 / 2 / 3; }
  .main > .run-error-banner { grid-area: 1 / 1 / 2 / 3; }
  .main > .err { grid-area: 1 / 1 / 2 / 3; }
  /* Preview lives inside .automation-preview-host (not a direct .preview-panel child). */
  .main > .automation-preview-host {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    justify-self: stretch;
    align-self: stretch;
    width: 100%;
    max-width: none;
    z-index: 2;
  }

  /* Quick-action live preview: drop the home grid so the frame can use full width/height. */
  .main.main--automation-preview {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: var(--space-2, 0.5rem);
    padding-inline: var(--space-3, 0.75rem);
  }

  .main.main--automation-preview .automation-preview-host {
    flex: 1 1 auto;
    display: flex;
    min-height: 0;
    width: 100%;
    max-width: none;
    align-items: stretch;
    justify-content: flex-start;
    padding-inline: 0;
  }

  .main.main--automation-preview .preview-panel {
    width: 100%;
    max-width: 100%;
  }

  .panel.driver-status-panel {
    grid-area: status;
    align-self: start;
  }
  .panel.trip-panel {
    grid-area: trip;
    align-self: start;
    max-height: calc(100vh - var(--nav-height, 4rem) - 1.5rem);
    max-height: calc(100dvh - var(--nav-height, 4rem) - 1.5rem);
    overflow-y: auto;
  }
  .panel.actions.actions-panel--ruled {
    grid-area: actions;
    align-self: start;
  }

  .panel {
    padding: var(--space-4, 1rem);
  }

  .driver-status-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .driver-status-cards .linehaul-dl-row {
    font-size: clamp(0.6rem, 1.4vw, 0.75rem);
  }
  .driver-status-cards .linehaul-dl-row dt {
    font-size: clamp(0.52rem, 1vw, 0.65rem);
  }

  .quick-actions-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .quick-action-btn {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
}

@media (orientation: landscape) and (min-width: 1100px) {
  .main {
    grid-template-columns: minmax(18rem, 1fr) minmax(0, 2.2fr);
    gap: var(--space-4, 1rem);
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
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  user-select: none;
  background: #22222c;
}
.trailer-card-header:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: -2px;
}
/* Single-line header: compress to one row without horizontal scroll */
.trailer-card-header-inline {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: nowrap;
  gap: clamp(0.2rem, 1.2vw, 0.35rem);
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: clamp(0.58rem, 2.65vw, 0.72rem);
  line-height: 1.05;
  max-height: 1.35rem;
}
.trailer-order {
  font-weight: 700;
  font-size: 1em;
  line-height: 1.05;
  color: var(--text, #e8e8ee);
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trailer-nbr {
  font-weight: 700;
  font-size: 1em;
  line-height: 1.05;
  color: var(--text, #e8e8ee);
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Code', 'Segoe UI Mono', monospace;
  flex: 0 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trailer-size-badge,
.trailer-status-badge,
.trailer-load-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.06rem 0.22rem;
  border-radius: 2px;
  font-size: 0.78em;
  line-height: 1.05;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.01em;
  flex-shrink: 1;
  min-width: 0;
  min-height: 0.95rem;
  max-height: 1.1rem;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.trailer-status-badge.status-tmpcl {
  background: rgba(234, 179, 8, 0.14);
  color: #facc15;
  border-color: rgba(234, 179, 8, 0.35);
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
  min-width: 0;
}
.trailer-nbr-entry {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  padding: 0.4rem 0.65rem !important;
}
.trailer-nbr-pre-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted, #9898a8);
}
.trailer-nbr-pre-val {
  font-weight: 700;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Code', 'Segoe UI Mono', monospace;
  color: var(--text, #e8e8ee);
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
}
.trailer-nbr-add-btn {
  width: 100%;
  padding: 0.35rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #c4b5fd;
  background: rgba(123, 77, 181, 0.08);
  border: 1px dashed rgba(123, 77, 181, 0.3);
  border-radius: 6px;
  cursor: pointer;
  text-align: center;
}
.trailer-nbr-add-btn:hover {
  background: rgba(123, 77, 181, 0.15);
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

</style>
