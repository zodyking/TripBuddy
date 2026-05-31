/**
 * BlueBubbles messenger: cache hydrate + background sync + polling.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  ensureBlueBubblesPrefsHydrated,
  syncCurrentBlueBubblesChatToServer,
} from '../utils/blueBubblesPrefs.js'
import {
  getBlueBubblesChatGuid,
  setBlueBubblesChatGuid,
  isBlueBubblesConfigured,
  getBlueBubblesPollInterval,
  fetchBlueBubblesChatMessages,
  sendBlueBubblesMessage,
  listBlueBubblesChats,
  normalizeBlueBubblesMessage,
  normalizeBlueBubblesChat,
  bbChatKindLabel,
  bbMessageId,
} from '../utils/blueBubblesApi.js'
import { getIMessageThreadCache, syncIMessageThread } from '../api.js'
import { formatChatDisplayName } from '../utils/chatDisplayName.js'
import { handleNewIncomingIMessageBatch } from '../utils/blueBubblesAutoResponder.js'
import {
  getCachedBbThread,
  setCachedBbThread,
  getCachedBbChats,
  setCachedBbChats,
} from '../stores/blueBubblesChatStore.js'

/**
 * @param {{ scrollEl?: import('vue').Ref<HTMLElement | null>, poll?: boolean }} [opts]
 */
