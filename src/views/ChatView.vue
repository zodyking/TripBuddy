<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { useWahaMessenger } from '../composables/useWahaMessenger.js'
import { useDailyBriefing } from '../composables/useDailyBriefing.js'
import { wahaPrefsHydrated, hydrateWahaPrefsFromServer } from '../utils/wahaPrefs.js'
import { hydrateOpenrouterApiKeyFromServer } from '../stores/trafficTileKey.js'
import { formatChatDisplayName, chatAvatarInitial } from '../utils/chatDisplayName.js'
import { createDoubleTapHandlers } from '../utils/doubleTap.js'
import { computeThreadLastMessageKey } from '../utils/dailyBriefingCache.js'
import { speakChatMessageAloud } from '../utils/chatMessageSpeech.js'
import { resolveWahaMediaUrl } from '../utils/wahaApi.js'
import { isLinkOnlyMessage, primaryUrlFromText } from '../utils/chatMessageLinks.js'
import ChatMessageText from '../components/ChatMessageText.vue'
import ChatLinkPreview from '../components/ChatLinkPreview.vue'
import IMessageChatPanel from '../components/IMessageChatPanel.vue'

/** @type {import('vue').Ref<'whatsapp' | 'imessage'>} */
const chatTab = ref(
  typeof window !== 'undefined' && window.localStorage.getItem('fedextool-chat-tab') === 'imessage'
    ? 'imessage'
    : 'whatsapp',
)

watch(chatTab, (tab) => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('fedextool-chat-tab', tab)
    } catch {
      /* ignore */
    }
  }
})

const {
  generateBriefingFromChat,
  loading: briefingLoading,
  isChatBriefingConfigured,
} = useDailyBriefing()

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
  wahaChatKindLabel,
  loadChats,
  refreshMessages,
  sendText,
  sendMedia,
  sendPoll,
  selectChat,
  fetchMessageMedia,
  formatChatLabel,
} = useWahaMessenger({ scrollEl, poll: true })

const imageInputRef = ref(/** @type {HTMLInputElement | null} */ (null))
const voiceInputRef = ref(/** @type {HTMLInputElement | null} */ (null))
const fileInputRef = ref(/** @type {HTMLInputElement | null} */ (null))
const showPollComposer = ref(false)
const pollQuestion = ref('')
const pollOptionA = ref('')
const pollOptionB = ref('')

/** @type {import('vue').Ref<{ url: string, kind: string, caption: string } | null>} */
const mediaViewer = ref(null)

const chatPickToast = ref('')

const hasActiveChat = computed(() => !!activeChatId.value)
const threadBusy = computed(() => loading.value || syncing.value)
const briefingAvailable = computed(
  () => wahaPrefsHydrated.value && configured.value && hasActiveChat.value,
)
const briefingBusy = computed(() => briefingLoading.value)

function threadLastMessageKey() {
  return computeThreadLastMessageKey(displayMessages.value)
}

function briefingChatLabel() {
  return formatChatLabel(chatTitle.value) || chatTitle.value || 'WhatsApp chat'
}

function onGenerateBriefingTap() {
  void generateBriefingFromChat({
    chatLabel: briefingChatLabel(),
    lastMessageKey: threadLastMessageKey(),
  })
}
const showThreadLoader = computed(() => threadBusy.value)

const loaderLabel = computed(() => {
  if (syncStatusLabel.value) return syncStatusLabel.value
  if (syncing.value) return 'Syncing with WhatsApp…'
  return 'Loading messages…'
})

const loaderPercent = computed(() => {
  if (syncProgress.value > 0) return syncProgress.value
  if (threadBusy.value) return 12
  return 0
})

/** Tap translated sender label to toggle original spelling */
const peekOriginalSenderId = ref(/** @type {string | null} */ (null))

function onSenderNameTap(msg) {
  if (!msg?.isSenderNameTranslated || !msg.senderNameOriginal) return
  peekOriginalSenderId.value = peekOriginalSenderId.value === msg.id ? null : msg.id
}

function senderNameLabel(msg) {
  if (!msg) return ''
  if (
    msg.isSenderNameTranslated &&
    msg.senderNameOriginal &&
    peekOriginalSenderId.value === msg.id
  ) {
    return msg.senderNameOriginal
  }
  const raw = msg.senderName || ''
  return raw ? formatChatDisplayName(raw).displayTitle : ''
}

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

