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
  putOpenrouterApiKey,
  putGwbUpperCamYoutubeUrl,
  putSmtpPrefs,
  postSmtpTest,
  getEmailTestKinds,
  putHelpersAutoArrivePrefs,
  deleteCredentials,
  putAssignment,
  getHealth,
  postLinehaulCaptureBearer,
  fetchFedexLinehaulTractor,
  fetchFedexLinehaulDriver,
  fetchFedexLinehaulTripStatus,
  fetchFedexLinehaulTrips,
  getSettingsAccessLog,
  getSettingsDevices,
  postSettingsDeviceRegister,
  putSettingsDeviceName,
  deleteSettingsDeviceSession,
  deleteSettingsDevice,
  postSettingsDeviceTouch,
  getBridgeTrafficExport,
  getSettingsGeoFence,
  putSettingsGeoFence,
  postSettingsGeoFencePreview,
  getApiQuotaSettings,
  putApiQuotaLimits,
  postApiQuotaReset,
  fetchDirectory,
  bulkImportDirectory,
  postAuthLogout,
} from '../api.js'
import { resetLinehaulSession } from '../stores/linehaulSnapshotStore.js'
import {
  DIRECTORY_STATION_TYPES,
  DIRECTORY_LOCATION_TYPE_OTHER,
  countByDirectoryLocationType,
  normalizeLocationTypeForStorage,
} from '../utils/directoryLocationTypes.js'
import {
  collectDeviceInfo,
  formatFormFactorLabel,
  getLocalDeviceName,
  setLocalDeviceName,
} from '../utils/deviceInfo.js'
import {
  exportTripHistoryToCsv,
  parseTripHistoryFromCsv,
  mergeTripHistoryLedgers,
  tripHistoryCsvPreviewRows,
} from '../utils/tripHistoryCsv.js'
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
import {
  startLinehaulBearerCaptureOverlay,
  finishLinehaulBearerCaptureOverlay,
} from '../stores/linehaulBearerCaptureOverlay.js'
import SettingsSection from '../components/settings/SettingsSection.vue'
import BridgeTrafficThresholdsEditor from '../components/settings/BridgeTrafficThresholdsEditor.vue'
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
  openrouterApiKeyOverride,
  setOpenrouterApiKey,
  setOpenrouterModel,
  openrouterModelEffective,
} from '../stores/trafficTileKey.js'
import {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_BRIEFING_SYSTEM_PROMPT,
  sanitizeOpenrouterModel,
} from '../constants/openrouterModels.js'
import OpenRouterModelPicker from '../components/OpenRouterModelPicker.vue'
import AutomationList from '../components/automation/AutomationList.vue'
import AutomationEditor from '../components/automation/AutomationEditor.vue'
import {
  getWahaUrlForSettings, setWahaBaseUrl,
  getWahaApiKeyForSettings, setWahaApiKey,
  isWahaProxyMode,
  getWahaChatId, setWahaChatId,
  wahaChatKindLabel,
  isWahaTtsEnabled,
  setWahaTtsEnabled,
  isWahaDailyBriefingEnabled,
  setWahaDailyBriefingEnabled,
  isWahaAutoRespondPhoneEnabled,
  setWahaAutoRespondPhoneEnabled,
  isWahaAutoRespondWhereEnabled,
  setWahaAutoRespondWhereEnabled,
  isWahaAutoRespondWhoAtEnabled,
  setWahaAutoRespondWhoAtEnabled,
  wahaAuthErrorHint,
  getSessionStatus, ensureSession, getQr, listChats, sendChatMessage,
} from '../utils/wahaApi.js'
import {
  getTripAlertMode,
  setTripAlertMode,
  speakTripTtsTest,
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
  HELPERS_RADIUS_NM_DEFAULT,
  applyHelpersLocationPrefsFromCredentials,
} from '../utils/helpersLocationPrefs.js'
import {
  applyWahaPrefsFromCredentials,
  saveWahaPrefsToServer,
} from '../utils/wahaPrefs.js'
import {
  getBlueBubblesUrlForSettings,
  setBlueBubblesBaseUrl,
  getBlueBubblesPasswordForSettings,
  setBlueBubblesPassword,
  isBlueBubblesProxyMode,
  pingBlueBubblesViaServer,
} from '../utils/blueBubblesApi.js'
import {
  saveBlueBubblesPrefsToServer,
  registerBlueBubblesWebhookOnServer,
  applyBlueBubblesPrefsFromCredentials,
} from '../utils/blueBubblesPrefs.js'
import { restartBlueBubblesBackgroundPoll } from '../utils/blueBubblesBackgroundPoll.js'
import { workWeekChangeEffectiveFromMs, workWeekStartMsForAnchorDate } from '../utils/workWeekGroup.js'
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

/** @type {import('vue').Ref<'general' | 'automation' | 'audio' | 'email' | 'security' | 'devices' | 'directory' | 'traffic' | 'helpers' | 'whatsapp' | 'imessage'>} */
const settingsTab = ref('general')
const settingsTabsEl = ref(/** @type {HTMLElement | null} */ (null))
const signOutBusy = ref(false)

async function signOutApp() {
  if (signOutBusy.value) return
  signOutBusy.value = true
  try {
    await postAuthLogout()
  } catch {
    /* still navigate */
  }
  resetLinehaulSession()
  await router.push({ name: 'login' })
  signOutBusy.value = false
}

/**
 * Desktop: vertical wheel scrolls tab bar horizontally when tabs overflow.
 * @param {WheelEvent} e
 */
function onSettingsTabsWheel(e) {
  const el = settingsTabsEl.value
  if (!el || el.scrollWidth <= el.clientWidth + 1) return
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}

const helpersAutoArriveEnabled = ref(getHelpersAutoArriveNearDestEnabled())
const helpersRadiusNm = ref(getHelpersAutoArriveRadiusNm())
const helpersLocationBusy = ref(false)
const helpersProximityBusy = ref(false)
const helpersProximityMsg = ref('')

function syncHelpersPrefsFromStorage() {
  helpersAutoArriveEnabled.value = getHelpersAutoArriveNearDestEnabled()
  helpersRadiusNm.value = getHelpersAutoArriveRadiusNm()
}

async function onHelpersProximityToggle(enabled) {
  if (!(await requireApi())) {
    syncHelpersPrefsFromStorage()
    return
  }
  const previousEnabled = helpersAutoArriveEnabled.value
  helpersAutoArriveEnabled.value = enabled
  helpersProximityBusy.value = true
  helpersProximityMsg.value = ''
  const radius = Math.min(
    HELPERS_RADIUS_NM_MAX,
    Math.max(
      HELPERS_RADIUS_NM_MIN,
      Number.isFinite(Number(helpersRadiusNm.value)) ? Number(helpersRadiusNm.value) : HELPERS_RADIUS_NM_DEFAULT,
    ),
  )
  try {
    await putHelpersAutoArrivePrefs({ enabled, radiusNm: radius })
    setHelpersAutoArriveNearDestEnabled(enabled)
    setHelpersAutoArriveRadiusNm(radius)
    syncHelpersPrefsFromStorage()
  } catch (e) {
    helpersAutoArriveEnabled.value = previousEnabled
    helpersProximityMsg.value = e instanceof Error ? e.message : String(e)
    syncHelpersPrefsFromStorage()
  } finally {
    helpersProximityBusy.value = false
  }
}

