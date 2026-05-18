<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  getAssignment,
  getCredentials,
  putCredentials,
  putTomtomApiKey,
  putHereApiKey,
  putNy511ApiKey,
  putGwbUpperCamYoutubeUrl,
  deleteCredentials,
  putAssignment,
  getHealth,
  postLinehaulCaptureBearer,
  fetchFedexLinehaulTractor,
  fetchFedexLinehaulDriver,
  fetchFedexLinehaulTripStatus,
  fetchFedexLinehaulTrips,
  getSettingsAccessLog,
  getSettingsGeoFence,
  putSettingsGeoFence,
  postSettingsGeoFencePreview,
  getApiQuotaSettings,
  putApiQuotaLimits,
  postApiQuotaReset,
  fetchDirectory,
  bulkImportDirectory,
} from '../api.js'
import {
  DIRECTORY_STATION_TYPES,
  DIRECTORY_LOCATION_TYPE_OTHER,
  countByDirectoryLocationType,
  normalizeLocationTypeForStorage,
} from '../utils/directoryLocationTypes.js'
import { parseCsvRecords } from '../utils/csvParse.js'
import {
  refreshLinehaulApis,
  computeLinehaulReferenceId,
  linehaulDriverIdFromCredMeta,
} from '../stores/linehaulSnapshotStore.js'
import { registerApiRecover, ensureFedexApiReady } from '../composables/useApiHealth.js'
import {
  liveLogEntries,
  pushLiveLog,
  clearLiveLog,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import SettingsSection from '../components/settings/SettingsSection.vue'
import LeafletPinModal from '../components/LeafletPinModal.vue'
import GeoFenceEditor from '../components/GeoFenceEditor.vue'
import ApiStatusBadge from '../components/ApiStatusBadge.vue'
import {
  trafficTomtomKeyOverride,
  setTomtomTrafficKey,
  hereApiKeyOverride,
  setHereApiKey,
  ny511ApiKeyOverride,
  setNy511ApiKey,
} from '../stores/trafficTileKey.js'
import AutomationList from '../components/automation/AutomationList.vue'
import AutomationEditor from '../components/automation/AutomationEditor.vue'
import {
  getTripAlertMode,
  setTripAlertMode,
  speakTripTtsTest,
  playTripBellTest,
  isTripStatusChangeEnabled,
  setTripStatusChangeEnabled,
  isTrailerStatusChangeEnabled,
  setTrailerStatusChangeEnabled,
  isArrivalAlertsEnabled,
  setArrivalAlertsEnabled,
  previewTripAlertSample,
  getNearTrailerRadiusFeet,
  setNearTrailerRadiusFeet,
  isTrailerGpsTtsEnabled,
  setTrailerGpsTtsEnabled,
} from '../utils/tripVoiceAnnouncement.js'
import {
  getAlertPrefs,
  setAlertPrefs,
  testTractorChangeAlert,
  testDriverChangeAlert,
  testSuccessAlert,
} from '../utils/alertAudioQueue.js'
import {
  getHelpersAutoArriveNearDestEnabled,
  setHelpersAutoArriveNearDestEnabled,
  getHelpersAutoArriveRadiusNm,
  setHelpersAutoArriveRadiusNm,
  HELPERS_RADIUS_NM_MIN,
  HELPERS_RADIUS_NM_MAX,
} from '../utils/helpersLocationPrefs.js'
import {
  appGeoLat,
  appGeoLng,
  appGeoAccuracyM,
  appGeoPermission,
  appGeoError,
  requestAppGeolocationOnceFromGesture,
} from '../composables/useAppGeolocationWatch.js'

/** Shown when a secret is on file but the user has not typed a new value (password inputs stay masked). */
const SECRET_SAVED_MASK = '••••••••••••••••'

const router = useRouter()
const route = useRoute()

/** @type {import('vue').Ref<'general' | 'automation' | 'audio' | 'security' | 'directory' | 'helpers'>} */
const settingsTab = ref('general')

const helpersAutoArriveEnabled = ref(getHelpersAutoArriveNearDestEnabled())
const helpersRadiusNm = ref(getHelpersAutoArriveRadiusNm())
const helpersLocationBusy = ref(false)

function syncHelpersPrefsFromStorage() {
  helpersAutoArriveEnabled.value = getHelpersAutoArriveNearDestEnabled()
  helpersRadiusNm.value = getHelpersAutoArriveRadiusNm()
}

function onHelpersAutoToggle() {
  setHelpersAutoArriveNearDestEnabled(helpersAutoArriveEnabled.value)
}

function onHelpersRadiusBlur() {
  const n = Number.parseFloat(String(helpersRadiusNm.value))
  if (!Number.isFinite(n)) {
    helpersRadiusNm.value = getHelpersAutoArriveRadiusNm()
    return
  }
  setHelpersAutoArriveRadiusNm(n)
  helpersRadiusNm.value = getHelpersAutoArriveRadiusNm()
}

const helpersPermissionLabel = computed(() => {
  switch (appGeoPermission.value) {
    case 'unsupported':
      return 'Geolocation is not supported in this browser.'
    case 'denied':
      return 'Location permission denied. Enable it in the browser or OS settings.'
    case 'prompt':
      return 'Location permission not decided yet — use “Request location fix” below (iOS may require a tap).'
    case 'granted':
      return 'Location permission granted.'
    default:
      return 'Location permission status unknown.'
  }
})

const helpersCoordsLine = computed(() => {
  const la = appGeoLat.value
  const lo = appGeoLng.value
  if (la == null || lo == null || !Number.isFinite(la) || !Number.isFinite(lo)) return '—'
  const acc = appGeoAccuracyM.value
  const accStr =
    acc != null && Number.isFinite(acc) ? ` ±${Math.round(acc)} m` : ''
  return `${la.toFixed(5)}, ${lo.toFixed(5)}${accStr}`
})

async function onHelpersRequestLocationTap() {
  helpersLocationBusy.value = true
  try {
    await requestAppGeolocationOnceFromGesture()
  } finally {
    helpersLocationBusy.value = false
  }
}

/** @type {import('vue').Ref<Array<{
 *   id: string,
 *   at: string,
 *   ip: string,
 *   latitude: number | null,
 *   longitude: number | null,
 *   locationDenied: boolean,
 *   source: string,
 * }>>} */
const accessLogEntries = ref([])
const accessLogLoading = ref(false)
const accessLogError = ref('')

async function loadSecurityAccessLog() {
  accessLogLoading.value = true
  accessLogError.value = ''
  try {
    const res = await getSettingsAccessLog()
    accessLogEntries.value = Array.isArray(res.entries) ? res.entries : []
  } catch (e) {
    accessLogError.value = e instanceof Error ? e.message : String(e)
    accessLogEntries.value = []
  } finally {
    accessLogLoading.value = false
  }
}

const geoFenceEnabled = ref(false)
const geoFenceRedirectUrl = ref('')
/** @type {import('vue').Ref<Array<{ lat: number, lng: number }>>} */
const geoFencePolygon = ref([])
const geoFenceLoading = ref(false)
const geoFenceSaving = ref(false)
const geoFenceError = ref('')
const geoFenceMsg = ref('')
/** @type {import('vue').Ref<{ inside: boolean | null, address: string | null, lat: number | null, lng: number | null, reason?: string } | null>} */
const geoFencePreview = ref(null)

/** @type {import('vue').Ref<InstanceType<typeof GeoFenceEditor> | null>} */
const geoFenceEditorRef = ref(null)

async function loadGeoFenceSettings() {
  geoFenceLoading.value = true
  geoFenceError.value = ''
  try {
    const res = await getSettingsGeoFence()
    geoFenceEnabled.value = res.enabled === true
    geoFenceRedirectUrl.value =
      typeof res.redirectUrl === 'string' ? res.redirectUrl : ''
    geoFencePolygon.value = Array.isArray(res.polygon)
      ? res.polygon.map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        }))
      : []
    await refreshGeoFencePreview()
  } catch (e) {
    geoFenceError.value = e instanceof Error ? e.message : String(e)
  } finally {
    geoFenceLoading.value = false
  }
}

async function saveGeoFenceSettings() {
  geoFenceSaving.value = true
  geoFenceMsg.value = ''
  geoFenceError.value = ''
  try {
    await putSettingsGeoFence({
      enabled: geoFenceEnabled.value,
      redirectUrl: geoFenceRedirectUrl.value.trim(),
      polygon: geoFencePolygon.value,
    })
    geoFenceMsg.value = 'Saved'
    await refreshGeoFencePreview()
  } catch (e) {
    geoFenceError.value = e instanceof Error ? e.message : String(e)
  } finally {
    geoFenceSaving.value = false
  }
}

function clearGeoFencePolygon() {
  geoFencePolygon.value = []
  void refreshGeoFencePreview()
}

function undoGeoFenceLastPoint() {
  if (!geoFencePolygon.value.length) return
  geoFencePolygon.value = geoFencePolygon.value.slice(0, -1)
  void refreshGeoFencePreview()
}

async function refreshGeoFencePreview() {
  try {
    const res = await postSettingsGeoFencePreview({})
    geoFencePreview.value = {
      inside: res.inside ?? null,
      address: res.address ?? null,
      lat: res.lat ?? null,
      lng: res.lng ?? null,
      reason: res.reason,
    }
  } catch {
    geoFencePreview.value = null
  }
}

const accessMapModalOpen = ref(false)
/** @type {import('vue').Ref<{ lat: number, lng: number, title: string, subtitle: string } | null>} */
const accessMapModalTarget = ref(null)

function openAccessLogMap(row) {
  const lat = row.latitude != null ? Number(row.latitude) : NaN
  const lng = row.longitude != null ? Number(row.longitude) : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  accessMapModalTarget.value = {
    lat,
    lng,
    title: 'Access location',
    subtitle: String(row.ip || ''),
  }
  accessMapModalOpen.value = true
}

function closeAccessMapModal() {
  accessMapModalOpen.value = false
  accessMapModalTarget.value = null
}

/** @type {import('vue').Ref<'off' | 'tts' | 'both'>} */
const tripAlertMode = ref(getTripAlertMode())

const tripStatusChangeOn = ref(isTripStatusChangeEnabled())
const trailerStatusChangeOn = ref(isTrailerStatusChangeEnabled())
const arrivalAlertsOn = ref(isArrivalAlertsEnabled())
const trailerNearbyOn = ref(isTrailerGpsTtsEnabled())
const nearTrailerRadiusFeet = ref(getNearTrailerRadiusFeet())
const audioMoreExpanded = ref(false)

function saveNearTrailerRadius() {
  setNearTrailerRadiusFeet(nearTrailerRadiusFeet.value)
  nearTrailerRadiusFeet.value = getNearTrailerRadiusFeet()
}

const alertPrefs = ref(getAlertPrefs())

function updateAlertPref(key, value) {
  alertPrefs.value = { ...alertPrefs.value, [key]: value }
  setAlertPrefs({ [key]: value })
}

function setTripAlertModeUi(
  /** @type {'off' | 'tts' | 'both'} */ mode,
) {
  tripAlertMode.value = mode
  setTripAlertMode(mode)
}

const ttsEnabled = computed(() => tripAlertMode.value !== 'off')
const bellChimeEnabled = computed(() => tripAlertMode.value === 'both')

function toggleTts(enabled) {
  setTripAlertModeUi(enabled ? 'tts' : 'off')
}

function toggleBellChime(enabled) {
  setTripAlertModeUi(enabled ? 'both' : 'tts')
}

function toggleTripStatusChange(enabled) {
  tripStatusChangeOn.value = enabled
  setTripStatusChangeEnabled(enabled)
}

