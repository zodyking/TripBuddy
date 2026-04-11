<script setup>
import { computed, inject } from 'vue'

const props = defineProps({
  action: { type: Object, required: true },
  index: { type: Number, required: true },
  total: { type: Number, required: true },
  depth: { type: Number, default: 0 },
})

const emit = defineEmits(['remove', 'move', 'duplicate', 'add-nested'])

const schema = inject('schema')

const ICONS = {
  globe: '🌐',
  'arrow-left': '←',
  'arrow-right': '→',
  refresh: '🔄',
  clock: '⏱',
  loader: '⏳',
  search: '🔍',
  link: '🔗',
  pointer: '👆',
  edit: '✏️',
  x: '✕',
  'check-square': '☑',
  square: '☐',
  'chevron-down': '▼',
  'mouse-pointer': '🖱',
  crosshair: '⊕',
  keyboard: '⌨',
  camera: '📷',
  type: '📝',
  tag: '🏷',
  code: '💻',
  'git-branch': '⑂',
  list: '☰',
  repeat: '🔁',
  layers: '▤',
  'stop-circle': '⏹',
  play: '▶',
  'log-in': '🔐',
  menu: '☰',
  clipboard: '📋',
  'alert-triangle': '⚠',
  phone: '📱',
  truck: '🚚',
}

const blockDef = computed(() => schema.value?.blocks?.[props.action.type] || null)

const icon = computed(() => ICONS[blockDef.value?.icon] || '•')

const title = computed(() => {
  const def = blockDef.value
  if (!def) return props.action.type
  return def.label
})

const subtitle = computed(() => {
  const a = props.action
  switch (a.type) {
    case 'goto':
      return a.url === 'dispatch_entry' ? 'FedEx Dispatch Entry' : a.url
    case 'delay':
      return `${a.ms || 0}ms`
    case 'waitForLoadState':
      return a.state
    case 'waitForSelector':
      return `${a.state || 'visible'}: ${a.selector || ''}`
    case 'click':
    case 'fill':
    case 'clear':
    case 'check':
    case 'uncheck':
    case 'hover':
    case 'focus':
      return a.selector || ''
    case 'press':
      return a.key || ''
    case 'if':
      return `${a.conditionType}: ${a.selector || a.pattern || a.variable || ''}`
    case 'repeat':
      return a.mode === 'count' ? `${a.count || 1} times` : a.mode
    case 'openMenu':
      return a.menuKey
    default:
      return ''
  }
})

const visibleFields = computed(() => {
  if (!blockDef.value?.fields) return []
  return blockDef.value.fields.filter((field) => {
    if (!field.showIf) return true
    return Object.entries(field.showIf).every(([key, values]) => {
      return values.includes(props.action[key])
    })
  })
})

const isContainer = computed(() => blockDef.value?.isContainer || false)

const childrenKeys = computed(() => {
  if (!isContainer.value) return []
  if (props.action.type === 'if') return ['then', 'else']
  if (props.action.type === 'repeat') return ['sequence']
  if (props.action.type === 'parallel') return ['branches']
  if (props.action.type === 'choose') return ['default']
  return []
})

function getChildLabel(key) {
  if (key === 'then') return 'Then'
  if (key === 'else') return 'Else'
  if (key === 'sequence') return 'Actions'
  if (key === 'branches') return 'Branches'
  if (key === 'default') return 'Default'
  return key
}

function addNestedAction(containerKey) {
  emit('add-nested', { parentAction: props.action, containerKey })
}

function removeNested(containerKey, idx) {
  if (!props.action.children?.[containerKey]) return
  props.action.children[containerKey].splice(idx, 1)
}

function moveNested(containerKey, idx, delta) {
  const arr = props.action.children?.[containerKey]
  if (!arr) return
  const newIdx = idx + delta
  if (newIdx < 0 || newIdx >= arr.length) return
  const item = arr.splice(idx, 1)[0]
  arr.splice(newIdx, 0, item)
}

function duplicateNested(containerKey, idx) {
  const arr = props.action.children?.[containerKey]
  if (!arr) return
  const copy = JSON.parse(JSON.stringify(arr[idx]))
  copy.id = Math.random().toString(36).slice(2, 10)
  arr.splice(idx + 1, 0, copy)
}
</script>