function setMonitoredChat(chat) {
  const names = formatChatDisplayName(chat.name || chat.id)
  selectChat(chat, { displayTitle: names.displayTitle })
  showChatList.value = false
  chatPickToast.value = `Using ${names.displayTitle}`
  setTimeout(() => {
    chatPickToast.value = ''
  }, 2800)
  setTimeout(() => {
    void generateBriefingFromChat({
      chatLabel: names.briefingLabel || names.displayTitle,
      lastMessageKey: threadLastMessageKey(),
    })
  }, 1800)
}

const chatListTap = createDoubleTapHandlers({
  onSingle() {
    const c = pendingChatTap.value
    if (c) pickChat(c)
  },
  onDouble() {
    const c = pendingChatTap.value
    if (c) setMonitoredChat(c)
  },
})

function onChatListTap(chat) {
  pendingChatTap.value = chat
  chatListTap.onTap(chat.id)
}

function onChatListDblClick(chat) {
  chatListTap.cancelPending()
  pendingChatTap.value = chat
  setMonitoredChat(chat)
}

/** @type {import('vue').Ref<typeof displayMessages.value[0] | null>} */
const pendingMessageTap = ref(null)

const messageBubbleTap = createDoubleTapHandlers({
  onSingle() {
    /* Images use their own single-tap handler; text links use <a @click.stop>. */
  },
  onDouble() {
    const m = pendingMessageTap.value
    if (m) speakChatMessageAloud(m)
  },
})

/** @param {typeof displayMessages.value[0]} msg */
function onMessageBubbleTap(msg) {
  pendingMessageTap.value = msg
  messageBubbleTap.onTap(msg.id)
}

