<script setup>
import { onMounted, onUnmounted, watch, nextTick, Teleport } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { postAuthLogout } from '../api.js'
import { resetLinehaulSession } from '../stores/linehaulSnapshotStore.js'
import { useApiHealth } from '../composables/useApiHealth.js'
import {
  connectLiveLogStream,
  disconnectLiveLogStream,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import {
  items,
  toasts,
  menuOpen,
  unreadCount,
  fetchInAppInbox,
  markInAppItemRead,
  markInAppAllRead,
} from '../stores/inAppNotificationsStore.js'

const route = useRoute()
const router = useRouter()
const { apiOk, refreshHealth } = useApiHealth()

function fmtNotifTime(ts) {
  if (typeof ts !== 'number') return '—'
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

const bellBadge = (n) => (n > 99 ? '99+' : String(n))

function toggleNotifMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    void fetchInAppInbox()
  }
}

/** @type {((e: Event) => void) | null} */
let docClickClose = null
watch(menuOpen, (o) => {
  if (docClickClose) {
    document.removeEventListener('click', docClickClose)
    docClickClose = null
  }
  if (o) {
    nextTick(() => {
      docClickClose = (e) => {
        const t = e.target
        if (t && typeof t === 'object' && 'closest' in t) {
          if (/** @type {Element} */(t).closest('.notif-wrap')) return
        }
        menuOpen.value = false
      }
      setTimeout(() => document.addEventListener('click', docClickClose), 0)
    })
  }
})

async function logoutApp() {
  try {
    await postAuthLogout()
  } catch {
    /* still navigate */
  }
  resetLinehaulSession()
  await router.push({ name: 'login' })
}

const headerAriaLabel = 'FedExTool — Linehaul'

onMounted(() => {
  connectLiveLogStream()
  void fetchInAppInbox()
  for (const ms of [500, 1500, 3500]) {
    setTimeout(() => {
      void refreshHealth().then(() => {
        if (apiOk.value) reconnectLiveLogStream()
      })
    }, ms)
  }
})

onUnmounted(() => {
  if (docClickClose) {
    document.removeEventListener('click', docClickClose)
    docClickClose = null
  }
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
          <div v-if="route.name !== 'login'" class="notif-wrap">
            <button
              type="button"
              class="header-bell tap"
              :class="{ 'header-bell--open': menuOpen }"
              aria-label="Notifications"
              :aria-expanded="menuOpen"
              @click.stop="toggleNotifMenu"
            >
              <span class="header-bell-ico" aria-hidden="true">&#128276;</span>
              <span v-if="unreadCount > 0" class="header-bell-n">{{ bellBadge(unreadCount) }}</span>
            </button>
            <div
              v-if="menuOpen"
              class="notif-popover"
              role="menu"
              @click.stop
            >
              <div class="notif-pop-head">
                <span class="notif-pop-title">Notifications</span>
                <button
                  v-if="unreadCount > 0"
                  type="button"
                  class="notif-markall tap"
                  @click="markInAppAllRead"
                >Mark all read</button
                >
              </div>
              <ul v-if="items.length" class="notif-list" aria-label="Notification history">
                <li
                  v-for="it in items"
                  :key="it.id"
                  class="notif-li"
                  :class="{ 'notif-li--unread': !it.read }"
                >
                  <p class="notif-msg">{{ it.message }}</p>
                  <p class="notif-meta">{{ fmtNotifTime(it.ts) }}{{ it.source ? ` · ${it.source}` : '' }}</p>
                </li>
              </ul>
              <p v-else class="notif-empty">No notifications yet</p>
            </div>
          </div>
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

    <Teleport to="body">
      <div
        v-if="route.name !== 'login' && toasts.length"
        class="inapp-toast-host"
        role="status"
        aria-live="polite"
      >
        <button
          v-for="t in toasts"
          :key="t.id"
          type="button"
          class="inapp-toast tap"
          @click="markInAppItemRead(t.id)"
        >
          <span class="inapp-toast-txt">{{ t.message }}</span>
        </button>
        <p class="inapp-toast-hint">Tap to dismiss</p>
      </div>
    </Teleport>

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
            'app-main--bridges': route.name === 'bridges',
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
        :class="{ 'is-active': route.name === 'history' }"
        to="/history"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        <span class="nav-label">History</span>
      </RouterLink>
      <RouterLink
        class="nav-item"
        :class="{ 'is-active': route.name === 'bridges' }"
        to="/bridges"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 20h4l4-12 3 6 3-6h6"/>
          <path d="M2 20h20"/>
        </svg>
        <span class="nav-label">Bridges</span>
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

/* Header Right — Sign out + bell */
.header-right {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
}

.notif-wrap {
  position: relative;
}

.header-bell {
  position: relative;
  min-width: 2.4rem;
  min-height: 2.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-lg, 0.75rem);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary, #a8a8b8);
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.header-bell:hover,
.header-bell--open {
  background: rgba(123, 77, 181, 0.2);
  border-color: rgba(123, 77, 181, 0.45);
  color: #e8e0ff;
}
.header-bell-ico {
  font-size: 1.1rem;
  line-height: 1;
  filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.3));
}
.header-bell-n {
  position: absolute;
  right: 0;
  top: 0;
  min-width: 0.9rem;
  min-height: 0.9rem;
  padding: 0.05rem 0.2rem;
  font-size: 0.5rem;
  font-weight: 800;
  line-height: 1.1;
  text-align: center;
  border-radius: 9999px;
  background: #ef4444;
  color: #fff;
  transform: translate(35%, -30%);
  border: 1px solid #7f1d1d;
}

