<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import {
  getAssignment,
  postRun,
  getCredentials,
  putCredentials,
  deleteCredentials,
  putAssignment,
  postOcr,
  getHealth,
  postLinehaulCaptureBearer,
  fetchFedexLinehaulTractor,
  fetchFedexLinehaulDriver,
  fetchFedexLinehaulTripStatus,
  fetchFedexLinehaulTrips,
} from '../api.js'
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
  registerAssignmentListener,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import SettingsSection from '../components/settings/SettingsSection.vue'
import AutomationList from '../components/automation/AutomationList.vue'
import AutomationEditor from '../components/automation/AutomationEditor.vue'
import XPathExtractor from '../components/settings/XPathExtractor.vue'

/** Shown when a secret is on file but the user has not typed a new value (password inputs stay masked). */
const SECRET_SAVED_MASK = '••••••••••••••••'

/** @type {import('vue').Ref<'general' | 'automation'>} */
const settingsTab = ref('general')

const editingAutomationId = ref(null)

function openAutomationEditor(id) {
  editingAutomationId.value = id
}

function closeAutomationEditor() {
  editingAutomationId.value = null
}

const assignmentAlert = ref(null)
let unregisterRecover = () => {}
let unregisterAssignment = () => {}

const credUser = ref('')
const credTractor = ref('')
const credLinehaulToken = ref('')
const credPollMinutes = ref(0)
/** Linehaul home refresh slider: 0 = manual only, max 60 min (1 min steps). */
const LINEHAUL_POLL_MAX = 60
const linehaulPollTickValues = Array.from(
  { length: LINEHAUL_POLL_MAX + 1 },
  (_, i) => i,
)
const linehaulManualBusy = ref(false)
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

const instructionsEd = ref('')
const tractorEd = ref('')
/** US phone: digits only (max 10); shown in the field as (XXX) XXX XXXX */
const phoneDigits = ref('')
const dispatchSaving = ref(false)
const dispatchMsg = ref(null)

const presetSelect = ref('sealed_dual')
const PRESET_OPTIONS = [
  { value: 'sealed_dual', label: 'Dolly + 2 seals' },
  { value: 'empty_dual', label: 'Empty move (3 fields)' },
  { value: 'trailer_only', label: 'Trailer 1 only' },
  { value: 'dolly_t1', label: 'Dolly + T1' },
]

const photoSlots = ref([])
const fieldValues = reactive({})
const filesBySlot = ref({})
const ocrBusy = ref(false)
const inspectBusy = ref(false)
const inspectMsg = ref(null)

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

function syncFieldValuesFromSlots(slots, fv) {
  const keep = new Set(slots.map((s) => s.id))
  for (const k of Object.keys(fieldValues)) {
    if (!keep.has(k)) delete fieldValues[k]
  }
  for (const s of slots) {
    fieldValues[s.id] = fv[s.id] ?? fieldValues[s.id] ?? ''
  }
}

async function loadAssignmentState() {
  try {
    const a = await getAssignment()
    instructionsEd.value = a.instructions ?? ''
    tractorEd.value = a.tractorLocation ?? ''
    phoneDigits.value = String(a.driverPhone ?? '')
      .replace(/\D/g, '')
      .slice(0, 10)
    presetSelect.value = a.preset ?? 'sealed_dual'
    photoSlots.value = Array.isArray(a.photoSlots) ? [...a.photoSlots] : []
    syncFieldValuesFromSlots(photoSlots.value, a.fieldValues || {})
  } catch (e) {
    pushLiveLog({ type: 'error', message: e instanceof Error ? e.message : String(e), ts: Date.now() })
  }
}

async function saveDispatchInfo() {
  if (!(await requireApi())) return
  dispatchSaving.value = true
  dispatchMsg.value = null
  try {
    await putAssignment({
      instructions: instructionsEd.value,
      tractorLocation: tractorEd.value,
      driverPhone: phoneDigits.value,
      fieldValues: { ...fieldValues },
    })
    dispatchMsg.value = 'Saved'
    pushLiveLog({ type: 'info', message: 'Dispatch info saved', ts: Date.now() })
  } catch (e) {
    dispatchMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    dispatchSaving.value = false
  }
}