async function onHelpersRadiusBlur() {
  const n = Number.parseFloat(String(helpersRadiusNm.value))
  if (!Number.isFinite(n)) {
    helpersRadiusNm.value = getHelpersAutoArriveRadiusNm()
    return
  }
  const clamped = Math.min(HELPERS_RADIUS_NM_MAX, Math.max(HELPERS_RADIUS_NM_MIN, n))
  if (!(await requireApi())) {
    helpersRadiusNm.value = getHelpersAutoArriveRadiusNm()
    return
  }
  helpersProximityBusy.value = true
  helpersProximityMsg.value = ''
  try {
    await putHelpersAutoArrivePrefs({
      enabled: helpersAutoArriveEnabled.value,
      radiusNm: clamped,
    })
    setHelpersAutoArriveNearDestEnabled(helpersAutoArriveEnabled.value)
    setHelpersAutoArriveRadiusNm(clamped)
    syncHelpersPrefsFromStorage()
  } catch (e) {
    helpersProximityMsg.value = e instanceof Error ? e.message : String(e)
    syncHelpersPrefsFromStorage()
  } finally {
    helpersProximityBusy.value = false
  }
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

/** @type {import('vue').Ref<Array<{
 *   id: string,
 *   name: string,
 *   os: string,
 *   formFactor: string,
 *   browser: string,
 *   registeredAt: string,
 *   lastSeenAt: string,
 *   sessionId: string | null,
 *   lastIp: string | null,
 *   isSignedIn?: boolean,
 *   isCurrent?: boolean,
 * }>>} */
const registeredDevices = ref([])
const devicesLoading = ref(false)
const devicesError = ref('')
const devicesMsg = ref('')
const devicesBusyId = ref('')
const deviceRegisterBusy = ref(false)
const deviceNameDraft = ref(getLocalDeviceName())
const devicesMaxSessions = ref(2)
const currentDeviceInfo = ref(collectDeviceInfo())

async function loadDevices() {
  devicesLoading.value = true
  devicesError.value = ''
  try {
    currentDeviceInfo.value = collectDeviceInfo()
    deviceNameDraft.value = getLocalDeviceName() || currentDeviceInfo.value.name
    const res = await getSettingsDevices()
    registeredDevices.value = Array.isArray(res.devices) ? res.devices : []
    devicesMaxSessions.value =
      typeof res.maxSessions === 'number' ? res.maxSessions : 2
    try {
      await postSettingsDeviceTouch({ deviceId: currentDeviceInfo.value.deviceId })
    } catch {
      /* non-fatal */
    }
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
    registeredDevices.value = []
  } finally {
    devicesLoading.value = false
  }
}

async function registerCurrentDevice() {
  if (deviceRegisterBusy.value) return
  deviceRegisterBusy.value = true
  devicesMsg.value = ''
  devicesError.value = ''
  try {
    const info = collectDeviceInfo()
    const name = deviceNameDraft.value.trim() || info.name
    setLocalDeviceName(name)
    await postSettingsDeviceRegister({ ...info, name })
    devicesMsg.value = 'Device registered.'
    await loadDevices()
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deviceRegisterBusy.value = false
  }
}

async function saveDeviceName(device) {
  const id = String(device?.id ?? '').trim()
  if (!id || devicesBusyId.value) return
  const name = String(device?.name ?? '').trim()
  if (!name) {
    devicesError.value = 'Device name is required.'
    return
  }
  devicesBusyId.value = id
  devicesMsg.value = ''
  devicesError.value = ''
  try {
    await putSettingsDeviceName(id, { name })
    if (currentDeviceInfo.value.deviceId === id) {
      setLocalDeviceName(name)
      deviceNameDraft.value = name
    }
    devicesMsg.value = 'Device renamed.'
    await loadDevices()
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
  } finally {
    devicesBusyId.value = ''
  }
}

async function signOutDevice(device) {
  const id = String(device?.id ?? '').trim()
  if (!id || devicesBusyId.value) return
  devicesBusyId.value = id
  devicesMsg.value = ''
  devicesError.value = ''
  try {
    await deleteSettingsDeviceSession(id)
    devicesMsg.value = 'Device signed out.'
    await loadDevices()
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
  } finally {
    devicesBusyId.value = ''
  }
}

async function removeDevice(device) {
  const id = String(device?.id ?? '').trim()
  if (!id || devicesBusyId.value) return
  devicesBusyId.value = id
  devicesMsg.value = ''
  devicesError.value = ''
  try {
    await deleteSettingsDevice(id)
    devicesMsg.value = 'Device removed.'
    await loadDevices()
  } catch (e) {
    devicesError.value = e instanceof Error ? e.message : String(e)
  } finally {
    devicesBusyId.value = ''
  }
}

function formatDeviceWhen(iso) {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleString()
}

const signedInDeviceCount = computed(
  () => registeredDevices.value.filter((d) => d.isSignedIn).length,
)

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

const nearTrailerApproachFeet = computed(() => nearTrailerRadiusFeet.value * 3)

function toggleTts(enabled) {
  setTripAlertModeUi(enabled ? 'tts' : 'off')
}

function clampNearTrailerFeet(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return getNearTrailerRadiusFeet()
  const clamped = Math.min(3000, Math.max(50, v))
  return Math.round(clamped / 10) * 10
}

function stepNearTrailerFeet(delta) {
  nearTrailerRadiusFeet.value = clampNearTrailerFeet(nearTrailerRadiusFeet.value + delta)
  saveNearTrailerRadius()
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
/** Last saved work week — used to record schedule history only when days actually change. */
const loadedWorkWeekStartDay = ref(0)
const loadedWorkWeekEndDay = ref(6)
/** When changing work week, optionally backdate when the new schedule began. */
const workWeekRetroactiveDate = ref('')
/** History calendar "shift day" — overnight (e.g. 19:00–07:00) uses the date the shift started. */
const shiftStartTime = ref('00:00')
const shiftEndTime = ref('23:59')
/** History: smart in-card approval for 1.5× mileage on US federal holidays. */
const federalHolidayMileage15xEnabled = ref(true)
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

/** OpenRouter API key + model (WhatsApp daily briefing). Register: openrouter.ai */
const openrouterApiDraft = ref('')
const openrouterModelDraft = ref(OPENROUTER_DEFAULT_MODEL)
const openrouterApiMsg = ref('')
const openrouterApiBusy = ref(false)
const openrouterBriefingSystemPrompt = OPENROUTER_BRIEFING_SYSTEM_PROMPT
const uiBuildLabel = ref('')

async function refreshUiBuildLabel() {
  try {
    const r = await fetch('/api/build-info', { credentials: 'include' })
    if (!r.ok) return
    const data = await r.json().catch(() => ({}))
    if (typeof data.buildLabel === 'string' && data.buildLabel.trim()) {
      uiBuildLabel.value = data.buildLabel.trim()
    } else {
      const parts = [data.gitCommit, data.builtAt, data.mainScript].filter(Boolean)
      uiBuildLabel.value = parts.length ? parts.join(' · ') : 'unknown'
    }
  } catch {
    /* optional */
  }
}

async function saveOpenrouterApiKey() {
  if (!(await requireApi())) return
  openrouterApiBusy.value = true
  openrouterApiMsg.value = ''
  try {
    const model = sanitizeOpenrouterModel(openrouterModelDraft.value)
    openrouterModelDraft.value = model
    const res = await putOpenrouterApiKey({
      openrouterApiKey: openrouterApiDraft.value,
      openrouterModel: model,
    })
    setOpenrouterApiKey(openrouterApiDraft.value)
    setOpenrouterModel(model)
    if (typeof res?.openrouterModel === 'string' && res.openrouterModel.trim()) {
      openrouterModelDraft.value = res.openrouterModel.trim()
      setOpenrouterModel(res.openrouterModel.trim())
    }
    openrouterApiMsg.value = 'OpenRouter settings saved to your account.'
  } catch (e) {
    openrouterApiMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    openrouterApiBusy.value = false
  }
}

/** GWB upper deck camera: full YouTube URL saved on server (no YouTube API key required). */
const gwbUpperCamYoutubeDraft = ref('')
const gwbUpperCamYoutubeMsg = ref('')
const gwbUpperCamYoutubeBusy = ref(false)

const smtpEnabled = ref(false)
const smtpHostDraft = ref('')
const smtpPortDraft = ref(587)
const smtpSecureDraft = ref(false)
const smtpUserDraft = ref('')
const smtpPassDraft = ref('')
const smtpFromEmailDraft = ref('')
const smtpFromNameDraft = ref('TripBuddy')
const emailNotifyToDraft = ref('')
const emailTimezoneDraft = ref('America/New_York')
const emailOnNewTrip = ref(true)
const emailOnPreplan = ref(true)
const emailOnStatusChange = ref(false)
const emailOnDriverMismatch = ref(false)
const emailOnDispatchInstructions = ref(false)
const emailOnDailyShift = ref(true)
const emailOnWeeklySummary = ref(true)
const emailTripCcDraft = ref('')
const emailDailyShiftCcDraft = ref('')
const emailWeeklySummaryCcDraft = ref('')
const smtpBusy = ref(false)
const smtpTestBusy = ref(false)
const smtpMsg = ref('')
const smtpTestKind = ref('weekly_summary')
const smtpTestKindOptions = ref([
  { id: 'smtp', label: 'SMTP connection test' },
  { id: 'new_trip', label: 'New trip assigned' },
  { id: 'preplan', label: 'New preplan assigned' },
  { id: 'status_enroute', label: 'Trip status — en route' },
  { id: 'dispatch_instructions', label: 'Dispatch instructions updated' },
  { id: 'driver_mismatch', label: 'Driver / tractor location mismatch' },
  { id: 'daily_shift', label: 'End of shift summary' },
  { id: 'weekly_summary', label: 'Weekly mileage summary' },
])

const showEmailSmtpFields = computed(() => smtpEnabled.value)
const showTripAlertCc = computed(
  () =>
    emailOnNewTrip.value ||
    emailOnPreplan.value ||
    emailOnStatusChange.value ||
    emailOnDriverMismatch.value ||
    emailOnDispatchInstructions.value,
)

watch(smtpSecureDraft, (secure) => {
  smtpPortDraft.value = secure ? 465 : 587
})

function smtpPrefsPayload() {
  return {
    enabled: smtpEnabled.value,
    host: smtpHostDraft.value,
    port: Number(smtpPortDraft.value) || 587,
    secure: smtpSecureDraft.value,
    user: smtpUserDraft.value,
    password: smtpPassDraft.value || undefined,
    fromEmail: smtpFromEmailDraft.value,
    fromName: smtpFromNameDraft.value,
    notifyTo: emailNotifyToDraft.value,
    timezone: emailTimezoneDraft.value,
    onNewTrip: emailOnNewTrip.value,
    onPreplan: emailOnPreplan.value,
    onStatusChange: emailOnStatusChange.value,
    onDriverMismatch: emailOnDriverMismatch.value,
    onDispatchInstructions: emailOnDispatchInstructions.value,
    onDailyShiftSummary: emailOnDailyShift.value,
    onWeeklySummary: emailOnWeeklySummary.value,
    tripCc: emailTripCcDraft.value,
    dailyShiftCc: emailDailyShiftCcDraft.value,
    weeklySummaryCc: emailWeeklySummaryCcDraft.value,
  }
}

async function saveSmtpPrefs() {
  if (!(await requireApi())) return
  smtpBusy.value = true
  smtpMsg.value = ''
  try {
    await putSmtpPrefs(smtpPrefsPayload())
    smtpPassDraft.value = ''
    smtpMsg.value = 'Email settings saved.'
    await loadCredentials()
  } catch (e) {
    smtpMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    smtpBusy.value = false
  }
}

async function sendSmtpTest() {
  if (!(await requireApi())) return
  smtpTestBusy.value = true
  smtpMsg.value = ''
  try {
    await putSmtpPrefs(smtpPrefsPayload())
    smtpPassDraft.value = '••••'
    const kind = smtpTestKind.value || 'smtp'
    await postSmtpTest({ kind })
    const label =
      smtpTestKindOptions.value.find((o) => o.id === kind)?.label || 'Test email'
    smtpMsg.value = `${label} sent — check your inbox.`
  } catch (e) {
    smtpMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    smtpTestBusy.value = false
  }
}

async function loadEmailTestKinds() {
  try {
    const data = await getEmailTestKinds()
    if (Array.isArray(data?.kinds) && data.kinds.length) {
      smtpTestKindOptions.value = data.kinds
    }
  } catch {
    /* keep defaults */
  }
}

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

/** WhatsApp (WAHA) settings */
const wahaUrlDraft = ref(getWahaUrlForSettings())
const wahaApiKeyDraft = ref(getWahaApiKeyForSettings())
const wahaUsesServerProxy = computed(() => isWahaProxyMode())
const wahaChatIdDraft = ref(getWahaChatId())
const wahaChatSpeechOn = ref(isWahaTtsEnabled())
const wahaDailyBriefingOn = ref(isWahaDailyBriefingEnabled())
const wahaAutoRespondPhoneOn = ref(isWahaAutoRespondPhoneEnabled())
const wahaAutoRespondWhereOn = ref(isWahaAutoRespondWhereEnabled())
const wahaAutoRespondWhoAtOn = ref(isWahaAutoRespondWhoAtEnabled())
const wahaConnMsg = ref('')
const wahaChatMsg = ref('')
const wahaChatsLoading = ref(false)
const wahaChatsList = ref([])
const wahaSendText = ref('')
const wahaSendMsg = ref('')

const wahaQrUrl = ref('')

/** BlueBubbles / iMessage settings (connection + webhook only) */
const bbUrlDraft = ref(getBlueBubblesUrlForSettings())
const bbPasswordDraft = ref(getBlueBubblesPasswordForSettings())
const bbUsesServerProxy = computed(() => isBlueBubblesProxyMode())
const bbConnMsg = ref('')
const bbSaveMsg = ref('')
const bbWebhookUrl = ref('')

async function testBlueBubblesConnection() {
  setBlueBubblesBaseUrl(bbUrlDraft.value)
  setBlueBubblesPassword(bbPasswordDraft.value)
  bbConnMsg.value = 'Checking…'
  try {
    const r = await pingBlueBubblesViaServer({
      serverUrl: bbUrlDraft.value,
      password: bbPasswordDraft.value,
    })
    if (r.ok) {
      bbConnMsg.value = 'Connected to BlueBubbles server.'
      restartBlueBubblesBackgroundPoll()
    } else {
      bbConnMsg.value = r.error || `Cannot reach BlueBubbles (${r.status}).`
    }
  } catch (e) {
    bbConnMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveBlueBubblesSettings() {
  bbSaveMsg.value = 'Saving…'
  try {
    const res = await saveBlueBubblesPrefsToServer({
      serverUrl: bbUrlDraft.value,
      password: bbPasswordDraft.value,
    })
    if (res?.blueBubblesWebhookUrl) bbWebhookUrl.value = res.blueBubblesWebhookUrl
    bbSaveMsg.value = 'Saved — synced to your account.'
    restartBlueBubblesBackgroundPoll()
  } catch (e) {
    bbSaveMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function registerBbWebhook() {
  bbConnMsg.value = 'Registering webhook…'
  try {
    await saveBlueBubblesPrefsToServer({
      serverUrl: bbUrlDraft.value,
      password: bbPasswordDraft.value,
    })
    const r = await registerBlueBubblesWebhookOnServer()
    if (r?.webhookUrl) {
      bbWebhookUrl.value = r.webhookUrl
      bbConnMsg.value = r.registered ? 'Webhook registered on BlueBubbles.' : 'Webhook already registered.'
    } else {
      bbConnMsg.value = r?.error || 'Webhook registration failed.'
    }
  } catch (e) {
    bbConnMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function testWahaConnection() {
  setWahaBaseUrl(wahaUrlDraft.value)
  setWahaApiKey(wahaApiKeyDraft.value)
  wahaConnMsg.value = 'Checking…'
  wahaQrUrl.value = ''
  try {
    await ensureSession()
    const r = await getSessionStatus()
    if (!r.ok) {
      const authHint = wahaAuthErrorHint(r.status)
      wahaConnMsg.value = authHint
        || `Cannot reach WAHA (${r.status}). Is the container running?`
      return
    }
    const status = String(r.body?.status || 'UNKNOWN').toUpperCase()
    if (status === 'WORKING') {
      const me = r.body?.me?.pushName || r.body?.me?.id || ''
      wahaConnMsg.value = `Connected${me ? ` as ${me}` : ''}.`
    } else if (status === 'SCAN_QR_CODE' || status === 'QR') {
      wahaConnMsg.value = 'Scan the QR code below with your WhatsApp app.'
      const qr = await getQr()
      if (qr.ok && qr.body?.value) {
        wahaQrUrl.value = qr.body.value
      }
    } else if (status === 'NOT_FOUND') {
      wahaConnMsg.value = 'Session not found — starting it now…'
      await ensureSession()
      wahaConnMsg.value = 'Session created. Tap "Check connection" again to get QR.'
    } else {
      wahaConnMsg.value = `Session status: ${status}`
    }
  } catch (e) {
    wahaConnMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveWahaChat() {
  const chatId = wahaChatIdDraft.value.trim()
  setWahaChatId(chatId)
  wahaChatMsg.value = 'Saving…'
  try {
    await saveWahaPrefsToServer({
      chatId,
      ttsEnabled: wahaChatSpeechOn.value,
      dailyBriefingEnabled: wahaDailyBriefingOn.value,
      autoRespondPhoneEnabled: wahaAutoRespondPhoneOn.value,
      autoRespondWhereEnabled: wahaAutoRespondWhereOn.value,
      autoRespondWhoAtEnabled: wahaAutoRespondWhoAtOn.value,
    })
    wahaChatMsg.value = 'Chat saved — synced to your account for all devices.'
  } catch (e) {
    wahaChatMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadWahaChats() {
  setWahaBaseUrl(wahaUrlDraft.value)
  setWahaApiKey(wahaApiKeyDraft.value)
  wahaChatsLoading.value = true
  wahaChatMsg.value = ''
  try {
    const r = await listChats({ limit: 100 })
    if (r.ok && Array.isArray(r.body)) {
      wahaChatsList.value = r.body
      wahaChatMsg.value = `${wahaChatsList.value.length} chat(s) found. Tap one to select it.`
    } else {
      const authHint = wahaAuthErrorHint(r.status)
      wahaChatMsg.value = authHint
        || `Failed (${r.status}). Session may not be linked — tap "Check connection" first.`
    }
  } catch (e) {
    wahaChatMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    wahaChatsLoading.value = false
  }
}

function selectWahaChat(chat) {
  if (!chat?.id) return
  wahaChatIdDraft.value = chat.id
  saveWahaChat()
}

function syncWahaSpeechPrefsFromStorage() {
  wahaChatSpeechOn.value = isWahaTtsEnabled()
  wahaDailyBriefingOn.value = isWahaDailyBriefingEnabled()
  wahaAutoRespondPhoneOn.value = isWahaAutoRespondPhoneEnabled()
  wahaAutoRespondWhereOn.value = isWahaAutoRespondWhereEnabled()
  wahaAutoRespondWhoAtOn.value = isWahaAutoRespondWhoAtEnabled()
}

function saveWahaAutoRespondPrefs() {
  void saveWahaPrefsToServer({
    chatId: wahaChatIdDraft.value.trim() || getWahaChatId(),
    ttsEnabled: wahaChatSpeechOn.value,
    dailyBriefingEnabled: wahaDailyBriefingOn.value,
    autoRespondPhoneEnabled: wahaAutoRespondPhoneOn.value,
    autoRespondWhereEnabled: wahaAutoRespondWhereOn.value,
    autoRespondWhoAtEnabled: wahaAutoRespondWhoAtOn.value,
  }).catch(() => {})
}

function onWahaAutoRespondPhoneToggle(enabled) {
  wahaAutoRespondPhoneOn.value = enabled
  setWahaAutoRespondPhoneEnabled(enabled)
  saveWahaAutoRespondPrefs()
}

function onWahaAutoRespondWhereToggle(enabled) {
  wahaAutoRespondWhereOn.value = enabled
  setWahaAutoRespondWhereEnabled(enabled)
  saveWahaAutoRespondPrefs()
}

function onWahaAutoRespondWhoAtToggle(enabled) {
  wahaAutoRespondWhoAtOn.value = enabled
  setWahaAutoRespondWhoAtEnabled(enabled)
  saveWahaAutoRespondPrefs()
}

function onWahaChatSpeechToggle(enabled) {
  wahaChatSpeechOn.value = enabled
  setWahaTtsEnabled(enabled)
  void saveWahaPrefsToServer({
    chatId: wahaChatIdDraft.value.trim() || getWahaChatId(),
    ttsEnabled: enabled,
    dailyBriefingEnabled: wahaDailyBriefingOn.value,
  }).catch(() => {})
}

function onWahaDailyBriefingToggle(enabled) {
  wahaDailyBriefingOn.value = enabled
  setWahaDailyBriefingEnabled(enabled)
  void saveWahaPrefsToServer({
    chatId: wahaChatIdDraft.value.trim() || getWahaChatId(),
    ttsEnabled: wahaChatSpeechOn.value,
    dailyBriefingEnabled: enabled,
  }).catch(() => {})
}

async function sendWahaMessage() {
  const text = wahaSendText.value.trim()
  if (!text) return
  setWahaBaseUrl(wahaUrlDraft.value)
  setWahaApiKey(wahaApiKeyDraft.value)
  wahaSendMsg.value = 'Sending…'
  try {
    const r = await sendChatMessage(text)
    if (r.ok) {
      wahaSendMsg.value = 'Sent.'
      wahaSendText.value = ''
    } else {
      wahaSendMsg.value = wahaAuthErrorHint(r.status) || `Failed (${r.status}).`
    }
  } catch (e) {
    wahaSendMsg.value = e instanceof Error ? e.message : String(e)
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
      includeOpenrouterApiKey: true,
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
      loadedWorkWeekStartDay.value = workWeekStartDay.value
    }
    {
      const we =
        typeof credMeta.value.workWeekEndDay === 'number' ? credMeta.value.workWeekEndDay : 6
      workWeekEndDay.value = Math.min(6, Math.max(0, Math.floor(we)))
      loadedWorkWeekEndDay.value = workWeekEndDay.value
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
    federalHolidayMileage15xEnabled.value =
      credMeta.value.federalHolidayMileage15xEnabled !== false
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
    const ork =
      typeof credMeta.value.openrouterApiKey === 'string'
        ? credMeta.value.openrouterApiKey.trim()
        : ''
    if (ork) setOpenrouterApiKey(ork)
    openrouterApiDraft.value = openrouterApiKeyOverride.value
    const orm =
      typeof credMeta.value.openrouterModel === 'string'
        ? credMeta.value.openrouterModel.trim()
        : ''
    if (orm) {
      setOpenrouterModel(orm)
      openrouterModelDraft.value = sanitizeOpenrouterModel(orm)
    }
    gwbUpperCamYoutubeDraft.value =
      typeof credMeta.value.gwbUpperCamYoutubeUrl === 'string'
        ? credMeta.value.gwbUpperCamYoutubeUrl
        : ''
    smtpEnabled.value = credMeta.value.smtpEnabled === true
    smtpHostDraft.value = String(credMeta.value.smtpHost ?? '')
    smtpPortDraft.value =
      typeof credMeta.value.smtpPort === 'number' ? credMeta.value.smtpPort : 587
    smtpSecureDraft.value = credMeta.value.smtpSecure === true
    smtpUserDraft.value = String(credMeta.value.smtpUser ?? '')
    smtpPassDraft.value =
      credMeta.value.smtpPassword === '••••' ? '••••' : ''
    smtpFromEmailDraft.value = String(credMeta.value.smtpFromEmail ?? '')
    smtpFromNameDraft.value = String(credMeta.value.smtpFromName ?? 'TripBuddy')
    emailNotifyToDraft.value = String(credMeta.value.emailNotifyTo ?? '')
    emailTimezoneDraft.value = String(
      credMeta.value.emailTimezone ?? 'America/New_York',
    )
    emailOnNewTrip.value = credMeta.value.emailOnNewTrip !== false
    emailOnPreplan.value = credMeta.value.emailOnPreplan !== false
    emailOnStatusChange.value = credMeta.value.emailOnStatusChange === true
    emailOnDriverMismatch.value = credMeta.value.emailOnDriverMismatch === true
    emailOnDispatchInstructions.value = credMeta.value.emailOnDispatchInstructions === true
    emailOnDailyShift.value = credMeta.value.emailOnDailyShift !== false
    emailOnWeeklySummary.value = credMeta.value.emailOnWeeklySummary !== false
    emailTripCcDraft.value = String(credMeta.value.emailTripCc ?? '')
    emailDailyShiftCcDraft.value = String(credMeta.value.emailDailyShiftCc ?? '')
    emailWeeklySummaryCcDraft.value = String(credMeta.value.emailWeeklySummaryCc ?? '')
    applyHelpersLocationPrefsFromCredentials(credMeta.value)
    applyWahaPrefsFromCredentials(credMeta.value)
    applyBlueBubblesPrefsFromCredentials(credMeta.value)
    wahaChatIdDraft.value = getWahaChatId()
    bbUrlDraft.value = getBlueBubblesUrlForSettings()
    bbPasswordDraft.value = getBlueBubblesPasswordForSettings()
    if (typeof credMeta.value?.blueBubblesWebhookToken === 'string' && credMeta.value.blueBubblesWebhookToken) {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      bbWebhookUrl.value = `${origin}/api/bluebubbles/webhook/${credMeta.value.blueBubblesWebhookToken}`
    }
    syncWahaSpeechPrefsFromStorage()
    syncHelpersPrefsFromStorage()
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
    const workWeekChanged =
      workWeekStartDay.value !== loadedWorkWeekStartDay.value ||
      workWeekEndDay.value !== loadedWorkWeekEndDay.value
    const body = {
      username: credUser.value,
      password: credPass.value || undefined,
      tractorNumber: credTractor.value,
      driverPhone: phoneDigits.value,
      workWeekStartDay: workWeekStartDay.value,
      workWeekEndDay: workWeekEndDay.value,
      shiftStartMins: ssm,
      shiftEndMins: sem,
      federalHolidayMileage15xEnabled: federalHolidayMileage15xEnabled.value,
      linehaulPollMinutes: Math.max(
        0,
        Math.min(LINEHAUL_POLL_MAX, Math.floor(Number(credPollMinutes.value) || 0)),
      ),
    }
    if (workWeekChanged) {
      const retroDate = String(workWeekRetroactiveDate.value ?? '').trim()
      if (retroDate && /^\d{4}-\d{2}-\d{2}$/.test(retroDate)) {
        const anchor = Date.parse(`${retroDate}T12:00:00`)
        body.workWeekChangeEffectiveFromMs = workWeekStartMsForAnchorDate(
          anchor,
          workWeekStartDay.value,
        )
        body.workWeekRetroactiveApply = true
      } else {
        body.workWeekChangeEffectiveFromMs = workWeekChangeEffectiveFromMs(
          Date.now(),
          workWeekStartDay.value,
        )
      }
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
    loadedWorkWeekStartDay.value = workWeekStartDay.value
    loadedWorkWeekEndDay.value = workWeekEndDay.value
    const usedRetroDate = Boolean(String(workWeekRetroactiveDate.value ?? '').trim())
    workWeekRetroactiveDate.value = ''
    credMsg.value = workWeekChanged
      ? usedRetroDate
        ? 'Saved. Work week schedule recalculated from the date you picked forward.'
        : 'Saved. Work week change applies from this week forward; older weeks are unchanged.'
      : 'Saved'
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
    setOpenrouterApiKey('')
    openrouterApiDraft.value = ''
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
  startLinehaulBearerCaptureOverlay()
  let captureOverlayOk = false
  try {
    const result = await postLinehaulCaptureBearer({
      headless: true,
      tryOktaLogin: true,
      clearSession: true,
      bypassValidityProbe: true,
    })
    captureOverlayOk = true
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
    finishLinehaulBearerCaptureOverlay(captureOverlayOk)
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
const trafficExportBusy = ref(false)
const trafficExportMsg = ref('')
const trafficExportError = ref('')

async function downloadBridgeTrafficExport() {
  if (trafficExportBusy.value) return
  trafficExportBusy.value = true
  trafficExportMsg.value = ''
  trafficExportError.value = ''
  try {
    const data = await getBridgeTrafficExport()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `bridge-traffic-export-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    trafficExportMsg.value = 'Export downloaded.'
  } catch (e) {
    trafficExportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    trafficExportBusy.value = false
  }
}

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

// Trip history CSV export / import
// ---------------------------------------------------------------------------

const tripHistoryExportBusy = ref(false)
const tripHistoryExportMsg = ref('')
const tripHistoryExportError = ref('')
const tripHistoryImportFile = ref(null)
const tripHistoryImportBusy = ref(false)
const tripHistoryImportMsg = ref('')
const tripHistoryImportError = ref('')
/** @type {import('vue').Ref<'merge' | 'replace'>} */
const tripHistoryImportMode = ref('merge')
/** @type {import('vue').Ref<{ total: number, importable: number, errors: string[], preview: Array<{ id: string, leg: string, origin: string, destination: string }> } | null>} */
const tripHistoryImportPreview = ref(null)

async function exportTripHistoryCsv() {
  if (tripHistoryExportBusy.value) return
  tripHistoryExportBusy.value = true
  tripHistoryExportMsg.value = ''
  tripHistoryExportError.value = ''
  try {
    const a = await getAssignment()
    const ledger = Array.isArray(a?.tripHistoryLedger) ? a.tripHistoryLedger : []
    const csv = exportTripHistoryToCsv(ledger)
    const stamp = new Date().toISOString().slice(0, 10)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = `tripbuddy-trip-history-${stamp}.csv`
    document.body.appendChild(el)
    el.click()
    el.remove()
    URL.revokeObjectURL(url)
    tripHistoryExportMsg.value = `Exported ${ledger.length} trip${ledger.length === 1 ? '' : 's'} to CSV.`
  } catch (e) {
    tripHistoryExportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    tripHistoryExportBusy.value = false
  }
}

function onTripHistoryCsvSelected(event) {
  tripHistoryImportMsg.value = ''
  tripHistoryImportError.value = ''
  tripHistoryImportPreview.value = null
  const file = event.target?.files?.[0]
  if (!file) {
    tripHistoryImportFile.value = null
    return
  }
  tripHistoryImportFile.value = file
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const text = e.target?.result
      if (typeof text !== 'string') throw new Error('Failed to read file')
      const { entries, errors, totalRows } = parseTripHistoryFromCsv(text)
      tripHistoryImportPreview.value = {
        total: totalRows,
        importable: entries.length,
        errors: errors.slice(0, 8),
        preview: tripHistoryCsvPreviewRows(entries),
      }
      if (entries.length === 0 && errors.length > 0) {
        tripHistoryImportError.value = errors[0]
      }
    } catch (err) {
      tripHistoryImportError.value = err instanceof Error ? err.message : String(err)
      tripHistoryImportPreview.value = null
    }
  }
  reader.onerror = () => {
    tripHistoryImportError.value = 'Failed to read CSV file'
    tripHistoryImportPreview.value = null
  }
  reader.readAsText(file)
}

async function importTripHistoryCsv() {
  if (!tripHistoryImportFile.value || tripHistoryImportBusy.value) return
  tripHistoryImportBusy.value = true
  tripHistoryImportMsg.value = ''
  tripHistoryImportError.value = ''
  try {
    const text = await tripHistoryImportFile.value.text()
    const { entries, errors } = parseTripHistoryFromCsv(text)
    if (entries.length === 0) {
      tripHistoryImportError.value =
        errors[0] || 'No valid trip rows found (each row needs an id or leg number)'
      return
    }
    if (errors.length > 0 && tripHistoryImportMode.value === 'replace') {
      tripHistoryImportError.value = `Fix ${errors.length} row error(s) before replace import`
      return
    }
    const a = await getAssignment()
    const existing = Array.isArray(a?.tripHistoryLedger) ? a.tripHistoryLedger : []
    const nextLedger =
      tripHistoryImportMode.value === 'replace'
        ? entries
        : mergeTripHistoryLedgers(existing, entries)
    await putAssignment({ tripHistoryLedger: nextLedger })
    const skippedNote = errors.length > 0 ? ` (${errors.length} row(s) skipped)` : ''
    tripHistoryImportMsg.value =
      tripHistoryImportMode.value === 'replace'
        ? `Replaced trip history with ${entries.length} trip${entries.length === 1 ? '' : 's'}.${skippedNote}`
        : `Imported ${entries.length} trip${entries.length === 1 ? '' : 's'} (merged by id). History now has ${nextLedger.length} trip${nextLedger.length === 1 ? '' : 's'}.${skippedNote}`
    tripHistoryImportFile.value = null
    tripHistoryImportPreview.value = null
  } catch (e) {
    tripHistoryImportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    tripHistoryImportBusy.value = false
  }
}

function clearTripHistoryCsvImport() {
  tripHistoryImportFile.value = null
  tripHistoryImportPreview.value = null
  tripHistoryImportMsg.value = ''
  tripHistoryImportError.value = ''
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
  void refreshUiBuildLabel()
  await loadCredentials()
  void loadEmailTestKinds()
  await loadAssignmentState()
  tomtomTrafficDraft.value = trafficTomtomKeyOverride.value
  hereApiDraft.value = hereApiKeyOverride.value
  ny511ApiDraft.value = ny511ApiKeyOverride.value
  openrouterApiDraft.value = openrouterApiKeyOverride.value
  openrouterModelDraft.value = sanitizeOpenrouterModel(
    openrouterModelEffective.value || OPENROUTER_DEFAULT_MODEL,
  )
  syncWahaSpeechPrefsFromStorage()
  applySettingsRouteFragment()
})

watch(() => route.hash, () => applySettingsRouteFragment())

watch(
  () => route.query.tab,
  (tab) => {
    if (tab === 'whatsapp') settingsTab.value = 'whatsapp'
    if (tab === 'imessage') settingsTab.value = 'imessage'
  },
  { immediate: true },
)

watch(settingsTab, (tab) => {
  if (tab === 'automation') {
    settingsTab.value = 'general'
    return
  }
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
  if (tab === 'devices') {
    void loadDevices()
  }
  if (tab === 'directory') {
    void loadDirectoryStats()
  }
  if (tab === 'helpers') {
    helpersProximityMsg.value = ''
    syncHelpersPrefsFromStorage()
    syncWahaSpeechPrefsFromStorage()
  }
})

onUnmounted(() => {
  unregisterRecover()
})

</script>

<template>
  <div class="shell">
    <div
      ref="settingsTabsEl"
      class="settings-tabs"
      role="tablist"
      aria-label="Settings sections"
      @wheel="onSettingsTabsWheel"
    >
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
        :aria-selected="settingsTab === 'email'"
        :class="{ active: settingsTab === 'email' }"
        @click="settingsTab = 'email'"
      >
        Email
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
        :aria-selected="settingsTab === 'devices'"
        :class="{ active: settingsTab === 'devices' }"
        @click="settingsTab = 'devices'"
      >
        Devices
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
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'traffic'"
        :class="{ active: settingsTab === 'traffic' }"
        @click="settingsTab = 'traffic'"
      >
        Traffic
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'whatsapp'"
        :class="{ active: settingsTab === 'whatsapp' }"
        @click="settingsTab = 'whatsapp'"
      >
        WhatsApp
      </button>
      <button
        type="button"
        class="tab-btn tap"
        role="tab"
        :aria-selected="settingsTab === 'imessage'"
        :class="{ active: settingsTab === 'imessage' }"
        @click="settingsTab = 'imessage'"
      >
        iMessage
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
          The end day is the <strong>last calendar day</strong> in each work block (e.g. Thu–Tue = Thu through Tue, six days).
        </p>
        <div v-if="workWeekStartDay !== loadedWorkWeekStartDay || workWeekEndDay !== loadedWorkWeekEndDay" class="work-week-retro">
          <label class="lbl" for="work-week-retro-date">Schedule starts (optional)</label>
          <input
            id="work-week-retro-date"
            v-model="workWeekRetroactiveDate"
            class="inp tap"
            type="date"
          />
          <p class="cred-hint">
            Pick the <strong>first day of the work week</strong> when this schedule began (e.g. a Thursday for Thu–Tue).
            History and pay totals from that week forward will regroup. Leave blank to apply from the current week only.
          </p>
        </div>
        <div class="history-federal-holiday-setting">
          <div class="history-federal-holiday-setting__head">
            <label class="lbl history-federal-holiday-setting__title" for="federal-holiday-mileage-switch">
              Federal holiday 1.5× mileage
            </label>
            <button
              id="federal-holiday-mileage-switch"
              type="button"
              class="history-federal-holiday-setting__switch tap"
              role="switch"
              :aria-checked="federalHolidayMileage15xEnabled"
              title="Show smart approval on History trips assigned, dispatched, or arrived on a US federal holiday"
              @click="federalHolidayMileage15xEnabled = !federalHolidayMileage15xEnabled"
            >
              <span class="history-federal-holiday-setting__thumb" aria-hidden="true" />
            </button>
          </div>
          <p class="cred-hint">
            When enabled, History shows an in-card option to manually approve <strong>1.5× billable
            mileage</strong> on federal holidays. Approved trips include
            <strong>federal holiday 1.5x multiplier</strong> in week PDF notes. Save credentials to
            apply.
          </p>
        </div>

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

      <SettingsSection title="Trip history backup (CSV)">
        <p class="cred-hint">
          Export your full trip history ledger for backup or editing. Each row includes every stored
          field — timestamps, outcomes, audit buckets, and complete
          <code>dispatchHeader</code> / <code>tripDetails</code> JSON (trailers, dollies, mileage,
          tractor, seals, etc.). Re-import to merge by trip id or replace the entire history.
        </p>
        <p v-if="tripHistoryExportError" class="cred-msg cred-msg--error">{{ tripHistoryExportError }}</p>
        <p v-else-if="tripHistoryExportMsg" class="cred-msg">{{ tripHistoryExportMsg }}</p>
        <button
          type="button"
          class="btn secondary tap"
          :disabled="tripHistoryExportBusy"
          @click="exportTripHistoryCsv"
        >
          {{ tripHistoryExportBusy ? 'Preparing export…' : 'Export trip history CSV' }}
        </button>

        <div class="csv-import-area trip-history-csv-import">
          <p class="cred-hint trip-history-import-heading">Import trip history</p>
          <div class="trip-history-import-mode">
            <label class="trip-history-import-mode-opt">
              <input v-model="tripHistoryImportMode" type="radio" value="merge" />
              Merge — update matching ids, keep other trips
            </label>
            <label class="trip-history-import-mode-opt">
              <input v-model="tripHistoryImportMode" type="radio" value="replace" />
              Replace — use only trips from this file
            </label>
          </div>
          <label class="csv-file-label">
            <input
              type="file"
              accept=".csv,text/csv"
              class="csv-file-input"
              @change="onTripHistoryCsvSelected"
            />
            <span class="btn secondary tap">{{
              tripHistoryImportFile ? 'Change file' : 'Select trip history CSV'
            }}</span>
          </label>
          <p v-if="tripHistoryImportFile" class="csv-file-name">{{ tripHistoryImportFile.name }}</p>
          <div v-if="tripHistoryImportPreview" class="csv-preview">
            <p class="csv-preview-summary">
              <strong>{{ tripHistoryImportPreview.importable }}</strong> of
              {{ tripHistoryImportPreview.total }} data rows will be imported
              <span v-if="tripHistoryImportPreview.errors.length" class="csv-preview-skip-note">
                ({{ tripHistoryImportPreview.errors.length }} row error(s) shown below)
              </span>
            </p>
            <ul
              v-if="tripHistoryImportPreview.errors.length"
              class="trip-history-import-errors"
            >
              <li v-for="(err, i) in tripHistoryImportPreview.errors" :key="i">{{ err }}</li>
            </ul>
            <p v-if="tripHistoryImportPreview.preview.length" class="csv-preview-label">
              Preview (first 5):
            </p>
            <ul v-if="tripHistoryImportPreview.preview.length" class="csv-preview-list">
              <li v-for="item in tripHistoryImportPreview.preview" :key="item.id">
                <strong>{{ item.leg || item.id }}</strong>
                <span v-if="item.origin || item.destination">
                  — {{ item.origin }} → {{ item.destination }}
                </span>
              </li>
            </ul>
          </div>
          <p v-if="tripHistoryImportError" class="csv-import-error">{{ tripHistoryImportError }}</p>
          <p v-if="tripHistoryImportMsg" class="csv-import-msg">{{ tripHistoryImportMsg }}</p>
          <div v-if="tripHistoryImportFile && tripHistoryImportPreview" class="csv-import-actions">
            <button
              type="button"
              class="btn tap"
              :disabled="tripHistoryImportBusy || !tripHistoryImportPreview?.importable"
              @click="importTripHistoryCsv"
            >
              {{ tripHistoryImportBusy ? 'Importing…' : 'Import trip history' }}
            </button>
            <button
              type="button"
              class="btn ghost tap"
              :disabled="tripHistoryImportBusy"
              @click="clearTripHistoryCsvImport"
            >
              Clear
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="API" section-id="settings-api">
        <p v-if="uiBuildLabel" class="cred-hint api-build-label">App build: {{ uiBuildLabel }}</p>
        <!-- TomTom -->
        <h4 class="api-sub-heading">TomTom Traffic</h4>
        <p class="cred-hint">
          Traffic map overlay + Corridors route monitoring.
          <a href="https://developer.tomtom.com/" target="_blank" rel="noopener noreferrer" class="ext-link">Free developer key</a>
        </p>
        <div class="api-key-row">
          <label class="lbl api-key-lbl" for="tomtom-traffic-key">TomTom</label>
          <input
            id="tomtom-traffic-key"
            v-model="tomtomTrafficDraft"
            class="inp tap api-key-inp"
            type="password"
            autocomplete="off"
            placeholder="API key"
          />
          <button type="button" class="btn primary tap api-key-save" :disabled="tomtomTrafficBusy" @click="saveTomtomTrafficKey">
            {{ tomtomTrafficBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p class="api-key-foot">
          <span class="cred-hint">Status: {{ trafficTomtomKeyOverride ? 'saved' : 'empty' }}</span>
          <span v-if="tomtomTrafficMsg" class="cred-msg">{{ tomtomTrafficMsg }}</span>
        </p>

        <!-- HERE -->
        <h4 class="api-sub-heading">HERE Traffic</h4>
        <p class="cred-hint">
          Corridors traffic flow monitoring.
          <a href="https://platform.here.com/" target="_blank" rel="noopener noreferrer" class="ext-link">Free HERE platform key</a>
        </p>
        <div class="api-key-row">
          <label class="lbl api-key-lbl" for="here-api-key">HERE</label>
          <input
            id="here-api-key"
            v-model="hereApiDraft"
            class="inp tap api-key-inp"
            type="password"
            autocomplete="off"
            placeholder="API key"
          />
          <button type="button" class="btn primary tap api-key-save" :disabled="hereApiBusy" @click="saveHereApiKey">
            {{ hereApiBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p class="api-key-foot">
          <span class="cred-hint">Status: {{ hereApiKeyOverride ? 'saved' : 'empty' }}</span>
          <span v-if="hereApiMsg" class="cred-msg">{{ hereApiMsg }}</span>
        </p>

        <!-- 511NY -->
        <h4 class="api-sub-heading">511NY</h4>
        <p class="cred-hint">
          Bridge cameras + NY511 traffic events.
          <a href="https://511ny.org/my511/register" target="_blank" rel="noopener noreferrer" class="ext-link">Free 511NY key</a>
        </p>
        <div class="api-key-row">
          <label class="lbl api-key-lbl" for="ny511-api-key">511NY</label>
          <input
            id="ny511-api-key"
            v-model="ny511ApiDraft"
            class="inp tap api-key-inp"
            type="password"
            autocomplete="off"
            placeholder="API key"
          />
          <button type="button" class="btn primary tap api-key-save" :disabled="ny511ApiBusy" @click="saveNy511ApiKey">
            {{ ny511ApiBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p class="api-key-foot">
          <span class="cred-hint">Status: {{ ny511ApiKeyOverride ? 'saved' : 'empty' }}</span>
          <span v-if="ny511ApiMsg" class="cred-msg">{{ ny511ApiMsg }}</span>
        </p>

        <!-- OpenRouter -->
        <h4 class="api-sub-heading">OpenRouter</h4>
        <p class="cred-hint">
          Powers the <strong>Brief</strong> button on the Chat page (spoken summary of the last 2 days).
          <a href="https://openrouter.ai/" target="_blank" rel="noopener noreferrer" class="ext-link">OpenRouter API key</a>
        </p>
        <div class="api-key-row">
          <label class="lbl api-key-lbl" for="openrouter-api-key">OpenRouter</label>
          <input
            id="openrouter-api-key"
            v-model="openrouterApiDraft"
            class="inp tap api-key-inp"
            type="password"
            autocomplete="off"
            placeholder="API key"
          />
          <button type="button" class="btn primary tap api-key-save" :disabled="openrouterApiBusy" @click="saveOpenrouterApiKey">
            {{ openrouterApiBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <div class="api-key-row api-key-row--model">
          <label class="lbl api-key-lbl" for="openrouter-model">AI model</label>
          <OpenRouterModelPicker
            v-model="openrouterModelDraft"
            input-id="openrouter-model"
            :disabled="openrouterApiBusy"
          />
          <button type="button" class="btn primary tap api-key-save" :disabled="openrouterApiBusy" @click="saveOpenrouterApiKey">
            {{ openrouterApiBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p class="cred-hint api-model-hint">
          Search the live OpenRouter catalog (text models). Pick from the list or type a model id such as
          <code>openai/gpt-4o-mini</code>.
        </p>
        <p class="api-key-foot">
          <span class="cred-hint">Status: {{ openrouterApiKeyOverride ? 'saved' : 'empty' }}</span>
          <span class="cred-hint">Model: {{ openrouterModelDraft || OPENROUTER_DEFAULT_MODEL }}</span>
          <span v-if="openrouterApiMsg" class="cred-msg">{{ openrouterApiMsg }}</span>
        </p>
        <details class="openrouter-prompt-details">
          <summary class="openrouter-prompt-summary">Briefing prompt (what we send to OpenRouter)</summary>
          <p class="cred-hint openrouter-prompt-note">
            System message plus a user message with today’s chat transcript
            (<code>[time] Sender: text</code> per line).
          </p>
          <pre class="openrouter-prompt-pre">{{ openrouterBriefingSystemPrompt }}</pre>
          <p class="cred-hint openrouter-prompt-user">
            User message template:
            <code>Chat: {chat name}</code> then
            <code>Today's messages:</code> and the transcript.
          </p>
        </details>

        <!-- GWB Camera -->
        <h4 class="api-sub-heading">GWB Upper Camera</h4>
        <p class="cred-hint">
          GWB upper deck live view (YouTube link).
        </p>
        <div class="api-key-row">
          <label class="lbl api-key-lbl" for="gwb-upper-cam-youtube-url">YouTube</label>
          <input
            id="gwb-upper-cam-youtube-url"
            v-model="gwbUpperCamYoutubeDraft"
            class="inp tap api-key-inp"
            type="url"
            autocomplete="off"
            placeholder="https://www.youtube.com/watch?v=…"
          />
          <button type="button" class="btn primary tap api-key-save" :disabled="gwbUpperCamYoutubeBusy" @click="saveGwbUpperCamYoutubeUrl">
            {{ gwbUpperCamYoutubeBusy ? 'Saving…' : 'Save' }}
          </button>
        </div>
        <p v-if="gwbUpperCamYoutubeMsg" class="api-key-foot cred-msg">{{ gwbUpperCamYoutubeMsg }}</p>

        <!-- Usage & Limits -->
        <h4 class="api-sub-heading">Usage &amp; Limits</h4>
        <p class="cred-hint">
          Outbound API calls counted per UTC day. HERE also capped monthly.
        </p>
        <p v-if="apiQuotaDayKey" class="cred-hint">
          UTC day: <strong>{{ apiQuotaDayKey }}</strong>
          <template v-if="apiQuotaMonthKey"> · Month: <strong>{{ apiQuotaMonthKey }}</strong></template>
        </p>
        <div v-if="apiQuotaRows.length" class="api-quota-table-wrap">
          <table class="api-quota-table">
            <thead>
              <tr>
                <th scope="col">API</th>
                <th scope="col">Today</th>
                <th scope="col">Limit</th>
                <th v-if="apiQuotaHasMonthCols" scope="col">Month</th>
                <th v-if="apiQuotaHasMonthCols" scope="col">Cap</th>
                <th scope="col">/min</th>
                <th scope="col">Max</th>
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
          <button type="button" class="btn tap" :disabled="apiQuotaBusy" @click="refreshApiQuota">Refresh</button>
          <button type="button" class="btn primary tap" :disabled="apiQuotaBusy" @click="saveApiQuotaLimitsFromUi">Save limits</button>
          <button type="button" class="btn tap" :disabled="apiQuotaBusy" @click="resetApiQuotaToday">Reset today</button>
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

      <div class="settings-sign-out-wrap">
        <button
          type="button"
          class="btn settings-sign-out-btn tap"
          :disabled="signOutBusy"
          aria-label="Sign out of app"
          @click="signOutApp"
        >
          {{ signOutBusy ? 'Signing out…' : 'Sign out' }}
        </button>
      </div>
    </main>

    <main v-show="settingsTab === 'helpers'" class="stack helpers-panel">
      <SettingsSection title="Location">
        <p class="helpers-lead">{{ helpersPermissionLabel }}</p>
        <p class="helpers-coords">{{ helpersCoordsLine }}</p>
        <p v-if="appGeoError" class="helpers-err">{{ appGeoError }}</p>
        <button
          type="button"
          class="btn tap"
          :disabled="helpersLocationBusy"
          @click="onHelpersRequestLocationTap"
        >
          {{ helpersLocationBusy ? 'Requesting…' : 'Refresh location' }}
        </button>
        <p class="helpers-hint">
          Background GPS for Dispatch and maps. Tap once on iOS if location stalls.
        </p>
      </SettingsSection>

      <SettingsSection title="Auto Arrive + Check-in">
        <p class="helpers-hint">
          When ENRT and leg remaining NM is at or below the trigger, runs Home Arrive then Check-in.
          Stay inside the zone ~40s with good GPS (blocks bad fixes).
        </p>
        <p v-if="helpersProximityMsg" class="cred-msg cred-msg--error">{{ helpersProximityMsg }}</p>
        <div class="api-key-row">
          <label class="lbl api-key-lbl" for="helpers-radius-nm">Trigger</label>
          <input
            id="helpers-radius-nm"
            v-model.number="helpersRadiusNm"
            class="inp tap api-key-inp"
            type="number"
            :min="HELPERS_RADIUS_NM_MIN"
            :max="HELPERS_RADIUS_NM_MAX"
            step="0.25"
            inputmode="decimal"
            :disabled="helpersProximityBusy"
            @blur="onHelpersRadiusBlur"
          />
          <div class="helpers-toggle-slot">
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="helpersAutoArriveEnabled"
                :disabled="helpersProximityBusy"
                @change="onHelpersProximityToggle($event.target.checked)"
              />
              <span class="toggle-slider"></span>
            </label>
            <span class="helpers-toggle-label">Enabled</span>
          </div>
        </div>
        <p class="api-key-foot">
          <span class="cred-hint">
            {{ HELPERS_RADIUS_NM_MIN }}–{{ HELPERS_RADIUS_NM_MAX }} NM · default 2 NM
          </span>
        </p>
      </SettingsSection>

      <SettingsSection title="WhatsApp speech">
        <p class="helpers-hint">
          Monitored chat is set under WhatsApp. Daily briefing needs an OpenRouter key in General → API.
        </p>
        <div class="audio-row">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="wahaChatSpeechOn"
              @change="onWahaChatSpeechToggle($event.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">Read new messages aloud</span>
        </div>
        <div class="audio-row">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="wahaDailyBriefingOn"
              @change="onWahaDailyBriefingToggle($event.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">AI chat briefing (Chat → Brief button)</span>
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

    <main v-show="settingsTab === 'email'" class="stack email-settings">
      <SettingsSection title="Email" section-id="settings-email" :collapsible="false">
        <p class="cred-hint email-intro">
          Gmail: <code>smtp.gmail.com</code>, port <code>587</code>, app password.
        </p>

        <label class="toggle-row tap email-master-toggle">
          <input v-model="smtpEnabled" type="checkbox" />
          <span>Enable email</span>
        </label>

        <template v-if="showEmailSmtpFields">
          <div class="email-panel">
            <h3 class="email-panel-title">Recipient</h3>
            <div class="email-fields email-fields--two-col">
              <div class="email-field">
                <label class="email-field-label" for="email-notify-to">Your email</label>
                <input
                  id="email-notify-to"
                  v-model="emailNotifyToDraft"
                  class="inp tap"
                  type="email"
                  autocomplete="email"
                  placeholder="you@gmail.com"
                />
              </div>
              <div class="email-field">
                <label class="email-field-label" for="email-timezone">Timezone</label>
                <input
                  id="email-timezone"
                  v-model="emailTimezoneDraft"
                  class="inp tap"
                  type="text"
                  placeholder="America/New_York"
                />
              </div>
            </div>
          </div>

          <div class="email-panel">
            <h3 class="email-panel-title">SMTP</h3>
            <div class="email-fields email-fields--two-col">
              <div class="email-field">
                <label class="email-field-label" for="smtp-host">Host</label>
                <input
                  id="smtp-host"
                  v-model="smtpHostDraft"
                  class="inp tap"
                  type="text"
                  autocomplete="off"
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div class="email-field email-field--port">
                <label class="email-field-label" for="smtp-port">Port</label>
                <div class="email-port-row">
                  <input
                    id="smtp-port"
                    v-model.number="smtpPortDraft"
                    class="inp tap email-port-inp"
                    type="number"
                    min="1"
                    max="65535"
                  />
                  <label class="email-port-ssl tap">
                    <input v-model="smtpSecureDraft" type="checkbox" />
                    <span>SSL (465)</span>
                  </label>
                </div>
              </div>
              <div class="email-field">
                <label class="email-field-label" for="smtp-user">Username</label>
                <input
                  id="smtp-user"
                  v-model="smtpUserDraft"
                  class="inp tap"
                  type="text"
                  autocomplete="username"
                  placeholder="you@gmail.com"
                />
              </div>
              <div class="email-field">
                <label class="email-field-label" for="smtp-pass">Password</label>
                <input
                  id="smtp-pass"
                  v-model="smtpPassDraft"
                  class="inp tap"
                  type="password"
                  autocomplete="new-password"
                  placeholder="App password"
                />
              </div>
              <div class="email-field">
                <label class="email-field-label" for="smtp-from-email">From email</label>
                <input
                  id="smtp-from-email"
                  v-model="smtpFromEmailDraft"
                  class="inp tap"
                  type="email"
                  autocomplete="off"
                />
              </div>
              <div class="email-field">
                <label class="email-field-label" for="smtp-from-name">From name</label>
                <input
                  id="smtp-from-name"
                  v-model="smtpFromNameDraft"
                  class="inp tap"
                  type="text"
                  autocomplete="off"
                />
              </div>
            </div>
          </div>

          <div class="email-panel">
            <h3 class="email-panel-title">Trip alerts</h3>
            <div class="email-toggle-grid">
              <label class="email-toggle tap">
                <input v-model="emailOnNewTrip" type="checkbox" />
                <span>New trip</span>
              </label>
              <label class="email-toggle tap">
                <input v-model="emailOnPreplan" type="checkbox" />
                <span>Preplan</span>
              </label>
              <label class="email-toggle tap">
                <input v-model="emailOnStatusChange" type="checkbox" />
                <span>Status updates</span>
              </label>
              <details class="email-more-toggles">
                <summary class="email-more-summary tap">More</summary>
                <div class="email-toggle-grid email-more-body">
                  <label class="email-toggle tap">
                    <input v-model="emailOnDriverMismatch" type="checkbox" />
                    <span>Driver / tractor mismatch</span>
                  </label>
                  <label class="email-toggle tap">
                    <input v-model="emailOnDispatchInstructions" type="checkbox" />
                    <span>Dispatch instructions</span>
                  </label>
                </div>
              </details>
            </div>
            <div v-if="showTripAlertCc" class="email-field email-field--cc">
              <label class="email-field-label" for="email-trip-cc">CC (trip alerts)</label>
              <input
                id="email-trip-cc"
                v-model="emailTripCcDraft"
                class="inp tap"
                type="text"
                autocomplete="email"
                placeholder="name@example.com, other@example.com"
              />
            </div>
          </div>

          <div class="email-panel email-panel--scheduled">
            <h3 class="email-panel-title">Scheduled reports</h3>
            <p class="email-field-note email-scheduled-note">
              Based on your shift schedule in credentials. End-of-shift summary sends after your shift
              ends when all trips are complete. Weekly PDFs send on your last work day, after shift ends
              and 2 hours with no new trips.
            </p>
            <div class="smtp-notify-toggles email-scheduled-toggles">
              <label class="toggle-row tap email-report-toggle">
                <input v-model="emailOnDailyShift" type="checkbox" />
                <span class="email-report-label">
                  <strong>End-of-shift summary</strong>
                  <small>After your shift ends each day</small>
                </span>
              </label>
              <label class="toggle-row tap email-report-toggle">
                <input v-model="emailOnWeeklySummary" type="checkbox" />
                <span class="email-report-label">
                  <strong>Weekly mileage PDFs</strong>
                  <small>Last work day of your week</small>
                </span>
              </label>
            </div>
            <div v-if="emailOnDailyShift" class="api-key-row email-scheduled-cc">
              <label class="lbl api-key-lbl" for="email-daily-cc">Also send daily report to</label>
              <input
                id="email-daily-cc"
                v-model="emailDailyShiftCcDraft"
                class="inp tap api-key-inp"
                type="text"
                autocomplete="email"
                placeholder="Optional — comma-separated emails"
              />
            </div>
            <div v-if="emailOnWeeklySummary" class="api-key-row email-scheduled-cc">
              <label class="lbl api-key-lbl" for="email-weekly-cc">Also send weekly PDFs to</label>
              <input
                id="email-weekly-cc"
                v-model="emailWeeklySummaryCcDraft"
                class="inp tap api-key-inp"
                type="text"
                autocomplete="email"
                placeholder="Optional — comma-separated emails"
              />
            </div>
          </div>
        </template>

        <div class="email-actions-bar">
          <button type="button" class="btn primary tap" :disabled="smtpBusy" @click="saveSmtpPrefs">
            {{ smtpBusy ? 'Saving…' : 'Save' }}
          </button>
          <div class="email-test-bar">
            <select
              id="smtp-test-kind"
              v-model="smtpTestKind"
              class="inp tap"
              aria-label="Test email template"
              :disabled="smtpTestBusy || smtpBusy || !smtpEnabled"
            >
              <option v-for="opt in smtpTestKindOptions" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
            <button
              type="button"
              class="btn secondary tap"
              :disabled="smtpTestBusy || smtpBusy || !smtpEnabled"
              @click="sendSmtpTest"
            >
              {{ smtpTestBusy ? 'Sending…' : 'Send test' }}
            </button>
          </div>
        </div>
        <p v-if="smtpMsg" class="cred-msg email-status-msg">{{ smtpMsg }}</p>
      </SettingsSection>
    </main>

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

        <div v-if="ttsEnabled && trailerNearbyOn" class="audio-near-trailer">
          <div class="audio-near-trailer-head">
            <label class="lbl audio-near-trailer-label" for="near-trailer-ft">Near-trailer radius</label>
            <span class="audio-near-trailer-value">{{ nearTrailerRadiusFeet }} ft</span>
          </div>
          <div class="audio-near-trailer-stepper">
            <button type="button" class="btn tap audio-step-btn" aria-label="Decrease radius by 10 feet" @click="stepNearTrailerFeet(-10)">−</button>
            <input
              id="near-trailer-ft"
              v-model.number="nearTrailerRadiusFeet"
              class="inp tap audio-near-trailer-slider"
              type="range"
              min="50"
              max="1500"
              step="10"
              aria-valuemin="50"
              aria-valuemax="1500"
              :aria-valuenow="nearTrailerRadiusFeet"
              @input="saveNearTrailerRadius"
              @change="saveNearTrailerRadius"
            />
            <button type="button" class="btn tap audio-step-btn" aria-label="Increase radius by 10 feet" @click="stepNearTrailerFeet(10)">+</button>
          </div>
          <p class="audio-near-trailer-hint">
            On the trailer map: “Approaching trailer …” at about {{ nearTrailerApproachFeet }} ft (3× this radius),
            then “You are near trailer …” inside {{ nearTrailerRadiusFeet }} ft. Open the map from a trailer card pin.
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

    <main v-show="settingsTab === 'devices'" class="stack devices-panel">
      <SettingsSection title="Registered devices" :collapsible="false">
        <p class="security-lead">
          Up to <strong>{{ devicesMaxSessions }}</strong> devices can be signed in at once (
          {{ signedInDeviceCount }} signed in now). Device name, OS, form factor, and browser are
          collected when you sign in (with consent) or register this device below.
        </p>
        <div class="devices-register-card">
          <h3 class="devices-register-title">This device</h3>
          <p class="cred-hint">
            {{ formatFormFactorLabel(currentDeviceInfo.formFactor) }} ·
            {{ currentDeviceInfo.os }} · {{ currentDeviceInfo.browser }}
          </p>
          <label class="lbl" for="device-name-draft">Device name</label>
          <input
            id="device-name-draft"
            v-model="deviceNameDraft"
            class="inp tap"
            type="text"
            maxlength="80"
            autocomplete="off"
            placeholder="e.g. Work laptop"
          />
          <button
            type="button"
            class="btn secondary tap"
            :disabled="deviceRegisterBusy"
            @click="registerCurrentDevice"
          >
            {{ deviceRegisterBusy ? 'Registering…' : 'Register / update this device' }}
          </button>
        </div>
        <p v-if="devicesLoading" class="cred-msg">Loading…</p>
        <p v-else-if="devicesError" class="cred-msg cred-msg--error">{{ devicesError }}</p>
        <p v-if="devicesMsg" class="cred-msg">{{ devicesMsg }}</p>
        <div v-if="!devicesLoading" class="devices-table-wrap">
          <table v-if="registeredDevices.length" class="devices-table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Type</th>
                <th scope="col">Last seen</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="device in registeredDevices" :key="device.id">
                <td>
                  <input
                    v-model="device.name"
                    class="inp devices-name-inp tap"
                    type="text"
                    maxlength="80"
                    :disabled="devicesBusyId === device.id"
                    @change="saveDeviceName(device)"
                  />
                  <span class="devices-meta">{{ device.os }} · {{ device.browser }}</span>
                </td>
                <td>{{ formatFormFactorLabel(device.formFactor) }}</td>
                <td>{{ formatDeviceWhen(device.lastSeenAt) }}</td>
                <td>
                  <span v-if="device.isCurrent" class="devices-badge devices-badge--current"
                    >This device</span
                  >
                  <span v-else-if="device.isSignedIn" class="devices-badge devices-badge--signed-in"
                    >Signed in</span
                  >
                  <span v-else class="devices-badge">Registered</span>
                </td>
                <td class="devices-actions">
                  <button
                    v-if="device.isSignedIn && !device.isCurrent"
                    type="button"
                    class="btn ghost tap"
                    :disabled="devicesBusyId === device.id"
                    @click="signOutDevice(device)"
                  >
                    Sign out
                  </button>
                  <button
                    v-if="!device.isCurrent"
                    type="button"
                    class="btn ghost tap"
                    :disabled="devicesBusyId === device.id"
                    @click="removeDevice(device)"
                  >
                    Remove
                  </button>
                  <span v-if="device.isCurrent" class="devices-meta">Use Sign out below</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="security-empty">No devices registered yet. Register this device above.</p>
        </div>
        <button type="button" class="btn ghost tap" @click="loadDevices">Refresh</button>
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

    <main v-show="settingsTab === 'traffic'" class="stack traffic-panel">
      <SettingsSection
        title="Crossing thresholds"
        section-id="settings-bridge-thresholds"
        :open="true"
      >
        <BridgeTrafficThresholdsEditor />
      </SettingsSection>

      <SettingsSection title="Bridge traffic history">
        <p class="cred-hint">
          Download the full crossing-time and speed series stored in Postgres (up to
          <strong>500 observations per route</strong>, not the 24-hour chart cap). Each series is one
          row in <code>crossingDatasets</code> with <code>displayName</code>,
          <code>bridgeName</code>, <code>travelDirectionLabel</code>, and <code>observations</code>.
        </p>
        <p v-if="trafficExportError" class="cred-msg cred-msg--error">{{ trafficExportError }}</p>
        <p v-else-if="trafficExportMsg" class="cred-msg">{{ trafficExportMsg }}</p>
        <button
          type="button"
          class="btn primary tap"
          :disabled="trafficExportBusy"
          @click="downloadBridgeTrafficExport"
        >
          {{ trafficExportBusy ? 'Preparing export…' : 'Export bridge traffic JSON' }}
        </button>
      </SettingsSection>
    </main>

    <main v-show="settingsTab === 'whatsapp'" class="stack whatsapp-panel">
      <SettingsSection title="WhatsApp Messenger" section-id="settings-whatsapp">
        <p class="cred-hint">
          Send and receive WhatsApp messages via
          <a href="https://github.com/devlikeapro/waha" target="_blank" rel="noopener noreferrer" class="ext-link">WAHA</a>.
          Pick a chat to monitor and send to; incoming messages can be read aloud via TTS.
          Deploy WAHA as a separate Dokploy service (<code>devlikeapro/waha</code> image) with
          <code>WAHA_API_KEY</code> set.
        </p>

        <h4 class="api-sub-heading" style="margin-top:0;padding-top:0;border-top:none">Connection</h4>
        <p v-if="wahaUsesServerProxy" class="cred-hint">
          Using the TripBuddy server proxy (<code>/api/waha</code>). Set on the TripBuddy container:
          <code>WAHA_BASE_URL</code> (internal WAHA URL, e.g. <code>http://waha:3000</code>) and
          <code>WAHA_API_KEY</code> (same plain key as on the WAHA service). No URL or key needed here.
        </p>
        <label class="lbl" for="waha-url">WAHA URL override (optional)</label>
        <input
          id="waha-url"
          v-model="wahaUrlDraft"
          class="inp tap"
          type="url"
          autocomplete="off"
          placeholder="Leave empty — use server proxy (recommended)"
        />
        <p class="cred-hint">
          Leave empty when WAHA is reached via TripBuddy’s proxy. Only set a public URL if the browser
          must call WAHA directly (you will also need the API key below).
        </p>
        <label class="lbl" for="waha-api-key">WAHA API key (direct URL only)</label>
        <input
          id="waha-api-key"
          v-model="wahaApiKeyDraft"
          class="inp tap"
          type="password"
          autocomplete="off"
          placeholder="Only if using a direct WAHA URL above"
          :disabled="wahaUsesServerProxy && !wahaUrlDraft.trim()"
        />
        <p class="cred-hint">
          WAHA expects the <code>X-Api-Key</code> header. When using the server proxy, configure
          <code>WAHA_API_KEY</code> on TripBuddy instead — the key is not stored in the browser.
        </p>
        <div class="btn-row">
          <button type="button" class="btn tap" @click="testWahaConnection">Check connection</button>
        </div>
        <p v-if="wahaConnMsg" class="cred-msg">{{ wahaConnMsg }}</p>
        <div v-if="wahaQrUrl" class="waha-qr-wrap">
          <img :src="wahaQrUrl" alt="WhatsApp QR code" class="waha-qr-img" />
        </div>

        <h4 class="api-sub-heading">Chat</h4>
        <label class="lbl" for="waha-chat-id">Chat ID</label>
        <input
          id="waha-chat-id"
          v-model="wahaChatIdDraft"
          class="inp tap"
          type="text"
          autocomplete="off"
          placeholder="120363…@g.us or 1555…@c.us"
        />
        <p class="cred-hint">
          Groups use <code>@g.us</code>, direct chats use <code>@c.us</code>. Use "List chats" below to pick one.
        </p>
        <div class="btn-row">
          <button type="button" class="btn primary tap" @click="saveWahaChat">Save chat</button>
          <button type="button" class="btn tap" :disabled="wahaChatsLoading" @click="loadWahaChats">
            {{ wahaChatsLoading ? 'Loading…' : 'List chats' }}
          </button>
        </div>
        <p v-if="wahaChatMsg" class="cred-msg">{{ wahaChatMsg }}</p>
        <div v-if="wahaChatsList.length" class="waha-chats-list">
          <button
            v-for="c in wahaChatsList"
            :key="c.id"
            type="button"
            class="waha-chat-item tap"
            :class="{ 'is-active': c.id === wahaChatIdDraft }"
            @click="selectWahaChat(c)"
          >
            <span class="waha-chat-name">{{ c.name || c.id }}</span>
            <span class="waha-chat-meta">
              <span class="waha-chat-kind">{{ wahaChatKindLabel(c.kind) }}</span>
              <span class="waha-chat-id">{{ c.id }}</span>
            </span>
          </button>
        </div>

        <h4 class="api-sub-heading">Auto-replies</h4>
        <p class="cred-hint">
          Reply automatically to <strong>new</strong> incoming messages only (not chat history).
          Locations are matched from your shared directory by <strong>ID</strong> (e.g. 89),
          <strong>name</strong> (e.g. Woodbridge), or <strong>abbreviation</strong> (e.g. WOOD).
          “Who’s at” uses tractor location + en-route GPS.
        </p>
        <div class="waha-toggle-row">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="wahaAutoRespondPhoneOn"
              @change="onWahaAutoRespondPhoneToggle($event.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">Phone / number for a location</span>
        </div>
        <ul class="waha-auto-examples" aria-label="Phone auto-reply examples">
          <li><span class="waha-ex-q">What's the number for Woodbridge?</span> → <span class="waha-ex-a">For 89 WOODBRIDGE you can try this number (732) 512-5528.</span></li>
          <li><span class="waha-ex-q">phone for WOOD</span> → <span class="waha-ex-a">For 89 WOODBRIDGE you can try this number …</span></li>
          <li><span class="waha-ex-q">3117 number?</span> → <span class="waha-ex-a">For 3117 … you can try this number …</span></li>
        </ul>
        <div class="waha-toggle-row">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="wahaAutoRespondWhereOn"
              @change="onWahaAutoRespondWhereToggle($event.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">Where is a location (address from directory)</span>
        </div>
        <ul class="waha-auto-examples" aria-label="Where auto-reply examples">
          <li><span class="waha-ex-q">where is Woodbridge?</span> → <span class="waha-ex-a">For 89 WOODBRIDGE, the address is 6000 RIVERSIDE DR…</span></li>
          <li><span class="waha-ex-q">where's WOOD?</span> → <span class="waha-ex-a">For 89 WOODBRIDGE, the address is …</span></li>
          <li><span class="waha-ex-q">location of 89</span> → <span class="waha-ex-a">For 89 WOODBRIDGE, the address is …</span></li>
        </ul>
        <div class="waha-toggle-row">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="wahaAutoRespondWhoAtOn"
              @change="onWahaAutoRespondWhoAtToggle($event.target.checked)"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="audio-row-label">Who’s at a location (I’m there / miles away)</span>
        </div>
        <ul class="waha-auto-examples" aria-label="Who's at auto-reply examples">
          <li><span class="waha-ex-q">who's at Woodbridge?</span> → <span class="waha-ex-a">I'm at 89 WOODBRIDGE right now.</span> <span class="waha-ex-note">(tractor at station)</span></li>
          <li><span class="waha-ex-q">who's at WOOD?</span> → <span class="waha-ex-a">I'm about 12 mi away from 89 WOODBRIDGE.</span> <span class="waha-ex-note">(en route)</span></li>
          <li><span class="waha-ex-q">anyone at 89?</span> → <span class="waha-ex-a">I'm at 89 WOODBRIDGE right now.</span> or miles-away reply</li>
        </ul>

        <div class="waha-send-row">
          <input
            v-model="wahaSendText"
            class="inp tap waha-send-input"
            type="text"
            placeholder="Type a message to the chat…"
            @keydown.enter.prevent="sendWahaMessage"
          />
          <button type="button" class="btn primary tap" :disabled="!wahaSendText.trim()" @click="sendWahaMessage">
            Send
          </button>
        </div>
        <p v-if="wahaSendMsg" class="cred-msg">{{ wahaSendMsg }}</p>
      </SettingsSection>
    </main>

    <main v-show="settingsTab === 'imessage'" class="stack imessage-panel">
      <SettingsSection title="iMessage (BlueBubbles)" section-id="settings-imessage">
        <p class="cred-hint">
          Connect to your
          <a href="https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks" target="_blank" rel="noopener noreferrer" class="ext-link">BlueBubbles</a>
          server for Open Bubbles / iMessage. All conversations appear in Chats → iMessage.
          Per-contact speech and auto-reply settings are configured inside each conversation.
        </p>

        <h4 class="api-sub-heading" style="margin-top:0;padding-top:0;border-top:none">Connection</h4>
        <p class="cred-hint">
          Your Mac's BlueBubbles URL and password are stored on TripBuddy and forwarded through the
          server proxy (<code>/api/bluebubbles</code>) — the browser never calls BlueBubbles directly.
        </p>
        <p v-if="bbUsesServerProxy && !bbUrlDraft.trim()" class="cred-hint">
          Optional: set <code>BLUEBUBBLES_BASE_URL</code> and <code>BLUEBUBBLES_PASSWORD</code> on the
          TripBuddy container instead of entering them here.
        </p>
        <label class="lbl" for="bb-url">BlueBubbles server URL</label>
        <input
          id="bb-url"
          v-model="bbUrlDraft"
          class="inp tap"
          type="url"
          autocomplete="off"
          placeholder="https://your-mac.trycloudflare.com"
        />
        <label class="lbl" for="bb-password">Server password</label>
        <input
          id="bb-password"
          v-model="bbPasswordDraft"
          class="inp tap"
          type="password"
          autocomplete="off"
          placeholder="BlueBubbles API password"
        />
        <div class="btn-row">
          <button type="button" class="btn tap" @click="testBlueBubblesConnection">Check connection</button>
          <button type="button" class="btn primary tap" @click="saveBlueBubblesSettings">Save settings</button>
          <button type="button" class="btn tap" @click="registerBbWebhook">Register webhook</button>
        </div>
        <p v-if="bbConnMsg" class="cred-msg">{{ bbConnMsg }}</p>
        <p v-if="bbSaveMsg" class="cred-msg">{{ bbSaveMsg }}</p>
        <p v-if="bbWebhookUrl" class="cred-hint">
          Webhook URL (add in BlueBubbles → API &amp; Webhooks if auto-register fails):<br />
          <code>{{ bbWebhookUrl }}</code>
        </p>
        <p class="cred-hint">
          OpenRouter auto-replies require an API key in Settings → General → API. Enable speech or
          auto-reply per contact from the ⚡ button inside each iMessage conversation.
        </p>
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
.history-federal-holiday-setting {
  margin: var(--space-4, 1rem) 0;
  padding: var(--space-4, 1rem);
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
  background: var(--surface-raised, rgba(255, 255, 255, 0.04));
}

.history-federal-holiday-setting__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3, 0.75rem);
  margin-bottom: var(--space-2, 0.5rem);
}

.history-federal-holiday-setting__title {
  margin: 0;
}

.history-federal-holiday-setting__switch {
  position: relative;
  width: 2.75rem;
  height: 1.5rem;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
}

.history-federal-holiday-setting__switch[aria-checked='true'] {
  background: var(--accent, #6ea8fe);
}

.history-federal-holiday-setting__thumb {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}

.history-federal-holiday-setting__switch[aria-checked='true'] .history-federal-holiday-setting__thumb {
  transform: translateX(1.25rem);
}

.cred-hint {
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.4;
  color: var(--color-text-tertiary, #6e6e7e);
  margin: 0 0 0.5rem;
  max-width: 36rem;
}
.api-sub-heading {
  margin: 1.1rem 0 0.35rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: 0.02em;
}
.api-sub-heading:first-of-type {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}
.api-key-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-1, 0.25rem);
}
.api-key-lbl {
  flex: 0 0 4.75rem;
  margin-bottom: 0;
  font-size: var(--text-sm, 0.8125rem);
}
.api-key-inp {
  flex: 1 1 10rem;
  min-width: 0;
  width: auto;
  margin-bottom: 0;
}
.api-key-save {
  flex: 0 0 auto;
  min-height: var(--touch-target, 2.75rem);
}
.api-key-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.75rem;
  margin: 0 0 var(--space-2, 0.5rem);
}
.api-key-foot .cred-hint {
  margin-bottom: 0;
}
.api-key-foot .cred-msg {
  margin: 0;
}
.api-key-row--model {
  align-items: center;
}
.api-model-hint {
  margin: 0 0 var(--space-2, 0.5rem);
  padding-left: 5.25rem;
}
@media (max-width: 520px) {
  .api-model-hint {
    padding-left: 0;
  }
}
.api-build-label {
  margin: 0 0 0.65rem;
  font-size: 0.68rem;
  opacity: 0.85;
}
.openrouter-prompt-details {
  margin: 0.5rem 0 0.75rem;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #c4c4d4);
}
.openrouter-prompt-summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}
.openrouter-prompt-note {
  margin: 0.5rem 0 0.35rem;
}
.openrouter-prompt-pre {
  margin: 0.35rem 0;
  padding: 0.55rem 0.65rem;
  border-radius: 0.45rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.72rem;
  line-height: 1.4;
  color: #b8b8c8;
}
.openrouter-prompt-user {
  margin: 0.35rem 0 0;
}
.openrouter-prompt-user code,
.openrouter-prompt-note code {
  font-size: 0.7rem;
}
@media (max-width: 420px) {
  .api-key-lbl {
    flex: 1 1 100%;
  }
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
  min-width: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--space-4, 1rem) 0 var(--space-6, 1.5rem);
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABS — Premium segmented control
   ═══════════════════════════════════════════════════════════════════════════ */
.settings-tabs {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-1, 0.25rem);
  padding: var(--space-1, 0.25rem);
  margin-bottom: var(--space-4, 1rem);
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-md, 12px));
  -webkit-backdrop-filter: blur(var(--blur-md, 12px));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-xl, 1rem);
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.settings-tabs::-webkit-scrollbar {
  display: none;
}

@media (pointer: fine) {
  .settings-tabs {
    scrollbar-width: thin;
    scrollbar-color: rgba(139, 92, 246, 0.55) transparent;
    padding-bottom: 0.15rem;
  }
  .settings-tabs::-webkit-scrollbar {
    display: block;
    height: 6px;
  }
  .settings-tabs::-webkit-scrollbar-thumb {
    background: rgba(139, 92, 246, 0.5);
    border-radius: 999px;
  }
  .settings-tabs::-webkit-scrollbar-track {
    background: transparent;
  }
}

.settings-sign-out-wrap {
  margin-top: var(--space-2, 0.5rem);
  padding-top: var(--space-4, 1rem);
}

.settings-sign-out-btn {
  display: block;
  width: 100%;
  min-height: 3.25rem;
  padding: var(--space-4, 1rem) var(--space-5, 1.25rem);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fff;
  border: none;
  border-radius: var(--radius-xl, 1rem);
  background: linear-gradient(145deg, #9b6fd4 0%, #7b4db5 45%, #6d28d9 100%);
  box-shadow:
    0 4px 14px rgba(109, 40, 217, 0.45),
    0 0 0 1px rgba(167, 139, 250, 0.25) inset;
}

.settings-sign-out-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.settings-sign-out-btn:active:not(:disabled) {
  transform: scale(0.99);
}

.settings-sign-out-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}

.tab-btn {
  flex: 0 0 auto;
  cursor: pointer;
  border-radius: var(--radius-lg, 0.75rem);
  border: none;
  background: transparent;
  color: var(--color-text-tertiary, #6e6e7e);
  padding: var(--space-2-5, 0.625rem) var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  min-height: var(--touch-target, 2.75rem);
  white-space: nowrap;
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
.devices-panel {
  max-width: 64rem;
  margin-inline: auto;
}

.devices-register-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-4, 1rem);
  padding: var(--space-4, 1rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 0.5rem);
  background: var(--color-glass-subtle, rgba(255, 255, 255, 0.03));
}

.devices-register-title {
  margin: 0;
  font-size: var(--text-base, 0.9375rem);
  font-weight: 600;
}

.devices-table-wrap {
  overflow-x: auto;
  margin-bottom: var(--space-3, 0.75rem);
}

.devices-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm, 0.8125rem);
}

.devices-table th,
.devices-table td {
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  text-align: left;
  vertical-align: top;
}

.devices-name-inp {
  min-width: 10rem;
  margin-bottom: var(--space-1, 0.25rem);
}

.devices-meta {
  display: block;
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

.devices-badge {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-sm, 0.375rem);
  font-size: var(--text-xs, 0.6875rem);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary, #a8a8b8);
}

.devices-badge--signed-in {
  background: rgba(74, 222, 128, 0.12);
  color: #86efac;
}

.devices-badge--current {
  background: rgba(123, 77, 181, 0.2);
  color: #d8b4fe;
}

.devices-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 0.5rem);
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

.smtp-notify-toggles {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0 12px;
}

.email-settings .email-intro {
  margin-bottom: 12px;
}

.email-settings .email-intro code {
  font-size: 0.9em;
}

.email-master-toggle {
  margin-bottom: 16px;
}

.email-panel {
  margin: 16px 0;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.08));
  background: var(--color-glass, rgba(22, 22, 29, 0.35));
}

.email-panel-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-secondary, #a8a8b8);
}

.email-field-note {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-tertiary, #8b8b9a);
}

.email-panel--scheduled {
  text-align: center;
}

.email-panel--scheduled .email-panel-title {
  text-align: center;
}

.email-scheduled-note {
  max-width: 34rem;
  margin-inline: auto;
}

.email-scheduled-toggles {
  max-width: 22rem;
  margin-inline: auto;
  text-align: left;
}

.email-report-toggle {
  align-items: flex-start;
}

.email-report-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.email-report-label strong {
  font-weight: 600;
}

.email-report-label small {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-tertiary, #8b8b9a);
}

.email-scheduled-cc {
  max-width: 28rem;
  margin-inline: auto;
  text-align: left;
}

.email-scheduled-cc .api-key-lbl {
  flex: 0 0 auto;
  min-width: 9.5rem;
}

@media (max-width: 520px) {
  .email-scheduled-cc {
    flex-direction: column;
    align-items: stretch;
  }

  .email-scheduled-cc .api-key-lbl {
    min-width: 0;
  }
}

.email-fields {
  display: grid;
  gap: 12px;
}

.email-fields--two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 560px) {
  .email-fields--two-col {
    grid-template-columns: 1fr;
  }
}

.email-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.email-field--cc {
  margin-top: 12px;
}

.email-field-label {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary, #a8a8b8);
}

.email-port-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.email-port-inp {
  width: 96px;
  flex: 0 0 auto;
}

.email-port-ssl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--color-text, #e4e4eb);
  white-space: nowrap;
}

.email-toggle-grid {
  display: grid;
  gap: 8px;
}

.email-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 14px;
  line-height: 1.35;
  color: var(--color-text, #e4e4eb);
}

.email-toggle input {
  flex-shrink: 0;
  margin: 0;
}

.email-more-toggles {
  margin-top: 2px;
}

.email-more-summary {
  font-size: 13px;
  color: var(--color-accent-purple, #b794f6);
  cursor: pointer;
  list-style: none;
}

.email-more-summary::-webkit-details-marker {
  display: none;
}

.email-more-body {
  margin-top: 8px;
}

.email-actions-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}

.email-test-bar {
  display: flex;
  flex: 1 1 200px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.email-test-bar select {
  flex: 1 1 160px;
  min-width: 0;
}

.email-status-msg {
  margin-top: 10px;
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
.helpers-panel .audio-row {
  margin: 0.5rem 0 0.75rem;
}
.helpers-field {
  margin-top: 0.35rem;
}
.helpers-toggle-slot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 0 0 auto;
  min-height: var(--touch-target, 2.75rem);
}
.helpers-toggle-label {
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-primary, #f4f4f8);
  white-space: nowrap;
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
  margin-bottom: 0;
}
.audio-near-trailer-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}
.audio-near-trailer-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-accent, #a78bfa);
}
.audio-near-trailer-stepper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.audio-step-btn {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  font-size: 1.125rem;
  line-height: 1;
}
.audio-near-trailer-slider {
  flex: 1 1 auto;
  min-width: 0;
  height: 2rem;
  padding: 0;
  accent-color: var(--color-accent, #8b5cf6);
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

.trip-history-csv-import {
  margin-top: var(--space-4, 1rem);
  padding-top: var(--space-4, 1rem);
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.trip-history-import-heading {
  margin: 0 0 var(--space-2, 0.5rem);
  font-weight: 600;
}

.trip-history-import-mode {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
  margin-bottom: var(--space-2, 0.5rem);
}

.trip-history-import-mode-opt {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2, 0.5rem);
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
  cursor: pointer;
}

.trip-history-import-errors {
  margin: var(--space-2, 0.5rem) 0 0;
  padding-left: 1.25rem;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-danger, #f87171);
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

/* WhatsApp panel */
.whatsapp-panel {
  max-width: 40rem;
  margin-inline: auto;
}
.waha-chats-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0.5rem 0;
  max-height: 12rem;
  overflow-y: auto;
}
.waha-chat-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.55rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.03);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.waha-chat-item:hover {
  background: rgba(255,255,255,0.07);
}
.waha-chat-item.is-active {
  border-color: rgba(34,197,94,0.5);
  background: rgba(34,197,94,0.08);
}
.waha-chat-name {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text-primary, #f4f4f8);
}
.waha-chat-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
}
.waha-chat-kind {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(34,197,94,0.9);
}
.waha-chat-id {
  font-size: 0.62rem;
  color: var(--color-text-tertiary, #8b8b98);
  font-family: monospace;
  word-break: break-all;
}
.waha-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #c8c8d4);
  cursor: pointer;
  margin-bottom: 0.5rem;
}
.waha-auto-examples {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0 0 0 0.25rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--muted, #9ca3af);
}
.waha-auto-examples li {
  margin-bottom: 0.35rem;
}
.waha-ex-q {
  color: var(--text-soft, #c4cad4);
}
.waha-ex-a {
  color: var(--accent, #a78bfa);
}
.waha-ex-note {
  font-size: 0.75rem;
  opacity: 0.85;
}
.waha-toggle-row input[type="checkbox"] {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--color-accent-purple, #7b4db5);
}
.waha-qr-wrap {
  margin: 0.75rem 0;
  text-align: center;
}
.waha-qr-img {
  max-width: 240px;
  width: 100%;
  height: auto;
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.5rem;
}
.waha-send-row {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.waha-send-input {
  flex: 1;
  min-width: 0;
}
</style>