/** @param {typeof displayMessages.value[0]} msg */
function onMessageBubbleDblClick(msg) {
  messageBubbleTap.cancelPending()
  speakChatMessageAloud(msg)
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

watch(activeChatId, () => {
  peekOriginalSenderId.value = null
})

watch(
  wahaPrefsHydrated,
  (hydrated) => {
    if (!hydrated) {
      void Promise.all([hydrateWahaPrefsFromServer(), hydrateOpenrouterApiKeyFromServer()])
    }
  },
  { immediate: true },
)

function isSameOriginMediaUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return false
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true
  try {
    return new URL(raw, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

function closeMediaViewer() {
  mediaViewer.value = null
}

/**
 * @param {{ media?: { url?: string, kind?: string } | null, text?: string }} msg
 */
function openMediaViewer(msg) {
  const media = msg?.media
  const url = resolveWahaMediaUrl(media?.url || '')
  if (!url || !isSameOriginMediaUrl(url)) return
  const kind = String(media?.kind || 'image')
  if (kind !== 'image' && kind !== 'sticker' && kind !== 'video') return
  mediaViewer.value = {
    url,
    kind,
    caption: String(msg?.text || '').trim(),
  }
}

/**
 * @param {{ media?: { url?: string, filename?: string } | null }} msg
 */
function openFileAttachment(msg) {
  const url = resolveWahaMediaUrl(msg?.media?.url || '')
  if (!url || !isSameOriginMediaUrl(url)) return
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  if (msg?.media?.filename) a.download = msg.media.filename
  a.click()
}

function onMediaViewerKeydown(e) {
  if (e.key === 'Escape') closeMediaViewer()
}

watch(mediaViewer, (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
})

onMounted(() => {
  window.addEventListener('keydown', onMediaViewerKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onMediaViewerKeydown)
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})

/** @param {{ id: string, hasMedia?: boolean, media?: { url?: string } | null }} msg */
function onMediaLoadError(msg) {
  if (!msg?.id || !msg.hasMedia) return
  void fetchMessageMedia(msg.id)
}

/** @param {{ id: string }} msg */
function retryMedia(msg) {
  if (!msg?.id) return
  void fetchMessageMedia(msg.id)
}

function openImagePicker() {
  imageInputRef.value?.click()
}

function openVoicePicker() {
  voiceInputRef.value?.click()
}

function openFilePicker() {
  fileInputRef.value?.click()
}

/** @param {Event} e */
async function onImagePicked(e) {
  const input = /** @type {HTMLInputElement} */ (e.target)
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const caption = draft.value.trim()
  const ok = await sendMedia(file, 'image', caption)
  if (ok && caption) draft.value = ''
}

/** @param {Event} e */
async function onVoicePicked(e) {
  const input = /** @type {HTMLInputElement} */ (e.target)
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await sendMedia(file, 'voice')
}

/** @param {Event} e */
async function onFilePicked(e) {
  const input = /** @type {HTMLInputElement} */ (e.target)
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const caption = draft.value.trim()
  const ok = await sendMedia(file, 'file', caption)
  if (ok && caption) draft.value = ''
}

async function onSendPoll() {
  const name = pollQuestion.value.trim()
  const options = [pollOptionA.value, pollOptionB.value].map((o) => o.trim()).filter(Boolean)
  if (!name || options.length < 2) return
  const ok = await sendPoll(name, options)
  if (ok) {
    showPollComposer.value = false
    pollQuestion.value = ''
    pollOptionA.value = ''
    pollOptionB.value = ''
  }
}
</script>

<template>
  <div class="chat-shell">
    <nav class="chat-platform-tabs" aria-label="Chat platform">
      <button
        type="button"
        class="chat-platform-tab tap"
        :class="{ active: chatTab === 'whatsapp' }"
        :aria-selected="chatTab === 'whatsapp'"
        @click="chatTab = 'whatsapp'"
      >
        WhatsApp
      </button>
      <button
        type="button"
        class="chat-platform-tab tap"
        :class="{ active: chatTab === 'imessage' }"
        :aria-selected="chatTab === 'imessage'"
        @click="chatTab = 'imessage'"
      >
        iMessage
      </button>
    </nav>

    <IMessageChatPanel v-if="chatTab === 'imessage'" />

    <div v-else class="chat-page">
  <p v-if="chatPickToast" class="chat-pick-toast" role="status" aria-live="polite">{{ chatPickToast }}</p>
  <!-- Hydrating account WhatsApp prefs from server -->
  <div v-if="!wahaPrefsHydrated" class="chat-empty">
    <div class="chat-thread-loader" role="status" aria-live="polite">
      <div
        class="chat-sync-progress"
        role="progressbar"
        :aria-valuenow="loaderPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="chat-sync-progress-fill"
          :class="{ 'is-active': !wahaPrefsHydrated }"
          :style="{ width: `${loaderPercent || 18}%` }"
        />
      </div>
      <p class="chat-thread-loader-label">Loading chat…</p>
    </div>
  </div>

  <!-- Not configured -->
  <div v-else-if="!configured" class="chat-empty">
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
    <p class="chat-list-hint">Double-tap a chat to use it and play today’s briefing. Double-tap a message to hear it again.</p>
    <div class="chat-list-scroll">
      <p v-if="chatsLoading" class="chat-list-status">Loading chats…</p>
      <p v-else-if="!chats.length" class="chat-list-status">No chats found. Check WAHA connection in Settings.</p>
      <button
        v-for="c in chatsForList"
        :key="c.id"
        type="button"
        class="chat-list-item tap"
        :class="{ 'is-active': c.id === activeChatId }"
        @click="onChatListTap(c)"
        @dblclick.prevent="onChatListDblClick(c)"
      >
        <span class="chat-list-avatar" aria-hidden="true">{{ chatAvatarInitial(c.name) }}</span>
        <span class="chat-list-body">
          <span class="chat-list-name">
            <span class="chat-list-first">{{ c.firstName || c.displayTitle }}</span>
            <span v-if="c.lastName" class="chat-list-last">{{ c.lastName }}</span>
          </span>
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
      <button
        type="button"
        class="chat-briefing-btn tap"
        :disabled="!briefingAvailable || briefingBusy || !hasActiveChat"
        :title="
          briefingAvailable
            ? 'Summarize the last 2 days and read aloud'
            : 'Set OpenRouter API key (Settings → API) and choose a chat (Settings → WhatsApp)'
        "
        aria-label="Generate spoken chat briefing"
        @click="onGenerateBriefingTap"
      >
        <span class="chat-briefing-btn-icon" aria-hidden="true">AI</span>
        <span class="chat-briefing-btn-label">{{ briefingBusy ? '…' : 'Brief' }}</span>
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
      <RouterLink class="btn primary tap" :to="{ path: '/settings', query: { tab: 'whatsapp' } }">
        Choose chat in Settings
      </RouterLink>
    </div>

    <template v-else>
      <div class="chat-thread-wrap">
        <div
          v-if="showThreadLoader"
          class="chat-thread-loader"
          :class="{ 'chat-thread-loader--overlay': displayMessages.length > 0 }"
          role="status"
          aria-live="polite"
          aria-label="Loading messages"
        >
          <div
            class="chat-sync-progress"
            role="progressbar"
            :aria-valuenow="loaderPercent"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="loaderLabel"
          >
            <div
              class="chat-sync-progress-fill"
              :class="{ 'is-active': threadBusy && loaderPercent < 100 }"
              :style="{ width: `${loaderPercent}%` }"
            />
          </div>
          <p class="chat-thread-loader-label">{{ loaderLabel }}</p>
          <p v-if="loaderPercent > 0" class="chat-sync-percent">{{ Math.round(loaderPercent) }}%</p>
        </div>
        <div
          v-else-if="error && !displayMessages.length"
          class="chat-thread-loader chat-thread-status"
          role="alert"
        >
          <p class="chat-thread-status-text">{{ error }}</p>
          <button type="button" class="btn tap chat-thread-retry" @click="refreshMessages">
            Try again
          </button>
        </div>
        <div ref="scrollEl" class="chat-thread" role="log" aria-live="polite" aria-relevant="additions">
        <p
          v-if="syncWarning && displayMessages.length"
          class="chat-thread-sync-hint"
          role="status"
        >
          {{ syncWarning }}
        </p>
        <p v-if="!threadBusy && !displayMessages.length && !error" class="chat-thread-empty">
          No messages yet. Say hello below.
        </p>
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
              @click.stop="onMessageBubbleTap(item.msg)"
              @dblclick.prevent.stop="onMessageBubbleDblClick(item.msg)"
            >
              <button
                v-if="!item.msg.fromMe && item.msg.isGroupChat && item.msg.senderName"
                type="button"
                class="chat-bubble-sender tap"
                :class="{
                  'chat-bubble-sender--translated': item.msg.isSenderNameTranslated,
                  'is-showing-original':
                    item.msg.isSenderNameTranslated &&
                    peekOriginalSenderId === item.msg.id,
                }"
                :title="
                  item.msg.isSenderNameTranslated
                    ? peekOriginalSenderId === item.msg.id
                      ? 'Tap for translation'
                      : 'Tap for original name'
                    : undefined
                "
                @click.stop="onSenderNameTap(item.msg)"
              >
                {{ senderNameLabel(item.msg) }}
              </button>
              <div v-if="item.msg.poll" class="chat-bubble-poll">
                <p class="chat-bubble-poll-title">{{ item.msg.poll.name }}</p>
                <ul class="chat-bubble-poll-options">
                  <li v-for="(opt, oi) in item.msg.poll.options" :key="oi">{{ opt }}</li>
                </ul>
                <p v-if="item.msg.poll.multipleAnswers" class="chat-bubble-poll-hint">
                  Multiple answers allowed
                </p>
              </div>
              <div v-else-if="item.msg.media?.url" class="chat-bubble-media">
                <img
                  v-if="item.msg.media.kind === 'image' || item.msg.media.kind === 'sticker'"
                  :src="item.msg.media.url"
                  class="chat-media-img tap"
                  :class="{ 'chat-media-img--sticker': item.msg.media.kind === 'sticker' }"
                  alt=""
                  loading="lazy"
                  @error="onMediaLoadError(item.msg)"
                  @click.stop="openMediaViewer(item.msg)"
                />
                <div v-else-if="item.msg.media.kind === 'video'" class="chat-bubble-video-wrap">
                  <video
                    class="chat-media-video"
                    :src="item.msg.media.url"
                    controls
                    playsinline
                    preload="metadata"
                    @error="onMediaLoadError(item.msg)"
                  />
                  <button
                    type="button"
                    class="chat-media-expand tap"
                    aria-label="Open video full screen"
                    @click.stop="openMediaViewer(item.msg)"
                  >
                    Expand
                  </button>
                </div>
                <audio
                  v-else-if="item.msg.media.kind === 'audio'"
                  class="chat-media-audio"
                  :src="item.msg.media.url"
                  controls
                  preload="metadata"
                  @error="onMediaLoadError(item.msg)"
                />
                <a
                  v-else
                  href="#"
                  class="chat-media-file tap"
                  @click.prevent.stop="openFileAttachment(item.msg)"
                >
                  <span class="chat-media-file-icon" aria-hidden="true">📎</span>
                  {{ item.msg.media.filename || 'Open attachment' }}
                  <span v-if="item.msg.media.mimetype" class="chat-media-file-type">{{
                    item.msg.media.mimetype
                  }}</span>
                </a>
                <p v-if="item.msg.media.error" class="chat-media-err">{{ item.msg.media.error }}</p>
              </div>
              <div
                v-else-if="item.msg.hasMedia && !item.msg.media?.url"
                class="chat-bubble-media chat-bubble-media--pending"
              >
                <p class="chat-bubble-text chat-bubble-text--muted">Loading attachment…</p>
                <button type="button" class="chat-media-retry tap" @click="retryMedia(item.msg)">
                  Retry
                </button>
              </div>
              <p v-if="item.msg.text" class="chat-bubble-text">
                <ChatMessageText :text="item.msg.text" />
              </p>
              <ChatLinkPreview
                v-if="item.msg.text && isLinkOnlyMessage(item.msg.text)"
                :url="primaryUrlFromText(item.msg.text)"
              />
              <time class="chat-bubble-time" :datetime="new Date(item.msg.ts).toISOString()">{{ fmtTime(item.msg.ts) }}</time>
            </div>
          </div>
        </template>
        </div>
      </div>

      <div v-if="showPollComposer" class="chat-poll-compose">
        <input
          v-model="pollQuestion"
          type="text"
          class="chat-poll-input tap"
          placeholder="Poll question"
          aria-label="Poll question"
          :disabled="sending"
        />
        <input
          v-model="pollOptionA"
          type="text"
          class="chat-poll-input tap"
          placeholder="Option 1"
          aria-label="Poll option 1"
          :disabled="sending"
        />
        <input
          v-model="pollOptionB"
          type="text"
          class="chat-poll-input tap"
          placeholder="Option 2"
          aria-label="Poll option 2"
          :disabled="sending"
        />
        <div class="chat-poll-actions">
          <button type="button" class="chat-poll-cancel tap" :disabled="sending" @click="showPollComposer = false">
            Cancel
          </button>
          <button
            type="button"
            class="chat-poll-send tap"
            :disabled="sending || !pollQuestion.trim() || !pollOptionA.trim() || !pollOptionB.trim()"
            @click="onSendPoll"
          >
            Send poll
          </button>
        </div>
      </div>
      <form class="chat-compose" @submit.prevent="onSend">
        <input
          ref="imageInputRef"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          class="chat-compose-file"
          tabindex="-1"
          aria-hidden="true"
          @change="onImagePicked"
        />
        <input
          ref="voiceInputRef"
          type="file"
          accept="audio/*,.ogg,.opus,.m4a,.mp3,.wav"
          class="chat-compose-file"
          tabindex="-1"
          aria-hidden="true"
          @change="onVoicePicked"
        />
        <input
          ref="fileInputRef"
          type="file"
          class="chat-compose-file"
          tabindex="-1"
          aria-hidden="true"
          @change="onFilePicked"
        />
        <button
          type="button"
          class="chat-compose-attach tap"
          aria-label="Send image"
          title="Send image"
          :disabled="sending"
          @click="openImagePicker"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 16l-5.5-5.5a2 2 0 0 0-2.8 0L3 18" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-compose-attach tap"
          aria-label="Send voice"
          title="Send voice"
          :disabled="sending"
          @click="openVoicePicker"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z" />
            <path d="M19 11v1a7 7 0 0 1-14 0v-1M12 18v3" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-compose-attach tap"
          aria-label="Send file"
          title="Send file"
          :disabled="sending"
          @click="openFilePicker"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-compose-attach tap"
          :class="{ 'is-active': showPollComposer }"
          aria-label="Send poll"
          title="Send poll"
          :disabled="sending"
          @click="showPollComposer = !showPollComposer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M9 11h6M9 15h4M7 4h10a2 2 0 0 1 2 2v14l-4-3-4 3V6a2 2 0 0 1-2-2z" />
          </svg>
        </button>
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

  <Teleport v-if="chatTab === 'whatsapp'" to="body">
    <div
      v-if="mediaViewer"
      class="chat-media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
    >
      <button
        type="button"
        class="chat-media-viewer-backdrop tap"
        aria-label="Close preview"
        @click="closeMediaViewer"
      />
      <div class="chat-media-viewer-panel">
        <button
          type="button"
          class="chat-media-viewer-close tap"
          aria-label="Close"
          @click="closeMediaViewer"
        >
          ×
        </button>
        <img
          v-if="mediaViewer.kind === 'image' || mediaViewer.kind === 'sticker'"
          :src="mediaViewer.url"
          class="chat-media-viewer-img"
          alt=""
        />
        <video
          v-else-if="mediaViewer.kind === 'video'"
          class="chat-media-viewer-video"
          :src="mediaViewer.url"
          controls
          autoplay
          playsinline
        />
        <p v-if="mediaViewer.caption" class="chat-media-viewer-caption">{{ mediaViewer.caption }}</p>
      </div>
    </div>
  </Teleport>
  </div>
</template>

<style scoped>
.chat-shell {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  width: 100%;
}
.chat-platform-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.35rem 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.chat-platform-tab {
  flex: 1;
  border: none;
  border-radius: 0.5rem 0.5rem 0 0;
  padding: 0.55rem 0.75rem;
  background: transparent;
  color: var(--color-text-secondary, #a8a8b8);
  font-weight: 600;
  font-size: 0.78rem;
}
.chat-platform-tab.active {
  background: rgba(123, 77, 181, 0.18);
  color: var(--color-text-primary, #f4f4f8);
}
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

.chat-briefing-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 2.75rem;
  padding: 0 0.65rem;
  border: 1px solid rgba(168, 85, 247, 0.45);
  border-radius: var(--radius-full, 9999px);
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.35), rgba(249, 115, 22, 0.22));
  color: var(--color-text-primary, #f4f4f5);
  font-size: 0.8125rem;
  font-weight: var(--weight-semibold, 600);
  cursor: pointer;
}

.chat-briefing-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-briefing-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #a855f7, #f97316);
  color: #fff;
}

.chat-briefing-btn-label {
  line-height: 1;
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

.chat-pick-toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--app-nav-height, 4.5rem) + 0.75rem);
  z-index: var(--z-toast, 60);
  transform: translateX(-50%);
  margin: 0;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-full, 9999px);
  background: rgba(22, 22, 29, 0.92);
  border: 1px solid rgba(168, 85, 247, 0.45);
  color: var(--color-text-primary, #f4f4f5);
  font-size: 0.875rem;
  font-weight: var(--weight-semibold, 600);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.chat-list-hint {
  flex-shrink: 0;
  margin: 0;
  padding: 0.35rem 0.75rem 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary, #a8a8b8);
  text-align: center;
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
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  font-size: var(--text-sm, 0.8125rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-list-first {
  font-weight: var(--weight-bold, 700);
  flex-shrink: 0;
}

.chat-list-last {
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-secondary, #a8a8b8);
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

.chat-thread-wrap {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.chat-thread-loader {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 8rem;
}

.chat-thread-loader--overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  flex: none;
  min-height: 0;
  background: rgba(8, 8, 10, 0.55);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.chat-sync-progress {
  width: min(16rem, 72vw);
  height: 0.35rem;
  border-radius: 999px;
  background: var(--color-border, rgba(255, 255, 255, 0.1));
  overflow: hidden;
}

.chat-sync-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    var(--color-accent-purple, #7b4db5) 0%,
    #a78bfa 100%
  );
  transition: width 0.35s ease;
}
.chat-sync-progress-fill.is-active {
  animation: chat-sync-pulse 1.4s ease-in-out infinite;
}

@keyframes chat-sync-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.72;
  }
}

.chat-thread-loader-label {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
  text-align: center;
}

.chat-sync-percent {
  margin: 0;
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary, #8b8b98);
}

.chat-thread-status {
  gap: 1rem;
  padding: 1.25rem;
}

.chat-thread-status-text {
  margin: 0;
  max-width: 18rem;
  text-align: center;
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.45;
  color: var(--color-text-secondary, #a8a8b8);
}

.chat-thread-retry {
  font-size: var(--text-sm, 0.8125rem);
}

.chat-thread-sync-hint {
  margin: 0 0 0.35rem;
  padding: 0.35rem 0.5rem;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.35;
  text-align: center;
  color: var(--color-text-tertiary, #6e6e7e);
  background: rgba(123, 77, 181, 0.08);
  border-radius: var(--radius-md, 0.5rem);
}

@keyframes chat-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.chat-thread {
  flex: 1 1 auto;
  width: 100%;
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
  display: block;
  width: 100%;
  margin: 0 0 0.28rem;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: var(--weight-bold, 700);
  color: var(--color-accent-orange, #ff6b1a);
  line-height: 1.2;
}

.chat-bubble-sender--translated {
  color: var(--color-accent-purple-light, #9d6fd7);
}

.chat-bubble-sender--translated.is-showing-original {
  color: var(--color-text-secondary, #a8a8b8);
  font-weight: var(--weight-semibold, 600);
  font-style: italic;
}

.chat-bubble-sender--translated:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 2px;
  border-radius: var(--radius-sm, 0.375rem);
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

.chat-media-img--sticker {
  max-width: 8rem;
  max-height: 8rem;
  object-fit: contain;
}

.chat-bubble-poll {
  margin-bottom: 0.25rem;
  padding: 0.35rem 0.45rem;
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(0, 0, 0, 0.12);
}

.chat-bubble-poll-title {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
  font-weight: var(--weight-semibold, 600);
}

.chat-bubble-poll-options {
  margin: 0;
  padding: 0 0 0 1rem;
  font-size: 0.85rem;
  line-height: 1.4;
}

.chat-bubble-poll-hint {
  margin: 0.35rem 0 0;
  font-size: 0.7rem;
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-bubble-media--pending {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.35rem 0;
}

.chat-media-retry {
  align-self: flex-start;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary, #c8c8d4);
  font: inherit;
  font-size: 0.72rem;
  padding: 0.25rem 0.55rem;
  border-radius: 0.35rem;
  cursor: pointer;
}

.chat-media-file {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
}

.chat-media-file-type {
  font-size: 0.65rem;
  opacity: 0.75;
}

.chat-bubble-video-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.chat-media-video {
  display: block;
  max-width: 100%;
  max-height: 14rem;
  border-radius: var(--radius-md, 0.5rem);
}

.chat-media-expand {
  position: absolute;
  right: 0.35rem;
  bottom: 0.35rem;
  border: none;
  border-radius: var(--radius-full, 9999px);
  padding: 0.2rem 0.55rem;
  font: inherit;
  font-size: 0.68rem;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
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

.chat-poll-compose {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem 0.55rem 0;
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  border-top: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
}

.chat-poll-input {
  width: 100%;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 0.5rem);
  padding: 0.45rem 0.65rem;
  font: inherit;
  font-size: 0.9rem;
  color: var(--color-text-primary, #f4f4f8);
  background: var(--color-bg-elevated, #0f0f14);
}

.chat-poll-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}

.chat-poll-cancel,
.chat-poll-send {
  border: none;
  border-radius: var(--radius-full, 9999px);
  padding: 0.35rem 0.75rem;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.chat-poll-cancel {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary, #a8a8b8);
}

.chat-poll-send {
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
}

.chat-compose-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.chat-compose-attach {
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: transparent;
  color: var(--color-text-secondary, #a8a8b8);
  cursor: pointer;
}

.chat-compose-attach.is-active {
  color: var(--color-accent-purple-light, #9d6fd7);
  background: rgba(123, 77, 181, 0.2);
}

.chat-compose-attach svg {
  width: 1.2rem;
  height: 1.2rem;
}

.chat-compose-attach:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-compose {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
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

<style>
.chat-media-viewer {
  position: fixed;
  inset: 0;
  z-index: 10060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0.5rem)
    env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0.5rem);
}

.chat-media-viewer-backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: rgba(0, 0, 0, 0.88);
  cursor: pointer;
}

.chat-media-viewer-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  max-width: min(96vw, 42rem);
  max-height: min(92vh, 92dvh);
}

.chat-media-viewer-close {
  align-self: flex-end;
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: var(--radius-full, 9999px);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
}

.chat-media-viewer-img {
  display: block;
  max-width: 100%;
  max-height: min(78vh, 78dvh);
  object-fit: contain;
  border-radius: var(--radius-md, 0.5rem);
}

.chat-media-viewer-video {
  display: block;
  max-width: 100%;
  max-height: min(78vh, 78dvh);
  border-radius: var(--radius-md, 0.5rem);
  background: #000;
}

.chat-media-viewer-caption {
  margin: 0;
  max-width: 100%;
  text-align: center;
  font-size: 0.9rem;
  line-height: 1.4;
  color: #e8e8ee;
}
</style>
