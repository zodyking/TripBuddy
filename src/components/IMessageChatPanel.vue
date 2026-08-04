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
import { findContactRule, contactTtsEnabled, contactOpenRouterReplyEnabled } from '../utils/blueBubblesContactRulesStore.js'
import ChatMessageText from '../components/ChatMessageText.vue'
import IMessageContactAutomationSheet from './IMessageContactAutomationSheet.vue'

const scrollEl = ref(/** @type {HTMLElement | null} */ (null))
const draft = ref('')
const showAutomation = ref(false)

const {
  configured,
  inConversation,
  activeChatId,
  chatTitle,
  sortedChats,
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
  openConversation,
  closeConversation,
  formatChatLabel,
  contactHandleForChat,
} = useBlueBubblesMessenger({ scrollEl, poll: true })

const threadBusy = computed(() => loading.value || syncing.value)
const showThreadLoader = computed(() => threadBusy.value)

const activeChat = computed(() =>
  sortedChats.value.find((c) => c.id === activeChatId.value) ?? null,
)

const activeContactHandle = computed(() => contactHandleForChat(activeChat.value))

const activeAutomationRule = computed(() =>
  findContactRule({ chatGuid: activeChatId.value, handle: activeContactHandle.value }),
)

const automationActive = computed(
  () =>
    contactTtsEnabled(activeAutomationRule.value) ||
    contactOpenRouterReplyEnabled(activeAutomationRule.value),
)

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

function fmtInboxTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    if (sameDay) {
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate()
    if (isYesterday) return 'Yesterday'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

const inboxRows = computed(() =>
  sortedChats.value.map((c) => {
    const names = formatChatDisplayName(c.name || c.id)
    const preview = c.lastMessageText
      ? c.lastMessageText.length > 72
        ? `${c.lastMessageText.slice(0, 72)}…`
        : c.lastMessageText
      : ''
    return { ...c, ...names, preview, inboxTime: fmtInboxTime(c.lastMessageTs) }
  }),
)

/** @type {import('vue').Ref<{ id: string, name: string } | null>} */
const pendingChatTap = ref(null)

const chatListTap = createDoubleTapHandlers({
  onSingle() {
    const c = pendingChatTap.value
    if (c) openConversation(c)
  },
  onDouble() {
    const c = pendingChatTap.value
    if (c) openConversation(c)
  },
})

function onInboxTap(chat) {
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

function onBackToInbox() {
  closeConversation()
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
          Connect BlueBubbles in Settings → iMessage to view all your conversations here.
        </p>
        <RouterLink class="btn primary tap chat-empty-btn" :to="{ path: '/settings', query: { tab: 'imessage' } }">
          Open iMessage settings
        </RouterLink>
      </div>
    </div>

    <!-- Inbox -->
    <template v-else-if="!inConversation">
      <header class="chat-toolbar">
        <button
          type="button"
          class="chat-icon-btn tap"
          :class="{ 'is-spinning': chatsLoading }"
          aria-label="Refresh conversations"
          :disabled="chatsLoading"
          @click="loadChats"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke-linecap="round" />
            <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="chat-toolbar-center">
          <h1 class="chat-toolbar-title">Messages</h1>
        </div>
        <RouterLink
          class="chat-icon-btn tap"
          aria-label="iMessage settings"
          :to="{ path: '/settings', query: { tab: 'imessage' } }"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </RouterLink>
      </header>

      <div class="im-inbox-scroll">
        <p v-if="chatsLoading && !inboxRows.length" class="chat-list-status">Loading conversations…</p>
        <p v-else-if="!inboxRows.length" class="chat-list-status">No conversations found.</p>
        <button
          v-for="c in inboxRows"
          :key="c.id"
          type="button"
          class="im-inbox-row tap"
          @click="onInboxTap(c)"
        >
          <span class="chat-list-avatar" aria-hidden="true">{{ chatAvatarInitial(c.displayTitle || c.name) }}</span>
          <span class="im-inbox-body">
            <span class="im-inbox-top">
              <span class="chat-list-name">{{ c.displayTitle || c.name }}</span>
              <span v-if="c.inboxTime" class="im-inbox-time">{{ c.inboxTime }}</span>
            </span>
            <span class="im-inbox-bottom">
              <span v-if="c.preview" class="im-inbox-preview">{{ c.preview }}</span>
              <span v-else class="im-inbox-preview im-inbox-preview--muted">{{ chatKindLabel(c.kind) }}</span>
            </span>
          </span>
        </button>
      </div>
    </template>

    <!-- Conversation thread -->
    <template v-else>
      <header class="chat-toolbar">
        <button type="button" class="chat-icon-btn tap" aria-label="Back to inbox" @click="onBackToInbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="chat-toolbar-center">
          <h1 class="chat-toolbar-title">{{ chatTitle || 'iMessage' }}</h1>
          <span class="chat-toolbar-sub">{{ chatKindLabel(activeChat?.kind) }}</span>
        </div>
        <button
          type="button"
          class="chat-icon-btn tap im-auto-btn"
          :class="{ 'im-auto-on': automationActive }"
          aria-label="Conversation automation"
          @click="showAutomation = true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-icon-btn tap"
          :class="{ 'is-spinning': loading || syncing }"
          aria-label="Refresh"
          :disabled="loading || syncing"
          @click="refreshMessages"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke-linecap="round" />
            <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </header>

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

      <IMessageContactAutomationSheet
        :open="showAutomation"
        :chat-guid="activeChatId"
        :handle="activeContactHandle"
        :contact-label="chatTitle || activeContactHandle"
        @close="showAutomation = false"
      />
    </template>
  </div>
</template>

<style scoped>
.chat-page--imessage {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - var(--app-header-h, 3.25rem) - 2.75rem);
  max-height: calc(100dvh - var(--app-header-h, 3.25rem) - 2.75rem);
}
.chat-toolbar-sub {
  display: block;
  font-size: 0.62rem;
  opacity: 0.65;
  font-weight: 500;
}
.chat-empty {
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
.chat-icon-btn.im-auto-on {
  color: #d8b4fe;
}
.im-inbox-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.im-inbox-row {
  display: flex;
  gap: 0.65rem;
  width: 100%;
  text-align: left;
  padding: 0.7rem 0.75rem;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  color: inherit;
}
.im-inbox-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.im-inbox-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.im-inbox-bottom {
  min-width: 0;
}
.im-inbox-time {
  font-size: 0.62rem;
  opacity: 0.55;
  flex-shrink: 0;
}
.im-inbox-preview {
  display: block;
  font-size: 0.72rem;
  opacity: 0.65;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.im-inbox-preview--muted {
  font-style: italic;
}
.chat-list-avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}
.chat-list-name {
  font-weight: 600;
  font-size: 0.88rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-list-status {
  text-align: center;
  font-size: 0.75rem;
  opacity: 0.7;
  padding: 1.5rem 1rem;
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
.chat-thread-loader-label,
.chat-thread-sync-hint,
.chat-thread-status-text {
  font-size: 0.75rem;
  text-align: center;
  opacity: 0.75;
}
</style>
