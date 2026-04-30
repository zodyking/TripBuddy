<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import TrafficCrossingsContent from './TrafficCrossingsContent.vue'
import TrafficCorridorsSchematic from '../components/TrafficCorridorsSchematic.vue'
import { postTrafficTomtomCorridors } from '../api.js'

defineOptions({ name: 'TrafficView' })

/** @typedef {'crossings' | 'corridors'} TrafficTab */
/** @type {import('vue').Ref<TrafficTab>} */
const tab = ref('crossings')

const POLL_MS = 5 * 60 * 1000

/** @type {import('vue').Ref<any | null>} */
const corridorPayload = ref(null)
const corridorLoading = ref(false)
const corridorError = ref('')
const corridorConfigError = ref('')
/** @type {ReturnType<typeof setInterval> | null} */
let corridorInterval = null

async function loadCorridors() {
  corridorLoading.value = true
  corridorError.value = ''
  corridorConfigError.value = ''
  try {
    const r = await postTrafficTomtomCorridors({})
    if (r && typeof r === 'object' && r.ok === false) {
      corridorConfigError.value =
        typeof r.error === 'string' ? r.error : 'Traffic API unavailable'
      corridorPayload.value = null
      return
    }
    corridorPayload.value = r
  } catch (e) {
    corridorError.value = e instanceof Error ? e.message : 'Failed to load corridor traffic'
    corridorPayload.value = null
  } finally {
    corridorLoading.value = false
  }
}

watch(tab, (t) => {
  if (t === 'corridors') {
    void loadCorridors()
    if (!corridorInterval) {
      corridorInterval = setInterval(() => {
        void loadCorridors()
      }, POLL_MS)
    }
  } else if (corridorInterval) {
    clearInterval(corridorInterval)
    corridorInterval = null
  }
})

onMounted(() => {
  if (tab.value === 'corridors') {
    void loadCorridors()
    corridorInterval = setInterval(() => void loadCorridors(), POLL_MS)
  }
})

onUnmounted(() => {
  if (corridorInterval) {
    clearInterval(corridorInterval)
    corridorInterval = null
  }
})
</script>

<template>
  <div class="traffic-hub">
    <nav class="traffic-hub-tabs" role="tablist" aria-label="Traffic views">
      <button
        type="button"
        role="tab"
        class="traffic-hub-tab tap"
        :class="{ 'is-active': tab === 'crossings' }"
        :aria-selected="tab === 'crossings'"
        @click="tab = 'crossings'"
      >
        Crossings
      </button>
      <button
        type="button"
        role="tab"
        class="traffic-hub-tab tap"
        :class="{ 'is-active': tab === 'corridors' }"
        :aria-selected="tab === 'corridors'"
        @click="tab = 'corridors'"
      >
        Corridors
      </button>
    </nav>

    <div
      v-show="tab === 'crossings'"
      class="traffic-hub-panel traffic-hub-panel--crossings"
      role="tabpanel"
    >
      <TrafficCrossingsContent />
    </div>
    <div
      v-show="tab === 'corridors'"
      class="traffic-hub-panel traffic-hub-panel--corridors"
      role="tabpanel"
    >
      <TrafficCorridorsSchematic
        :payload="corridorPayload"
        :loading="corridorLoading"
        :error="corridorError"
        :config-error="corridorConfigError"
      />
    </div>
  </div>
</template>

<style scoped>
.traffic-hub {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  padding-bottom: 0.35rem;
}

.traffic-hub-tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
  flex-shrink: 0;
  padding-left: max(env(safe-area-inset-left, 0px), var(--space-2, 0.5rem));
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-2, 0.5rem));
  padding-top: 0.45rem;
}

.traffic-hub-tab {
  flex: 1;
  max-width: 12rem;
  padding: 0.42rem 0.65rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(15, 15, 20, 0.85);
  color: #a8a8b8;
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.traffic-hub-tab.is-active {
  color: #f4f4f8;
  border-color: rgba(199, 168, 255, 0.45);
  background: rgba(123, 77, 181, 0.28);
}

.traffic-hub-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.traffic-hub-panel--crossings {
  padding-left: max(env(safe-area-inset-left, 0px), var(--space-2, 0.5rem));
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-2, 0.5rem));
}

.traffic-hub-panel--corridors {
  padding-bottom: 0.25rem;
  padding-left: max(env(safe-area-inset-left, 0px), var(--space-2, 0.5rem));
  padding-right: max(env(safe-area-inset-right, 0px), var(--space-2, 0.5rem));
}
</style>
