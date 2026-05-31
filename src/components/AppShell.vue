<script setup>
import { computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import {
  startAppGeolocationWatch,
  stopAppGeolocationWatch,
} from '../composables/useAppGeolocationWatch.js'
import { useApiHealth } from '../composables/useApiHealth.js'
import {
  connectLiveLogStream,
  disconnectLiveLogStream,
  reconnectLiveLogStream,
} from '../stores/liveLogStore.js'
import {
  items,
  menuOpen,
  unreadCount,
  fetchInAppInbox,
  markInAppItemRead,
  markInAppAllRead,
} from '../stores/inAppNotificationsStore.js'
import {
  linehaulBearerCaptureOverlayVisible,
  linehaulBearerCaptureProgress,
} from '../stores/linehaulBearerCaptureOverlay.js'
import DailyBriefingModal from './DailyBriefingModal.vue'
import DailyBriefingNarrator from './DailyBriefingNarrator.vue'
import SpeechAlertModal from './SpeechAlertModal.vue'
import { useDailyBriefing } from '../composables/useDailyBriefing.js'
import { hydrateOpenrouterApiKeyFromServer } from '../stores/trafficTileKey.js'
import { hydrateWahaPrefsFromServer } from '../utils/wahaPrefs.js'

const route = useRoute()
const { apiOk, refreshHealth } = useApiHealth()

const {
  modalOpen: dailyBriefingOpen,
  briefingText: dailyBriefingText,
  messageCount: dailyBriefingCount,
  loading: dailyBriefingLoading,
  error: dailyBriefingError,
  narratorActive: dailyBriefingNarratorActive,
  narratorWordIndex: dailyBriefingNarratorWordIndex,
  generateBriefingFromChat,
  playBriefing: playDailyBriefing,
  dismiss: dismissDailyBriefing,
  stopNarrator: stopDailyBriefingNarrator,
} = useDailyBriefing()

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

const headerAriaLabel = 'FedExTool — Linehaul'

const headerTitle = computed(() => {
  if (route.name === 'chat') return 'Chat'
  return 'Linehaul'
})

function onOfferBriefingEvent() {
  void generateBriefingFromChat()
}

onMounted(() => {
  window.addEventListener('tripbuddy:offer-briefing', onOfferBriefingEvent)
  startAppGeolocationWatch()
  connectLiveLogStream()
  void fetchInAppInbox()
  if (route.name !== 'login') {
    void (async () => {
      await Promise.all([
        hydrateOpenrouterApiKeyFromServer(),
        hydrateWahaPrefsFromServer(),
      ])
    })()
  }
  for (const ms of [500, 1500, 3500]) {
    setTimeout(() => {
      void refreshHealth().then(() => {
        if (apiOk.value) reconnectLiveLogStream()
      })
    }, ms)
  }
})

onUnmounted(() => {
  window.removeEventListener('tripbuddy:offer-briefing', onOfferBriefingEvent)
  stopAppGeolocationWatch()
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
          <span class="header-title header-title--center">{{ headerTitle }}</span>
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
            'app-main--home': route.name === 'home' || route.name === 'dispatch',
            'app-main--chat': route.name === 'chat',
            'app-main--directory': route.name === 'directory',
            'app-main--traffic': route.name === 'traffic',
            'app-main--trailer-map': route.name === 'trailer-map',
          }"
        >
          <RouterView />
        </main>
      </div>
    </div>

    <nav v-if="route.name !== 'trailer-map'" class="bottom-nav" aria-label="Main navigation">
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
        :class="{ 'is-active': route.name === 'chat' }"
        to="/chat"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="nav-label">Chat</span>
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
        :class="{ 'is-active': route.name === 'traffic' }"
        to="/traffic"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v4"/>
          <path d="M12 18v4"/>
          <path d="m4.93 4.93 2.83 2.83"/>
          <path d="m16.24 16.24 2.83 2.83"/>
          <path d="M2 12h4"/>
          <path d="M18 12h4"/>
          <path d="m4.93 19.07 2.83-2.83"/>
          <path d="m16.24 7.76 2.83-2.83"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="nav-label">Traffic</span>
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

    <Teleport to="body">
      <div
        v-if="linehaulBearerCaptureOverlayVisible"
        class="lh-bearer-sync-overlay"
        role="presentation"
        aria-live="polite"
        aria-busy="true"
      >
        <div class="lh-bearer-sync-panel">
          <p class="lh-bearer-sync-title">Server synchronizing</p>
          <div
            class="lh-bearer-sync-track"
            role="progressbar"
            :aria-valuenow="Math.round(linehaulBearerCaptureProgress)"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="Synchronization progress"
          >
            <div
              class="lh-bearer-sync-fill"
              :style="{
                width: `${Math.min(100, Math.max(0, linehaulBearerCaptureProgress))}%`,
              }"
            />
          </div>
        </div>
      </div>
    </Teleport>

    <DailyBriefingModal
      :open="dailyBriefingOpen"
      :message-count="dailyBriefingCount"
      :preview="dailyBriefingText"
      :busy="dailyBriefingLoading"
      :error="dailyBriefingError"
      @play="playDailyBriefing"
      @dismiss="dismissDailyBriefing"
    />
    <DailyBriefingNarrator
      :active="dailyBriefingNarratorActive"
      :text="dailyBriefingText"
      :word-index="dailyBriefingNarratorWordIndex"
      @close="stopDailyBriefingNarrator"
    />
    <SpeechAlertModal />
  </div>
</template>

<style scoped>
.app-shell {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: none;
}

/* Linehaul bearer capture — full-screen lock (teleported to body) */
.lh-bearer-sync-overlay {
  position: fixed;
  inset: 0;
  z-index: 100001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6, 1.5rem);
  padding-bottom: max(var(--space-6, 1.5rem), env(safe-area-inset-bottom));
  background: var(--color-bg-overlay, rgba(8, 8, 10, 0.9));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  pointer-events: all;
  box-sizing: border-box;
}

