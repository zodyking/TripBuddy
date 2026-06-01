/**
 * BlueBubbles messenger: iMessage-style inbox + per-conversation threads.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ensureBlueBubblesPrefsHydrated } from '../utils/blueBubblesPrefs.js'
import {
  isBlueBubblesConfigured,
  getBlueBubblesPollInterval,
  fetchBlueBubblesChatMessages,
  fetchBlueBubblesRecentMessages,
  fetchBlueBubblesContacts,
  sendBlueBubblesMessage,
  listBlueBubblesChats,
  normalizeBlueBubblesMessage,
  normalizeBlueBubblesChat,
  buildBlueBubblesContactMap,
  bbChatKindLabel,
} from '../utils/blueBubblesApi.js'
import { getIMessageThreadCache, syncIMessageThread } from '../api.js'
import { formatChatDisplayName } from '../utils/chatDisplayName.js'
import { handleNewIncomingIMessageBatch } from '../utils/blueBubblesAutoResponder.js'
import {
  getCachedBbThread,
  setCachedBbThread,
  getCachedBbChats,
  setCachedBbChats,
  getCachedBbContactMap,
  setCachedBbContactMap,
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
  const activeChatGuid = ref('')
  const chatTitle = ref('')
  const chats = ref(/** @type {ReturnType<typeof normalizeBlueBubblesChat>[]} */ ([]))
  const chatsLoading = ref(false)
  /** @type {import('vue').Ref<Map<string, string>>} */
  const contactMap = ref(new Map())

  function normalizeOpts() {
    return { contactMap: contactMap.value }
  }

  function remapChats(rawList) {
    chats.value = rawList.map((c) => normalizeBlueBubblesChat(c, normalizeOpts())).filter((c) => c?.id)
  }

  async function loadContacts() {
    try {
      const r = await fetchBlueBubblesContacts()
      if (r.ok && Array.isArray(r.body) && r.body.length) {
        contactMap.value = buildBlueBubblesContactMap(r.body)
        setCachedBbContactMap(contactMap.value)
        if (chats.value.length) {
          const raw = getCachedBbChats()
          if (raw.length) remapChats(raw)
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  let syncGen = 0
  let hadPriorMessages = false
  /** @type {Set<string>} */
  const seenInboxIds = new Set()

  const configured = computed(() => isBlueBubblesConfigured())
  const inConversation = computed(() => !!activeChatGuid.value)
  const displayMessages = computed(() =>
    [...messages.value].sort((a, b) => a.ts - b.ts),
  )

  const sortedChats = computed(() =>
    [...chats.value].sort((a, b) => (b.lastMessageTs || 0) - (a.lastMessageTs || 0)),
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
      .map((m) => normalizeBlueBubblesMessage(m, { chatGuid, ...normalizeOpts() }))
      .filter(Boolean)
    if (scroll) void scrollToBottom()
    return true
  }

  function updateChatPreview(chatGuid, msg) {
    if (!chatGuid || !msg) return
    const idx = chats.value.findIndex((c) => c.id === chatGuid)
    if (idx < 0) return
    const c = chats.value[idx]
    chats.value[idx] = {
      ...c,
      lastMessageText: msg.text || (msg.hasMedia ? 'Attachment' : c.lastMessageText),
      lastMessageTs: msg.ts || c.lastMessageTs,
    }
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
          .map((m) => normalizeBlueBubblesMessage(m, { chatGuid, ...normalizeOpts() }))
          .filter(Boolean)
        syncProgress.value = 35
      }
      syncProgress.value = 55
      const r = await syncIMessageThread(chatGuid, { limit })
      if (gen !== syncGen) return
      if (r.stale && r.warning) syncWarning.value = r.warning
      if (Array.isArray(r.messages)) {
        const normalized = r.messages
          .map((m) => normalizeBlueBubblesMessage(m, { chatGuid, ...normalizeOpts() }))
          .filter(Boolean)
        const prevIds = new Set(messages.value.map((m) => m.id))
        hadPriorMessages = messages.value.length > 0
        const incoming = normalized.filter((m) => !prevIds.has(m.id))
        if (incoming.length) {
          handleNewIncomingIMessageBatch(incoming, { hadPriorMessages, skipIfNoPriorMessages: true })
        }
        messages.value = normalized
        setCachedBbThread(chatGuid, r.messages, r.updatedAt || Date.now())
        const last = normalized[normalized.length - 1]
        if (last) updateChatPreview(chatGuid, last)
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
        setCachedBbChats(r.body)
        remapChats(r.body)
      }
    } catch {
      /* ignore */
    } finally {
      chatsLoading.value = false
    }
  }

  async function refreshMessages() {
    if (!activeChatGuid.value) {
      await loadChats()
      return
    }
    loading.value = true
    await syncThread(activeChatGuid.value, { scroll: true })
    loading.value = false
  }

  async function pollActiveThread() {
    const chatGuid = activeChatGuid.value
    if (!chatGuid || syncing.value) return
    try {
      const r = await fetchBlueBubblesChatMessages(chatGuid, { limit: 40 })
      if (!r.ok || !Array.isArray(r.body)) return
      const normalized = [...r.body]
        .reverse()
        .map((m) => normalizeBlueBubblesMessage(m, { chatGuid, ...normalizeOpts() }))
        .filter(Boolean)
      const prevIds = new Set(messages.value.map((m) => m.id))
      const incoming = normalized.filter((m) => !prevIds.has(m.id))
      if (incoming.length) {
        handleNewIncomingIMessageBatch(incoming, {
          hadPriorMessages: messages.value.length > 0,
          skipIfNoPriorMessages: true,
        })
        messages.value = normalized
        setCachedBbThread(chatGuid, r.body.reverse(), Date.now())
        const last = normalized[normalized.length - 1]
        if (last) updateChatPreview(chatGuid, last)
        await scrollToBottom()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function pollInboxRecent() {
    if (syncing.value) return
    try {
      const r = await fetchBlueBubblesRecentMessages({ limit: 40 })
      if (!r.ok || !Array.isArray(r.body)) return
      const normalized = r.body
        .map((m) => normalizeBlueBubblesMessage(m, normalizeOpts()))
        .filter(Boolean)
      const incoming = normalized.filter((m) => !seenInboxIds.has(m.id))
      for (const m of normalized) seenInboxIds.add(m.id)
      if (seenInboxIds.size > 1200) {
        const drop = [...seenInboxIds].slice(0, 400)
        for (const id of drop) seenInboxIds.delete(id)
      }
      if (incoming.length) {
        handleNewIncomingIMessageBatch(incoming, {
          hadPriorMessages: true,
          skipIfNoPriorMessages: false,
        })
      }
      for (const m of normalized) {
        if (m.fromMe || !m.chatGuid) continue
        const idx = chats.value.findIndex((c) => c.id === m.chatGuid)
        if (idx < 0) continue
        if (m.ts <= (chats.value[idx].lastMessageTs || 0)) continue
        updateChatPreview(m.chatGuid, m)
      }
      if (activeChatGuid.value) {
        await pollActiveThread()
      }
    } catch {
      /* ignore inbox poll errors */
    }
  }

  async function pollOnce() {
    if (activeChatGuid.value) {
      await pollActiveThread()
    } else {
      await pollInboxRecent()
    }
  }

  function startPolling() {
    if (!shouldPoll || pollTimer) return
    if (!configured.value) return
    void pollOnce()
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
      await pollActiveThread()
      await scrollToBottom()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      sending.value = false
    }
  }

  function openConversation(chat, opts = {}) {
    if (!chat?.id) return
    activeChatGuid.value = chat.id
    const formatted = formatChatDisplayName(String(opts.displayTitle || chat.name || chat.id))
    chatTitle.value = formatted.displayTitle
    messages.value = []
    syncWarning.value = ''
    error.value = ''
    const had = hydrateThreadFromClientCache(chat.id, { scroll: true })
    if (!had) loading.value = true
    void syncThread(chat.id, { scroll: !had }).then(() => {
      void pollActiveThread()
    })
  }

  function closeConversation() {
    activeChatGuid.value = ''
    chatTitle.value = ''
    messages.value = []
    syncWarning.value = ''
    error.value = ''
    loading.value = false
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
      if (!configured.value) return
      const cachedContacts = getCachedBbContactMap()
      if (cachedContacts && Object.keys(cachedContacts).length) {
        contactMap.value = new Map(Object.entries(cachedContacts))
      }
      const memChats = getCachedBbChats()
      if (memChats.length) {
        remapChats(memChats)
      }
      void loadContacts()
      await loadChats()
      startPolling()
    })()
  })

  onBeforeUnmount(() => {
    stopPolling()
  })

  function formatChatLabel(raw) {
    return formatChatDisplayName(raw).displayTitle
  }

  /** @param {ReturnType<typeof normalizeBlueBubblesChat>} chat */
  function contactHandleForChat(chat) {
    if (!chat) return ''
    const id = String(chat.chatIdentifier || chat.id || '').trim()
    if (id && !id.includes(';')) return id
    const parts = String(chat.id || '').split(';')
    return parts[parts.length - 1] || chat.chatIdentifier || ''
  }

  return {
    configured,
    activeChatId: activeChatGuid,
    inConversation,
    chatTitle,
    formatChatLabel,
    contactHandleForChat,
    chats,
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
    chatKindLabel: bbChatKindLabel,
    loadChats,
    refreshMessages,
    sendText,
    openConversation,
    closeConversation,
    stopPolling,
    startPolling,
  }
}
