<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { postAuthLogout } from '../api.js'
import { useApiHealth } from '../composables/useApiHealth.js'
import {
  connectLiveLogStream,
  disconnectLiveLogStream,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'

const route = useRoute()
const router = useRouter()
const { apiOk, refreshHealth } = useApiHealth()

async function logoutApp() {
  try {
    await postAuthLogout()
  } catch {
    /* still navigate */
  }
  await router.push({ name: 'login' })
}

const headerAriaLabel = 'FedExTool — Linehaul'

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
    <header class="app-header" role="banner" :aria-label="headerAriaLabel">
      <div class="header-inner">
        <div class="header-left">
          <span class="brand" aria-label="FedEx">
            <span class="brand-fed">Fed</span><span class="brand-ex">Ex</span>
          </span>
        </div>

        <div class="header-center">
          <span class="header-title header-title--center">Linehaul</span>
        </div>

        <div class="header-right">
          <button
            type="button"
            class="header-sign-out tap"
            aria-label="Sign out of app"
            @click="logoutApp"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>

    <div class="app-body">
      <div v-if="apiOk === false" class="offline-banner">
        <div class="offline-banner-inner">
          <span class="offline-icon">!</span>
          <span class="offline-text">API offline — run <code>npm run dev</code> from project root</span>
        </div>
      </div>

      <!-- Full-width scroll area so side gutters scroll with page content (not only the centered column). -->
      <div class="app-scroll">
        <main
          class="app-main"
          :class="{
            'app-main--directory': route.name === 'directory',
          }"
        >
          <RouterView />
        </main>
      </div>
    </div>

    <nav class="bottom-nav" aria-label="Main navigation">
      <RouterLink
        class="nav-item"
        :class="{ 'is-active': route.name === 'home' }"
        to="/"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span class="nav-label">Home</span>
      </RouterLink>
      <RouterLink
        class="nav-item"
        :class="{ 'is-active': route.name === 'directory' }"
        to="/directory"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        <span class="nav-label">Directory</span>
      </RouterLink>
      <RouterLink
        class="nav-item"
        :class="{ 'is-active': route.name === 'settings' }"
        to="/settings"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span class="nav-label">Settings</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HEADER — Glass morphism with gradient accent
   ═══════════════════════════════════════════════════════════════════════════ */
.app-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header, 30);
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-lg, 20px));
  -webkit-backdrop-filter: blur(var(--blur-lg, 20px));
  border-bottom: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.3)),
              inset 0 -1px 0 var(--color-glass-highlight, rgba(255, 255, 255, 0.03));
}

.header-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3, 0.75rem);
  max-width: var(--app-content-max, 40rem);
  margin-inline: auto;
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  padding-top: max(var(--space-3, 0.75rem), env(safe-area-inset-top));
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-2-5, 0.625rem);
  justify-self: start;
}

.brand {
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-bold, 700);
  letter-spacing: var(--tracking-tight, -0.02em);
  line-height: var(--leading-none, 1);
  user-select: none;
}

