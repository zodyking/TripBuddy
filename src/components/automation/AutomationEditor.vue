<script setup>
import { ref, reactive, computed, watch, onMounted, provide } from 'vue'
import { getAutomation, updateAutomation, getAutomationsSchema, runAutomation } from '../../api.js'
import { pushLiveLog } from '../../stores/liveLogStore.js'
import ActionBlock from './ActionBlock.vue'
import TriggerBlock from './TriggerBlock.vue'
import ConditionBlock from './ConditionBlock.vue'
import BlockPicker from './BlockPicker.vue'

const props = defineProps({
  automationId: { type: String, required: true },
})

const emit = defineEmits(['back', 'saved'])

const loading = ref(true)
const saving = ref(false)
const running = ref(false)
const error = ref(null)
const saveMsg = ref(null)

const schema = ref(null)
const automation = reactive({
  id: '',
  name: '',
  description: '',
  enabled: true,
  triggers: [],
  conditions: [],
  actions: [],
  variables: {},
})

const showBlockPicker = ref(false)
const pickerTarget = ref(null)

provide('schema', schema)
provide('automation', automation)

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [schemaData, autoData] = await Promise.all([
      getAutomationsSchema(),
      getAutomation(props.automationId),
    ])
    schema.value = schemaData
    Object.assign(automation, autoData)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  saveMsg.value = null
  try {
    await updateAutomation(automation.id, {
      name: automation.name,
      description: automation.description,
      enabled: automation.enabled,
      triggers: JSON.parse(JSON.stringify(automation.triggers)),
      conditions: JSON.parse(JSON.stringify(automation.conditions)),
      actions: JSON.parse(JSON.stringify(automation.actions)),
      variables: automation.variables,
    })
    saveMsg.value = 'Saved'
    pushLiveLog({ type: 'info', message: `Automation "${automation.name}" saved`, ts: Date.now() })
    emit('saved')
    setTimeout(() => { saveMsg.value = null }, 2000)
  } catch (e) {
    saveMsg.value = e.message
    pushLiveLog({ type: 'error', message: e.message, ts: Date.now() })
  } finally {
    saving.value = false
  }
}

async function run() {
  running.value = true
  try {
    await save()
    const result = await runAutomation(automation.id, { headless: true })
    if (result.ok) {
      pushLiveLog({ type: 'info', message: `Automation completed`, ts: Date.now() })
    } else {
      pushLiveLog({ type: 'error', message: result.error || 'Run failed', ts: Date.now() })
    }
  } catch (e) {
    pushLiveLog({ type: 'error', message: e.message, ts: Date.now() })
  } finally {
    running.value = false
  }
}

function openPicker(target) {
  pickerTarget.value = target
  showBlockPicker.value = true
}

function closePicker() {
  showBlockPicker.value = false
  pickerTarget.value = null
}

function addBlock(blockType, blockDef) {
  const target = pickerTarget.value
  if (!target) return

  const newBlock = {
    id: generateId(),
    type: blockType,
  }

  if (blockDef.fields) {
    for (const field of blockDef.fields) {
      if (field.default !== undefined) {
        newBlock[field.key] = field.default
      }
    }
  }

  if (blockDef.isContainer && blockDef.children) {
    newBlock.children = JSON.parse(JSON.stringify(blockDef.children))
  }

  if (target === 'actions') {
    automation.actions.push(newBlock)
  } else if (target === 'triggers') {
    automation.triggers.push(newBlock)
  } else if (target === 'conditions') {
    automation.conditions.push(newBlock)
  }

  closePicker()
}

function removeAction(index) {
  automation.actions.splice(index, 1)
}

function removeTrigger(index) {
  automation.triggers.splice(index, 1)
}

function removeCondition(index) {
  automation.conditions.splice(index, 1)
}

function moveAction(index, delta) {
  const newIndex = index + delta
  if (newIndex < 0 || newIndex >= automation.actions.length) return
  const item = automation.actions.splice(index, 1)[0]
  automation.actions.splice(newIndex, 0, item)
}

function duplicateAction(index) {
  const original = automation.actions[index]
  const copy = JSON.parse(JSON.stringify(original))
  copy.id = generateId()
  automation.actions.splice(index + 1, 0, copy)
}

onMounted(load)

watch(() => props.automationId, load)
</script>

