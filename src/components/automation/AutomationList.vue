<script setup>
import { ref, onMounted } from 'vue'
import { listAutomations, createAutomation, deleteAutomation, duplicateAutomation, runAutomation, listAutomationPresets, installAutomationPreset } from '../../api.js'
import { pushLiveLog } from '../../stores/liveLogStore.js'
import { announceGeofenceArrival, announceArrivalSuccess } from '../../utils/tripVoiceAnnouncement.js'
import { announceCheckInSuccess, announceCheckInFail, announceCheckInTripReady } from '../../utils/alertAudioQueue.js'

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

const emit = defineEmits(['edit'])

const automations = ref([])
const presets = ref([])
const loading = ref(true)
const error = ref(null)
const runningId = ref(null)
const showPresets = ref(false)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [autos, presetList] = await Promise.all([
      listAutomations(),
      listAutomationPresets(),
    ])
    automations.value = autos
    presets.value = presetList
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const installingPresetId = ref(null)

async function installPreset(presetId, name) {
  console.log('[AutomationList] installPreset called:', presetId, name)
  if (installingPresetId.value) {
    console.log('[AutomationList] blocked: already installing', installingPresetId.value)
    return
  }
  installingPresetId.value = presetId
  try {
    console.log('[AutomationList] calling installAutomationPreset...')
    const auto = await installAutomationPreset(presetId)
    console.log('[AutomationList] install success:', auto)
    pushLiveLog({ type: 'info', message: `Installed preset: ${name}`, ts: Date.now() })
    showPresets.value = false
    await load()
    emit('edit', auto.id)
  } catch (e) {
    console.error('[AutomationList] install error:', e)
    pushLiveLog({ type: 'error', message: e.message || String(e), ts: Date.now() })
  } finally {
    installingPresetId.value = null
  }
}

async function create() {
  try {
    const auto = await createAutomation({
      name: 'New Automation',
      triggers: [{ id: generateId(), type: 'manual', buttonLabel: 'Run' }],
      conditions: [],
      actions: [],
    })
    pushLiveLog({ type: 'info', message: `Created automation: ${auto.name}`, ts: Date.now() })
    emit('edit', auto.id)
  } catch (e) {
    pushLiveLog({ type: 'error', message: e.message, ts: Date.now() })
  }
}

async function remove(id, name) {
  if (!confirm(`Delete automation "${name}"?`)) return
  try {
    await deleteAutomation(id)
    pushLiveLog({ type: 'info', message: `Deleted: ${name}`, ts: Date.now() })
    await load()
  } catch (e) {
    pushLiveLog({ type: 'error', message: e.message, ts: Date.now() })
  }
}

async function duplicate(id) {
  try {
    const copy = await duplicateAutomation(id)
    pushLiveLog({ type: 'info', message: `Duplicated: ${copy.name}`, ts: Date.now() })
    await load()
  } catch (e) {
    pushLiveLog({ type: 'error', message: e.message, ts: Date.now() })
  }
}

