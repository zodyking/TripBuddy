<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import {
  getXPathPickerStatus,
  getXPathPickerPreview,
  startXPathPicker,
  stopXPathPicker,
  navigateXPathPicker,
  refreshXPathPicker,
  clearXPathPickerElements,
} from '../../api.js'
import { liveLogEntries } from '../../stores/liveLogStore.js'

const urlInput = ref('https://fdxtools.fedex.com/dispatch/')
const isActive = ref(false)
const isStarting = ref(false)
const isStopping = ref(false)
const error = ref(null)
const preview = ref(null)
const selectedElements = ref([])
const copiedIndex = ref(null)

let pollTimer = null

const recentElements = computed(() => {
  return [...selectedElements.value].reverse().slice(0, 20)
})

async function loadStatus() {
  try {
    const status = await getXPathPickerStatus()
    isActive.value = status.active
    selectedElements.value = status.elements || []
  } catch {
    /* ignore */
  }
}

async function pollPreview() {
  if (!isActive.value) {
    preview.value = null
    return
  }
  try {
    const p = await getXPathPickerPreview()
    if (p.active && p.image) {
      preview.value = {
        src: `data:image/jpeg;base64,${p.image}`,
        ts: p.ts ?? Date.now(),
      }
    } else {
      preview.value = null
    }
  } catch {
    /* ignore */
  }
}

async function startPicker() {
  if (isStarting.value || isActive.value) return
  const url = urlInput.value.trim()
  if (!url) {
    error.value = 'Enter a URL to start'
    return
  }
  error.value = null
  isStarting.value = true
  try {
    await startXPathPicker(url, false)
    isActive.value = true
    selectedElements.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    isStarting.value = false
  }
}