<template>
  <div class="editor">
    <header class="editor-header">
      <button type="button" class="btn ghost tap" @click="$emit('back')">
        <span class="icon">←</span> Back
      </button>
      <div class="header-title">
        <input
          v-model="automation.name"
          class="name-input"
          type="text"
          placeholder="Automation name"
        />
      </div>
      <div class="header-actions">
        <span v-if="saveMsg" class="save-msg" :class="{ error: saveMsg !== 'Saved' }">{{ saveMsg }}</span>
        <button type="button" class="btn tap" :disabled="running" @click="run">
          {{ running ? 'Running…' : 'Run' }}
        </button>
        <button type="button" class="btn primary tap" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading">Loading automation…</div>
    <div v-else-if="error" class="error-box">{{ error }}</div>

    <div v-else class="editor-body">
      <div class="meta-row">
        <label class="toggle-label">
          <input v-model="automation.enabled" type="checkbox" />
          <span>Enabled</span>
        </label>
        <input
          v-model="automation.description"
          class="desc-input"
          type="text"
          placeholder="Description (optional)"
        />
      </div>

      <section class="block-section">
        <div class="section-header">
          <div class="section-title">
            <span class="section-icon">⚡</span>
            <span>When</span>
            <span class="section-subtitle">Triggers</span>
          </div>
          <button type="button" class="btn sm tap" @click="openPicker('triggers')">+ Add trigger</button>
        </div>
        <div class="block-list">
          <p v-if="!automation.triggers.length" class="empty-hint">
            No triggers. Add a trigger to define when this automation runs.
          </p>
          <TriggerBlock
            v-for="(trigger, idx) in automation.triggers"
            :key="trigger.id"
            :trigger="trigger"
            :index="idx"
            @remove="removeTrigger(idx)"
          />
        </div>
      </section>

      <section class="block-section">
        <div class="section-header">
          <div class="section-title">
            <span class="section-icon">🔍</span>
            <span>And if</span>
            <span class="section-subtitle">Conditions (optional)</span>
          </div>
          <button type="button" class="btn sm tap" @click="openPicker('conditions')">+ Add condition</button>
        </div>
        <div class="block-list">
          <p v-if="!automation.conditions.length" class="empty-hint">
            No conditions. Automation will run whenever a trigger fires.
          </p>
          <ConditionBlock
            v-for="(condition, idx) in automation.conditions"
            :key="condition.id"
            :condition="condition"
            :index="idx"
            @remove="removeCondition(idx)"
          />
        </div>
      </section>

      <section class="block-section actions-section">
        <div class="section-header">
          <div class="section-title">
            <span class="section-icon">▶</span>
            <span>Then do</span>
            <span class="section-subtitle">Actions</span>
          </div>
          <button type="button" class="btn sm tap" @click="openPicker('actions')">+ Add action</button>
        </div>
        <div class="block-list actions-list">
          <p v-if="!automation.actions.length" class="empty-hint">
            No actions yet. Add actions to define what this automation does.
          </p>
          <ActionBlock
            v-for="(action, idx) in automation.actions"
            :key="action.id"
            :action="action"
            :index="idx"
            :total="automation.actions.length"
            @remove="removeAction(idx)"
            @move="moveAction(idx, $event)"
            @duplicate="duplicateAction(idx)"
            @add-nested="openPicker"
          />
        </div>
      </section>
    </div>

    <BlockPicker
      v-if="showBlockPicker"
      :target="pickerTarget"
      :schema="schema"
      @select="addBlock"
      @close="closePicker"
    />
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg, #0d0d12);
}

.editor-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: #14141c;
  border-bottom: 1px solid var(--border, #2e2e38);
  position: sticky;
  top: 0;
  z-index: 10;
}

.header-title {
  flex: 1;
}

.name-input {
  width: 100%;
  max-width: 300px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #1a1a24;
  color: var(--text, #e8e8ee);
  font-size: 1rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.save-msg {
  font-size: 0.85rem;
  color: #a5d6a7;
}

.save-msg.error {
  color: #ffab91;
}

.loading, .error-box {
  padding: 2rem;
  text-align: center;
  color: var(--muted, #9898a8);
}

.error-box {
  color: #ffab91;
}

.editor-body {
  flex: 1;
  padding: 1rem;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 0.75rem 1rem;
  background: #14141c;
  border-radius: 10px;
  border: 1px solid var(--border, #2e2e38);
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  cursor: pointer;
}

.desc-input {
  flex: 1;
  min-width: 200px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #1a1a24;
  color: var(--text, #e8e8ee);
  font-size: 0.9rem;
}

.block-section {
  margin-bottom: 1.5rem;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.section-icon {
  font-size: 1.1rem;
}

.section-subtitle {
  font-weight: 400;
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
}

.block-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.empty-hint {
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  background: #14141c;
  border: 1px dashed var(--border, #2e2e38);
  border-radius: 10px;
}

.btn {
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  padding: 0.5rem 0.85rem;
  font-size: 0.9rem;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.btn.primary {
  background: #5c2d91;
  border-color: #7b4db5;
}

.btn.ghost {
  background: transparent;
  border-color: transparent;
}

.btn.sm {
  min-height: 36px;
  padding: 0.35rem 0.65rem;
  font-size: 0.85rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.icon {
  font-size: 1.1rem;
}

.tap:active {
  opacity: 0.85;
}
</style>
