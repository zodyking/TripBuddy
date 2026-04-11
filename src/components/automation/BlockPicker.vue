<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  target: { type: String, required: true },
  schema: { type: Object, required: true },
})

const emit = defineEmits(['select', 'close'])

const searchQuery = ref('')
const selectedCategory = ref(null)

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
  eye: '👁',
  'eye-off': '🙈',
  hash: '#',
  calendar: '📅',
  zap: '⚡',
  server: '🖥',
  hand: '✋',
}

function getIcon(iconName) {
  return ICONS[iconName] || '•'
}

const isActionPicker = computed(() => props.target === 'actions')
const isTriggerPicker = computed(() => props.target === 'triggers')
const isConditionPicker = computed(() => props.target === 'conditions')

const categories = computed(() => {
  if (isTriggerPicker.value) {
    return [{ key: 'triggers', label: 'Triggers', icon: 'zap' }]
  }
  if (isConditionPicker.value) {
    return [{ key: 'conditions', label: 'Conditions', icon: 'eye' }]
  }
  if (!props.schema?.categories) return []
  return Object.entries(props.schema.categories).map(([key, cat]) => ({
    key,
    label: cat.label,
    icon: cat.icon,
    blocks: cat.blocks,
  }))
})

const items = computed(() => {
  let blocks = []

  if (isTriggerPicker.value && props.schema?.triggers) {
    blocks = Object.entries(props.schema.triggers).map(([key, def]) => ({
      type: key,
      ...def,
    }))
  } else if (isConditionPicker.value && props.schema?.conditions) {
    blocks = Object.entries(props.schema.conditions).map(([key, def]) => ({
      type: key,
      ...def,
    }))
  } else if (props.schema?.blocks) {
    if (selectedCategory.value) {
      const cat = props.schema.categories[selectedCategory.value]
      if (cat?.blocks) {
        blocks = cat.blocks
          .map((type) => props.schema.blocks[type])
          .filter(Boolean)
      }
    } else {
      blocks = Object.values(props.schema.blocks)
    }
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    blocks = blocks.filter((b) =>
      b.label?.toLowerCase().includes(q) ||
      b.type?.toLowerCase().includes(q) ||
      b.category?.toLowerCase().includes(q)
    )
  }

  return blocks
})

function selectBlock(block) {
  emit('select', block.type, block)
}

function selectCategory(key) {
  selectedCategory.value = selectedCategory.value === key ? null : key
}
</script>

<template>
  <div class="picker-overlay" @click.self="$emit('close')">
    <div class="picker-modal">
      <header class="picker-header">
        <h2 class="picker-title">
          <template v-if="isTriggerPicker">Add Trigger</template>
          <template v-else-if="isConditionPicker">Add Condition</template>
          <template v-else>Add Action</template>
        </h2>
        <button type="button" class="close-btn tap" @click="$emit('close')">✕</button>
      </header>

      <div class="search-row">
        <input
          v-model="searchQuery"
          class="search-input"
          type="text"
          placeholder="Search actions…"
          autofocus
        />
      </div>

      <div class="picker-body">
        <aside v-if="isActionPicker && !searchQuery" class="categories">
          <button
            v-for="cat in categories"
            :key="cat.key"
            type="button"
            class="cat-btn tap"
            :class="{ active: selectedCategory === cat.key }"
            @click="selectCategory(cat.key)"
          >
            <span class="cat-icon">{{ getIcon(cat.icon) }}</span>
            <span class="cat-label">{{ cat.label }}</span>
          </button>
        </aside>

        <div class="blocks-grid">
          <button
            v-for="block in items"
            :key="block.type"
            type="button"
            class="block-btn tap"
            @click="selectBlock(block)"
          >
            <span class="block-icon">{{ getIcon(block.icon) }}</span>
            <span class="block-label">{{ block.label }}</span>
            <span v-if="block.isContainer" class="block-badge">Container</span>
          </button>
          <p v-if="!items.length" class="no-results">No matching blocks found</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.picker-modal {
  background: #14141c;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 12px;
  width: 100%;
  max-width: 700px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border, #2e2e38);
}

.picker-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: var(--muted, #9898a8);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
}

.search-row {
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--border, #2e2e38);
}

.search-input {
  width: 100%;
  padding: 0.6rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #1a1a24;
  color: var(--text, #e8e8ee);
  font-size: 0.95rem;
}

.picker-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.categories {
  width: 180px;
  border-right: 1px solid var(--border, #2e2e38);
  padding: 0.75rem;
  overflow-y: auto;
  flex-shrink: 0;
}

.cat-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text, #e8e8ee);
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
  margin-bottom: 0.25rem;
}

.cat-btn:hover {
  background: #1f1f2a;
}

.cat-btn.active {
  background: #2a2a3a;
  color: #c4a6e8;
}

.cat-icon {
  font-size: 1rem;
}

.blocks-grid {
  flex: 1;
  padding: 0.75rem;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
  align-content: start;
}

.block-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: 0.75rem;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  background: #1a1a24;
  color: var(--text, #e8e8ee);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.block-btn:hover {
  border-color: #5c2d91;
  background: #1f1f2a;
}

.block-icon {
  font-size: 1.25rem;
}

.block-label {
  font-size: 0.85rem;
  font-weight: 500;
}

.block-badge {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: rgba(92, 45, 145, 0.3);
  color: #c4a6e8;
}

.no-results {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--muted, #9898a8);
  padding: 2rem;
}

.tap:active {
  opacity: 0.85;
}

@media (max-width: 600px) {
  .categories {
    display: none;
  }
  .blocks-grid {
    grid-template-columns: 1fr;
  }
}
</style>