function toggleArrivalAlerts(enabled) {
  arrivalAlertsOn.value = enabled
  setArrivalAlertsEnabled(enabled)
}

function toggleTrailerStatusChange(enabled) {
  trailerStatusChangeOn.value = enabled
  setTrailerStatusChangeEnabled(enabled)
}

function toggleTrailerNearby(enabled) {
  trailerNearbyOn.value = enabled
  setTrailerGpsTtsEnabled(enabled)
}

const editingAutomationId = ref(null)

function openAutomationEditor(id) {
  editingAutomationId.value = id
}

function closeAutomationEditor() {
  editingAutomationId.value = null
}

let unregisterRecover = () => {}

const credUser = ref('')
const credTractor = ref('')
/** 0=Sun..6=Sat; History groups by your rolling 7-day work week starting on this day */
const workWeekStartDay = ref(0)
const workWeekEndDay = ref(6)
/** History calendar "shift day" — overnight (e.g. 19:00–07:00) uses the date the shift started. */
const shiftStartTime = ref('00:00')
const shiftEndTime = ref('23:59')
const credLinehaulToken = ref('')
const credPollMinutes = ref(0)
const weekDayOptions = [
  { v: 0, label: 'Sunday' },
  { v: 1, label: 'Monday' },
  { v: 2, label: 'Tuesday' },
  { v: 3, label: 'Wednesday' },
  { v: 4, label: 'Thursday' },
  { v: 5, label: 'Friday' },
  { v: 6, label: 'Saturday' },
]
/** Linehaul home refresh slider: 0 = manual only, max 60 min (1 min steps). */
const LINEHAUL_POLL_MAX = 60
const linehaulPollTickValues = Array.from(
  { length: LINEHAUL_POLL_MAX + 1 },
  (_, i) => i,
)
const linehaulManualBusy = ref(false)
/** Optional digits for Settings → Trip details test (dispatch-era `dailyTripLegSequence`). */
const linehaulTestTripLegSeq = ref('')
/** @type {import('vue').Ref<'all' | 'tractor' | 'driver' | 'tripReady' | 'trips'>} */
const linehaulTestTarget = ref('all')
const credPass = ref('')
const credMeta = ref(null)
const credSaving = ref(false)
const captureBearerBusy = ref(false)

const linehaulPollReadout = computed(() => {
  const n = Math.max(
    0,
    Math.min(LINEHAUL_POLL_MAX, Math.floor(Number(credPollMinutes.value) || 0)),
  )
  return n === 0 ? 'Manual only' : `Every ${n} min`
})

const linehaulPollAriaNow = computed(() =>
  Math.max(
    0,
    Math.min(LINEHAUL_POLL_MAX, Math.floor(Number(credPollMinutes.value) || 0)),
  ),
)

/** US phone: digits only (max 10); shown in the field as (XXX) XXX XXXX */
const phoneDigits = ref('')
const credMsg = ref(null)

/** TomTom Traffic Raster API key (Traffic map overlay). Free developer account: developer.tomtom.com */
const tomtomTrafficDraft = ref('')
const tomtomTrafficMsg = ref('')
const tomtomTrafficBusy = ref(false)

async function saveTomtomTrafficKey() {
  if (!(await requireApi())) return
  tomtomTrafficBusy.value = true
  tomtomTrafficMsg.value = ''
  try {
    await putTomtomApiKey({ tomtomApiKey: tomtomTrafficDraft.value })
    setTomtomTrafficKey(tomtomTrafficDraft.value)
    tomtomTrafficMsg.value = 'TomTom key saved to your account (encrypted on the server).'
  } catch (e) {
    tomtomTrafficMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    tomtomTrafficBusy.value = false
  }
}

/** HERE API key (Route Monitoring / Traffic Flow). Free developer account: platform.here.com */
const hereApiDraft = ref('')
const hereApiMsg = ref('')
const hereApiBusy = ref(false)

async function saveHereApiKey() {
  if (!(await requireApi())) return
  hereApiBusy.value = true
  hereApiMsg.value = ''
  try {
    await putHereApiKey({ hereApiKey: hereApiDraft.value })
    setHereApiKey(hereApiDraft.value)
    hereApiMsg.value = 'HERE key saved to your account (encrypted on the server).'
  } catch (e) {
    hereApiMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    hereApiBusy.value = false
  }
}

/** 511NY API key (bridge cameras + Traffic NY511 feeds). Register: 511ny.org/my511/register */
const ny511ApiDraft = ref('')
const ny511ApiMsg = ref('')
const ny511ApiBusy = ref(false)

async function saveNy511ApiKey() {
  if (!(await requireApi())) return
  ny511ApiBusy.value = true
  ny511ApiMsg.value = ''
  try {
    await putNy511ApiKey({ ny511ApiKey: ny511ApiDraft.value })
    setNy511ApiKey(ny511ApiDraft.value)
    ny511ApiMsg.value = '511NY key saved to your account (encrypted on the server).'
  } catch (e) {
    ny511ApiMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    ny511ApiBusy.value = false
  }
}

/** GWB upper deck camera: full YouTube URL saved on server (no YouTube API key required). */
const gwbUpperCamYoutubeDraft = ref('')
const gwbUpperCamYoutubeMsg = ref('')
const gwbUpperCamYoutubeBusy = ref(false)

async function saveGwbUpperCamYoutubeUrl() {
  if (!(await requireApi())) return
  gwbUpperCamYoutubeBusy.value = true
  gwbUpperCamYoutubeMsg.value = ''
  try {
    await putGwbUpperCamYoutubeUrl({ url: gwbUpperCamYoutubeDraft.value })
    gwbUpperCamYoutubeMsg.value = 'GWB upper camera link saved on the server.'
    await loadCredentials()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tripbuddy-gwb-upper-cam-url-updated'))
    }
  } catch (e) {
    gwbUpperCamYoutubeMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    gwbUpperCamYoutubeBusy.value = false
  }
}

/** Server-tracked outbound API usage (per UTC day). */
const apiQuotaRows = ref(
  /** @type {Array<{ id: string, label: string, countToday: number, limitDay: number, defaultLimitDay: number, perMinuteLimit: number, callsLastMinute: number, countMonth?: number, limitMonth?: number, defaultLimitMonth?: number, monthKey?: string }>} */ ([]),
)
const apiQuotaDayKey = ref('')
const apiQuotaMonthKey = ref('')
const apiQuotaMsg = ref('')
const apiQuotaBusy = ref(false)
/** Editable daily caps keyed by bucket id */
const apiQuotaDraftLimits = ref(/** @type {Record<string, string>} */ ({}))
const apiQuotaHasMonthCols = computed(() =>
  apiQuotaRows.value.some((r) => r.limitMonth != null),
)