export function useBlueBubblesMessenger(opts = {}) {
  const shouldPoll = opts.poll !== false
  const messages = ref(/** @type {ReturnType<typeof normalizeBlueBubblesMessage>[]} */ ([]))
  const loading = ref(false)
  const syncing = ref(false)
  const syncProgress = ref(0)
  const syncStatusLabel = ref('')
  const sending = ref(false)
  const error = ref('')
  const syncWarning = ref('')
  const activeChatGuid = ref(getBlueBubblesChatGuid())
  const chatTitle = ref('')
  const chats = ref(/** @type {ReturnType<typeof normalizeBlueBubblesChat>[]} */ ([]))
  const chatsLoading = ref(false)

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  let lastSeenId = ''
  let syncGen = 0
  let hadPriorMessages = false

  const configured = computed(() => isBlueBubblesConfigured())
  const displayMessages = computed(() =>
    [...messages.value].sort((a, b) => a.ts - b.ts),
  )

  async function scrollToBottom() {
    await nextTick()
    const el = opts.scrollEl?.value
    if (el) el.scrollTop = el.scrollHeight
  }

  function hydrateThreadFromClientCache(chatGuid, { scroll = false } = {}) {
    const cached = getCachedBbThread(chatGuid)
    if (!cached?.messages?.length) return false
    messages.value = cached.messages
      .map((m) => normalizeBlueBubblesMessage(m, { chatGuid }))
      .filter(Boolean)
    if (scroll) void scrollToBottom()
    return true
  }

  async function syncThread(chatGuid, { scroll = true, limit = 60 } = {}) {
    const gen = ++syncGen
    syncing.value = true
    syncProgress.value = 8
    syncStatusLabel.value = 'Syncing with iMessage…'
    syncWarning.value = ''
    try {
      const cacheRes = await getIMessageThreadCache(chatGuid)
      if (gen !== syncGen) return
      if (cacheRes?.messages?.length) {
        messages.value = cacheRes.messages
          .map((m) => normalizeBlueBubblesMessage(m, { chatGuid }))
          .filter(Boolean)
        syncProgress.value = 35
      }
      syncProgress.value = 55
      const r = await syncIMessageThread(chatGuid, { limit })
      if (gen !== syncGen) return
      if (r.stale && r.warning) syncWarning.value = r.warning
      if (Array.isArray(r.messages)) {
        const normalized = r.messages
          .map((m) => normalizeBlueBubblesMessage(m, { chatGuid }))
          .filter(Boolean)
        const prevIds = new Set(messages.value.map((m) => m.id))
        hadPriorMessages = messages.value.length > 0
        const incoming = normalized.filter((m) => !m.fromMe && !prevIds.has(m.id))
        if (incoming.length) {
          handleNewIncomingIMessageBatch(incoming, { hadPriorMessages, skipIfNoPriorMessages: true })
        }
        messages.value = normalized
        setCachedBbThread(chatGuid, r.messages, r.updatedAt || Date.now())
      }
      syncProgress.value = 100
    } catch (e) {
      if (gen === syncGen) {
        syncWarning.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (gen === syncGen) {
        syncing.value = false
        syncStatusLabel.value = ''
        loading.value = false
        if (scroll) await scrollToBottom()
      }
    }
  }

  async function loadChats() {
    chatsLoading.value = true
    try {
      const r = await listBlueBubblesChats({ limit: 80 })
      if (r.ok && Array.isArray(r.body)) {
        chats.value = r.body.map(normalizeBlueBubblesChat).filter((c) => c?.id)
        setCachedBbChats(r.body)
      }
    } catch {
      /* ignore */
    } finally {
      chatsLoading.value = false
    }
  }

  async function refreshMessages() {
    if (!activeChatGuid.value) return
    loading.value = true
    await syncThread(activeChatGuid.value, { scroll: true })
    loading.value = false
  }

  async function pollOnce() {
    if (!activeChatGuid.value || syncing.value) return
    try {
      const r = await fetchBlueBubblesChatMessages(activeChatGuid.value, { limit: 40 })
      if (!r.ok || !Array.isArray(r.body)) return
      const chatGuid = activeChatGuid.value
      const normalized = [...r.body]
        .reverse()
        .map((m) => normalizeBlueBubblesMessage(m, { chatGuid }))
        .filter(Boolean)
      const prevIds = new Set(messages.value.map((m) => m.id))
      const incoming = normalized.filter((m) => !m.fromMe && !prevIds.has(m.id))
      if (incoming.length) {
        handleNewIncomingIMessageBatch(incoming, {
          hadPriorMessages: messages.value.length > 0,
          skipIfNoPriorMessages: true,
        })
        messages.value = normalized
        setCachedBbThread(chatGuid, r.body.reverse(), Date.now())
        const newest = [...incoming].sort((a, b) => b.ts - a.ts)[0]
        if (newest?.id && newest.id !== lastSeenId) {
          lastSeenId = newest.id
          await scrollToBottom()
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function startPolling() {
    if (!shouldPoll || pollTimer) return
    if (!activeChatGuid.value) return
    pollTimer = setInterval(pollOnce, getBlueBubblesPollInterval())
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function sendText(text) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed || !activeChatGuid.value) return false
    sending.value = true
    error.value = ''
    try {
      const r = await sendBlueBubblesMessage(activeChatGuid.value, trimmed)
      if (!r.ok) {
        error.value = `Send failed (${r.status})`
        return false
      }
      await pollOnce()
      await scrollToBottom()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      sending.value = false
    }
  }

  function selectChat(chat, opts = {}) {
    if (!chat?.id) return
    setBlueBubblesChatGuid(chat.id)
    void syncCurrentBlueBubblesChatToServer().catch(() => {})
    activeChatGuid.value = chat.id
    const formatted = formatChatDisplayName(String(opts.displayTitle || chat.name || chat.id))
    chatTitle.value = formatted.displayTitle
    lastSeenId = ''
    const had = hydrateThreadFromClientCache(chat.id, { scroll: true })
    if (!had) loading.value = true
    void syncThread(chat.id, { scroll: !had }).then(() => startPolling())
  }

  async function resolveChatTitle() {
    const id = activeChatGuid.value
    if (!id) {
      chatTitle.value = ''
      return
    }
    const hit = chats.value.find((c) => c.id === id)
    if (hit) {
      chatTitle.value = formatChatDisplayName(hit.name).displayTitle
      return
    }
    chatTitle.value = id.split(';').pop() || id
  }

  watch(activeChatGuid, () => {
    void resolveChatTitle()
  })

  onMounted(() => {
    void (async () => {
      await ensureBlueBubblesPrefsHydrated()
      activeChatGuid.value = getBlueBubblesChatGuid()
      if (!configured.value) return
      const memChats = getCachedBbChats()
      if (memChats.length) {
        chats.value = memChats.map(normalizeBlueBubblesChat).filter((c) => c?.id)
      }
      void loadChats().then(() => {
        if (!activeChatGuid.value) return
        const had = hydrateThreadFromClientCache(activeChatGuid.value, { scroll: true })
        if (!had) loading.value = true
        void syncThread(activeChatGuid.value, { scroll: !had }).then(() => startPolling())
      })
    })()
  })

  onBeforeUnmount(() => {
    stopPolling()
  })

  function formatChatLabel(raw) {
    return formatChatDisplayName(raw).displayTitle
  }

  return {
    configured,
    activeChatId: activeChatGuid,
    chatTitle,
    formatChatLabel,
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
    chatKindLabel: bbChatKindLabel,
    loadChats,
    refreshMessages,
    sendText,
    selectChat,
    stopPolling,
    startPolling,
  }
}