<template>
  <div class="action-block" :style="{ '--depth': depth }">
    <div class="block-header">
      <span class="block-number">{{ index + 1 }}</span>
      <span class="block-icon">{{ icon }}</span>
      <div class="block-info">
        <span class="block-title">{{ title }}</span>
        <span v-if="subtitle" class="block-subtitle">{{ subtitle }}</span>
      </div>
      <div class="block-actions">
        <button
          type="button"
          class="action-btn tap"
          :disabled="index === 0"
          title="Move up"
          @click="$emit('move', -1)"
        >↑</button>
        <button
          type="button"
          class="action-btn tap"
          :disabled="index >= total - 1"
          title="Move down"
          @click="$emit('move', 1)"
        >↓</button>
        <button
          type="button"
          class="action-btn tap"
          title="Duplicate"
          @click="$emit('duplicate')"
        >⎘</button>
        <button
          type="button"
          class="action-btn tap danger"
          title="Remove"
          @click="$emit('remove')"
        >✕</button>
      </div>
    </div>

    <div class="block-body">
      <div class="fields-grid">
        <div v-for="field in visibleFields" :key="field.key" class="field">
          <label class="field-label">{{ field.label }}</label>

          <template v-if="field.type === 'text' || field.type === 'textarea'">
            <input
              v-if="field.type === 'text'"
              v-model="action[field.key]"
              class="field-input"
              type="text"
              :placeholder="field.placeholder"
            />
            <textarea
              v-else
              v-model="action[field.key]"
              class="field-textarea"
              :placeholder="field.placeholder"
              rows="3"
            />
          </template>

          <template v-else-if="field.type === 'number'">
            <input
              v-model.number="action[field.key]"
              class="field-input"
              type="number"
              :min="field.min"
              :max="field.max"
            />
          </template>

          <template v-else-if="field.type === 'select'">
            <select v-model="action[field.key]" class="field-select">
              <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>

          <template v-else-if="field.type === 'boolean'">
            <label class="checkbox-label">
              <input v-model="action[field.key]" type="checkbox" />
              <span>{{ field.label }}</span>
            </label>
          </template>
        </div>
      </div>

      <template v-if="isContainer">
        <div v-for="key in childrenKeys" :key="key" class="nested-section">
          <div class="nested-header">
            <span class="nested-label">{{ getChildLabel(key) }}</span>
            <button type="button" class="btn sm tap" @click="addNestedAction(key)">+ Add</button>
          </div>
          <div class="nested-list">
            <p v-if="!action.children?.[key]?.length" class="nested-empty">No actions</p>
            <ActionBlock
              v-for="(child, idx) in (action.children?.[key] || [])"
              :key="child.id"
              :action="child"
              :index="idx"
              :total="action.children[key].length"
              :depth="depth + 1"
              @remove="removeNested(key, idx)"
              @move="moveNested(key, idx, $event)"
              @duplicate="duplicateNested(key, idx)"
              @add-nested="$emit('add-nested', $event)"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.action-block {
  background: #16161e;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  margin-left: calc(var(--depth, 0) * 1.5rem);
  overflow: hidden;
}

.action-block:hover {
  border-color: #3a3a48;
}

.block-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.85rem;
  background: #1a1a24;
  border-bottom: 1px solid var(--border, #2e2e38);
}

.block-number {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.8rem;
  background: linear-gradient(145deg, #3d2a52, #2a1f38);
  border: 1px solid rgba(92, 45, 145, 0.5);
  color: #e1bee7;
  flex-shrink: 0;
}

.block-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.block-info {
  flex: 1;
  min-width: 0;
}

.block-title {
  display: block;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text, #e8e8ee);
}

.block-subtitle {
  display: block;
  font-size: 0.78rem;
  color: var(--muted, #9898a8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}

.block-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border, #2e2e38);
  background: #22222c;
  color: var(--muted, #9898a8);
  font-size: 0.85rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn:hover:not(:disabled) {
  background: #2a2a36;
  color: var(--text, #e8e8ee);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn.danger:hover:not(:disabled) {
  background: #3a2228;
  color: #ffab91;
  border-color: #5a3038;
}

.block-body {
  padding: 0.75rem 0.85rem;
}

.fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.65rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-size: 0.75rem;
  color: var(--muted, #9898a8);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.field-input,
.field-select,
.field-textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  font-size: 0.85rem;
}

.field-textarea {
  resize: vertical;
  min-height: 60px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
}

.nested-section {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px dashed var(--border, #2e2e38);
}

.nested-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.nested-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--muted, #9898a8);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.nested-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nested-empty {
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  padding: 0.5rem;
  text-align: center;
  background: #12121a;
  border-radius: 6px;
  border: 1px dashed var(--border, #2e2e38);
}

.btn {
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
}

.btn.sm {
  min-height: 30px;
}

.tap:active {
  opacity: 0.85;
}
</style>
