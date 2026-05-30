<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { getOpenrouterModels } from '../api.js'
import {
  OPENROUTER_DEFAULT_MODEL,
  sanitizeOpenrouterModel,
} from '../constants/openrouterModels.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  inputId: { type: String, default: 'openrouter-model' },
})

const emit = defineEmits(['update:modelValue'])

const rootEl = ref(/** @type {HTMLElement | null} */ (null))
const listOpen = ref(false)
const loading = ref(false)
const loadError = ref('')
/** @type {import('vue').Ref<Array<{ id: string, name: string, description: string }>>} */
const catalog = ref([])
const activeIndex = ref(-1)
const catalogLoaded = ref(false)

const displayValue = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', sanitizeOpenrouterModel(v)),
})

const filtered = computed(() => {
  const q = String(displayValue.value ?? '').trim().toLowerCase()
  if (!catalog.value.length) {
    const v = displayValue.value?.trim()
    if (v && /^[a-z0-9][\w.-]*\/[\w.-]+$/i.test(v)) {
      return [{ id: v, name: v, description: '' }]
    }
    return []
  }
  if (!q) return catalog.value.slice(0, 50)
  const hits = catalog.value.filter((m) => {
    if (m.id.toLowerCase().includes(q)) return true
    if (m.name.toLowerCase().includes(q)) return true
    return false
  })
  const out = hits.slice(0, 50)
  if (
    /^[a-z0-9][\w.-]*\/[\w.-]+$/i.test(q) &&
    !out.some((m) => m.id.toLowerCase() === q)
  ) {
    out.unshift({ id: q, name: q, description: 'Custom model id' })
  }
  return out
})

const listboxId = computed(() => `${props.inputId}-listbox`)

async function loadCatalog() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const r = await getOpenrouterModels()
    if (r?.ok && Array.isArray(r.models)) {
      catalog.value = r.models
      catalogLoaded.value = true
    } else {
      loadError.value = typeof r?.error === 'string' ? r.error : 'Could not load models'
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function openList() {
  if (props.disabled) return
  listOpen.value = true
  activeIndex.value = filtered.value.length ? 0 : -1
  if (!catalogLoaded.value && !loading.value) {
    void loadCatalog()
  }
}

function closeList() {
  listOpen.value = false
  activeIndex.value = -1
}

function selectModel(m) {
  if (!m?.id) return
  displayValue.value = m.id
  closeList()
}

function onInput() {
  openList()
  if (!catalogLoaded.value && !loading.value) {
    void loadCatalog()
  }
}

function onKeydown(e) {
  if (!listOpen.value && (e.key === 'ArrowDown' || e.key === 'Enter')) {
    openList()
    return
  }
  if (!listOpen.value) return
  const n = filtered.value.length
  if (e.key === 'Escape') {
    e.preventDefault()
    closeList()
    return
  }
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % n
    return
  }
  if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    activeIndex.value = activeIndex.value <= 0 ? n - 1 : activeIndex.value - 1
    return
  }
  if (e.key === 'Enter' && n && activeIndex.value >= 0) {
    e.preventDefault()
    selectModel(filtered.value[activeIndex.value])
  }
}

function onDocPointer(e) {
  const root = rootEl.value
  if (!root || !(e.target instanceof Node)) return
  if (!root.contains(e.target)) closeList()
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
})

watch(
  () => props.modelValue,
  (v) => {
    if (!v) emit('update:modelValue', OPENROUTER_DEFAULT_MODEL)
  },
  { immediate: true },
)

watch(filtered, async () => {
  if (!listOpen.value) return
  await nextTick()
  activeIndex.value = filtered.value.length ? Math.min(activeIndex.value, filtered.value.length - 1) : -1
  if (activeIndex.value < 0 && filtered.value.length) activeIndex.value = 0
})
</script>

<template>
  <div ref="rootEl" class="or-model-picker">
    <input
      :id="inputId"
      v-model="displayValue"
      class="inp tap or-model-input"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      :disabled="disabled"
      :aria-expanded="listOpen"
      :aria-controls="listboxId"
      :aria-activedescendant="
        listOpen && activeIndex >= 0 && filtered[activeIndex]
          ? `${inputId}-opt-${activeIndex}`
          : undefined
      "
      aria-autocomplete="list"
      placeholder="Search models (e.g. gpt-4o-mini)"
      @focus="openList"
      @input="onInput"
      @keydown="onKeydown"
    />
    <ul
      v-if="listOpen"
      :id="listboxId"
      class="or-model-list"
      role="listbox"
      :aria-label="'OpenRouter models'"
    >
      <li v-if="loading" class="or-model-item or-model-item--muted" role="presentation">
        Loading models…
      </li>
      <li v-else-if="loadError" class="or-model-item or-model-item--err" role="presentation">
        {{ loadError }}
      </li>
      <li
        v-for="(m, i) in filtered"
        :key="m.id"
        :id="`${inputId}-opt-${i}`"
        class="or-model-item tap"
        role="option"
        :aria-selected="displayValue === m.id"
        :class="{ 'is-active': i === activeIndex, 'is-selected': displayValue === m.id }"
        @pointerdown.prevent="selectModel(m)"
      >
        <span class="or-model-name">{{ m.name }}</span>
        <span class="or-model-id">{{ m.id }}</span>
      </li>
      <li
        v-if="!loading && !loadError && !filtered.length"
        class="or-model-item or-model-item--muted"
        role="presentation"
      >
        No models match. Type a model id (provider/model-name).
      </li>
    </ul>
  </div>
</template>

<style scoped>
.or-model-picker {
  position: relative;
  flex: 1 1 12rem;
  min-width: 0;
}

.or-model-input {
  width: 100%;
}

.or-model-list {
  position: absolute;
  z-index: 50;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 0.25rem 0;
  max-height: min(16rem, 45vh);
  overflow-y: auto;
  list-style: none;
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-surface, #16161d);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.35));
}

.or-model-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.65rem;
  cursor: pointer;
  border: none;
  background: transparent;
  text-align: left;
}

.or-model-item.is-active,
.or-model-item:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}

.or-model-item.is-selected .or-model-id {
  color: var(--color-accent-purple-light, #9d6fd7);
}

.or-model-item--muted {
  cursor: default;
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: var(--text-sm, 0.8125rem);
}

.or-model-item--err {
  cursor: default;
  color: var(--color-error, #ef4444);
  font-size: var(--text-sm, 0.8125rem);
}

.or-model-name {
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  line-height: 1.25;
}

.or-model-id {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
  color: var(--color-text-tertiary, #6e6e7e);
  word-break: break-all;
}
</style>
