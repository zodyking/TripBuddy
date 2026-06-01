<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { getOpenrouterModels } from '../api.js'
import {
  OPENROUTER_DEFAULT_MODEL,
  isValidOpenrouterModelId,
  sanitizeOpenrouterModel,
} from '../constants/openrouterModels.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  inputId: { type: String, default: 'openrouter-model' },
  /** When true, empty value is allowed (placeholder only — uses app default at runtime). */
  optional: { type: Boolean, default: false },
  /** Eager-load model catalog (e.g. inside modals). */
  preloadCatalog: { type: Boolean, default: false },
  /** Render dropdown in a body teleport so overflow parents (modals) do not clip it. */
  teleportList: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue'])

const rootEl = ref(/** @type {HTMLElement | null} */ (null))
const inputEl = ref(/** @type {HTMLInputElement | null} */ (null))
const listOpen = ref(false)
const inputFocused = ref(false)
const loading = ref(false)
const loadError = ref('')
/** Free-typed filter text — not sanitized until pick or blur commit. */
const filterQuery = ref('')
/** @type {import('vue').Ref<Array<{ id: string, name: string, description: string }>>} */
const catalog = ref([])
const activeIndex = ref(-1)
const catalogLoaded = ref(false)
/** @type {import('vue').Ref<{ top: number, left: number, width: number }>} */
const listStyle = ref({ top: 0, left: 0, width: 0 })
let blurCloseTimer = null
let selectingFromList = false

const committedModel = computed(() => {
  const raw = String(props.modelValue ?? '').trim()
  if (props.optional && !raw) return ''
  return sanitizeOpenrouterModel(raw || OPENROUTER_DEFAULT_MODEL)
})

const filtered = computed(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!catalog.value.length) {
    const v = filterQuery.value.trim()
    if (v && isValidOpenrouterModelId(v)) {
      return [{ id: v, name: v, description: '' }]
    }
    return []
  }
  let hits = catalog.value
  if (q) {
    hits = catalog.value.filter((m) => {
      if (m.id.toLowerCase().includes(q)) return true
      if (m.name.toLowerCase().includes(q)) return true
      return false
    })
  }
  const out = q ? hits.slice(0, 120) : hits
  const exact = filterQuery.value.trim()
  if (
    exact &&
    isValidOpenrouterModelId(exact) &&
    !out.some((m) => m.id.toLowerCase() === exact.toLowerCase())
  ) {
    out.unshift({ id: exact, name: exact, description: 'Custom model id' })
  }
  return out
})

const listboxId = computed(() => `${props.inputId}-listbox`)
const listSummary = computed(() => {
  if (!catalogLoaded.value || !catalog.value.length) return ''
  const shown = filtered.value.length
  const total = catalog.value.length
  const q = filterQuery.value.trim()
  if (!q) return `${total} text models — type to filter`
  return `${shown} match${shown === 1 ? '' : 'es'} · ${total} total`
})

function syncFilterFromCommitted() {
  if (props.optional && !String(props.modelValue ?? '').trim()) {
    filterQuery.value = ''
    return
  }
  filterQuery.value = committedModel.value
}

function updateListPosition() {
  const el = inputEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  listStyle.value = {
    top: rect.bottom + 4,
    left: rect.left,
    width: rect.width,
  }
}

function onScrollOrResize() {
  if (listOpen.value) updateListPosition()
}

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
  activeIndex.value = -1
  updateListPosition()
  if (!catalogLoaded.value && !loading.value) {
    void loadCatalog()
  }
}

function closeList() {
  listOpen.value = false
  activeIndex.value = -1
}

function commitModel(id) {
  const next = sanitizeOpenrouterModel(id)
  filterQuery.value = next
  emit('update:modelValue', next)
}

function selectModel(m) {
  if (!m?.id) return
  selectingFromList = true
  commitModel(m.id)
  closeList()
  void nextTick(() => {
    selectingFromList = false
    inputEl.value?.blur()
  })
}

function toggleList() {
  if (listOpen.value) {
    closeList()
    revertFilterIfNeeded()
    inputEl.value?.blur()
  } else {
    filterQuery.value = ''
    openList()
    void nextTick(() => {
      inputEl.value?.focus()
    })
  }
}

function revertFilterIfNeeded() {
  const q = filterQuery.value.trim()
  if (!q || !isValidOpenrouterModelId(q)) {
    syncFilterFromCommitted()
  }
}

function onInput() {
  if (!listOpen.value) openList()
  if (!catalogLoaded.value && !loading.value) {
    void loadCatalog()
  }
}