async function refreshApiQuota() {
  apiQuotaMsg.value = ''
  try {
    const r = await getApiQuotaSettings()
    if (!r.ok || !Array.isArray(r.buckets)) {
      apiQuotaRows.value = []
      return
    }
    apiQuotaDayKey.value = typeof r.dayKey === 'string' ? r.dayKey : ''
    apiQuotaMonthKey.value = typeof r.monthKey === 'string' ? r.monthKey : ''
    apiQuotaRows.value = r.buckets
    const d = { ...apiQuotaDraftLimits.value }
    for (const b of r.buckets) {
      d[b.id] = String(b.limitDay)
    }
    apiQuotaDraftLimits.value = d
  } catch (e) {
    apiQuotaRows.value = []
    apiQuotaMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveApiQuotaLimitsFromUi() {
  if (!(await requireApi())) return
  apiQuotaBusy.value = true
  apiQuotaMsg.value = ''
  try {
    /** @type {Record<string, number>} */
    const limits = {}
    for (const row of apiQuotaRows.value) {
      const raw = apiQuotaDraftLimits.value[row.id]
      const n = Math.floor(Number(raw))
      if (!Number.isFinite(n) || n < 1) continue
      limits[row.id] = n
    }
    const r = await putApiQuotaLimits({ limits })
    if (r.ok && Array.isArray(r.buckets)) {
      apiQuotaRows.value = r.buckets
      apiQuotaDayKey.value = typeof r.dayKey === 'string' ? r.dayKey : ''
      apiQuotaMonthKey.value = typeof r.monthKey === 'string' ? r.monthKey : ''
      apiQuotaMsg.value = 'Daily limits saved.'
    }
  } catch (e) {
    apiQuotaMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    apiQuotaBusy.value = false
  }
}

async function resetApiQuotaToday() {
  if (!(await requireApi())) return
  apiQuotaBusy.value = true
  apiQuotaMsg.value = ''
  try {
    const r = await postApiQuotaReset()
    if (r.ok && Array.isArray(r.buckets)) {
      apiQuotaRows.value = r.buckets
      apiQuotaDayKey.value = typeof r.dayKey === 'string' ? r.dayKey : ''
      apiQuotaMonthKey.value = typeof r.monthKey === 'string' ? r.monthKey : ''
      apiQuotaMsg.value = "Today's counts reset (UTC)."
    }
  } catch (e) {
    apiQuotaMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    apiQuotaBusy.value = false
  }
}

const screenshotModal = ref(null)

function openScreenshotModal(line) {
  screenshotModal.value = line
}

function closeScreenshotModal() {
  screenshotModal.value = null
}

async function requireApi() {
  const ok = await ensureFedexApiReady()
  if (!ok) {
    pushLiveLog({
      type: 'error',
      message:
        'API not reachable on port 3847. With vite-only dev, wait a few seconds for autostart, or run npm run dev from the project root.',
      ts: Date.now(),
    })
  }
  return ok
}

/** @param {string} raw */
function formatUsPhoneDisplay(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 10)
  if (!d.length) return ''
  if (d.length <= 3) return d.length < 3 ? `(${d}` : `(${d})`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}`
}

const phoneDisplay = computed(() => formatUsPhoneDisplay(phoneDigits.value))

function onPhoneInput(e) {
  phoneDigits.value = String(e.target?.value ?? '').replace(/\D/g, '').slice(0, 10)
}

function onCredTractorInput(e) {
  credTractor.value = String(e.target?.value ?? '').replace(/\D/g, '').slice(0, 6)
}

async function loadAssignmentState() {
  try {
    const a = await getAssignment()
    const fromA = String(a.driverPhone ?? '')
      .replace(/\D/g, '')
      .slice(0, 10)
    const fromC = String(credMeta.value?.driverPhone ?? '')
      .replace(/\D/g, '')
      .slice(0, 10)
    phoneDigits.value = fromC || fromA
  } catch (e) {
    pushLiveLog({ type: 'error', message: e instanceof Error ? e.message : String(e), ts: Date.now() })
  }
}

async function loadCredentials() {
  try {
    credMeta.value = await getCredentials({
      includeLinehaulBearer: true,
      includeTomtomApiKey: true,
      includeHereApiKey: true,
      includeNy511ApiKey: true,
    })
    credUser.value = credMeta.value.username || ''
    credTractor.value = String(credMeta.value.tractorNumber ?? '')
      .replace(/\D/g, '')
      .slice(0, 6)
    {
      const raw =
        typeof credMeta.value.linehaulPollMinutes === 'number'
          ? credMeta.value.linehaulPollMinutes
          : 0
      credPollMinutes.value = Math.max(
        0,
        Math.min(LINEHAUL_POLL_MAX, Math.floor(raw)),
      )
    }
    {
      const ws =
        typeof credMeta.value.workWeekStartDay === 'number' ? credMeta.value.workWeekStartDay : 0
      workWeekStartDay.value = Math.min(6, Math.max(0, Math.floor(ws)))
    }
    {
      const we =
        typeof credMeta.value.workWeekEndDay === 'number' ? credMeta.value.workWeekEndDay : 6
      workWeekEndDay.value = Math.min(6, Math.max(0, Math.floor(we)))
    }
    {
      const mToStr = (m) => {
        const n = Math.max(0, Math.min(1439, Math.floor(Number(m) || 0)))
        return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
      }
      shiftStartTime.value =
        typeof credMeta.value.shiftStartMins === 'number'
          ? mToStr(credMeta.value.shiftStartMins)
          : '00:00'
      shiftEndTime.value =
        typeof credMeta.value.shiftEndMins === 'number'
          ? mToStr(credMeta.value.shiftEndMins)
          : '23:59'
    }
    credLinehaulToken.value =
      typeof credMeta.value.fedexLinehaulBearer === 'string'
        ? credMeta.value.fedexLinehaulBearer
        : ''
    const tk =
      typeof credMeta.value.tomtomApiKey === 'string' ? credMeta.value.tomtomApiKey.trim() : ''
    if (tk) setTomtomTrafficKey(tk)
    tomtomTrafficDraft.value = trafficTomtomKeyOverride.value
    const hk =
      typeof credMeta.value.hereApiKey === 'string' ? credMeta.value.hereApiKey.trim() : ''
    if (hk) setHereApiKey(hk)
    hereApiDraft.value = hereApiKeyOverride.value
    const nk =
      typeof credMeta.value.ny511ApiKey === 'string' ? credMeta.value.ny511ApiKey.trim() : ''
    if (nk) setNy511ApiKey(nk)
    ny511ApiDraft.value = ny511ApiKeyOverride.value
    gwbUpperCamYoutubeDraft.value =
      typeof credMeta.value.gwbUpperCamYoutubeUrl === 'string'
        ? credMeta.value.gwbUpperCamYoutubeUrl
        : ''
    await refreshApiQuota()
  } catch (e) {
    pushLiveLog({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
      ts: Date.now(),
    })
  }
}

async function saveCredentials() {
  if (!(await requireApi())) return
  credSaving.value = true
  credMsg.value = null
  try {
    const hasBearerInput = credLinehaulToken.value.trim().length > 0
    const tToM = (s) => {
      const t = String(s).trim()
      if (!/^\d{1,2}:\d{2}$/.test(t)) return 0
      const [a, b] = t.split(':')
      const h = Math.min(23, Math.max(0, parseInt(a, 10) || 0))
      const mi = Math.min(59, Math.max(0, parseInt(b, 10) || 0))
      return h * 60 + mi
    }
    const ssm = tToM(shiftStartTime.value)
    const sem = tToM(shiftEndTime.value)
    const body = {
      username: credUser.value,
      password: credPass.value || undefined,
      tractorNumber: credTractor.value,
      driverPhone: phoneDigits.value,
      workWeekStartDay: workWeekStartDay.value,
      workWeekEndDay: workWeekEndDay.value,
      shiftStartMins: ssm,
      shiftEndMins: sem,
      linehaulPollMinutes: Math.max(
        0,
        Math.min(LINEHAUL_POLL_MAX, Math.floor(Number(credPollMinutes.value) || 0)),
      ),
    }
    if (hasBearerInput) {
      body.fedexLinehaulBearer = credLinehaulToken.value.trim()
    }
    await putCredentials(body)
    await putAssignment({
      driverPhone: phoneDigits.value,
    })
    credPass.value = ''
    credLinehaulToken.value = ''
    await loadCredentials()
    await loadAssignmentState()
    credMsg.value = 'Saved'
    pushLiveLog({ type: 'info', message: 'Credentials saved', ts: Date.now() })
  } catch (e) {
    credMsg.value = e instanceof Error ? e.message : String(e)
    pushLiveLog({ type: 'error', message: e instanceof Error ? e.message : String(e), ts: Date.now() })
  } finally {
    credSaving.value = false
  }
}

async function clearCredentials() {
  if (!(await requireApi())) return
  try {
    await deleteCredentials()
    credUser.value = ''
    credTractor.value = ''
    credLinehaulToken.value = ''
    credPass.value = ''
    setTomtomTrafficKey('')
    tomtomTrafficDraft.value = ''
    setHereApiKey('')
    hereApiDraft.value = ''
    setNy511ApiKey('')
    ny511ApiDraft.value = ''
    gwbUpperCamYoutubeDraft.value = ''
    await loadCredentials()
    pushLiveLog({ type: 'info', message: 'Credentials cleared', ts: Date.now() })
  } catch (e) {
    pushLiveLog({ type: 'error', message: e instanceof Error ? e.message : String(e), ts: Date.now() })
  }
}

async function runCaptureLinehaulBearer() {
  if (!(await requireApi())) return
  try {
    const h = await getHealth()
    if (h.busy) {
      pushLiveLog({
        type: 'error',
        message: 'Server busy (automation or Linehaul capture) — try again shortly.',
        ts: Date.now(),
      })
      return
    }
  } catch {
    /* ignore */
  }
  captureBearerBusy.value = true
  try {
    const result = await postLinehaulCaptureBearer({
      headless: true,
      tryOktaLogin: true,
      clearSession: true,
      bypassValidityProbe: true,
    })
    if (result.skipped) {
      pushLiveLog({
        type: 'info',
        message: 'Linehaul bearer already valid — browser capture skipped.',
        ts: Date.now(),
      })
    } else {
      pushLiveLog({
        type: 'info',
        message: 'Linehaul bearer captured from fdxtools and saved.',
        ts: Date.now(),
      })
    }
    await loadCredentials()
    await loadAssignmentState()
  } catch (e) {
    pushLiveLog({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
      ts: Date.now(),
    })
  } finally {
    captureBearerBusy.value = false
  }
}

async function testLinehaulTractor() {
  if (!(await requireApi())) return
  const r = await fetchFedexLinehaulTractor()
  if (r.ok && r.body !== undefined) {
    pushLiveLog({
      type: 'info',
      message: `Tractor details: ${JSON.stringify(r.body)}`,
      ts: Date.now(),
    })
  } else {
    pushLiveLog({
      type: 'error',
      message: `Tractor details: ${r.error || 'failed'}${r.body != null ? ` ${JSON.stringify(r.body)}` : ''}`,
      ts: Date.now(),
    })
  }
}

async function testLinehaulDriver() {
  if (!(await requireApi())) return
  const r = await fetchFedexLinehaulDriver()
  if (r.ok && r.body !== undefined) {
    pushLiveLog({
      type: 'info',
      message: `Driver details: ${JSON.stringify(r.body)}`,
      ts: Date.now(),
    })
  } else {
    pushLiveLog({
      type: 'error',
      message: `Driver details: ${r.error || 'failed'}${r.body != null ? ` ${JSON.stringify(r.body)}` : ''}`,
      ts: Date.now(),
    })
  }
}

async function testLinehaulTripReady() {
  if (!(await requireApi())) return
  const tr = await fetchFedexLinehaulTractor()
  if (!tr.ok || tr.body === undefined) {
    pushLiveLog({
      type: 'error',
      message: `Trip Ready: tractor API required first — ${tr.error || 'failed'}${tr.body != null ? ` ${JSON.stringify(tr.body)}` : ''}`,
      ts: Date.now(),
    })
    return
  }
  let cred
  try {
    cred = await getCredentials()
  } catch (e) {
    pushLiveLog({
      type: 'error',
      message: `Trip Ready: credentials ${e instanceof Error ? e.message : String(e)}`,
      ts: Date.now(),
    })
    return
  }
  const driverId = linehaulDriverIdFromCredMeta(cred)
  const refId = computeLinehaulReferenceId(tr.body, driverId)
  if (!refId) {
    pushLiveLog({
      type: 'error',
      message:
        'Trip Ready: could not build reference id (digits-only Username/Employee # and tractor locationId + tractorNbr).',
      ts: Date.now(),
    })
    return
  }
  const trip = await fetchFedexLinehaulTripStatus({ referenceId: refId })
  if (trip.ok && trip.body !== undefined) {
    pushLiveLog({
      type: 'info',
      message: `Trip Ready API (referenceId=${refId}): ${JSON.stringify(trip.body)}`,
      ts: Date.now(),
    })
  } else {
    pushLiveLog({
      type: 'error',
      message: `Trip Ready API: ${trip.error || 'failed'}${trip.body != null ? ` ${JSON.stringify(trip.body)}` : ''}`,
      ts: Date.now(),
    })
  }
}

async function testLinehaulTrips() {
  if (!(await requireApi())) return
  const leg = typeof linehaulTestTripLegSeq.value === 'string'
    ? linehaulTestTripLegSeq.value.trim()
    : ''
  const r =
    leg && /^\d+$/.test(leg)
      ? await fetchFedexLinehaulTrips({
          dailyTripLegSequence: leg,
          alreadyCalled: 'false',
        })
      : await fetchFedexLinehaulTrips()
  if (r.noActiveTrip) {
    pushLiveLog({
      type: 'info',
      message: 'Trip details API: no active trip (FedEx HTTP 204)',
      ts: Date.now(),
    })
  } else if (r.ok && r.body !== undefined) {
    pushLiveLog({
      type: 'info',
      message: `Trip details API: ${JSON.stringify(r.body)}`,
      ts: Date.now(),
    })
  } else {
    const detail = [
      r.error || 'failed',
      r.status != null ? `(HTTP ${r.status})` : '',
      r.body !== undefined ? JSON.stringify(r.body) : '',
    ]
      .filter(Boolean)
      .join(' ')
    pushLiveLog({
      type: 'error',
      message: `Trip details API: ${detail}`,
      ts: Date.now(),
    })
  }
}

async function runLinehaulTest() {
  if (!(await requireApi())) return
  linehaulManualBusy.value = true
  try {
    const mode = linehaulTestTarget.value
    if (mode === 'all') {
      await refreshLinehaulApis()
      pushLiveLog({
        type: 'info',
        message: 'Linehaul snapshot refreshed (Home card)',
        ts: Date.now(),
      })
      return
    }
    if (mode === 'tractor') {
      await testLinehaulTractor()
      return
    }
    if (mode === 'driver') {
      await testLinehaulDriver()
      return
    }
    if (mode === 'tripReady') {
      await testLinehaulTripReady()
      return
    }
    if (mode === 'trips') {
      await testLinehaulTrips()
    }
  } finally {
    linehaulManualBusy.value = false
  }
}

// ---------------------------------------------------------------------------
// Directory settings state
// ---------------------------------------------------------------------------

/** @type {import('vue').Ref<Array<{ locationId: string, locationName: string, abbreviation: string, address: string, phone: string, latitude: number | null, longitude: number | null, timeZone: string, lastUpdated: string }>>} */
const directoryLocations = ref([])
const directoryLoading = ref(false)
const directoryError = ref('')

/** CSV import state */
const csvImportFile = ref(null)
const csvImportBusy = ref(false)
const csvImportMsg = ref('')
const csvImportError = ref('')
/** @type {import('vue').Ref<{ total: number, importable: number, preview: Array<{ locationId: string, locationName: string }> } | null>} */
const csvImportPreview = ref(null)

async function loadDirectoryStats() {
  directoryLoading.value = true
  directoryError.value = ''
  try {
    const res = await fetchDirectory()
    directoryLocations.value = Array.isArray(res.locations) ? res.locations : []
  } catch (e) {
    directoryError.value = e instanceof Error ? e.message : String(e)
    directoryLocations.value = []
  } finally {
    directoryLoading.value = false
  }
}

const directoryStats = computed(() => {
  const locs = directoryLocations.value
  const byType = countByDirectoryLocationType(locs)
  return {
    total: locs.length,
    withPhone: locs.filter((l) => l.phone && l.phone.trim()).length,
    withCoords: locs.filter((l) => l.latitude != null && l.longitude != null).length,
    byType,
  }
})

/** Station-type rows for the statistics grid (canonical types, then Other). */
const directoryTypeStatRows = computed(() => {
  const by = directoryStats.value.byType ?? {}
  return [...DIRECTORY_STATION_TYPES, DIRECTORY_LOCATION_TYPE_OTHER].map((label) => ({
    label,
    count: typeof by[label] === 'number' ? by[label] : 0,
  }))
})

/**
 * Read latitude/longitude from a FedEx-style CSV row when columns are present and numeric.
 * Accepts Lat/Long, lat/lng, latitude/longitude, etc.
 * @param {Record<string, string>} r
 * @returns {({ latitude: number, longitude: number }) | null}
 */
function readLatLngFromCsvRow(r) {
  const latRaw = String(
    r.Lat ?? r.lat ?? r.latitude ?? r.Latitude ?? r.LAT ?? '',
  ).trim()
  const lngRaw = String(
    r.Long ?? r.lng ?? r.lon ?? r.longitude ?? r.Longitude ?? r.LONG ?? '',
  ).trim()
  if (!latRaw || !lngRaw) return null
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { latitude: lat, longitude: lng }
}

function onCsvFileSelected(event) {
  csvImportMsg.value = ''
  csvImportError.value = ''
  csvImportPreview.value = null
  const file = event.target?.files?.[0]
  if (!file) {
    csvImportFile.value = null
    return
  }
  csvImportFile.value = file
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const text = e.target?.result
      if (typeof text !== 'string') throw new Error('Failed to read file')
      const rows = parseCsvRecords(text)
      const importable = rows.filter((r) => String(r['Station Number'] ?? '').trim())
      csvImportPreview.value = {
        total: rows.length,
        importable: importable.length,
        preview: importable.slice(0, 5).map((r) => ({
          locationId: r['Station Number'] || '',
          locationName: r['Station Name'] || '',
        })),
      }
    } catch (err) {
      csvImportError.value = err instanceof Error ? err.message : String(err)
      csvImportPreview.value = null
    }
  }
  reader.onerror = () => {
    csvImportError.value = 'Failed to read CSV file'
    csvImportPreview.value = null
  }
  reader.readAsText(file)
}

async function importCsvToDirectory() {
  if (!csvImportFile.value) return
  csvImportBusy.value = true
  csvImportMsg.value = ''
  csvImportError.value = ''
  try {
    const text = await csvImportFile.value.text()
    const rows = parseCsvRecords(text)
    const importable = rows.filter((r) => String(r['Station Number'] ?? '').trim())
    const entries = importable.map((r) => {
      const addr1 = (r['Address 1'] || '').trim()
      const addr2 = (r['Address 2'] || '').trim()
      const city = (r.City || '').trim()
      const state = (r.State || '').trim()
      const zip = (r.Zip || '').trim()
      const addressParts = [addr1, addr2, city, state, zip].filter(Boolean)
      const coords = readLatLngFromCsvRow(r)
      return {
        locationId: (r['Station Number'] || '').trim(),
        locationName: (r['Station Name'] || '').trim(),
        abbreviation: (r['Station Abbreviation'] || '').trim(),
        address: addressParts.join(', '),
        phone: (r.Phone || '').trim(),
        ...(coords ? coords : {}),
        timeZone: '',
        locationType: normalizeLocationTypeForStorage(r.Status || ''),
        district: (r.District || '').trim().toUpperCase(),
      }
    }).filter((e) => e.locationId)
    if (entries.length === 0) {
      csvImportError.value = 'No valid entries to import (each row needs a Station Number)'
      return
    }
    const res = await bulkImportDirectory(entries)
    csvImportMsg.value = `Import complete: ${res.inserted} inserted, ${res.updated} updated, ${res.skipped} skipped`
    csvImportFile.value = null
    csvImportPreview.value = null
    await loadDirectoryStats()
  } catch (e) {
    csvImportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    csvImportBusy.value = false
  }
}

function clearCsvImport() {
  csvImportFile.value = null
  csvImportPreview.value = null
  csvImportMsg.value = ''
  csvImportError.value = ''
}

function applySettingsRouteFragment() {
  const raw = typeof route.hash === 'string' ? route.hash.replace(/^#/, '').trim() : ''
  if (raw !== 'tomtom' && raw !== 'here' && raw !== 'api-quota') return
  settingsTab.value = 'general'
  nextTick(() => {
    const elId =
      raw === 'here'
        ? 'settings-here'
        : raw === 'api-quota'
          ? 'settings-api-quota'
          : 'settings-tomtom'
    const el = document.getElementById(elId)
    if (el instanceof HTMLDetailsElement) el.open = true
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

onMounted(async () => {
  tripAlertMode.value = getTripAlertMode()
  unregisterRecover = registerApiRecover(reconnectLiveLogStream)
  await loadCredentials()
  await loadAssignmentState()
  tomtomTrafficDraft.value = trafficTomtomKeyOverride.value
  hereApiDraft.value = hereApiKeyOverride.value
  ny511ApiDraft.value = ny511ApiKeyOverride.value
  applySettingsRouteFragment()
})

watch(() => route.hash, () => applySettingsRouteFragment())

watch(settingsTab, (tab) => {
  if (tab === 'audio') {
    tripAlertMode.value = getTripAlertMode()
    tripStatusChangeOn.value = isTripStatusChangeEnabled()
    trailerStatusChangeOn.value = isTrailerStatusChangeEnabled()
    arrivalAlertsOn.value = isArrivalAlertsEnabled()
    trailerNearbyOn.value = isTrailerGpsTtsEnabled()
    alertPrefs.value = getAlertPrefs()
    nearTrailerRadiusFeet.value = getNearTrailerRadiusFeet()
  }
  if (tab === 'security') {
    void loadSecurityAccessLog()
    void loadGeoFenceSettings()
    nextTick(() => geoFenceEditorRef.value?.invalidateSize?.())
  }
  if (tab === 'directory') {
    void loadDirectoryStats()
  }
  if (tab === 'helpers') {
    syncHelpersPrefsFromStorage()
  }
})

onUnmounted(() => {
  unregisterRecover()
})

</script>

<template>
  <div class="shell">
    <div class="settings-tabs" role="tablist" aria-label="Settings sections">
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'general'"
        :class="{ active: settingsTab === 'general' }"
        @click="settingsTab = 'general'"
      >
        General
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'helpers'"
        :class="{ active: settingsTab === 'helpers' }"
        @click="settingsTab = 'helpers'"
      >
        Helpers
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'automation'"
        :class="{ active: settingsTab === 'automation' }"
        @click="settingsTab = 'automation'"
      >
        Automation
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'audio'"
        :class="{ active: settingsTab === 'audio' }"
        @click="settingsTab = 'audio'"
      >
        Audio
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'security'"
        :class="{ active: settingsTab === 'security' }"
        @click="settingsTab = 'security'"
      >
        Security
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'directory'"
        :class="{ active: settingsTab === 'directory' }"
        @click="settingsTab = 'directory'"
      >
        Directory
      </button>
    </div>

    <main v-show="settingsTab === 'general'" class="stack">
      <SettingsSection title="Driver Credentials">
        <p v-if="credMsg" class="cred-msg" :class="{ 'cred-msg--error': credMsg !== 'Saved' }">{{ credMsg }}</p>
        <label class="lbl">Username / Driver ID</label>
        <input v-model="credUser" class="inp tap" type="text" autocomplete="username" />
        <label class="lbl">Password</label>
        <input
          v-model="credPass"
          class="inp tap"
          type="password"
          autocomplete="current-password"
          :placeholder="credMeta?.hasPassword && !credPass ? SECRET_SAVED_MASK : ''"
        />
        <label class="lbl">Tractor number</label>
        <input
          :value="credTractor"
          class="inp tap"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          maxlength="6"
          @input="onCredTractorInput"
        />
        <p class="cred-hint">History uses your work week below. Shift times set which <strong>calendar day</strong> a trip belongs to (e.g. 7:00 PM–7:00 AM: a trip at 1:00 AM still counts on the <strong>previous</strong> calendar day, when your shift started).</p>
        <div class="work-week-row work-week-row--3">
          <div>
            <label class="lbl" for="shift-start">Shift start (local)</label>
            <input
              id="shift-start"
              v-model="shiftStartTime"
              class="inp tap"
              type="time"
            />
          </div>
          <div>
            <label class="lbl" for="shift-end">Shift end (local)</label>
            <input
              id="shift-end"
              v-model="shiftEndTime"
              class="inp tap"
              type="time"
            />
          </div>
        </div>
        <div class="work-week-row">
          <div>
            <label class="lbl" for="work-week-start">Work week starts</label>
            <select
              id="work-week-start"
              v-model.number="workWeekStartDay"
              class="inp tap"
            >
              <option v-for="o in weekDayOptions" :key="`ws-${o.v}`" :value="o.v">
                {{ o.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="lbl" for="work-week-end">Work week ends</label>
            <select
              id="work-week-end"
              v-model.number="workWeekEndDay"
              class="inp tap"
            >
              <option v-for="o in weekDayOptions" :key="`we-${o.v}`" :value="o.v">
                {{ o.label }}
              </option>
            </select>
          </div>
        </div>
        <p class="cred-hint">
          The end day is the <strong>last calendar day</strong> in each work block (e.g. Thu–Mon = Thu through Mon, five days).
        </p>
        <label class="lbl">Phone number</label>
        <input
          :value="phoneDisplay"
          class="inp tap"
          type="tel"
          autocomplete="tel"
          inputmode="numeric"
          placeholder="(555) 555 5555"
          @input="onPhoneInput"
        />
        <label class="lbl">Linehaul bearer token</label>
        <div class="linehaul-bearer-row">
          <input
            v-model="credLinehaulToken"
            class="inp tap token-field linehaul-bearer-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            type="button"
            class="btn tap linehaul-bearer-capture"
            :disabled="captureBearerBusy || credSaving"
            @click="runCaptureLinehaulBearer"
          >
            {{ captureBearerBusy ? 'Capturing…' : 'Capture from browser' }}
          </button>
        </div>
        <div class="linehaul-poll-card">
          <div class="linehaul-poll-head">
            <label class="linehaul-poll-title" for="linehaul-poll-range">Linehaul refresh rate</label>
            <output class="linehaul-poll-value" for="linehaul-poll-range" aria-live="polite">{{
              linehaulPollReadout
            }}</output>
          </div>
          <input
            id="linehaul-poll-range"
            v-model.number="credPollMinutes"
            class="linehaul-poll-range tap"
            type="range"
            min="0"
            :max="LINEHAUL_POLL_MAX"
            step="1"
            list="linehaul-poll-tickmarks"
            :aria-valuemin="0"
            :aria-valuemax="LINEHAUL_POLL_MAX"
            :aria-valuenow="linehaulPollAriaNow"
            :aria-valuetext="linehaulPollReadout"
          />
          <div class="linehaul-poll-scale" aria-hidden="true">
            <span><span class="linehaul-poll-scale-num">0</span> · manual</span>
            <span>{{ LINEHAUL_POLL_MAX }} min</span>
          </div>
          <datalist id="linehaul-poll-tickmarks">
            <option v-for="v in linehaulPollTickValues" :key="v" :value="v" />
          </datalist>
          <p class="linehaul-poll-hint">
            Sign in sets this to 1 min (when no session it stays at 0). Adjust anytime — your choice is saved.
          </p>
        </div>
        <div class="linehaul-test-row">
          <label class="lbl linehaul-test-lbl" for="linehaul-test-select">APIs</label>
          <div class="linehaul-test-controls">
            <select id="linehaul-test-select" v-model="linehaulTestTarget" class="inp tap linehaul-test-select">
              <option value="all">All</option>
              <option value="tractor">Tractor details</option>
              <option value="driver">Driver details</option>
              <option value="tripReady">Trip Ready</option>
              <option value="trips">Trip details</option>
            </select>
            <input
              v-show="linehaulTestTarget === 'trips'"
              v-model="linehaulTestTripLegSeq"
              class="inp tap linehaul-test-legseq"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="Leg seq (optional)"
              title="If set (digits only), tests GET trips by dailyTripLegSequence; otherwise default APRVD query."
              aria-label="Daily trip leg sequence for trip details test"
            />
            <button
              type="button"
              class="btn primary tap"
              :disabled="linehaulManualBusy"
              @click="runLinehaulTest"
            >
              {{ linehaulManualBusy ? 'Running…' : 'Run' }}
            </button>
          </div>
        </div>
        <div class="cred-actions-row">
          <div class="btn-row">
            <button type="button" class="btn primary tap" :disabled="credSaving" @click="saveCredentials">
              {{ credSaving ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="btn tap" @click="clearCredentials">Clear</button>
          </div>
          <ApiStatusBadge />
        </div>
      </SettingsSection>

      <SettingsSection title="Compass calibration">
        <p class="cred-hint">
          On any map that shows the compass control, <strong>press and hold</strong> the compass button to open the
          calibration panel (live heading preview, offset slider, and reset). A short tap still toggles heading-up
          mode on or off. Your offset is saved on this device automatically.
        </p>
      </SettingsSection>

      <SettingsSection title="Map: TomTom traffic overlay" section-id="settings-tomtom">
        <p class="cred-hint">
          Live road traffic tiles on the <strong>Traffic</strong> map use
          <a
            href="https://developer.tomtom.com/traffic-api/documentation/product-information/introduction"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link"
          >TomTom Traffic</a>
          (free developer tier, API key). Your key is stored encrypted for your account on the server and cached in this browser for faster map loads.
        </p>
        <p class="cred-hint">
          <strong>Traffic → Corridors</strong> uses the same key for
          <a
            href="https://developer.tomtom.com/route-monitoring/documentation/routes-service/routes"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link"
          >Route Monitoring</a>
          (create monitored routes). The map preview may use
          <a
            href="https://developer.tomtom.com/routing-api/documentation/routing/calculate-route"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link"
          >Routing calculateRoute</a>
          when Route Monitoring preview is unavailable — your key still needs Route Monitoring for saving routes.
        </p>
        <p class="cred-hint">
          <strong>403 “not allowed” with Corridors but tiles work?</strong>
          Map tiles run in your browser (TomTom sees your site as referrer); Route Monitoring and Routing run on this app’s server (no referrer).
          In the TomTom dashboard, open your key and relax <strong>allowed URLs / domain</strong> restrictions for server-side use, or create a second key without referrer locking for Corridors.
        </p>
        <label class="lbl" for="tomtom-traffic-key">TomTom API key (optional)</label>
        <input
          id="tomtom-traffic-key"
          v-model="tomtomTrafficDraft"
          class="inp tap"
          type="password"
          autocomplete="off"
          placeholder="Paste API key"
          :aria-describedby="'tomtom-hint'"
        />
        <p id="tomtom-hint" class="cred-hint">
          Active key: {{ trafficTomtomKeyOverride ? 'saved (server + this browser)' : 'empty' }}
        </p>
        <p v-if="tomtomTrafficMsg" class="cred-msg">{{ tomtomTrafficMsg }}</p>
        <div class="btn-row">
          <button
            type="button"
            class="btn primary tap"
            :disabled="tomtomTrafficBusy"
            @click="saveTomtomTrafficKey"
          >
            {{ tomtomTrafficBusy ? 'Saving…' : 'Save TomTom key' }}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="HERE Traffic API (Route Monitoring)" section-id="settings-here">
        <p class="cred-hint">
          <strong>Traffic → Corridors</strong> uses
          <a
            href="https://platform.here.com/"
            target="_blank"
            rel="noopener noreferrer"
            class="ext-link"
          >HERE Traffic API v7</a>
          for real-time traffic flow monitoring along your routes. Create a free account at HERE Platform.
        </p>
        <p class="cred-hint">
          HERE provides: <strong>speed</strong> (current vs free-flow), <strong>jam factor</strong> (0–10), <strong>travel time</strong> estimates, and segment-level detail.
          Real-time <strong>Traffic</strong> on the free plan is billed in small monthly transaction bundles (on the order of a few thousand per month for flow data); this app batches refreshes and enforces a monthly cap server-side (see <strong>API usage & limits</strong> below).
        </p>
        <p class="cred-hint">
          To set up: Go to <a href="https://platform.here.com/" target="_blank" rel="noopener noreferrer" class="ext-link">platform.here.com</a> → Access Manager → Apps → Register new app → Create API Key. Enable <strong>Traffic API</strong> and <strong>Routing API</strong>.
        </p>
        <label class="lbl" for="here-api-key">HERE API key (for Route Monitoring)</label>
        <input
          id="here-api-key"
          v-model="hereApiDraft"
          class="inp tap"
          type="password"
          autocomplete="off"
          placeholder="Paste HERE API key"
          :aria-describedby="'here-hint'"
        />
        <p id="here-hint" class="cred-hint">
          Active key: {{ hereApiKeyOverride ? 'saved (server + this browser)' : 'empty' }}
        </p>
        <p v-if="hereApiMsg" class="cred-msg">{{ hereApiMsg }}</p>
        <div class="btn-row">
          <button
            type="button"
            class="btn primary tap"
            :disabled="hereApiBusy"
            @click="saveHereApiKey"
          >
            {{ hereApiBusy ? 'Saving…' : 'Save HERE key' }}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="API usage & limits" section-id="settings-api-quota">
        <p class="cred-hint">
          Outbound API calls are counted per account and saved in the database. Caps apply per
          <strong>UTC calendar day</strong>, per rolling minute (burst protection), and for
          <strong>HERE</strong> also per <strong>UTC calendar month</strong> (default 4800 calls, aligned
          with HERE Traffic free-tier monthly transactions). When a cap is hit, requests are blocked until
          the period resets or you raise the limit (daily caps in this table; HERE monthly default via
          server env <code>API_QUOTA_HERE_MONTH</code> or optional
          <code>limits.here_month</code> in the quota API).
        </p>
        <p v-if="apiQuotaDayKey" class="cred-hint">
          Current UTC day: <strong>{{ apiQuotaDayKey }}</strong>
        </p>
        <p v-if="apiQuotaMonthKey" class="cred-hint">
          Current UTC month (HERE): <strong>{{ apiQuotaMonthKey }}</strong>
        </p>
        <div v-if="apiQuotaRows.length" class="api-quota-table-wrap">
          <table class="api-quota-table">
            <thead>
              <tr>
                <th scope="col">API</th>
                <th scope="col">Calls today</th>
                <th scope="col">Daily limit</th>
                <th v-if="apiQuotaHasMonthCols" scope="col">
                  HERE this month
                </th>
                <th v-if="apiQuotaHasMonthCols" scope="col">
                  HERE monthly cap
                </th>
                <th scope="col">Calls last min</th>
                <th scope="col">Max / min</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in apiQuotaRows" :key="row.id">
                <td>{{ row.label }}</td>
                <td>{{ row.countToday }}</td>
                <td>
                  <input
                    v-model="apiQuotaDraftLimits[row.id]"
                    class="inp inp-compact tap"
                    type="number"
                    min="1"
                    step="1"
                    :aria-label="`Daily limit for ${row.label}`"
                  />
                </td>
                <td v-if="apiQuotaHasMonthCols">
                  {{ row.limitMonth != null ? row.countMonth ?? 0 : '—' }}
                </td>
                <td v-if="apiQuotaHasMonthCols">
                  {{ row.limitMonth != null ? row.limitMonth : '—' }}
                </td>
                <td>{{ row.callsLastMinute }}</td>
                <td>{{ row.perMinuteLimit }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="!apiQuotaMsg" class="cred-hint">Loading usage…</p>
        <p v-if="apiQuotaMsg" class="cred-msg">{{ apiQuotaMsg }}</p>
        <div class="btn-row">
          <button type="button" class="btn tap" :disabled="apiQuotaBusy" @click="refreshApiQuota">
            Refresh
          </button>
          <button
            type="button"
            class="btn primary tap"
            :disabled="apiQuotaBusy"
            @click="saveApiQuotaLimitsFromUi"
          >
            Save limits
          </button>
          <button type="button" class="btn tap" :disabled="apiQuotaBusy" @click="resetApiQuotaToday">
            Reset today's counts
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="511NY API (Cameras + NY511 traffic)" section-id="settings-ny511">
        <p class="cred-hint">
          <strong>Traffic → Crossings</strong> uses this key for live bridge cameras (Bayonne, Goethals, Outerbridge, Verrazzano).
          <strong>Traffic → NY511</strong> loads official 511NY events, construction, incidents, and road conditions filtered to NYC-region truck routes (same key; server caches ~5 minutes).
        </p>
        <p class="cred-hint">
          To get your free key: <a href="https://511ny.org/my511/register" target="_blank" rel="noopener noreferrer" class="ext-link">511ny.org/my511/register</a>
          → create an account → <strong>Manage Account</strong> → enable the Developer API → use the key from your approval email.
        </p>
        <p class="cred-hint">
          <strong>Rate limit:</strong> respect 511NY limits; this app batches feeds and caches responses server-side.
        </p>
        <label class="lbl" for="ny511-api-key">511NY API key</label>
        <input
          id="ny511-api-key"
          v-model="ny511ApiDraft"
          class="inp tap"
          type="password"
          autocomplete="off"
          placeholder="Paste 511NY API key"
          :aria-describedby="'ny511-hint'"
        />
        <p id="ny511-hint" class="cred-hint">
          Active key: {{ ny511ApiKeyOverride ? 'saved (server + this browser)' : 'empty' }}
        </p>
        <p v-if="ny511ApiMsg" class="cred-msg">{{ ny511ApiMsg }}</p>
        <div class="btn-row">
          <button
            type="button"
            class="btn primary tap"
            :disabled="ny511ApiBusy"
            @click="saveNy511ApiKey"
          >
            {{ ny511ApiBusy ? 'Saving…' : 'Save 511NY key' }}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="GWB upper camera (YouTube)" section-id="settings-gwb-youtube">
        <p class="cred-hint">
          <strong>Traffic → Crossings</strong> uses this for the George Washington Bridge <strong>upper deck</strong> live view.
          Paste any standard YouTube link (watch, Shorts, embed, or youtu.be). Leave empty to hide the embed.
        </p>
        <label class="lbl" for="gwb-upper-cam-youtube-url">YouTube URL</label>
        <input
          id="gwb-upper-cam-youtube-url"
          v-model="gwbUpperCamYoutubeDraft"
          class="inp tap"
          type="url"
          autocomplete="off"
          placeholder="https://www.youtube.com/watch?v=…"
        />
        <p v-if="gwbUpperCamYoutubeMsg" class="cred-msg">{{ gwbUpperCamYoutubeMsg }}</p>
        <div class="btn-row">
          <button
            type="button"
            class="btn primary tap"
            :disabled="gwbUpperCamYoutubeBusy"
            @click="saveGwbUpperCamYoutubeUrl"
          >
            {{ gwbUpperCamYoutubeBusy ? 'Saving…' : 'Save GWB camera link' }}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="App Logs">
        <div class="log-actions">
          <button type="button" class="btn tap" @click="clearLiveLog">Clear log</button>
        </div>
        <div class="log-scroll">
          <div
            v-for="(line, i) in liveLogEntries.slice().reverse()"
            :key="`${line.ts}-${i}`"
            class="log-line"
            :class="{ 'log-line-screenshot': line.type === 'screenshot' }"
            :data-t="line.type"
          >
            <span class="ts">{{ new Date(line.ts).toLocaleTimeString() }}</span>
            <span class="ty">{{ line.type }}</span>
            <span v-if="line.type === 'screenshot' && line.image" class="msg screenshot-msg">
              <span class="screenshot-label">{{ line.message }}</span>
              <span v-if="line.error" class="screenshot-error">{{ line.error }}</span>
              <img
                :src="`data:image/jpeg;base64,${line.image}`"
                alt="Step screenshot"
                class="screenshot-thumb"
                loading="lazy"
                @click="openScreenshotModal(line)"
              />
            </span>
            <span v-else class="msg">{{ line.message }}</span>
          </div>
        </div>
        <Teleport to="body">
          <div v-if="screenshotModal" class="screenshot-modal-backdrop" @click.self="closeScreenshotModal">
            <div class="screenshot-modal">
              <button type="button" class="screenshot-modal-close tap" @click="closeScreenshotModal">×</button>
              <p class="screenshot-modal-title">{{ screenshotModal.message }}</p>
              <p v-if="screenshotModal.error" class="screenshot-modal-error">{{ screenshotModal.error }}</p>
              <img
                :src="`data:image/jpeg;base64,${screenshotModal.image}`"
                alt="Full screenshot"
                class="screenshot-full"
              />
            </div>
          </div>
        </Teleport>
      </SettingsSection>
    </main>

    <main v-show="settingsTab === 'helpers'" class="stack helpers-panel">
      <SettingsSection title="Location (live)">
        <p class="helpers-lead">{{ helpersPermissionLabel }}</p>
        <p class="helpers-coords">{{ helpersCoordsLine }}</p>
        <p v-if="appGeoError" class="helpers-err">{{ appGeoError }}</p>
        <button
          type="button"
          class="btn tap"
          :disabled="helpersLocationBusy"
          @click="onHelpersRequestLocationTap"
        >
          {{ helpersLocationBusy ? 'Requesting…' : 'Request location fix' }}
        </button>
        <p class="helpers-hint">
          While signed in, the app keeps a GPS watch in the background for Dispatch and this screen.
          High accuracy uses more battery. On iOS you may need a tap here once to unlock fixes.
        </p>
      </SettingsSection>

      <SettingsSection title="Auto arrive and check-in near destination">
        <p class="helpers-lead">
          When your driver status is <strong>ENRT</strong> and you move within the set distance of the
          <strong>current trip destination</strong> (Linehaul facility coordinates), the app announces
          <em>Auto arrive and check in running</em> and runs your Home <strong>Arrive</strong> quick action,
          then your <strong>Check-in</strong> quick action (same pairing as the late-night prompt).
        </p>
        <label class="helpers-row tap">
          <input v-model="helpersAutoArriveEnabled" type="checkbox" @change="onHelpersAutoToggle" />
          <span>Enable proximity auto Arrive and Check-in</span>
        </label>
        <div class="helpers-field">
          <label class="lbl" for="helpers-radius-nm">Trigger distance (nautical miles)</label>
          <input
            id="helpers-radius-nm"
            v-model.number="helpersRadiusNm"
            class="inp tap"
            type="number"
            :min="HELPERS_RADIUS_NM_MIN"
            :max="HELPERS_RADIUS_NM_MAX"
            step="0.25"
            inputmode="decimal"
            @blur="onHelpersRadiusBlur"
          />
          <p class="helpers-hint">
            Range {{ HELPERS_RADIUS_NM_MIN }}–{{ HELPERS_RADIUS_NM_MAX }} NM (1 NM = 1852 m). Default is 2 NM if unset.
          </p>
        </div>
      </SettingsSection>
    </main>

    <div v-show="settingsTab === 'automation'" class="automation-wrap">
      <AutomationEditor
        v-if="editingAutomationId"
        :automation-id="editingAutomationId"
        @back="closeAutomationEditor"
        @saved="() => {}"
      />
      <AutomationList
        v-else
        @edit="openAutomationEditor"
      />
    </div>

    <main v-show="settingsTab === 'audio'" class="stack audio-panel">
      <SettingsSection title="Audio Alerts" :collapsible="false">
        <div class="audio-row">
          <label class="toggle-switch">
            <input type="checkbox" :checked="ttsEnabled" @change="toggleTts($event.target.checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">Text-to-speech alerts</span>
          <button type="button" class="audio-test-btn tap" :disabled="!ttsEnabled" @click="speakTripTtsTest">Test</button>
        </div>

        <div v-if="ttsEnabled" class="audio-row">
          <label class="toggle-switch">
            <input type="checkbox" :checked="trailerNearbyOn" @change="toggleTrailerNearby($event.target.checked)" />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">Near-trailer alerts (trailer map only)</span>
        </div>

        <div v-if="ttsEnabled && trailerNearbyOn" class="audio-near-trailer audio-near-trailer--compact">
          <label class="lbl audio-near-trailer-label" for="near-trailer-ft">Distance (feet)</label>
          <div class="audio-near-trailer-row">
            <input
              id="near-trailer-ft"
              v-model.number="nearTrailerRadiusFeet"
              class="inp tap audio-near-trailer-input"
              type="number"
              min="15"
              max="3000"
              step="5"
              inputmode="numeric"
              autocomplete="off"
              @input="saveNearTrailerRadius"
              @blur="saveNearTrailerRadius"
            />
            <span class="audio-near-trailer-unit" aria-hidden="true">ft</span>
          </div>
          <p class="audio-near-trailer-hint">
            “You are near trailer …” only while a trailer location map is open. Open the map from a trailer card pin.
          </p>
        </div>

        <div v-if="ttsEnabled" class="audio-more-wrap">
          <button
            type="button"
            class="audio-more-toggle tap"
            :aria-expanded="audioMoreExpanded"
            @click="audioMoreExpanded = !audioMoreExpanded"
          >
            {{ audioMoreExpanded ? '▼' : '▶' }} More alert types
          </button>
          <div v-show="audioMoreExpanded" class="alert-types-section alert-types-section--more">
            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="bellChimeEnabled" @change="toggleBellChime($event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Play bell chime before alerts</span>
              <button type="button" class="audio-test-btn tap" @click="playTripBellTest">Test</button>
            </div>

            <p class="alert-types-heading">Alert Types</p>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="alertPrefs.tripReady" @change="updateAlertPref('tripReady', $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">New trip ready</span>
              <button
                type="button"
                class="audio-test-btn tap"
                @click="previewTripAlertSample('New trip ready from Example Origin to Example Destination.')"
              >
                Test
              </button>
            </div>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="tripStatusChangeOn" @change="toggleTripStatusChange($event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Trip status change</span>
              <button
                type="button"
                class="audio-test-btn tap"
                @click="previewTripAlertSample('Trip status changed to dispatched.')"
              >
                Test
              </button>
            </div>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="trailerStatusChangeOn" @change="toggleTrailerStatusChange($event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Trailer load status changes</span>
              <button
                type="button"
                class="audio-test-btn tap"
                @click="previewTripAlertSample('Trailer 1 has finished loading and is now closed.')"
              >
                Test
              </button>
            </div>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="arrivalAlertsOn" @change="toggleArrivalAlerts($event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Arrival alerts</span>
              <button
                type="button"
                class="audio-test-btn tap"
                @click="previewTripAlertSample('Arrived at destination successfully.')"
              >
                Test
              </button>
            </div>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="alertPrefs.tractorChange" @change="updateAlertPref('tractorChange', $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Tractor details change</span>
              <button type="button" class="audio-test-btn tap" @click="testTractorChangeAlert">Test</button>
            </div>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="alertPrefs.driverChange" @change="updateAlertPref('driverChange', $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Driver details change</span>
              <button type="button" class="audio-test-btn tap" @click="testDriverChangeAlert">Test</button>
            </div>

            <div class="audio-row">
              <label class="toggle-switch">
                <input type="checkbox" :checked="alertPrefs.checkIn" @change="updateAlertPref('checkIn', $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
              <span class="audio-row-label">Check-in results</span>
              <button type="button" class="audio-test-btn tap" @click="testSuccessAlert">Test</button>
            </div>
          </div>
        </div>
      </SettingsSection>

    </main>

    <main v-show="settingsTab === 'security'" class="stack security-panel">
      <SettingsSection title="Auto redirect" :collapsible="false">
        <p class="security-lead">
          Draw an allowed region. When enabled, visitors without a session whose IP location falls
          outside the area are redirected to your URL. Signed-in users are not affected. Uses IP
          geolocation and OpenStreetMap for address preview.
        </p>
        <p v-if="geoFenceLoading" class="cred-msg">Loading…</p>
        <p v-else-if="geoFenceError" class="cred-msg cred-msg--error">{{ geoFenceError }}</p>
        <template v-else>
          <label class="toggle-row">
            <input v-model="geoFenceEnabled" type="checkbox" class="tap" />
            <span>Enable auto redirect for visitors outside the drawn area</span>
          </label>
          <label class="lbl" for="geo-fence-redirect">Redirect URL</label>
          <input
            id="geo-fence-redirect"
            v-model="geoFenceRedirectUrl"
            class="inp tap"
            type="url"
            autocomplete="off"
            placeholder="https://example.com"
          />
          <div class="geo-fence-toolbar">
            <button
              type="button"
              class="btn tap"
              :disabled="!geoFencePolygon.length"
              @click="undoGeoFenceLastPoint"
            >
              Undo last point
            </button>
            <button type="button" class="btn tap" @click="clearGeoFencePolygon">Clear polygon</button>
            <button type="button" class="btn ghost tap" @click="refreshGeoFencePreview">
              Preview my IP
            </button>
          </div>
          <GeoFenceEditor ref="geoFenceEditorRef" v-model="geoFencePolygon" />
          <div v-if="geoFencePreview" class="geo-fence-preview" role="status">
            <template v-if="geoFencePreview.reason === 'no_polygon'">
              <p class="geo-fence-preview-line">Add at least three points to test.</p>
            </template>
            <template v-else-if="geoFencePreview.reason === 'private_ip'">
              <p class="geo-fence-preview-line">
                Your IP looks private or local — the fence applies to public visitor IPs.
              </p>
            </template>
            <template v-else-if="geoFencePreview.reason === 'lookup_failed'">
              <p class="geo-fence-preview-line">Could not resolve IP location (network or rate limit).</p>
            </template>
            <template v-else>
              <p class="geo-fence-preview-line">
                <strong>Inside allowed area:</strong>
                {{
                  geoFencePreview.inside === true
                    ? 'Yes'
                    : geoFencePreview.inside === false
                      ? 'No (would redirect if enabled)'
                      : '—'
                }}
              </p>
              <p v-if="geoFencePreview.address" class="geo-fence-preview-line geo-fence-address">
                {{ geoFencePreview.address }}
              </p>
            </template>
          </div>
          <p v-if="geoFenceMsg" class="cred-msg">{{ geoFenceMsg }}</p>
          <div class="btn-row">
            <button
              type="button"
              class="btn primary tap"
              :disabled="geoFenceSaving"
              @click="saveGeoFenceSettings"
            >
              {{ geoFenceSaving ? 'Saving…' : 'Save auto redirect' }}
            </button>
          </div>
        </template>
      </SettingsSection>

      <SettingsSection title="Access log" :collapsible="false">
        <p class="security-lead">
          Page visits (IP on load), login gate events, and optional browser-reported coordinates.
          Up to 5,000 entries are kept on disk. Use View on map for a full map when coordinates exist.
        </p>
        <p v-if="accessLogLoading" class="cred-msg">Loading…</p>
        <p v-else-if="accessLogError" class="cred-msg cred-msg--error">{{ accessLogError }}</p>
        <div v-else class="access-table-wrap">
          <table class="access-table" v-if="accessLogEntries.length">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">IP</th>
                <th scope="col">Source</th>
                <th scope="col">Location</th>
                <th scope="col">Map</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in accessLogEntries" :key="row.id">
                <td>{{ new Date(row.at).toLocaleString() }}</td>
                <td><code class="access-ip">{{ row.ip }}</code></td>
                <td class="access-source">
                  {{
                    row.source === 'page_visit'
                      ? 'Visit'
                      : row.source === 'login_ack'
                        ? 'Login gate'
                        : row.source || '—'
                  }}
                </td>
                <td>
                  <template v-if="row.locationDenied">Not shared</template>
                  <template v-else-if="row.latitude != null && row.longitude != null">
                    {{ Number(row.latitude).toFixed(4) }}, {{ Number(row.longitude).toFixed(4) }}
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="access-map-cell">
                  <button
                    v-if="
                      row.latitude != null &&
                      row.longitude != null &&
                      Number.isFinite(Number(row.latitude)) &&
                      Number.isFinite(Number(row.longitude))
                    "
                    type="button"
                    class="access-map-btn tap"
                    @click="openAccessLogMap(row)"
                  >
                    View on map
                  </button>
                  <span v-else class="access-map-empty">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="!accessLogLoading && !accessLogError" class="security-empty">
            No access entries yet.
          </p>
        </div>
        <button type="button" class="btn ghost tap" @click="loadSecurityAccessLog">Refresh</button>
      </SettingsSection>
    </main>

    <main v-show="settingsTab === 'directory'" class="stack directory-panel">
      <SettingsSection title="Directory Statistics">
        <p v-if="directoryLoading" class="directory-loading">Loading...</p>
        <p v-else-if="directoryError" class="directory-error">{{ directoryError }}</p>
        <div v-else class="directory-stats">
          <div class="directory-stats-primary">
            <div class="stat-card">
              <span class="stat-value">{{ directoryStats.total }}</span>
              <span class="stat-label">Total locations</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{{ directoryStats.withPhone }}</span>
              <span class="stat-label">With phone numbers</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{{ directoryStats.withCoords }}</span>
              <span class="stat-label">With coordinates</span>
            </div>
          </div>
          <p class="directory-type-stats-heading">By station type</p>
          <ul class="directory-type-stats-grid" aria-label="Location counts by station type">
            <li v-for="row in directoryTypeStatRows" :key="row.label" class="directory-type-stat">
              <span class="directory-type-stat-count">{{ row.count }}</span>
              <span class="directory-type-stat-label">{{ row.label }}</span>
            </li>
          </ul>
        </div>
        <button type="button" class="btn ghost tap" @click="loadDirectoryStats">Refresh stats</button>
      </SettingsSection>

      <SettingsSection title="Import Locations (CSV)">
        <p class="directory-hint">
          Import FedEx Ground facility data from a CSV file. <strong>All</strong> rows with a station
          number are imported; every station type in the file (Annex, Hub, Hub Local, NFS, Smartpost Hub,
          Station, Sub Station, etc.) is kept.
        </p>

        <div class="csv-import-area">
          <label class="csv-file-label">
            <input
              type="file"
              accept=".csv,text/csv"
              class="csv-file-input"
              @change="onCsvFileSelected"
            />
            <span class="btn secondary tap">{{ csvImportFile ? 'Change file' : 'Select CSV file' }}</span>
          </label>

          <p v-if="csvImportFile" class="csv-file-name">{{ csvImportFile.name }}</p>

          <div v-if="csvImportPreview" class="csv-preview">
            <p class="csv-preview-summary">
              <strong>{{ csvImportPreview.importable }}</strong> of {{ csvImportPreview.total }} data rows will be imported
              <span v-if="csvImportPreview.importable < csvImportPreview.total" class="csv-preview-skip-note">
                (rows without a Station Number are skipped)
              </span>
            </p>
            <p v-if="csvImportPreview.preview.length" class="csv-preview-label">Preview (first 5):</p>
            <ul v-if="csvImportPreview.preview.length" class="csv-preview-list">
              <li v-for="item in csvImportPreview.preview" :key="item.locationId">
                <strong>{{ item.locationId }}</strong> — {{ item.locationName }}
              </li>
            </ul>
          </div>

          <p v-if="csvImportError" class="csv-import-error">{{ csvImportError }}</p>
          <p v-if="csvImportMsg" class="csv-import-msg">{{ csvImportMsg }}</p>

          <div v-if="csvImportFile && csvImportPreview" class="csv-import-actions">
            <button
              type="button"
              class="btn primary tap"
              :disabled="csvImportBusy || !csvImportPreview?.importable"
              @click="importCsvToDirectory"
            >
              {{ csvImportBusy ? 'Importing...' : 'Import to directory' }}
            </button>
            <button type="button" class="btn ghost tap" :disabled="csvImportBusy" @click="clearCsvImport">
              Cancel
            </button>
          </div>
        </div>
      </SettingsSection>
    </main>

    <LeafletPinModal
      :open="accessMapModalOpen"
      :title="accessMapModalTarget?.title || 'Location'"
      :subtitle="accessMapModalTarget?.subtitle || ''"
      :lat="accessMapModalTarget?.lat ?? null"
      :lng="accessMapModalTarget?.lng ?? null"
      :zoom="15"
      @close="closeAccessMapModal"
    />
  </div>
</template>

<style scoped>
.cred-hint {
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.4;
  color: var(--color-text-tertiary, #6e6e7e);
  margin: 0 0 0.5rem;
  max-width: 36rem;
}
.work-week-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3, 0.75rem);
  margin-bottom: var(--space-3, 0.75rem);
}
.work-week-row--3 {
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 500px) {
  .work-week-row {
    grid-template-columns: 1fr;
  }
}
.shell {
  min-height: 100vh;
  min-height: 100dvh;
  padding: var(--space-4, 1rem) 0 var(--space-6, 1.5rem);
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABS — Premium segmented control
   ═══════════════════════════════════════════════════════════════════════════ */
.settings-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1, 0.25rem);
  padding: var(--space-1, 0.25rem);
  margin-bottom: var(--space-4, 1rem);
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-md, 12px));
  -webkit-backdrop-filter: blur(var(--blur-md, 12px));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-xl, 1rem);
}

.tab-btn {
  flex: 1;
  cursor: pointer;
  border-radius: var(--radius-lg, 0.75rem);
  border: none;
  background: transparent;
  color: var(--color-text-tertiary, #6e6e7e);
  padding: var(--space-2-5, 0.625rem) var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  min-height: var(--touch-target, 2.75rem);
  transition: var(--transition-all);
  position: relative;
}

.tab-btn:hover:not(.active) {
  color: var(--color-text-secondary, #a8a8b8);
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}

.tab-btn.active {
  background: var(--color-accent-purple, #7b4db5);
  color: white;
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.25));
}
.automation-wrap {
  margin-top: 0;
}
.security-panel {
  max-width: 64rem;
  margin-inline: auto;
}

.security-lead {
  margin: 0 0 var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.5;
  color: var(--color-text-secondary, #a8a8b8);
}

.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3, 0.75rem);
  margin-bottom: var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.45;
  color: var(--color-text, #e4e4eb);
}

.toggle-row input {
  margin-top: 0.2rem;
  flex-shrink: 0;
}

.geo-fence-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-3, 0.75rem);
}

.geo-fence-preview {
  margin: var(--space-4, 1rem) 0;
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  border-radius: var(--radius-lg, 0.75rem);
  background: var(--color-glass, rgba(22, 22, 29, 0.5));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
}

.geo-fence-preview-line {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.5;
  color: var(--color-text-secondary, #a8a8b8);
}

.geo-fence-preview-line + .geo-fence-preview-line {
  margin-top: var(--space-2, 0.5rem);
}

.geo-fence-address {
  color: var(--color-text-tertiary, #8b8b9a);
  word-break: break-word;
}

.access-source {
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
  white-space: nowrap;
}

.access-map-cell {
  vertical-align: middle;
  width: auto;
  white-space: nowrap;
}

.access-map-btn {
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(123, 77, 181, 0.35);
  border: 1px solid rgba(123, 77, 181, 0.5);
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.access-map-btn:hover {
  background: rgba(123, 77, 181, 0.5);
  border-color: rgba(167, 139, 250, 0.55);
}

.access-map-empty {
  display: inline-block;
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: var(--text-sm, 0.8125rem);
}

.access-table-wrap {
  overflow-x: auto;
  margin-bottom: var(--space-4, 1rem);
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.access-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm, 0.8125rem);
}

.access-table th,
.access-table td {
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  text-align: left;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.06));
}

.access-table th {
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-tertiary, #6e6e7e);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--text-xs, 0.6875rem);
}

.access-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}

.access-ip {
  font-size: 0.75rem;
  color: var(--color-accent-purple, #c4b5fd);
}

.security-empty {
  margin: 0;
  padding: var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

.helpers-panel {
  gap: 1rem;
}
.helpers-lead {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--color-text-secondary, #a8a8b8);
}
.helpers-coords {
  margin: 0 0 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  color: var(--color-text-primary, #f4f4f8);
  word-break: break-all;
}
.helpers-err {
  margin: 0 0 0.5rem;
  font-size: 0.72rem;
  color: #f97373;
}
.helpers-hint {
  margin: 0.55rem 0 0;
  font-size: 0.68rem;
  line-height: 1.35;
  color: #7a7a8c;
}
.helpers-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.5rem 0 0.75rem;
  font-size: 0.82rem;
  color: var(--color-text-primary, #f4f4f8);
}
.helpers-row input {
  margin-top: 0.15rem;
}
.helpers-field {
  margin-top: 0.35rem;
}

.audio-panel {
  padding-top: 0.15rem;
}
.audio-near-trailer {
  padding: 0.65rem 0 0.85rem;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}
.audio-near-trailer-label {
  display: block;
  margin-bottom: 0.45rem;
}
.audio-near-trailer-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.audio-near-trailer-input {
  max-width: 7rem;
  min-height: 2.5rem;
}
.audio-near-trailer-unit {
  font-size: 0.9rem;
  color: var(--color-text-tertiary, #a8a8b8);
  font-weight: 600;
}
.audio-near-trailer-hint {
  margin: 0.45rem 0 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--color-text-tertiary, #8e8e9e);
}
.audio-near-trailer--compact {
  padding-top: 0.35rem;
}
.audio-more-wrap {
  margin-top: 0.35rem;
}
.audio-more-toggle {
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.25rem;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #c4c4d4);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  border-radius: 6px;
}
.audio-more-toggle:hover {
  background: rgba(255, 255, 255, 0.04);
}
.alert-types-section--more {
  padding-top: 0.25rem;
}
.audio-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  min-height: 48px;
}
.audio-row:last-child {
  border-bottom: none;
}
.audio-row-label {
  font-size: 0.95rem;
  color: var(--color-text-primary, #f4f4f8);
  flex: 1;
  min-width: 0;
}
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-bg-tertiary, #2a2a35);
  border-radius: 24px;
  transition: background-color 0.2s ease;
}
.toggle-slider::before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: #fff;
  border-radius: 50%;
  transition: transform 0.2s ease;
}
.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-accent-purple, #7b4db5);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(20px);
}
.toggle-switch input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}
.audio-test-btn {
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  background: var(--color-bg-surface, #16161d);
  color: var(--color-text-secondary, #a8a8b8);
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  font-weight: 500;
  min-width: 60px;
  min-height: 36px;
  transition: var(--transition-colors);
}
.audio-test-btn:hover:not(:disabled) {
  background: var(--color-hover, rgba(255, 255, 255, 0.06));
  color: var(--color-text-primary, #f4f4f8);
}
.audio-test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.alert-types-section {
  padding-top: 0.25rem;
}
.alert-types-heading {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary, #a8a8b8);
  margin: 0.5rem 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.btn-group-sm {
  display: flex;
  gap: 0.35rem;
}
.cred-msg {
  font-size: 0.9rem;
  color: var(--color-success, #22c55e);
  margin: 0 0 0.75rem;
}
.cred-msg--error {
  color: var(--color-error, #ef4444);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
}
.hint {
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-tertiary, #6e6e7e);
  margin: 0 0 var(--space-3, 0.75rem);
  line-height: var(--leading-relaxed, 1.65);
}
.hint.tight {
  margin-bottom: var(--space-2, 0.5rem);
}
.hint strong {
  color: var(--color-text-secondary, #a8a8b8);
}
.block-gap {
  margin-top: var(--space-4, 1rem);
}
.lbl {
  display: block;
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  margin-bottom: var(--space-1-5, 0.375rem);
  color: var(--color-text-secondary, #a8a8b8);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-2, 0.5rem);
  font-size: var(--text-base, 0.9375rem);
  min-height: var(--touch-target, 2.75rem);
}
.inp {
  width: 100%;
  padding: var(--space-2-5, 0.625rem) var(--space-3, 0.75rem);
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-elevated, #0f0f14);
  color: var(--color-text-primary, #f4f4f8);
  margin-bottom: var(--space-3, 0.75rem);
  min-height: var(--touch-target, 2.75rem);
  font-size: var(--text-base, 0.9375rem);
  transition: var(--transition-colors);
}
.inp:focus {
  outline: none;
  border-color: var(--color-accent-purple, #7b4db5);
  box-shadow: 0 0 0 3px rgba(123, 77, 181, 0.15);
}
.inp::placeholder {
  color: var(--color-text-tertiary, #6e6e7e);
}
.linehaul-poll-card {
  margin-bottom: var(--space-3, 0.75rem);
  padding: var(--space-4, 1rem);
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-sm, 8px));
  -webkit-backdrop-filter: blur(var(--blur-sm, 8px));
}
.linehaul-poll-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.55rem;
}
.linehaul-poll-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted, #9898a8);
  cursor: pointer;
}
.linehaul-poll-value {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.linehaul-poll-range {
  display: block;
  width: 100%;
  height: 2rem;
  margin: 0;
  accent-color: #7b4db5;
  cursor: pointer;
}
.linehaul-poll-range:focus-visible {
  outline: 2px solid #7b4db5;
  outline-offset: 2px;
  border-radius: 4px;
}
.linehaul-poll-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 0.35rem;
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  color: var(--muted, #9898a8);
}
.linehaul-poll-scale-num {
  font-variant-numeric: tabular-nums;
}

.linehaul-poll-hint {
  margin: var(--space-3, 0.75rem) 0 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.45;
  color: var(--color-text-tertiary, #6e6e7e);
}
.inp.token-field {
  font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.82rem;
  word-break: break-all;
}
.linehaul-bearer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}
.linehaul-bearer-input {
  flex: 1 1 14rem;
  min-width: 0;
  margin-bottom: 0;
}
.linehaul-bearer-capture {
  flex: 0 0 auto;
  align-self: center;
  white-space: nowrap;
}
.cred-actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3, 0.75rem);
  margin-top: var(--space-3, 0.75rem);
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
}
.linehaul-test-row {
  margin: var(--space-4, 1rem) 0 var(--space-3, 0.75rem);
  padding-top: var(--space-3, 0.75rem);
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}
.linehaul-test-lbl {
  margin-bottom: var(--space-2, 0.5rem);
}
.linehaul-test-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 0.5rem);
}
.linehaul-test-select {
  flex: 1 1 14rem;
  min-width: 11rem;
  max-width: 100%;
  margin-bottom: 0;
}
.linehaul-test-controls .btn {
  flex: 0 0 auto;
}
.linehaul-test-legseq {
  flex: 1 1 9rem;
  min-width: 8rem;
  max-width: 100%;
  margin-bottom: 0;
}
.api-quota-table-wrap {
  overflow-x: auto;
  margin: 0.75rem 0;
}
.api-quota-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}
.api-quota-table th,
.api-quota-table td {
  border: 1px solid var(--border, #2e2e38);
  padding: 0.35rem 0.45rem;
  text-align: left;
  vertical-align: middle;
}
.api-quota-table thead th {
  background: #12121a;
  font-weight: 600;
}
.inp-compact {
  max-width: 7rem;
  min-height: 2.25rem;
}
.btn {
  cursor: pointer;
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-surface, #16161d);
  color: var(--color-text-primary, #f4f4f8);
  padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-medium, 500);
  min-height: var(--touch-target, 2.75rem);
  transition: var(--transition-all);
}
.btn:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
  border-color: var(--color-accent-purple, #7b4db5);
}
.btn.primary {
  background: var(--color-accent-purple, #7b4db5);
  border: none;
  color: white;
  font-weight: var(--weight-semibold, 600);
}
.btn.primary:hover {
  box-shadow: var(--shadow-glow-purple, 0 0 20px rgba(123, 77, 181, 0.25));
  transform: translateY(-1px);
}
.btn.primary:active {
  transform: translateY(0);
}
.btn.ghost {
  background: transparent;
  border-color: transparent;
}
.btn.ghost:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}
.log-actions {
  margin-bottom: 0.5rem;
}
.log-scroll {
  max-height: 280px;
  overflow: auto;
  font-size: 0.75rem;
  background: #12121a;
  border-radius: 6px;
  border: 1px solid var(--border, #2e2e38);
  padding: 0.5rem;
}
.log-line {
  display: grid;
  grid-template-columns: 5rem 4rem 1fr;
  gap: 0.35rem;
  padding: 0.2rem 0;
  border-bottom: 1px solid #22222c;
}
.log-line[data-t='error'] .msg {
  color: #ff8a80;
}
.ts {
  color: var(--muted, #9898a8);
}
.ty {
  color: #90caf9;
  text-transform: uppercase;
  font-size: 0.62rem;
}
.tap:active {
  opacity: 0.9;
}
code {
  font-size: 0.85em;
}
.bmk {
  background: rgba(0, 0, 0, 0.35);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.78em;
}
.ext-link {
  color: #a78bfa;
  text-decoration: underline;
  text-underline-offset: 2px;
}
@media (max-width: 480px) {
  .log-line {
    grid-template-columns: 1fr;
  }
}
.log-line-screenshot {
  grid-template-columns: 5rem 4.5rem 1fr;
}
.log-line-screenshot .ty {
  color: #ce93d8;
}
.screenshot-msg {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.screenshot-label {
  font-weight: 500;
  color: var(--text, #e8e8ee);
}
.screenshot-error {
  color: #ff8a80;
  font-size: 0.7rem;
}
.screenshot-thumb {
  max-width: 120px;
  max-height: 80px;
  border-radius: 4px;
  border: 1px solid #3a3a48;
  cursor: pointer;
  object-fit: contain;
  background: #0a0a10;
}
.screenshot-thumb:hover {
  border-color: #7b4db5;
}
.screenshot-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.screenshot-modal {
  position: relative;
  max-width: 95vw;
  max-height: 95vh;
  background: var(--card, #1a1a21);
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  padding: 0.75rem;
  overflow: auto;
}
.screenshot-modal-close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 2rem;
  height: 2rem;
  border-radius: 6px;
  border: 1px solid var(--border, #2e2e38);
  background: #25252e;
  color: var(--text, #e8e8ee);
  font-size: 1.1rem;
  cursor: pointer;
}
.screenshot-modal-title {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
}
.screenshot-modal-error {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: #ff8a80;
}
.screenshot-full {
  display: block;
  max-width: 90vw;
  max-height: 80vh;
  border-radius: 6px;
  object-fit: contain;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DIRECTORY PANEL — Statistics & CSV Import
   ═══════════════════════════════════════════════════════════════════════════ */

.directory-panel {
  max-width: 64rem;
  margin-inline: auto;
}

.directory-loading,
.directory-error {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
}

.directory-error {
  color: var(--color-danger, #ff6b6b);
}

.directory-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
  margin-bottom: var(--space-4, 1rem);
}

.directory-stats-primary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-3, 0.75rem);
}

.directory-type-stats-heading {
  margin: 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #6e6e7e);
}

.directory-type-stats-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: var(--space-2, 0.5rem);
}

.directory-type-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: var(--space-2, 0.5rem) var(--space-2, 0.5rem);
  background: var(--color-glass-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 0.5rem);
  min-height: 3.25rem;
}

.directory-type-stat-count {
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-bold, 700);
  color: var(--color-accent-purple, #7b4db5);
  line-height: 1.1;
}

.directory-type-stat-label {
  font-size: 0.65rem;
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #a8a8b8);
  text-align: center;
  line-height: 1.25;
}

.csv-preview-skip-note {
  display: block;
  margin-top: 0.25rem;
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
  font-weight: var(--weight-normal, 400);
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-4, 1rem);
  background: var(--color-glass-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-lg, 0.75rem);
}

.stat-value {
  font-size: var(--text-2xl, 1.5rem);
  font-weight: var(--weight-bold, 700);
  color: var(--color-accent-purple, #7b4db5);
  line-height: 1.2;
}

.stat-label {
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
  text-align: center;
  margin-top: var(--space-1, 0.25rem);
}

.directory-hint {
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
  margin: 0 0 var(--space-4, 1rem);
  line-height: 1.5;
}

.csv-import-area {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.csv-file-label {
  display: inline-block;
  cursor: pointer;
}

.csv-file-input {
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

.csv-file-name {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
  word-break: break-all;
}

.csv-preview {
  padding: var(--space-3, 0.75rem);
  background: var(--color-glass-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 0.5rem);
}

.csv-preview-summary {
  margin: 0 0 var(--space-2, 0.5rem);
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-primary, #f4f4f8);
}

.csv-preview-label {
  margin: var(--space-2, 0.5rem) 0 var(--space-1, 0.25rem);
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

.csv-preview-list {
  margin: 0;
  padding-left: var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
  list-style: disc;
}

.csv-preview-list li {
  margin-bottom: var(--space-1, 0.25rem);
}

.csv-import-error {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-danger, #ff6b6b);
}

.csv-import-msg {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-success, #4ade80);
}

.csv-import-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
  margin-top: var(--space-2, 0.5rem);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPONSIVE — Mobile-first breakpoints
   ═══════════════════════════════════════════════════════════════════════════ */

@media (max-width: 374px) {
  .shell {
    padding: var(--space-3, 0.75rem) 0;
  }

  .settings-tabs {
    gap: var(--space-0-5, 0.125rem);
    padding: var(--space-0-5, 0.125rem);
    border-radius: var(--radius-lg, 0.75rem);
  }

  .tab-btn {
    padding: var(--space-2, 0.5rem) var(--space-2, 0.5rem);
    font-size: var(--text-xs, 0.6875rem);
  }

  .stack {
    gap: var(--space-3, 0.75rem);
  }
}

@media (min-width: 420px) {
  .shell {
    padding: var(--space-5, 1.25rem) 0 var(--space-6, 1.5rem);
  }

  .settings-tabs {
    border-radius: var(--radius-2xl, 1.25rem);
  }

  .tab-btn {
    font-size: var(--text-sm, 0.8125rem);
  }
}

@media (min-width: 640px) {
  .shell {
    padding: var(--space-6, 1.5rem) 0 var(--space-8, 2rem);
  }

  .stack {
    gap: var(--space-5, 1.25rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn.primary:hover {
    animation: none;
    transform: none;
  }
}
</style>
