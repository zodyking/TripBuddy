<script setup>
import { ref, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useWahaMessenger } from '../composables/useWahaMessenger.js'

const scrollEl = ref(/** @type {HTMLElement | null} */ (null))
const draft = ref('')
const showChatList = ref(false)

const {
  configured,
  activeChatId,
  chatTitle,
  chats,
  chatsLoading,
  displayMessages,
  loading,
  syncing,
  sending,
  error,
  wahaChatKindLabel,
  loadChats,
  refreshMessages,
  sendText,
  selectChat,
} = useWahaMessenger({ scrollEl, poll: true })

const hasActiveChat = computed(() => !!activeChatId.value)

function fmtTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function fmtDay(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const threadItems = computed(() => {
  /** @type {Array<{ type: 'day', key: string, label: string } | { type: 'msg', msg: typeof displayMessages.value[0] }>} */
  const items = []
  let lastK = ''
  for (const msg of displayMessages.value) {
    const k = dayKey(msg.ts)
    if (k !== lastK) {
      items.push({ type: 'day', key: k, label: fmtDay(msg.ts) })
      lastK = k
    }
    items.push({ type: 'msg', msg })
  }
  return items
})

async function openChatList() {
  showChatList.value = true
  await loadChats()
}

function pickChat(chat) {
  selectChat(chat)
  showChatList.value = false
}

async function onSend() {
  const text = draft.value
  if (!text.trim() || sending.value) return
  const ok = await sendText(text)
  if (ok) draft.value = ''
}

function onComposeKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void onSend()
  }
}

watch(showChatList, (open) => {
  if (open) void loadChats()
})

function openMedia(url) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="chat-page">
  <!-- Not configured -->
  <div v-if="!configured" class="chat-empty">
    <div class="chat-empty-card">
      <p class="chat-empty-title">WhatsApp not set up</p>
      <p class="chat-empty-hint">
        Connect WAHA in Settings → WhatsApp, then choose a chat to monitor.
      </p>
      <RouterLink class="btn primary tap chat-empty-btn" :to="{ path: '/settings', query: { tab: 'whatsapp' } }">
        Open WhatsApp settings
      </RouterLink>
    </div>
  </div>

  <!-- Chat list sheet -->
  <div
    v-else-if="showChatList"
    class="chat-list-screen"
    role="dialog"
    aria-label="Chats"
  >
    <header class="chat-toolbar">
      <button type="button" class="chat-icon-btn tap" aria-label="Back" @click="showChatList = false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <h1 class="chat-toolbar-title">Chats</h1>
      <button
        type="button"
        class="chat-icon-btn tap"
        aria-label="Refresh chats"
        :disabled="chatsLoading"
        @click="loadChats"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke-linecap="round" />
          <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </header>
    <div class="chat-list-scroll">
      <p v-if="chatsLoading" class="chat-list-status">Loading chats…</p>
      <p v-else-if="!chats.length" class="chat-list-status">No chats found. Check WAHA connection in Settings.</p>
      <button
        v-for="c in chats"
        :key="c.id"
        type="button"
        class="chat-list-item tap"
        :class="{ 'is-active': c.id === activeChatId }"
        @click="pickChat(c)"
      >
        <span class="chat-list-avatar" aria-hidden="true">{{ (c.name || '?').charAt(0).toUpperCase() }}</span>
        <span class="chat-list-body">
          <span class="chat-list-name">{{ c.name || c.id }}</span>
          <span class="chat-list-meta">
            <span class="chat-list-kind">{{ wahaChatKindLabel(c.kind) }}</span>
            <span class="chat-list-id">{{ c.id }}</span>
          </span>
        </span>
      </button>
    </div>
  </div>

  <!-- Conversation -->
  <template v-else>
    <header class="chat-toolbar">
      <button
        type="button"
        class="chat-icon-btn tap"
        :class="{ 'is-spinning': loading || syncing }"
        aria-label="Refresh messages"
        :disabled="loading || syncing"
        @click="refreshMessages"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke-linecap="round" />
          <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="chat-toolbar-center">
        <h1 class="chat-toolbar-title">{{ chatTitle || 'Chat' }}</h1>
      </div>
      <RouterLink
        class="chat-icon-btn tap"
        aria-label="WhatsApp settings"
        :to="{ path: '/settings', query: { tab: 'whatsapp' } }"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </RouterLink>
    </header>

    <div v-if="!hasActiveChat" class="chat-pick-prompt">
      <p>No chat selected.</p>
      <RouterLink class="btn primary tap" :to="{ path: '/settings', query: { tab: 'whatsapp' } }">
        Choose chat in Settings
      </RouterLink>
    </div>

    <template v-else>
      <p v-if="error && !displayMessages.length" class="chat-banner chat-banner--err" role="alert">{{ error }}</p>
      <p v-else-if="loading && !displayMessages.length" class="chat-banner">Loading messages…</p>
      <p v-else-if="syncing" class="chat-banner chat-banner--sync">Updating…</p>

      <div ref="scrollEl" class="chat-thread" role="log" aria-live="polite" aria-relevant="additions">
        <p v-if="!loading && !displayMessages.length" class="chat-thread-empty">
          No messages yet. Say hello below.
        </p>
        <template v-for="item in threadItems" :key="item.type === 'day' ? `d-${item.key}` : item.msg.id">
          <p v-if="item.type === 'day'" class="chat-day-divider">{{ item.label }}</p>
          <div
            v-else
            class="chat-bubble-row"
            :class="item.msg.fromMe ? 'chat-bubble-row--out' : 'chat-bubble-row--in'"
          >
            <div class="chat-bubble" :class="item.msg.fromMe ? 'chat-bubble--out' : 'chat-bubble--in'">
              <p
                v-if="!item.msg.fromMe && item.msg.isGroupChat && item.msg.senderName"
                class="chat-bubble-sender"
              >
                {{ item.msg.senderName }}
              </p>
              <div v-if="item.msg.media?.url" class="chat-bubble-media">
                <img
                  v-if="item.msg.media.kind === 'image'"
                  :src="item.msg.media.url"
                  class="chat-media-img tap"
                  alt=""
                  loading="lazy"
                  @click="openMedia(item.msg.media.url)"
                />
                <video
                  v-else-if="item.msg.media.kind === 'video'"
                  class="chat-media-video"
                  :src="item.msg.media.url"
                  controls
                  playsinline
                  preload="metadata"
                />
                <audio
                  v-else-if="item.msg.media.kind === 'audio'"
                  class="chat-media-audio"
                  :src="item.msg.media.url"
                  controls
                  preload="metadata"
                />
                <a
                  v-else
                  class="chat-media-file tap"
                  :href="item.msg.media.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ item.msg.media.filename || 'Download file' }}
                </a>
                <p v-if="item.msg.media.error" class="chat-media-err">{{ item.msg.media.error }}</p>
              </div>
              <p v-else-if="item.msg.hasMedia && !item.msg.media?.url" class="chat-bubble-text chat-bubble-text--muted">
                Loading media…
              </p>
              <p v-if="item.msg.text" class="chat-bubble-text">{{ item.msg.text }}</p>
              <time class="chat-bubble-time" :datetime="new Date(item.msg.ts).toISOString()">{{ fmtTime(item.msg.ts) }}</time>
            </div>
          </div>
        </template>
      </div>

      <form class="chat-compose" @submit.prevent="onSend">
        <textarea
          v-model="draft"
          class="chat-compose-input tap"
          rows="1"
          placeholder="Message"
          aria-label="Message"
          :disabled="sending"
          @keydown="onComposeKeydown"
        />
        <button
          type="submit"
          class="chat-compose-send tap"
          aria-label="Send"
          :disabled="sending || !draft.trim()"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </template>
  </template>
  </div>