.brand-fed {
  color: var(--color-accent-purple, #7b4db5);
}

.brand-ex {
  color: var(--color-accent-orange, #ff6b1a);
}

.header-divider {
  width: 1px;
  height: 1.25rem;
  background: var(--color-border, rgba(255, 255, 255, 0.08));
  opacity: 0.5;
}

.header-title {
  font-size: var(--text-base, 0.9375rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: var(--tracking-wide, 0.025em);
  text-transform: uppercase;
}

.header-title--center {
  display: block;
  text-align: center;
  width: 100%;
  min-width: 0;
}

/* Header Center — title only */
.header-center {
  justify-self: stretch;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Header Right — Sign out */
.header-right {
  justify-self: end;
}

.header-sign-out {
  padding: var(--space-2, 0.5rem) var(--space-3, 0.75rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-lg, 0.75rem);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #a8a8b8);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.025em);
}

.header-sign-out:hover {
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
}

/* Offline Banner */
.offline-banner {
  background: var(--color-error-muted, rgba(239, 68, 68, 0.15));
  border-bottom: 1px solid var(--color-error-border, rgba(239, 68, 68, 0.3));
}

.offline-banner-inner {
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  max-width: var(--app-content-max, 40rem);
  margin-inline: auto;
  padding: var(--space-2, 0.5rem) var(--space-4, 1rem);
}

.offline-icon {
  width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full, 9999px);
  background: var(--color-error, #ef4444);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-bold, 700);
  color: white;
  flex-shrink: 0;
}

.offline-text {
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-primary, #f4f4f8);
}

.offline-text code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: var(--radius-sm, 0.375rem);
  background: rgba(0, 0, 0, 0.3);
}

/* Middle column: header → scrollable region → footer (fixed). Gutters are inside the scroller. */
.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  display: flex;
  flex-direction: column;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════════ */
.app-main {
  flex: 1 0 auto;
  box-sizing: border-box;
  max-width: var(--app-content-max, 40rem);
  width: 100%;
  margin-inline: auto;
  padding-inline: var(--space-4, 1rem);
  padding-bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0) + 1rem);
  min-height: 0;
}

/* Directory: edge-to-edge horizontal, no centered column — inner view owns scroll regions */
.app-main.app-main--directory {
  flex: 1;
  min-height: 0;
  max-width: none;
  margin-inline: 0;
  padding-inline: 0;
  padding-bottom: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Split-pane directory: only the list column scrolls, not the main element */
@media (orientation: landscape) and (min-width: 700px) {
  .app-main.app-main--directory {
    overflow-y: hidden;
  }
}

.app-main.app-main--directory > * {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
}

@media (orientation: landscape) and (min-width: 700px) {
  .app-main.app-main--directory > * {
    flex: 1;
    min-height: 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOTTOM NAVIGATION — Opaque bar (content must not show through)
   ═══════════════════════════════════════════════════════════════════════════ */
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-sticky, 20);
  display: flex;
  height: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0px));
  max-height: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0px));
  background: var(--color-bg-base, #08080a);
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.35);
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1, 0.25rem);
  padding: var(--space-2, 0.5rem);
  text-decoration: none;
  color: var(--color-text-tertiary, #6e6e7e);
  transition: var(--transition-colors);
  position: relative;
  -webkit-tap-highlight-color: transparent;
}

.nav-item:active {
  transform: scale(0.96);
}

.nav-icon {
  width: 1.375rem;
  height: 1.375rem;
  stroke-width: 1.75;
  transition: var(--transition-colors);
}

.nav-label {
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: var(--tracking-wide, 0.025em);
  text-transform: uppercase;
}

.nav-item.is-active {
  color: var(--color-text-primary, #f4f4f8);
}

.nav-item.is-active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 2.5rem;
  height: 2px;
  background: var(--color-accent-purple, #7b4db5);
  border-radius: 0 0 var(--radius-full, 9999px) var(--radius-full, 9999px);
}

.nav-item.is-active .nav-icon {
  color: var(--color-accent-purple, #7b4db5);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPONSIVE — Mobile-first breakpoints
   ═══════════════════════════════════════════════════════════════════════════ */

/* Small mobile (up to 374px) */
@media (max-width: 374px) {
  .header-inner {
    grid-template-columns: auto 1fr auto;
    gap: var(--space-1-5, 0.375rem);
    padding-inline: var(--space-2, 0.5rem);
  }

  .header-left {
    gap: var(--space-1-5, 0.375rem);
  }

  .brand {
    font-size: var(--text-base, 0.9375rem);
  }

  .header-title--center {
    font-size: var(--text-xs, 0.6875rem);
  }

  .api-status {
    padding: var(--space-0-5, 0.125rem) var(--space-1-5, 0.375rem);
  }

  .api-label {
    display: none;
  }

  .nav-label {
    font-size: 0.625rem;
  }
}

/* Large mobile / small tablet (420px+) */
@media (min-width: 420px) {
  .header-inner {
    gap: var(--space-4, 1rem);
  }
}

/* Tablet and up (640px+) */
@media (min-width: 640px) {
  .header-inner {
    padding: var(--space-4, 1rem) var(--space-6, 1.5rem);
  }

  .header-title {
    font-size: var(--text-md, 1rem);
  }

  .nav-icon {
    width: 1.5rem;
    height: 1.5rem;
  }

  .nav-label {
    font-size: var(--text-xs, 0.6875rem);
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .nav-item:active {
    transform: none;
  }

  .api-dot,
  .nav-item {
    transition: none;
  }
}
</style>
