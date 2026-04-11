<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useApiHealth } from '../composables/useApiHealth.js'
import {
  connectLiveLogStream,
  disconnectLiveLogStream,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'

const route = useRoute()
const { apiOk, refreshHealth } = useApiHealth()

const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : ''))

const headerAriaLabel = computed(() =>
  pageTitle.value ? `FedExTool — ${pageTitle.value}` : 'FedExTool',
)

onMounted(() => {
  connectLiveLogStream()
  for (const ms of [500, 1500, 3500]) {
    setTimeout(() => {
      void refreshHealth().then(() => {
        if (apiOk.value) reconnectLiveLogStream()
      })
    }, ms)
  }
})

onUnmounted(() => {
  disconnectLiveLogStream()
})
</script>

<template>
  <div class="app-shell">
    <header class="app-top" role="banner" :aria-label="headerAriaLabel">
      <div class="app-top-left">
        <span class="brand-fedex" aria-label="FedEx">
          <span class="brand-fed">Fed</span><span class="brand-ex">Ex</span>
        </span>
        <span v-if="pageTitle" class="page-heading">{{ pageTitle }}</span>
      </div>
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
.app-top {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
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
.pill {
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