.notif-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: min(20rem, calc(100vw - 2.5rem));
  max-height: 70dvh;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: linear-gradient(165deg, #1a1a24 0%, #12121a 100%);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  z-index: calc(var(--z-header, 30) + 2);
  overflow: hidden;
}

.notif-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.25);
}
.notif-pop-title {
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9a9ab0;
}
.notif-markall {
  font-size: 0.58rem;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.45rem;
  border-radius: 6px;
  border: 1px solid #3a3a48;
  background: #1e1e25;
  color: #a8a8b8;
  cursor: pointer;
}
.notif-markall:hover {
  color: #e0e0f0;
  border-color: #5a5a68;
}
.notif-list {
  list-style: none;
  margin: 0;
  padding: 0.35rem 0;
  overflow: auto;
  max-height: min(56dvh, 22rem);
}
.notif-li {
  padding: 0.4rem 0.65rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: default;
}
.notif-li--unread {
  background: rgba(123, 77, 181, 0.12);
}
.notif-li:last-child {
  border-bottom: 0;
}
.notif-msg {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.3;
  color: #e8e8f0;
  text-align: left;
  word-break: break-word;
}
.notif-meta {
  margin: 0.2rem 0 0;
  font-size: 0.6rem;
  color: #6a6a78;
  text-align: left;
}
.notif-empty {
  margin: 0;
  padding: 0.9rem 0.65rem;
  font-size: 0.75rem;
  color: #6a6a78;
  text-align: center;
}

/* Teleported — fixed; tap-to-dismiss, no X */
:global(.inapp-toast-host) {
  position: fixed;
  z-index: 2200;
  left: 0;
  right: 0;
  top: calc(3.1rem + env(safe-area-inset-top, 0px));
  max-width: var(--app-content-max, 40rem);
  width: 100%;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
  padding: 0 0.9rem;
  pointer-events: none;
}
:global(.inapp-toast-hint) {
  margin: 0;
  font-size: 0.55rem;
  text-align: right;
  color: rgba(200, 200, 220, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  pointer-events: none;
  padding: 0 0.1rem 0.15rem 0;
}
:global(.inapp-toast) {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.55rem 0.7rem 0.6rem;
  border: 1px solid rgba(99, 102, 241, 0.45);
  border-radius: 10px;
  background: linear-gradient(135deg, #262636 0%, #1a1a28 100%);
  color: #e4e4f0;
  font-size: 0.78rem;
  line-height: 1.35;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  animation: inapp-in 0.2s ease-out;
}
:global(.inapp-toast:hover) {
  border-color: rgba(167, 139, 250, 0.6);
  background: linear-gradient(135deg, #2e2e3e 0%, #202030 100%);
}
:global(.inapp-toast-txt) {
  display: block;
}
@keyframes inapp-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :global(.inapp-toast) {
    animation: none;
  }
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

/* Bridges: same full-bleed width as directory; inner page handles padding */
.app-main.app-main--bridges {
  flex: 1;
  min-height: 0;
  max-width: none;
  width: 100%;
  margin-inline: 0;
  padding-inline: 0;
  padding-bottom: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.app-main.app-main--bridges > * {
  display: flex;
  flex-direction: column;
  flex: 1 0 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

/* Split-pane directory / bridges: only the list column scrolls, not the main element */
@media (orientation: landscape) and (min-width: 700px) {
  .app-main.app-main--directory,
  .app-main.app-main--bridges {
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