function onFocus() {
  inputFocused.value = true
  if (blurCloseTimer) {
    clearTimeout(blurCloseTimer)
    blurCloseTimer = null
  }
  filterQuery.value = ''
  openList()
}

function onBlur() {
  inputFocused.value = false
  if (selectingFromList) return
  blurCloseTimer = setTimeout(() => {
    blurCloseTimer = null
    if (selectingFromList) return
    const q = filterQuery.value.trim()
    if (!q && props.optional) {
      emit('update:modelValue', '')
      filterQuery.value = ''
    } else if (isValidOpenrouterModelId(q)) {
      commitModel(q)
    } else {
      syncFilterFromCommitted()
    }
    closeList()
  }, 180)
}

function onKeydown(e) {
  if (e.key === 'ArrowDown') {
    if (!listOpen.value) openList()
    if (filtered.value.length) {
      e.preventDefault()
      activeIndex.value =
        activeIndex.value < 0 ? 0 : (activeIndex.value + 1) % filtered.value.length
      scrollActiveIntoView()
    }
    return
  }
  if (e.key === 'ArrowUp' && listOpen.value && filtered.value.length) {
    e.preventDefault()
    activeIndex.value =
      activeIndex.value <= 0 ? filtered.value.length - 1 : activeIndex.value - 1
    scrollActiveIntoView()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    syncFilterFromCommitted()
    closeList()
    return
  }
  if (e.key === 'Enter' && listOpen.value && activeIndex.value >= 0 && filtered.value.length) {
    e.preventDefault()
    selectModel(filtered.value[activeIndex.value])
  }
}