</template>

<style scoped>
.chat-page {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-base, #08080a);
  color: var(--color-text-primary, #f4f4f8);
  overflow: hidden;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
}

.chat-empty-card {
  max-width: 22rem;
  text-align: center;
  padding: 1.5rem 1.25rem;
  border-radius: var(--radius-xl, 1rem);
  background: var(--color-bg-surface, #16161d);
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.3));
}

.chat-empty-title {
  margin: 0 0 0.5rem;
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-bold, 700);
}

.chat-empty-hint {
  margin: 0 0 1rem;
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.45;
  color: var(--color-text-secondary, #a8a8b8);
}

.chat-empty-btn {
  display: inline-flex;
  width: 100%;
  justify-content: center;
}

.chat-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.5rem;
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-md, 12px));
  -webkit-backdrop-filter: blur(var(--blur-md, 12px));
  border-bottom: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  min-height: 3.25rem;
}

.chat-toolbar-center {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.chat-toolbar-title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: var(--weight-bold, 700);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-icon-btn {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: transparent;
  color: var(--color-text-secondary, #a8a8b8);
  text-decoration: none;
  cursor: pointer;
}

.chat-icon-btn svg {
  width: 1.35rem;
  height: 1.35rem;
}

.chat-icon-btn.is-spinning svg {
  animation: chat-refresh-spin 0.85s linear infinite;
}

@keyframes chat-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.chat-icon-btn:active {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
  color: var(--color-text-primary, #f4f4f8);
}

.chat-list-screen {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.chat-list-status {
  margin: 1rem;
  text-align: center;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-list-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: none;
  border-bottom: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.04));
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.chat-list-item.is-active {
  background: rgba(123, 77, 181, 0.15);
}

.chat-list-avatar {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-full, 9999px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--weight-bold, 700);
  font-size: var(--text-md, 1rem);
  background: var(--color-accent-purple-dark, #5c2d91);
  color: var(--color-text-primary, #f4f4f8);
}

.chat-list-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.chat-list-name {
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-list-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-list-kind {
  color: var(--color-accent-purple-light, #9d6fd7);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.chat-list-id {
  font-family: var(--font-mono, ui-monospace, monospace);
  word-break: break-all;
}

.chat-pick-prompt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--color-text-secondary, #a8a8b8);
  font-size: var(--text-sm, 0.8125rem);
}

.chat-banner {
  flex-shrink: 0;
  margin: 0;
  padding: 0.5rem 0.85rem;
  font-size: 0.875rem;
  text-align: center;
  background: var(--color-bg-elevated, #0f0f14);
  color: var(--color-text-secondary, #a8a8b8);
}

.chat-banner--err {
  color: var(--color-error, #ef4444);
  background: var(--color-error-muted, rgba(239, 68, 68, 0.15));
}

.chat-banner--sync {
  color: var(--color-accent-purple-light, #9d6fd7);
  background: rgba(123, 77, 181, 0.12);
}

.chat-thread {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0.75rem 0.65rem 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  background:
    var(--gradient-glow-purple, radial-gradient(ellipse at 30% 0%, rgba(123, 77, 181, 0.12) 0%, transparent 55%)),
    var(--color-bg-base, #08080a);
}

.chat-thread-empty {
  margin: auto;
  text-align: center;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-day-divider {
  align-self: center;
  margin: 0.5rem 0;
  padding: 0.28rem 0.7rem;
  border-radius: var(--radius-md, 0.5rem);
  font-size: 0.8125rem;
  font-weight: 600;
  background: var(--color-bg-surface, #16161d);
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.04));
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-bubble-row {
  display: flex;
  width: 100%;
}

.chat-bubble-row--in {
  justify-content: flex-start;
}

.chat-bubble-row--out {
  justify-content: flex-end;
}

.chat-bubble {
  max-width: min(92%, 26rem);
  padding: 0.55rem 0.7rem 0.42rem;
  border-radius: var(--radius-xl, 1rem);
  position: relative;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.04));
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.25));
}

.chat-bubble--in {
  background: var(--color-bg-surface, #16161d);
  border-top-left-radius: var(--radius-sm, 0.375rem);
}

.chat-bubble--out {
  background: var(--color-accent-purple-dark, #5c2d91);
  border-color: rgba(123, 77, 181, 0.35);
  border-top-right-radius: var(--radius-sm, 0.375rem);
}

.chat-bubble-sender {
  margin: 0 0 0.28rem;
  font-size: 0.875rem;
  font-weight: var(--weight-bold, 700);
  color: var(--color-accent-orange, #ff6b1a);
  line-height: 1.2;
}

.chat-bubble-media {
  margin-bottom: 0.25rem;
  max-width: 100%;
}

.chat-media-img {
  display: block;
  max-width: 100%;
  max-height: 16rem;
  border-radius: var(--radius-md, 0.5rem);
  object-fit: cover;
  cursor: pointer;
}

.chat-media-video {
  display: block;
  max-width: 100%;
  max-height: 14rem;
  border-radius: var(--radius-md, 0.5rem);
}

.chat-media-audio {
  width: min(100%, 16rem);
  height: 2.25rem;
}

.chat-media-file {
  display: inline-block;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-accent-purple-light, #9d6fd7);
  text-decoration: underline;
  word-break: break-all;
}

.chat-media-err {
  margin: 0.25rem 0 0;
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-error, #ef4444);
}

.chat-bubble-text {
  margin: 0;
  font-size: 1.0625rem;
  line-height: 1.45;
  letter-spacing: 0.01em;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-bubble-text--muted {
  font-style: italic;
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-bubble-time {
  display: block;
  margin-top: 0.28rem;
  font-size: 0.75rem;
  font-weight: 500;
  text-align: right;
  color: var(--color-text-tertiary, #6e6e7e);
  opacity: 0.9;
}

.chat-compose {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 0.45rem;
  padding: 0.45rem 0.55rem;
  padding-bottom: max(0.45rem, env(safe-area-inset-bottom, 0px));
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-md, 12px));
  -webkit-backdrop-filter: blur(var(--blur-md, 12px));
  border-top: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
}

.chat-compose-input {
  flex: 1;
  min-width: 0;
  min-height: 3rem;
  max-height: 7rem;
  resize: none;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-full, 9999px);
  padding: 0.65rem 1rem;
  font: inherit;
  font-size: 1.0625rem;
  line-height: 1.4;
  color: var(--color-text-primary, #f4f4f8);
  background: var(--color-bg-elevated, #0f0f14);
}

.chat-compose-input:focus {
  outline: none;
  border-color: var(--color-accent-purple, #7b4db5);
  box-shadow: 0 0 0 3px rgba(123, 77, 181, 0.2);
}

.chat-compose-input::placeholder {
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-compose-send {
  flex-shrink: 0;
  width: 3rem;
  height: 3rem;
  border: none;
  border-radius: var(--radius-full, 9999px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-accent-purple, #7b4db5);
  color: var(--color-text-primary, #f4f4f8);
  cursor: pointer;
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.25));
}

.chat-compose-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-compose-send svg {
  width: 1.35rem;
  height: 1.35rem;
  margin-left: 0.1rem;
}

@media (min-width: 640px) {
  .chat-toolbar,
  .chat-compose {
    padding-inline: 1rem;
  }

  .chat-thread {
    padding-inline: 1rem;
  }

  .chat-bubble {
    max-width: min(75%, 32rem);
  }

  .chat-bubble-text {
    font-size: 1.125rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-icon-btn.is-spinning svg {
    animation: none;
  }
}
</style>