async function applyLayoutPreset() {
  if (!(await requireApi())) return
  dispatchMsg.value = null
  try {
    await putAssignment({ applyPreset: presetSelect.value })
    await loadAssignmentState()
    pushLiveLog({ type: 'info', message: `Layout preset: ${presetSelect.value}`, ts: Date.now() })
  } catch (e) {
    dispatchMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadCredentials() {
  try {
    credMeta.value = await getCredentials({ includeLinehaulBearer: true })
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
    credLinehaulToken.value =
      typeof credMeta.value.fedexLinehaulBearer === 'string'
        ? credMeta.value.fedexLinehaulBearer
        : ''
  } catch {
    credMeta.value = null
    credLinehaulToken.value = ''
  }
}

async function saveCredentials() {
  if (!(await requireApi())) return
  credSaving.value = true
  try {
    const hasBearerInput = credLinehaulToken.value.trim().length > 0
    const hasBearerOnFile = Boolean(credMeta.value?.hasLinehaulBearer)
    if (!hasBearerInput && !hasBearerOnFile) {
      pushLiveLog({
        type: 'error',
        message: 'Linehaul bearer token is required',
        ts: Date.now(),
      })
      return
    }
    const body = {
      username: credUser.value,
      password: credPass.value || undefined,
      tractorNumber: credTractor.value,
      linehaulPollMinutes: Math.max(
        0,
        Math.min(LINEHAUL_POLL_MAX, Math.floor(Number(credPollMinutes.value) || 0)),
      ),
    }
    if (hasBearerInput) {
      body.fedexLinehaulBearer = credLinehaulToken.value.trim()
    }
    await putCredentials(body)
    await putAssignment({ driverPhone: phoneDigits.value })
    credPass.value = ''
    credLinehaulToken.value = ''
    await loadCredentials()
    await loadAssignmentState()
    pushLiveLog({ type: 'info', message: 'Credentials saved (password encrypted on disk)', ts: Date.now() })
  } catch (e) {
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
  const r = await fetchFedexLinehaulTrips()
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

function onSlotFile(slotId, ev) {
  const f = ev.target.files?.[0]
  if (f) filesBySlot.value = { ...filesBySlot.value, [slotId]: f }
  else {
    const copy = { ...filesBySlot.value }
    delete copy[slotId]
    filesBySlot.value = copy
  }
}

async function runOcr() {
  if (!(await requireApi())) return
  ocrBusy.value = true
  dispatchMsg.value = null
  try {
    const fd = new FormData()
    for (const s of photoSlots.value) {
      const f = filesBySlot.value[s.id]
      if (f) fd.append(s.id, f)
    }
    if ([...fd.keys()].length === 0) {
      dispatchMsg.value = 'Choose at least one photo'
      return
    }
    const { results } = await postOcr(fd)
    for (const r of results || []) {
      if (r.field in fieldValues) fieldValues[r.field] = r.text || ''
    }
    await putAssignment({ fieldValues: { ...fieldValues } })
    dispatchMsg.value = 'OCR done — verify values'
    pushLiveLog({ type: 'info', message: 'OCR complete', ts: Date.now() })
  } catch (e) {
    dispatchMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    ocrBusy.value = false
  }
}

const valueOrder = computed(() => photoSlots.value.map((s) => s.id))

async function runInspectCheckout() {
  if (!(await requireApi())) return
  inspectBusy.value = true
  inspectMsg.value = null
  try {
    await putAssignment({ fieldValues: { ...fieldValues } })
    const result = await postRun({
      scenario: 'inspect_checkout',
      headless: true,
      slowMo: 0,
      values: { ...fieldValues },
      valueOrder: valueOrder.value,
      tryOktaLogin: false,
    })
    inspectMsg.value = result.ok ? 'Inspect/checkout finished' : result.error || 'Failed'
    pushLiveLog({ type: 'info', message: inspectMsg.value, ts: Date.now() })
  } catch (e) {
    inspectMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    inspectBusy.value = false
  }
}

function clearAssignmentAlert() {
  assignmentAlert.value = null
}

onMounted(() => {
  unregisterAssignment = registerAssignmentListener((data) => {
    assignmentAlert.value = {
      ts: data.ts,
      message: data.message || 'Assignment change detected',
      detail: data.current ?? data,
    }
  })
  unregisterRecover = registerApiRecover(reconnectLiveLogStream)
  loadCredentials()
  loadAssignmentState()
})

onUnmounted(() => {
  unregisterAssignment()
  unregisterRecover()
})
</script>

<template>
  <div class="shell">
    <div v-if="assignmentAlert" class="alert" role="status">
      <strong>New activity</strong>
      <p>{{ assignmentAlert.message }}</p>
      <button type="button" class="btn ghost tap" @click="clearAssignmentAlert">Dismiss</button>
    </div>

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
        :aria-selected="settingsTab === 'automation'"
        :class="{ active: settingsTab === 'automation' }"
        @click="settingsTab = 'automation'"
      >
        Automation
      </button>
    </div>

    <main v-show="settingsTab === 'general'" class="stack">
      <SettingsSection title="Driver Credentials">
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
        <div class="btn-row">
          <button type="button" class="btn primary tap" :disabled="credSaving" @click="saveCredentials">
            Save credentials
          </button>
          <button type="button" class="btn tap" @click="clearCredentials">Clear</button>
        </div>
      </SettingsSection>

      <SettingsSection title="Dispatch & seals">
        <p v-if="dispatchMsg" class="dispatch-msg">{{ dispatchMsg }}</p>
        <p class="hint tight">
          Instructions and tractor location are shown read-only on Home — save after edits. Driver phone is set under
          Driver Credentials only.
        </p>
        <label class="lbl">Instructions (for drivers / Home display)</label>
        <textarea v-model="instructionsEd" class="area-tap" rows="4" autocomplete="off" />
        <label class="lbl">Tractor location (current location for Check in)</label>
        <input v-model="tractorEd" class="inp tap" type="text" autocomplete="off" />
        <button type="button" class="btn primary tap" :disabled="dispatchSaving" @click="saveDispatchInfo">
          Save dispatch info
        </button>

        <label class="lbl block-gap">Layout preset</label>
        <select v-model="presetSelect" class="inp tap">
          <option v-for="o in PRESET_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
        <button type="button" class="btn tap" @click="applyLayoutPreset">Apply layout preset</button>

        <template v-if="photoSlots.length">
          <p class="hint tight block-gap">Inspect order: {{ valueOrder.join(', ') }}</p>
          <div v-for="s in photoSlots" :key="s.id" class="slot">
            <label class="slot-label">{{ s.label }}</label>
            <input type="file" accept="image/*" class="file tap" @change="onSlotFile(s.id, $event)" />
            <input v-model="fieldValues[s.id]" class="inp tap" type="text" autocomplete="off" />
          </div>
          <div class="btn-row">
            <button type="button" class="btn tap" :disabled="ocrBusy" @click="runOcr">
              {{ ocrBusy ? 'OCR…' : 'Run OCR' }}
            </button>
          </div>
        </template>

        <p v-if="inspectMsg" class="dispatch-msg block-gap">{{ inspectMsg }}</p>
        <p class="hint tight">Uses field values above (saved to server).</p>
        <button
          type="button"
          class="btn primary tap"
          :disabled="inspectBusy || !photoSlots.length"
          @click="runInspectCheckout"
        >
          {{ inspectBusy ? 'Running…' : 'Run inspect & checkout (headless)' }}
        </button>
      </SettingsSection>

      <SettingsSection title="XPath Tools">
        <XPathExtractor />
      </SettingsSection>

      <SettingsSection title="Live log">
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
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  padding: 0.75rem 0 1rem;
}
.settings-tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}
.tab-btn {
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #1e1e26;
  color: var(--muted, #9898a8);
  padding: 0.55rem 1rem;
  font-size: 0.95rem;
  font-weight: 600;
  min-height: 44px;
  min-width: 7rem;
}
.tab-btn.active {
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  border-color: #5c2d91;
  box-shadow: 0 0 0 1px rgba(92, 45, 145, 0.35);
}
.automation-wrap {
  margin-top: 0;
}
.dispatch-msg {
  font-size: 0.9rem;
  color: #90caf9;
  margin: 0 0 0.75rem;
}
.alert {
  background: #2a1f08;
  border: 1px solid #d97706;
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.hint {
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  margin: 0 0 0.75rem;
  line-height: 1.4;
}
.hint.tight {
  margin-bottom: 0.5rem;
}
.block-gap {
  margin-top: 1rem;
}
.lbl {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
  color: var(--muted, #9898a8);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
  min-height: 44px;
}
.inp {
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  margin-bottom: 0.65rem;
  min-height: 44px;
}
.linehaul-poll-card {
  margin-bottom: 0.65rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--border, #2e2e38);
  background: rgba(18, 18, 26, 0.65);
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
.area-tap {
  width: 100%;
  min-height: 5rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  margin-bottom: 0.65rem;
  resize: vertical;
}
.slot {
  margin-bottom: 1rem;
}
.slot-label {
  display: block;
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  margin-bottom: 0.35rem;
}
.file {
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}
.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.linehaul-test-row {
  margin: 0.85rem 0 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border, #2e2e38);
}
.linehaul-test-lbl {
  margin-bottom: 0.35rem;
}
.linehaul-test-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
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
.btn {
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  padding: 0.5rem 0.85rem;
  font-size: 0.9rem;
  min-height: 44px;
}
.btn.primary {
  background: #5c2d91;
  border-color: #7b4db5;
}
.btn.ghost {
  background: transparent;
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
</style>
