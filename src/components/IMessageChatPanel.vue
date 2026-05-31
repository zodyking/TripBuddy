<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useBlueBubblesMessenger } from '../composables/useBlueBubblesMessenger.js'
import {
  blueBubblesPrefsHydrated,
  hydrateBlueBubblesPrefsFromServer,
} from '../utils/blueBubblesPrefs.js'
import { formatChatDisplayName, chatAvatarInitial } from '../utils/chatDisplayName.js'
import { createDoubleTapHandlers } from '../utils/doubleTap.js'
import { speakIMessageAloud } from '../utils/imessageChatSpeech.js'
import ChatMessageText from '../components/ChatMessageText.vue'

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
  syncProgress,
  syncStatusLabel,
  sending,
  error,
  syncWarning,
  chatKindLabel,
  loadChats,
  refreshMessages,
  sendText,
  selectChat,
  formatChatLabel,
} = useBlueBubblesMessenger({ scrollEl, poll: true })

const hasActiveChat = computed(() => !!activeChatId.value)
const threadBusy = computed(() => loading.value || syncing.value)
const showThreadLoader = computed(() => threadBusy.value)

const loaderLabel = computed(() => {
  if (syncStatusLabel.value) return syncStatusLabel.value
  if (syncing.value) return 'Syncing with iMessage…'
  return 'Loading messages…'
})

const loaderPercent = computed(() => {
  if (syncProgress.value > 0) return syncProgress.value
  if (threadBusy.value) return 12
  return 0
})

function fmtTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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

const chatsForList = computed(() =>
  chats.value.map((c) => {
    const names = formatChatDisplayName(c.name || c.id)
    return { ...c, ...names }
  }),
)

function pickChat(chat) {
  selectChat(chat)
  showChatList.value = false
}

/** @type {import('vue').Ref<{ id: string, name: string } | null>} */
const pendingChatTap = ref(null)

const chatListTap = createDoubleTapHandlers({
  onSingle() {
    const c = pendingChatTap.value
    if (c) pickChat(c)
  },
  onDouble() {
    const c = pendingChatTap.value
    if (c) pickChat(c)
  },
})

function onChatListTap(chat) {
  pendingChatTap.value = chat
  chatListTap.onTap(chat.id)
}

