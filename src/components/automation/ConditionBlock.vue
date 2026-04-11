<script setup>
import { computed, inject } from 'vue'

const props = defineProps({
  condition: { type: Object, required: true },
  index: { type: Number, required: true },
})

const emit = defineEmits(['remove'])

const schema = inject('schema')

const ICONS = {
  eye: '👁',
  'eye-off': '🙈',
  link: '🔗',
  clock: '⏱',
  hash: '#',
}

const conditionDef = computed(() => schema.value?.conditions?.[props.condition.type] || null)

const icon = computed(() => ICONS[conditionDef.value?.icon] || '🔍')

const title = computed(() => conditionDef.value?.label || props.condition.type)

const subtitle = computed(() => {
  const c = props.condition
  switch (c.type) {
    case 'elementVisible':
    case 'elementHidden':
      return c.selector || ''
    case 'urlMatches':
      return c.pattern || ''
    case 'timeWindow':
      return `${c.after || '00:00'} - ${c.before || '23:59'}`
    case 'variableEquals':
      return `${c.variable} = ${c.value}`
    default:
      return ''
  }
})

const visibleFields = computed(() => {
  if (!conditionDef.value?.fields) return []
  return conditionDef.value.fields
})
</script>

<template>
  <div class="condition-block">
    <div class="block-header">
      <span class="block-icon">{{ icon }}</span>
      <div class="block-info">
        <span class="block-title">{{ title }}</span>
        <span v-if="subtitle" class="block-subtitle">{{ subtitle }}</span>
      </div>
      <button
        type="button"
        class="action-btn tap danger"
        title="Remove"
        @click="$emit('remove')"
      >✕</button>
    </div>

    <div v-if="visibleFields.length" class="block-body">
      <div class="fields-grid">
        <div v-for="field in visibleFields" :key="field.key" class="field">
          <label class="field-label">{{ field.label }}</label>

          <template v-if="field.type === 'text'">
            <input
              v-model="condition[field.key]"
              class="field-input"
              type="text"
              :placeholder="field.placeholder"
            />
          </template>

          <template v-else-if="field.type === 'number'">
            <input
              v-model.number="condition[field.key]"
              class="field-input"
              type="number"
            />
          </template>

          <template v-else-if="field.type === 'select'">
            <select v-model="condition[field.key]" class="field-select">
              <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>

          <template v-else-if="field.type === 'multiselect'">
            <div class="multiselect">
              <label v-for="opt in field.options" :key="opt" class="ms-option">
                <input
                  type="checkbox"
                  :checked="(condition[field.key] || []).includes(opt)"
                  @change="e => {
                    const arr = condition[field.key] || []
                    if (e.target.checked) {
                      condition[field.key] = [...arr, opt]
                    } else {
                      condition[field.key] = arr.filter(v => v !== opt)
                    }
                  }"
                />
                <span>{{ opt }}</span>
              </label>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.condition-block {
  background: #16161e;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  overflow: hidden;
}

.condition-block:hover {
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

.action-btn.danger:hover {
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
.field-select {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 6px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  font-size: 0.85rem;
}

.multiselect {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.ms-option {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.tap:active {
  opacity: 0.85;
}
</style>
