<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useApiHealth } from '../composables/useApiHealth.js'
import {
  connectLiveLogStream,
  disconnectLiveLogStream,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import { getCredentials } from '../api.js'
import { linehaulDriverIdFromCredMeta } from '../stores/linehaulSnapshotStore.js'

const route = useRoute()
const { apiOk, refreshHealth } = useApiHealth()

/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const credMeta = ref(null)

async function refreshHeaderCreds() {
  try {
    credMeta.value = await getCredentials()
  } catch {
    credMeta.value = null
  }
}

const headerDriverId = computed(() =>
  linehaulDriverIdFromCredMeta(credMeta.value ?? {}),
)

const headerTractor = computed(() => {
  const t = credMeta.value?.tractorNumber
  return typeof t === 'string' && t.trim() ? t.trim() : ''
})

const showHeaderCenter = computed(
  () => Boolean(headerDriverId.value || headerTractor.value),
)

const headerAriaLabel = 'FedExTool — Linehaul'

function onVisibility() {
  if (document.visibilityState === 'visible') void refreshHeaderCreds()
}

onMounted(() => {
  connectLiveLogStream()
  void refreshHeaderCreds()
  document.addEventListener('visibilitychange', onVisibility)
  for (const ms of [500, 1500, 3500]) {
    setTimeout(() => {
      void refreshHealth().then(() => {
        if (apiOk.value) reconnectLiveLogStream()
      })
    }, ms)
  }
})

watch(
  () => route.path,
  () => {
    void refreshHeaderCreds()
  },
)

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  disconnectLiveLogStream()
})
</script>

<template>
  <div class="app-shell">
    <header class="app-top app-top-grid" role="banner" :aria-label="headerAriaLabel">
      <div class="app-top-left">
        <span class="brand-fedex" aria-label="FedEx">
          <span class="brand-fed">Fed</span><span class="brand-ex">Ex</span>
        </span>
        <span class="page-heading">Linehaul</span>
      </div>
      <div
        v-if="showHeaderCenter"
        class="app-top-center"
        aria-label="Driver and tractor from saved credentials"
      >
        <span v-if="headerDriverId" class="app-top-center-item"
          >Driver {{ headerDriverId }}</span
        >
        <span v-if="headerDriverId && headerTractor" class="app-top-center-sep" aria-hidden="true"
          >·</span
        >
        <span v-if="headerTractor" class="app-top-center-item"
          >Tractor {{ headerTractor }}</span
        >
      </div>
      <div v-else class="app-top-center app-top-center--empty" aria-hidden="true" />
      <div class="pill" :data-ok="apiOk === true">
        API: {{ apiOk === null ? '…' : apiOk ? 'ok' : 'offline' }}
      </div>
    </header>

    <p v-if="apiOk === false" class="offline-hint">
      The API on port 3847 is offline. Running <code>vite</code> alone usually starts it automatically; otherwise use <code>npm run dev</code>. Live log uses a direct connection to the API in dev.
    </p>

    <div class="app-content">
      <RouterView />
    </div>

    <nav class="bottom-nav" aria-label="Main">
      <RouterLink
        class="nav-item tap"
        :class="{ 'nav-item-active': route.name === 'home' }"
        to="/"
      >
        Home
      </RouterLink>
      <RouterLink
        class="nav-item tap"
        :class="{ 'nav-item-active': route.name === 'settings' }"
        to="/settings"
      >
        Settings
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  padding-bottom: calc(3.5rem + env(safe-area-inset-bottom, 0));
}
.app-top-grid {
  position: sticky;
  top: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr) minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border, #2e2e38);
  background: var(--bg, #0f0f12);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
}
.app-top-left {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  justify-self: start;
}
.brand-fedex {
  flex-shrink: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  user-select: none;
}
.brand-fed {
  color: #4d148c;
}
.brand-ex {
  color: #ff6600;
}
.page-heading {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
.app-top-center {
  justify-self: center;
  min-width: 0;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  line-height: 1.25;
  color: var(--muted, #9898a8);
}
.app-top-center--empty {
  min-height: 1em;
  pointer-events: none;
}
.app-top-center-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 42vw;
}
.app-top-center-sep {
  flex-shrink: 0;
  opacity: 0.7;
}
.pill {
  justify-self: end;
  flex-shrink: 0;
  font-size: 0.75rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--border, #2e2e38);
  color: var(--muted, #9898a8);
}
.pill[data-ok='true'] {
  border-color: #2e7d32;
  color: #a5d6a7;
}
.offline-hint {
  font-size: 0.85rem;
  color: #ffcc80;
  margin: 0;
  padding: 0.5rem 1rem 0.75rem;
  max-width: var(--app-content-max, 36rem);
  margin-inline: auto;
}
.app-content {
  max-width: var(--app-content-max, 36rem);
  margin-inline: auto;
  padding-inline: 1rem;
}
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  border-top: 1px solid var(--border, #2e2e38);
  background: #12121a;
  padding-bottom: env(safe-area-inset-bottom, 0);
  z-index: 20;
}
.nav-item {
  flex: 1;
  text-align: center;
  padding: 1rem;
  font-weight: 600;
  color: var(--text, #e8e8ee);
  text-decoration: none;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-item-active {
  color: #ffb74d;
}
.tap:active {
  opacity: 0.88;
}
code {
  font-size: 0.9em;
}
</style>
