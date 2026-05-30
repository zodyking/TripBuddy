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
      <button type="button" class="chat-icon-btn tap" aria-label="All chats" @click="openChatList">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="chat-toolbar-center">
        <h1 class="chat-toolbar-title">{{ chatTitle || 'Chat' }}</h1>
        <p v-if="activeChatId" class="chat-toolbar-sub">{{ activeChatId }}</p>
      </div>
      <button
        type="button"
        class="chat-icon-btn tap"
        aria-label="Refresh messages"
        :disabled="loading"
        @click="refreshMessages"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke-linecap="round" />
          <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
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
      <button type="button" class="btn primary tap" @click="openChatList">Choose a chat</button>
    </div>

    <template v-else>
      <p v-if="error" class="chat-banner chat-banner--err" role="alert">{{ error }}</p>
      <p v-else-if="loading && !displayMessages.length" class="chat-banner">Loading messages…</p>

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
              <p v-if="!item.msg.fromMe && item.msg.senderName" class="chat-bubble-sender">{{ item.msg.senderName }}</p>
              <p v-if="item.msg.text" class="chat-bubble-text">{{ item.msg.text }}</p>
              <p v-else-if="item.msg.hasMedia" class="chat-bubble-text chat-bubble-text--muted">[Media]</p>
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
  background: #0b141a;
  color: #e9edef;
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
  border-radius: 1rem;
  background: #111b21;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.chat-empty-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  font-weight: 700;
}

.chat-empty-hint {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  line-height: 1.45;
  color: #8696a0;
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
  padding-top: max(0.45rem, env(safe-area-inset-top, 0px));
  background: #202c33;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 3.25rem;
}

.chat-toolbar-center {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.chat-toolbar-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-toolbar-sub {
  margin: 0.1rem 0 0;
  font-size: 0.62rem;
  color: #8696a0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-icon-btn {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #aebac1;
  text-decoration: none;
  cursor: pointer;
}

.chat-icon-btn svg {
  width: 1.25rem;
  height: 1.25rem;
}

.chat-icon-btn:active {
  background: rgba(255, 255, 255, 0.08);
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
  font-size: 0.8rem;
  color: #8696a0;
}

.chat-list-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.chat-list-item.is-active {
  background: rgba(0, 168, 132, 0.12);
}

.chat-list-avatar {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1rem;
  background: #374248;
  color: #e9edef;
}

.chat-list-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.chat-list-name {
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-list-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.68rem;
  color: #8696a0;
}

.chat-list-kind {
  color: #00a884;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.chat-list-id {
  font-family: ui-monospace, monospace;
  word-break: break-all;
}

.chat-pick-prompt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #8696a0;
  font-size: 0.9rem;
}

.chat-banner {
  flex-shrink: 0;
  margin: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.75rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.25);
  color: #8696a0;
}

.chat-banner--err {
  color: #ffb4b4;
  background: rgba(239, 68, 68, 0.15);
}

.chat-thread {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0.65rem 0.55rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  background:
    radial-gradient(circle at 20% 20%, rgba(0, 168, 132, 0.04), transparent 45%),
    #0b141a;
}

.chat-thread-empty {
  margin: auto;
  text-align: center;
  font-size: 0.85rem;
  color: #8696a0;
}

.chat-day-divider {
  align-self: center;
  margin: 0.5rem 0;
  padding: 0.2rem 0.55rem;
  border-radius: 0.45rem;
  font-size: 0.68rem;
  background: #182229;
  color: #8696a0;
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
  max-width: min(85%, 22rem);
  padding: 0.35rem 0.5rem 0.25rem;
  border-radius: 0.55rem;
  position: relative;
  box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13);
}

.chat-bubble--in {
  background: #202c33;
  border-top-left-radius: 0.15rem;
}

.chat-bubble--out {
  background: #005c4b;
  border-top-right-radius: 0.15rem;
}

.chat-bubble-sender {
  margin: 0 0 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: #53bdeb;
}

.chat-bubble-text {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-bubble-text--muted {
  font-style: italic;
  color: #8696a0;
}

.chat-bubble-time {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.62rem;
  text-align: right;
  color: rgba(255, 255, 255, 0.55);
}

.chat-compose {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 0.45rem;
  padding: 0.45rem 0.55rem;
  padding-bottom: max(0.45rem, env(safe-area-inset-bottom, 0px));
  background: #202c33;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.chat-compose-input {
  flex: 1;
  min-width: 0;
  min-height: 2.5rem;
  max-height: 6.5rem;
  resize: none;
  border: none;
  border-radius: 1.25rem;
  padding: 0.55rem 0.85rem;
  font: inherit;
  font-size: 0.95rem;
  line-height: 1.35;
  color: #e9edef;
  background: #2a3942;
}

.chat-compose-input:focus {
  outline: 2px solid rgba(0, 168, 132, 0.45);
  outline-offset: 0;
}

.chat-compose-input::placeholder {
  color: #8696a0;
}

.chat-compose-send {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #00a884;
  color: #111b21;
  cursor: pointer;
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
    max-width: min(70%, 28rem);
  }
}
</style>