async function run(id, name) {
  runningId.value = id
  try {
    const result = await runAutomation(id, { headless: true })
    if (result.ok) {
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
        if (checkInPayload.tripReadyAcknowledged === true) {
          announceCheckInTripReady()
        } else if (checkInPayload.signedOut === true) {
          announceCheckInSuccess()
        } else if (checkInPayload.success === false) {
          announceCheckInFail()
        }
      }
      pushLiveLog({ type: 'info', message: `Ran: ${name}`, ts: Date.now() })
    } else {
      pushLiveLog({ type: 'error', message: result.error || 'Failed', ts: Date.now() })
    }
  } catch (e) {
    pushLiveLog({ type: 'error', message: e.message, ts: Date.now() })
  } finally {
    runningId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="list-container">
    <div class="list-header">
      <h2 class="list-title">Automations</h2>
      <div class="header-actions">
        <button type="button" class="btn tap" @click="showPresets = !showPresets">
          {{ showPresets ? 'Hide Presets' : 'Templates' }}
        </button>
        <button type="button" class="btn primary tap" @click="create">+ New Automation</button>
      </div>
    </div>

    <p class="hint">
      Build browser automations with triggers, conditions, and actions — like Home Assistant for Playwright.
    </p>

    <div v-if="showPresets" class="presets-section">
      <h3 class="presets-title">Templates</h3>
      <p class="presets-hint">Pre-built automations you can install and customize.</p>
      <div class="presets-grid">
        <div v-for="preset in presets" :key="preset.id" class="preset-card">
          <div class="preset-info">
            <span class="preset-name">{{ preset.name }}</span>
            <span class="preset-desc">{{ preset.description }}</span>
            <span class="preset-meta">{{ preset.actionCount }} actions</span>
          </div>
          <button
            type="button"
            class="btn tap"
            :disabled="installingPresetId === preset.id"
            @click="installPreset(preset.id, preset.name)"
          >
            {{ installingPresetId === preset.id ? 'Installing…' : 'Install' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">Loading…</div>
    <div v-else-if="error" class="error">{{ error }}</div>

    <div v-else-if="!automations.length" class="empty">
      <p>No automations yet.</p>
      <p>Create one to automate FedEx check-in, form filling, and more.</p>
    </div>

    <div v-else class="automations-grid">
      <div
        v-for="auto in automations"
        :key="auto.id"
        class="automation-card"
        :class="{ disabled: !auto.enabled }"
      >
        <div class="card-header">
          <span class="card-icon">⚡</span>
          <div class="card-info">
            <span class="card-name">{{ auto.name }}</span>
            <span class="card-meta">
              {{ auto.triggerCount }} trigger{{ auto.triggerCount !== 1 ? 's' : '' }} ·
              {{ auto.actionCount }} action{{ auto.actionCount !== 1 ? 's' : '' }}
            </span>
          </div>
          <span v-if="!auto.enabled" class="disabled-badge">Disabled</span>
        </div>

        <div v-if="auto.description" class="card-desc">{{ auto.description }}</div>

        <div class="card-actions">
          <button
            type="button"
            class="btn tap"
            :disabled="runningId === auto.id"
            @click="run(auto.id, auto.name)"
          >
            {{ runningId === auto.id ? 'Running…' : '▶ Run' }}
          </button>
          <button type="button" class="btn tap" @click="$emit('edit', auto.id)">Edit</button>
          <button type="button" class="btn tap" @click="duplicate(auto.id)">Duplicate</button>
          <button type="button" class="btn tap danger" @click="remove(auto.id, auto.name)">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-container {
  padding: 0;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.presets-section {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: #14141c;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 12px;
}

.presets-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.25rem;
}

.presets-hint {
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  margin: 0 0 0.75rem;
}

.presets-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.preset-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: #1a1a24;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
}

.preset-info {
  flex: 1;
  min-width: 0;
}

.preset-name {
  display: block;
  font-weight: 600;
  font-size: 0.95rem;
}

.preset-desc {
  display: block;
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  margin-top: 0.15rem;
}

.preset-meta {
  display: block;
  font-size: 0.75rem;
  color: var(--muted, #9898a8);
  margin-top: 0.35rem;
}

.list-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.hint {
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  margin: 0 0 1rem;
  line-height: 1.4;
}

.loading, .error, .empty {
  text-align: center;
  padding: 2rem;
  color: var(--muted, #9898a8);
}

.error {
  color: #ffab91;
}

.empty p {
  margin: 0.5rem 0;
}

.automations-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.automation-card {
  background: #16161e;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 12px;
  padding: 1rem;
}

.automation-card.disabled {
  opacity: 0.7;
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.card-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-name {
  display: block;
  font-weight: 600;
  font-size: 1rem;
  color: var(--text, #e8e8ee);
}

.card-meta {
  display: block;
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
}

.disabled-badge {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: #2a2a34;
  color: var(--muted, #9898a8);
}

.card-desc {
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.btn {
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  padding: 0.45rem 0.75rem;
  font-size: 0.85rem;
  min-height: 36px;
}

.btn.primary {
  background: #5c2d91;
  border-color: #7b4db5;
}

.btn.danger {
  border-color: #5a3038;
  color: #ffab91;
}

.btn.danger:hover {
  background: #3a2228;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tap:active {
  opacity: 0.85;
}
</style>
