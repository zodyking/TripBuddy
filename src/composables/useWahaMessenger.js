/**
 * WAHA messenger state: load, poll, and send messages for the active chat.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  getWahaChatId,
  setWahaChatId,
  isWahaConfigured,
  getWahaPollInterval,
  fetchChatMessagesForChat,
  sendChatMessage,
  listChats,
  normalizeWahaMessage,
  normalizeWahaChat,
  wahaChatKindLabel,
} from '../utils/wahaApi.js'

/**
 * @param {{ scrollEl?: import('vue').Ref<HTMLElement | null>, poll?: boolean }} [opts]
 */
export function useWahaMessenger(opts = {}) {
  const shouldPoll = opts.poll !== false
  const messages = ref(/** @type {ReturnType<typeof normalizeWahaMessage>[]} */ ([]))
  const loading = ref(false)
  const sending = ref(false)
  const error = ref('')
  const activeChatId = ref(getWahaChatId())
  const chatTitle = ref('')
  const chats = ref(/** @type {ReturnType<typeof normalizeWahaChat>[]} */ ([]))
  const chatsLoading = ref(false)

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  let lastSeenId = ''

  const configured = computed(() => isWahaConfigured())
  const displayMessages = computed(() =>
    [...messages.value].sort((a, b) => a.ts - b.ts),
  )

  function syncActiveFromStorage() {
    activeChatId.value = getWahaChatId()
  }

  async function resolveChatTitle() {
    const id = activeChatId.value
    if (!id) {
      chatTitle.value = ''
      return
    }
    const hit = chats.value.find((c) => c.id === id)
    if (hit) {
      chatTitle.value = hit.name
      return
    }
    chatTitle.value = id.split('@')[0] || id
  }

  async function loadChats() {
    chatsLoading.value = true
    try {
      const r = await listChats({ limit: 100 })
      if (r.ok && Array.isArray(r.body)) {
        chats.value = r.body
      }
    } finally {
      chatsLoading.value = false
      await resolveChatTitle()
    }
  }

  async function scrollToBottom() {
    await nextTick()
    const el = opts.scrollEl?.value
    if (el) el.scrollTop = el.scrollHeight
  }

  async function refreshMessages() {
    const chatId = activeChatId.value
    if (!chatId) {
      messages.value = []
      return
    }
    loading.value = true
    error.value = ''
    try {
      const r = await fetchChatMessagesForChat(chatId, 60)
      if (!r.ok || !Array.isArray(r.body)) {
        error.value = r.status ? `Could not load messages (${r.status})` : 'Could not load messages'
        return
      }
      const normalized = r.body
        .map((m) => normalizeWahaMessage(m))
        .filter((m) => m.id && (m.text || m.hasMedia))
      messages.value = normalized
      if (normalized.length > 0) {
        const newest = [...normalized].sort((a, b) => b.ts - a.ts)[0]
        lastSeenId = newest.id
      }
      await scrollToBottom()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function pollOnce() {
    if (!activeChatId.value) return
    try {
      const r = await fetchChatMessagesForChat(activeChatId.value, 40)
      if (!r.ok || !Array.isArray(r.body)) return
      error.value = ''
      const incoming = r.body.map((m) => normalizeWahaMessage(m)).filter((m) => m.id)
      const byId = new Map(messages.value.map((m) => [m.id, m]))
      let hasNew = false
      for (const m of incoming) {
        if (!byId.has(m.id)) hasNew = true
        byId.set(m.id, m)
      }
      messages.value = [...byId.values()]
      if (incoming.length > 0) {
        const newest = [...incoming].sort((a, b) => b.ts - a.ts)[0]
        if (newest.id !== lastSeenId) {
          lastSeenId = newest.id
          if (hasNew) await scrollToBottom()
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function startPolling() {
    if (!shouldPoll || pollTimer) return
    if (!activeChatId.value) return
    pollTimer = setInterval(pollOnce, getWahaPollInterval())
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function sendText(text) {
    const trimmed = String(text ?? '').trim()
    if (!trimmed || !activeChatId.value) return false
    sending.value = true
    error.value = ''
    try {
      const r = await sendChatMessage(trimmed)
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

  function selectChat(chat) {
    if (!chat?.id) return
    setWahaChatId(chat.id)
    activeChatId.value = chat.id
    chatTitle.value = chat.name || chat.id
    messages.value = []
    lastSeenId = ''
    void refreshMessages().then(() => startPolling())
  }

  watch(activeChatId, () => {
    void resolveChatTitle()
  })

  onMounted(() => {
    syncActiveFromStorage()
    if (!configured.value) return
    void loadChats().then(() => {
      if (activeChatId.value) {
        void refreshMessages().then(() => {
          startPolling()
        })
      }
    })
  })

  onBeforeUnmount(() => {
    stopPolling()
  })

  return {
    configured,
    activeChatId,
    chatTitle,
    chats,
    chatsLoading,
    messages,
    displayMessages,
    loading,
    sending,
    error,
    wahaChatKindLabel,
    loadChats,
    refreshMessages,
    sendText,
    selectChat,
    stopPolling,
    startPolling,
    syncActiveFromStorage,
  }
}