async function stopPicker() {
  if (isStopping.value || !isActive.value) return
  isStopping.value = true
  try {
    const result = await stopXPathPicker()
    isActive.value = false
    preview.value = null
    if (result.elements) {
      selectedElements.value = result.elements
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    isStopping.value = false
  }
}

async function navigateTo() {
  if (!isActive.value) return
  const url = urlInput.value.trim()
  if (!url) return
  error.value = null
  try {
    await navigateXPathPicker(url)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function refresh() {
  if (!isActive.value) return
  try {
    await refreshXPathPicker()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function clearElements() {
  try {
    await clearXPathPickerElements()
    selectedElements.value = []
  } catch {
    /* ignore */
  }
}

function copyXPath(xpath, index) {
  navigator.clipboard.writeText(xpath).then(() => {
    copiedIndex.value = index
    setTimeout(() => {
      copiedIndex.value = null
    }, 1500)
  }).catch(() => {
    /* fallback */
  })
}

function updateFromLiveLog() {
  const list = liveLogEntries.value
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.xpathPicker === true && e.element) {
      const exists = selectedElements.value.some(
        (el) => el.xpath === e.element.xpath && el.ts === e.element.ts
      )
      if (!exists) {
        selectedElements.value.push(e.element)
      }
    }
  }
}

onMounted(() => {
  loadStatus()
  pollTimer = setInterval(() => {
    if (isActive.value) {
      pollPreview()
      updateFromLiveLog()
    }
  }, 800)
})

onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<template>
  <div class="xpath-extractor">
    <h3 class="section-title">XPath Extractor</h3>
    <p class="section-desc">
      Open a webpage and click on elements to extract their XPath selectors for use in automations.
    </p>

    <div class="url-row">
      <input
        v-model="urlInput"
        type="text"
        class="url-input"
        placeholder="https://example.com"
        :disabled="isActive"
        @keyup.enter="isActive ? navigateTo() : startPicker()"
      />
      <button
        v-if="!isActive"
        type="button"
        class="btn primary tap"
        :disabled="isStarting"
        @click="startPicker"
      >
        {{ isStarting ? 'Starting…' : 'Start' }}
      </button>
      <template v-else>
        <button type="button" class="btn tap" @click="navigateTo">Go</button>
        <button type="button" class="btn tap" @click="refresh">Refresh</button>
        <button
          type="button"
          class="btn danger tap"
          :disabled="isStopping"
          @click="stopPicker"
        >
          {{ isStopping ? 'Stopping…' : 'Stop' }}
        </button>
      </template>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>

    <div v-if="isActive" class="active-indicator">
      <span class="pulse-dot"></span>
      <span>Picker active — click elements in the browser to extract XPath</span>
    </div>

    <div v-if="isActive && preview" class="preview-panel">
      <img :src="preview.src" alt="Browser preview" class="preview-img" />
    </div>

    <div class="elements-section">
      <div class="elements-header">
        <h4>Extracted XPaths ({{ selectedElements.length }})</h4>
        <button
          v-if="selectedElements.length > 0"
          type="button"
          class="btn sm tap"
          @click="clearElements"
        >
          Clear
        </button>
      </div>

      <p v-if="!selectedElements.length" class="empty-hint">
        No elements selected yet. Start the picker and click elements in the browser.
      </p>

      <div v-else class="elements-list">
        <div
          v-for="(el, idx) in recentElements"
          :key="el.ts"
          class="element-card"
        >
          <div class="element-info">
            <span class="element-tag">{{ el.tagName }}</span>
            <span v-if="el.id" class="element-id">#{{ el.id }}</span>
            <span v-if="el.text" class="element-text">{{ el.text.slice(0, 40) }}{{ el.text.length > 40 ? '…' : '' }}</span>
          </div>
          <div class="xpath-row">
            <code class="xpath-code">{{ el.xpath }}</code>
            <button
              type="button"
              class="btn sm tap copy-btn"
              :class="{ copied: copiedIndex === idx }"
              @click="copyXPath(el.xpath, idx)"
            >
              {{ copiedIndex === idx ? 'Copied!' : 'Copy' }}
            </button>
          </div>
          <div v-if="el.fullXpath && el.fullXpath !== el.xpath" class="full-xpath">
            <span class="xpath-label">Full:</span>
            <code class="xpath-code-small">{{ el.fullXpath }}</code>
            <button
              type="button"
              class="btn sm tap copy-btn-small"
              @click="copyXPath(el.fullXpath, idx + 1000)"
            >
              {{ copiedIndex === idx + 1000 ? '✓' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xpath-extractor {
  padding: 0.5rem 0;
}

.section-title {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
}

.section-desc {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  line-height: 1.4;
}

.url-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.url-input {
  flex: 1;
  min-width: 200px;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  font-size: 0.9rem;
}

.btn {
  min-height: 40px;
  padding: 0.5rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  font-size: 0.9rem;
  cursor: pointer;
}

.btn.primary {
  background: #5c2d91;
  border-color: #7b4db5;
}

.btn.danger {
  background: #8b2635;
  border-color: #c53d4f;
}

.btn.sm {
  min-height: 32px;
  padding: 0.3rem 0.65rem;
  font-size: 0.8rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tap:active {
  opacity: 0.85;
}

.error-msg {
  color: #ff8a80;
  margin: 0 0 1rem;
  font-size: 0.85rem;
}

.active-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  background: #1b2e1b;
  border: 1px solid #4caf50;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #c8e6c9;
}

.pulse-dot {
  width: 10px;
  height: 10px;
  background: #4caf50;
  border-radius: 50%;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.9); }
}

.preview-panel {
  margin-bottom: 1rem;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border, #2e2e38);
  background: #0a0a0f;
}

.preview-img {
  width: 100%;
  height: auto;
  display: block;
  max-height: 300px;
  object-fit: contain;
}

.elements-section {
  margin-top: 1rem;
}

.elements-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.elements-header h4 {
  margin: 0;
  font-size: 0.95rem;
}

.empty-hint {
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--muted, #9898a8);
  background: #14141c;
  border: 1px dashed var(--border, #2e2e38);
  border-radius: 8px;
}

.elements-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.element-card {
  padding: 0.65rem 0.85rem;
  background: #14141c;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 8px;
}

.element-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.element-tag {
  padding: 0.15rem 0.4rem;
  background: #5c2d91;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.element-id {
  color: #90caf9;
  font-size: 0.8rem;
  font-family: monospace;
}

.element-text {
  color: var(--muted, #9898a8);
  font-size: 0.8rem;
  font-style: italic;
}

.xpath-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.xpath-code {
  flex: 1;
  padding: 0.4rem 0.6rem;
  background: #0a0a0f;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: monospace;
  color: #a5d6a7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  flex-shrink: 0;
}

.copy-btn.copied {
  background: #2e7d32;
  border-color: #4caf50;
}

.full-xpath {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.4rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border, #2e2e38);
}

.xpath-label {
  font-size: 0.7rem;
  color: var(--muted, #9898a8);
  flex-shrink: 0;
}

.xpath-code-small {
  flex: 1;
  font-size: 0.7rem;
  font-family: monospace;
  color: var(--muted, #9898a8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn-small {
  min-height: 24px;
  padding: 0.15rem 0.4rem;
  font-size: 0.7rem;
}
</style>