/** @param {typeof displayMessages.value[0]} msg */
function onMessageBubbleDblClick(msg) {
  speakIMessageAloud(msg)
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

watch(
  blueBubblesPrefsHydrated,
  (hydrated) => {
    if (!hydrated) void hydrateBlueBubblesPrefsFromServer()
  },
  { immediate: true },
)

onMounted(() => {
  void hydrateBlueBubblesPrefsFromServer()
})
</script>

<template>
  <div class="chat-page chat-page--imessage">
    <div v-if="!blueBubblesPrefsHydrated" class="chat-empty">
      <div class="chat-thread-loader" role="status">
        <p class="chat-thread-loader-label">Loading iMessage…</p>
      </div>
    </div>

    <div v-else-if="!configured" class="chat-empty">
      <div class="chat-empty-card">
        <p class="chat-empty-title">iMessage not set up</p>
        <p class="chat-empty-hint">
          Connect BlueBubbles in Settings → iMessage, then choose a conversation to monitor.
        </p>
        <RouterLink class="btn primary tap chat-empty-btn" :to="{ path: '/settings', query: { tab: 'imessage' } }">
          Open iMessage settings
        </RouterLink>
      </div>
    </div>

    <div v-else-if="showChatList" class="chat-list-screen" role="dialog" aria-label="iMessage chats">
      <header class="chat-toolbar">
        <button type="button" class="chat-icon-btn tap" aria-label="Back" @click="showChatList = false">
          ←
        </button>
        <h1 class="chat-toolbar-title">iMessage chats</h1>
        <button type="button" class="chat-icon-btn tap" :disabled="chatsLoading" @click="loadChats">↻</button>
      </header>
      <div class="chat-list-scroll">
        <p v-if="chatsLoading" class="chat-list-status">Loading…</p>
        <button
          v-for="c in chatsForList"
          :key="c.id"
          type="button"
          class="chat-list-item tap"
          :class="{ 'is-active': c.id === activeChatId }"
          @click="onChatListTap(c)"
        >
          <span class="chat-list-avatar" aria-hidden="true">{{ chatAvatarInitial(c.name) }}</span>
          <span class="chat-list-body">
            <span class="chat-list-name">{{ c.displayTitle || c.name }}</span>
            <span class="chat-list-meta">
              <span class="chat-list-kind">{{ chatKindLabel(c.kind) }}</span>
            </span>
          </span>
        </button>
      </div>
    </div>

    <template v-else>
      <header class="chat-toolbar">
        <button
          type="button"
          class="chat-icon-btn tap"
          :class="{ 'is-spinning': loading || syncing }"
          aria-label="Refresh"
          :disabled="loading || syncing"
          @click="refreshMessages"
        >
          ↻
        </button>
        <button type="button" class="chat-toolbar-center tap chat-title-btn" @click="openChatList">
          <h1 class="chat-toolbar-title">{{ chatTitle || 'iMessage' }}</h1>
          <span class="chat-toolbar-sub">Open Bubbles</span>
        </button>
        <RouterLink
          class="chat-icon-btn tap"
          aria-label="iMessage settings"
          :to="{ path: '/settings', query: { tab: 'imessage' } }"
        >
          ⚙
        </RouterLink>
      </header>

      <div v-if="!hasActiveChat" class="chat-pick-prompt">
        <p>No conversation selected.</p>
        <button type="button" class="btn primary tap" @click="openChatList">Pick a chat</button>
      </div>

      <template v-else>
        <div class="chat-thread-wrap">
          <div
            v-if="showThreadLoader && !displayMessages.length"
            class="chat-thread-loader"
            role="status"
          >
            <p class="chat-thread-loader-label">{{ loaderLabel }}</p>
          </div>
          <div ref="scrollEl" class="chat-thread" role="log" aria-live="polite">
            <p v-if="syncWarning && displayMessages.length" class="chat-thread-sync-hint">{{ syncWarning }}</p>
            <p v-if="error && !displayMessages.length" class="chat-thread-status-text">{{ error }}</p>
            <template v-for="item in threadItems" :key="item.type === 'day' ? `d-${item.key}` : item.msg.id">
              <p v-if="item.type === 'day'" class="chat-day-divider">{{ item.label }}</p>
              <div
                v-else
                class="chat-bubble-row"
                :class="item.msg.fromMe ? 'chat-bubble-row--out' : 'chat-bubble-row--in'"
              >
                <div
                  class="chat-bubble"
                  :class="item.msg.fromMe ? 'chat-bubble--out' : 'chat-bubble--in'"
                  @dblclick.prevent.stop="onMessageBubbleDblClick(item.msg)"
                >
                  <p v-if="!item.msg.fromMe && item.msg.senderName" class="chat-bubble-sender">
                    {{ formatChatLabel(item.msg.senderName) }}
                  </p>
                  <p v-if="item.msg.hasMedia && !item.msg.text" class="chat-bubble-text chat-bubble-text--muted">
                    {{ item.msg.media?.count > 1 ? `${item.msg.media.count} attachments` : 'Attachment' }}
                  </p>
                  <p v-if="item.msg.text" class="chat-bubble-text">
                    <ChatMessageText :text="item.msg.text" />
                  </p>
                  <time class="chat-bubble-time">{{ fmtTime(item.msg.ts) }}</time>
                </div>
              </div>
            </template>
          </div>
        </div>

        <footer class="chat-compose">
          <textarea
            v-model="draft"
            class="chat-compose-input tap"
            rows="1"
            placeholder="iMessage…"
            :disabled="sending"
            @keydown="onComposeKeydown"
          />
          <button
            type="button"
            class="chat-compose-send tap"
            :disabled="!draft.trim() || sending"
            aria-label="Send"
            @click="onSend"
          >
            Send
          </button>
        </footer>
      </template>
    </template>
  </div>
</template>

<style scoped>
.chat-page--imessage {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--app-header-h, 3.25rem));
  max-height: calc(100dvh - var(--app-header-h, 3.25rem));
}
.chat-title-btn {
  background: none;
  border: none;
  color: inherit;
  text-align: center;
  flex: 1;
  min-width: 0;
}
.chat-toolbar-sub {
  display: block;
  font-size: 0.62rem;
  opacity: 0.65;
  font-weight: 500;
}
.chat-empty,
.chat-pick-prompt {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  text-align: center;
}
.chat-empty-card {
  max-width: 20rem;
}
.chat-empty-title {
  font-weight: 700;
  margin: 0 0 0.35rem;
}
.chat-empty-hint {
  font-size: 0.78rem;
  opacity: 0.8;
  margin: 0 0 1rem;
}
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.chat-toolbar-center {
  flex: 1;
  min-width: 0;
}
.chat-toolbar-title {
  font-size: 0.95rem;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-icon-btn {
  width: 2.5rem;
  height: 2.5rem;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  flex-shrink: 0;
}
.chat-thread-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}
.chat-thread {
  height: 100%;
  overflow-y: auto;
  padding: 0.65rem 0.5rem 0.75rem;
}
.chat-day-divider {
  text-align: center;
  font-size: 0.65rem;
  opacity: 0.65;
  margin: 0.75rem 0;
}
.chat-bubble-row {
  display: flex;
  margin-bottom: 0.35rem;
}
.chat-bubble-row--out {
  justify-content: flex-end;
}
.chat-bubble-row--in {
  justify-content: flex-start;
}
.chat-bubble {
  max-width: min(85%, 22rem);
  padding: 0.45rem 0.65rem;
  border-radius: 1rem;
}
.chat-bubble--out {
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
  border-bottom-right-radius: 0.25rem;
}
.chat-bubble--in {
  background: rgba(255, 255, 255, 0.08);
  border-bottom-left-radius: 0.25rem;
}
.chat-bubble-sender {
  font-size: 0.65rem;
  font-weight: 700;
  margin: 0 0 0.2rem;
  opacity: 0.85;
}
.chat-bubble-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-bubble-text--muted {
  opacity: 0.7;
  font-style: italic;
}
.chat-bubble-time {
  display: block;
  font-size: 0.58rem;
  opacity: 0.65;
  margin-top: 0.25rem;
  text-align: right;
}
.chat-compose {
  display: flex;
  gap: 0.35rem;
  padding: 0.45rem 0.5rem calc(0.45rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.chat-compose-input {
  flex: 1;
  min-width: 0;
  border-radius: 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  padding: 0.55rem 0.85rem;
  resize: none;
  font: inherit;
}
.chat-compose-send {
  border: none;
  border-radius: 999px;
  padding: 0 1rem;
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
  font-weight: 600;
}
.chat-list-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chat-list-scroll {
  flex: 1;
  overflow-y: auto;
}
.chat-list-item {
  display: flex;
  gap: 0.65rem;
  width: 100%;
  text-align: left;
  padding: 0.65rem 0.75rem;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  color: inherit;
}
.chat-list-item.is-active {
  background: rgba(123, 77, 181, 0.15);
}
.chat-list-avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.chat-list-name {
  font-weight: 600;
  font-size: 0.85rem;
}
.chat-list-meta {
  font-size: 0.65rem;
  opacity: 0.65;
}
.chat-thread-loader-label,
.chat-thread-sync-hint,
.chat-thread-status-text {
  font-size: 0.75rem;
  text-align: center;
  opacity: 0.75;
}
</style>