.lh-bearer-sync-panel {
  width: min(22rem, 100%);
  padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
  border-radius: var(--radius-xl, 1rem);
  background: var(--color-bg-surface, #16161d);
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  box-shadow: var(--shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.45)),
    0 0 0 1px var(--color-border-subtle, rgba(255, 255, 255, 0.04)) inset;
}

.lh-bearer-sync-title {
  margin: 0 0 var(--space-5, 1.25rem);
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  text-align: center;
  letter-spacing: var(--tracking-wide, 0.025em);
}

.lh-bearer-sync-track {
  height: 0.45rem;
  border-radius: var(--radius-full, 9999px);
  background: var(--color-border, rgba(255, 255, 255, 0.08));
  overflow: hidden;
}

.lh-bearer-sync-fill {
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--color-accent-purple, #7b4db5),
    var(--color-accent-purple-light, #9d6fd7),
    var(--color-accent-orange, #ff6b1a)
  );
  background-size: 200% 100%;
  transition: width 0.2s ease-out;
  animation: lh-bearer-sync-shimmer 2.2s ease-in-out infinite;
}

@keyframes lh-bearer-sync-shimmer {
  0%,
  100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lh-bearer-sync-fill {
    animation: none;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HEADER — Glass morphism with gradient accent
   ═══════════════════════════════════════════════════════════════════════════ */
.app-header {
  flex-shrink: 0;
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
  /* Block scroll chaining to the pinned #app shell (avoids “whole app” drag). */
  overscroll-behavior: contain;
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
  padding-bottom: var(--space-5, 1.25rem);
  min-height: 0;
}

/* Home quick action layout when automation preview is open: see unscoped block below (Lightning CSS + :has(:deep)). */

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

/* Chat: full-height messenger (no page scroll) */
.app-main.app-main--chat {
  flex: 1;
  min-height: 0;
  max-width: none;
  width: 100%;
  margin-inline: 0;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.app-main.app-main--chat > * {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

/* Traffic (crossings): full-bleed like directory */
.app-main.app-main--traffic {
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

.app-main.app-main--traffic > * {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

/* Full-page trailer GPS map (same flex fill pattern as traffic) */
.app-main.app-main--trailer-map {
  flex: 1;
  min-height: 0;
  max-width: none;
  width: 100%;
  margin-inline: 0;
  padding-inline: 0;
  padding-bottom: 0;
  overflow-x: hidden;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
}

.app-main.app-main--trailer-map > * {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

/* Split-pane directory / traffic crossings: only the list column scrolls, not the main element */
@media (orientation: landscape) and (min-width: 700px) {
  .app-main.app-main--directory,
  .app-main.app-main--traffic,
  .app-main.app-main--trailer-map {
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

/* Home page: full-width grid in landscape */
@media (orientation: landscape) and (min-width: 768px) {
  .app-main.app-main--home {
    max-width: none;
    margin-inline: 0;
    padding-inline: var(--space-4, 1rem);
  }
}

/* Directory + Traffic: fill viewport height in landscape (no scroll on app-main) */
@media (orientation: landscape) and (min-width: 700px) {
  .app-scroll:has(.app-main--directory),
  .app-scroll:has(.app-main--chat),
  .app-scroll:has(.app-main--traffic),
  .app-scroll:has(.app-main--trailer-map) {
    overflow-y: hidden;
  }
  .app-main.app-main--directory,
  .app-main.app-main--chat,
  .app-main.app-main--traffic,
  .app-main.app-main--trailer-map {
    flex: 1;
    overflow-y: hidden;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOTTOM NAVIGATION — Opaque bar (content must not show through)
   ═══════════════════════════════════════════════════════════════════════════ */
.bottom-nav {
  flex-shrink: 0;
  position: relative;
  z-index: var(--z-sticky, 20);
  display: flex;
  width: 100%;
  height: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0px));
  min-height: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0px));
  max-height: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0px));
  background: var(--color-bg-base, #08080a);
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.35);
  padding-bottom: env(safe-area-inset-bottom, 0);
  overscroll-behavior: none;
  touch-action: manipulation;
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
    font-size: 0.58rem;
    letter-spacing: 0.02em;
  }

  .nav-icon {
    width: 1.2rem;
    height: 1.2rem;
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

<style>
/*
 * Unscoped on purpose: Lightning CSS minify rejects :has(:deep(...)) in Vue scoped output.
 * Selectors stay under .app-shell so they only apply inside this layout.
 */
.app-shell .app-main.app-main--home:has(.main--automation-preview) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-bottom: var(--space-2, 0.5rem);
}

.app-shell .app-main.app-main--home:has(.main--automation-preview) > * {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.app-shell .app-scroll:has(.main--automation-preview) {
  overflow-y: hidden;
  flex: 1 1 0;
  min-height: 0;
}
</style>