function scrollActiveIntoView() {
  void nextTick(() => {
    const root = rootEl.value
    if (!root || activeIndex.value < 0) return
    const el = root.querySelector(`#${props.inputId}-opt-${activeIndex.value}`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onDocPointer(e) {
  if (!(e.target instanceof Node)) return
  const root = rootEl.value
  if (root?.contains(e.target)) return
  const listEl = document.getElementById(listboxId.value)
  if (listEl?.contains(e.target)) return
  if (!inputFocused.value) closeList()
}

watch(
  () => props.modelValue,
  () => {
    if (!inputFocused.value && !listOpen.value) {
      syncFilterFromCommitted()
    }
  },
  { immediate: true },
)

watch(filterQuery, () => {
  if (!listOpen.value) return
  activeIndex.value = -1
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
  syncFilterFromCommitted()
  if (props.preloadCatalog) {
    void loadCatalog()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
  if (blurCloseTimer) clearTimeout(blurCloseTimer)
})
</script>

<template>
  <div
    ref="rootEl"
    class="or-model-picker"
    :class="{ 'is-open': listOpen, 'is-focused': inputFocused, 'is-disabled': disabled }"
  >
    <div class="or-model-field">
      <input
        :id="inputId"
        ref="inputEl"
        v-model="filterQuery"
        class="or-model-input tap"
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
        placeholder="Search OpenRouter models…"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="or-model-toggle tap"
        tabindex="-1"
        :disabled="disabled"
        :aria-label="listOpen ? 'Close model list' : 'Browse all models'"
        :aria-expanded="listOpen"
        @mousedown.prevent="toggleList"
      >
        <svg
          class="or-model-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <Teleport v-if="teleportList" to="body">
      <ul
        v-if="listOpen"
        :id="listboxId"
        class="or-model-list or-model-list--teleport"
        :style="{ top: `${listStyle.top}px`, left: `${listStyle.left}px`, width: `${listStyle.width}px` }"
        role="listbox"
        aria-label="OpenRouter models"
      >
        <li v-if="listSummary" class="or-model-meta" role="presentation">{{ listSummary }}</li>
        <li v-if="loading" class="or-model-item or-model-item--muted" role="presentation">
          Loading models…
        </li>
        <li v-else-if="loadError" class="or-model-item or-model-item--err" role="presentation">
          {{ loadError }}
        </li>
        <template v-else>
          <li
            v-for="(m, i) in filtered"
            :key="m.id"
            :id="`${inputId}-opt-${i}`"
            class="or-model-item tap"
            role="option"
            :aria-selected="committedModel === m.id"
            :class="{
              'is-active': i === activeIndex,
              'is-selected': committedModel === m.id,
            }"
            @mousedown.prevent="selectModel(m)"
          >
            <span class="or-model-name">{{ m.name }}</span>
            <span class="or-model-id">{{ m.id }}</span>
          </li>
          <li
            v-if="!filtered.length"
            class="or-model-item or-model-item--muted"
            role="presentation"
          >
            No models match. Type a provider/model id (e.g. openai/gpt-4o-mini).
          </li>
        </template>
      </ul>
    </Teleport>

    <ul
      v-else-if="listOpen"
      :id="listboxId"
      class="or-model-list"
      role="listbox"
      aria-label="OpenRouter models"
    >
      <li v-if="listSummary" class="or-model-meta" role="presentation">{{ listSummary }}</li>
      <li v-if="loading" class="or-model-item or-model-item--muted" role="presentation">
        Loading models…
      </li>
      <li v-else-if="loadError" class="or-model-item or-model-item--err" role="presentation">
        {{ loadError }}
      </li>
      <template v-else>
        <li
          v-for="(m, i) in filtered"
          :key="m.id"
          :id="`${inputId}-opt-${i}`"
          class="or-model-item tap"
          role="option"
          :aria-selected="committedModel === m.id"
          :class="{
            'is-active': i === activeIndex,
            'is-selected': committedModel === m.id,
          }"
          @mousedown.prevent="selectModel(m)"
        >
          <span class="or-model-name">{{ m.name }}</span>
          <span class="or-model-id">{{ m.id }}</span>
        </li>
        <li
          v-if="!filtered.length"
          class="or-model-item or-model-item--muted"
          role="presentation"
        >
          No models match. Type a provider/model id (e.g. openai/gpt-4o-mini).
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.or-model-picker {
  position: relative;
  flex: 1 1 10rem;
  min-width: 0;
  margin-bottom: 0;
}

.or-model-field {
  display: flex;
  align-items: stretch;
  min-height: var(--touch-target, 2.75rem);
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-elevated, #0f0f14);
  transition: var(--transition-colors, border-color 0.2s ease, box-shadow 0.2s ease);
}

.or-model-picker.is-focused .or-model-field,
.or-model-picker.is-open .or-model-field {
  border-color: var(--color-accent-purple, #7b4db5);
  box-shadow: 0 0 0 3px rgba(123, 77, 181, 0.15);
}

.or-model-picker.is-disabled .or-model-field {
  opacity: 0.55;
}

.or-model-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  margin: 0;
  padding: var(--space-2-5, 0.625rem) var(--space-2, 0.5rem) var(--space-2-5, 0.625rem)
    var(--space-3, 0.75rem);
  border: none;
  border-radius: var(--radius-md, 0.5rem) 0 0 var(--radius-md, 0.5rem);
  background: transparent;
  color: var(--color-text-primary, #f4f4f8);
  font-size: var(--text-base, 0.9375rem);
  line-height: 1.35;
  min-height: var(--touch-target, 2.75rem);
  box-sizing: border-box;
}

.or-model-input:focus {
  outline: none;
}

.or-model-input::placeholder {
  color: var(--color-text-tertiary, #6e6e7e);
}

.or-model-input:disabled {
  cursor: not-allowed;
}

.or-model-toggle {
  flex: 0 0 var(--touch-target, 2.75rem);
  width: var(--touch-target, 2.75rem);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: none;
  border-left: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: 0 var(--radius-md, 0.5rem) var(--radius-md, 0.5rem) 0;
  background: transparent;
  color: var(--color-text-secondary, #a8a8b8);
  cursor: pointer;
}

.or-model-toggle:hover:not(:disabled) {
  color: var(--color-text-primary, #f4f4f8);
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}

.or-model-toggle:disabled {
  cursor: not-allowed;
}

.or-model-chevron {
  width: 1.125rem;
  height: 1.125rem;
  transition: transform 0.15s ease;
}

.or-model-picker.is-open .or-model-chevron {
  transform: rotate(180deg);
}

.or-model-list {
  position: absolute;
  z-index: var(--z-dropdown, 10);
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 0.2rem 0;
  max-height: min(18rem, 50vh);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  list-style: none;
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-elevated, #0f0f14);
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.35));
}

.or-model-list--teleport {
  position: fixed;
  z-index: 1400;
  right: auto;
  top: auto;
  max-height: min(20rem, 55vh);
}

.or-model-meta {
  padding: 0.35rem 0.75rem 0.45rem;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-tertiary, #6e6e7e);
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.04));
}

.or-model-item {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  text-align: left;
}

.or-model-item.is-active {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}

.or-model-item.is-selected .or-model-name {
  color: var(--color-accent-purple-light, #9d6fd7);
}

.or-model-item.is-selected .or-model-id {
  color: var(--color-accent-purple, #7b4db5);
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
  line-height: 1.3;
}

.or-model-id {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
  word-break: break-all;
}
</style>
