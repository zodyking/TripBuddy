/**
 * WAHA messenger: instant cache hydrate + background server sync + lazy media.
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
  listContacts,
  buildContactNameMap,
  normalizeWahaMessage,
  normalizeWahaChat,
  wahaChatKindLabel,
} from '../utils/wahaApi.js'
import {
  getWhatsAppThreadCache,
  syncWhatsAppThread,
  fetchWhatsAppMessageMedia,
} from '../api.js'
import {
  getCachedThread,
  setCachedThread,
  getCachedChats,
  setCachedChats,
  getCachedContactsMap,
  setCachedContactsMap,
} from '../stores/wahaChatStore.js'

/**
 * @param {{ scrollEl?: import('vue').Ref<HTMLElement | null>, poll?: boolean }} [opts]
 */
export function useWahaMessenger(opts = {}) {
  const shouldPoll = opts.poll !== false
  const messages = ref(/** @type {ReturnType<typeof normalizeWahaMessage>[]} */ ([]))
  const loading = ref(false)
  const syncing = ref(false)
  const sending = ref(false)
  const error = ref('')
  const activeChatId = ref(getWahaChatId())
  const chatTitle = ref('')
  const chats = ref(/** @type {ReturnType<typeof normalizeWahaChat>[]} */ ([]))
  const chatsLoading = ref(false)
  /** @type {import('vue').Ref<Map<string, string>>} */
  const contactMap = ref(new Map())

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  let lastSeenId = ''
  let syncGen = 0
  let mediaGen = 0

  const configured = computed(() => isWahaConfigured())
  const displayMessages = computed(() =>
    [...messages.value].sort((a, b) => a.ts - b.ts),
  )

  function syncActiveFromStorage() {
    activeChatId.value = getWahaChatId()
  }

  function contactsFromRecord(rec) {
    const map = new Map()
    if (rec && typeof rec === 'object') {
      for (const [k, v] of Object.entries(rec)) {
        if (k && v) map.set(k, String(v))
      }
    }
    return map
  }

  function applyContactsRecord(rec) {
    contactMap.value = contactsFromRecord(rec)
    setCachedContactsMap(rec)
  }

  function applyContactsList(list) {
    const map = buildContactNameMap(list)
    contactMap.value = map
    setCachedContactsMap(Object.fromEntries(map))
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

  function normalizeList(raw, chatId) {
    return raw
      .map((m) => normalizeWahaMessage(m, { contactMap: contactMap.value, activeChatId: chatId }))
      .filter((m) => m.id && (m.text || m.hasMedia))
  }

  function applyMessages(normalized, chatId, updatedAt) {
    messages.value = normalized
    setCachedThread(chatId, normalized, updatedAt)
    if (normalized.length > 0) {
      const newest = [...normalized].sort((a, b) => b.ts - a.ts)[0]
      lastSeenId = newest.id
    }
  }

  function hydrateContactsFromCache() {
    const rec = getCachedContactsMap()
    if (Object.keys(rec).length) {
      contactMap.value = contactsFromRecord(rec)
    }
  }

  /**
   * @param {string} chatId
   * @param {{ scroll?: boolean }} [opts]
   */
  function hydrateThreadFromClientCache(chatId, opts = {}) {
    const cached = getCachedThread(chatId)
    if (!cached?.messages?.length) return false
    const normalized = cached.messages.every((m) => m && typeof m.id === 'string' && 'fromMe' in m)
      ? cached.messages
      : normalizeList(cached.messages, chatId)
    applyMessages(normalized, chatId, cached.updatedAt)
    loading.value = false
    if (opts.scroll) void scrollToBottom()
    return true
  }

  /**
   * @param {string} chatId
   * @param {unknown[]} rawMessages
   * @param {number} updatedAt
   */
  function applyRawThread(chatId, rawMessages, updatedAt) {
    const normalized = normalizeList(rawMessages, chatId)
    applyMessages(normalized, chatId, updatedAt)
    return normalized
  }

  async function loadContacts() {
    try {
      const r = await listContacts({ limit: 500 })
      if (r.ok && Array.isArray(r.body)) {
        applyContactsList(r.body)
      }
    } catch {
      /* optional */
    }
  }

  async function loadChats() {
    const mem = getCachedChats()
    if (mem.length) chats.value = mem.map(normalizeWahaChat).filter((c) => c.id)
    chatsLoading.value = true
    try {
      const r = await listChats({ limit: 100 })
      if (r.ok && Array.isArray(r.body)) {
        chats.value = r.body
        setCachedChats(r.body)
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

  async function hydrateMediaLazy(chatId) {
    const gen = ++mediaGen
    const pending = messages.value.filter(
      (m) => m.hasMedia && !m.media?.url && m.id,
    )
    for (const m of pending.slice(0, 12)) {
      if (gen !== mediaGen) return
      try {
        const r = await fetchWhatsAppMessageMedia(chatId, m.id)
        if (gen !== mediaGen || !r.ok || !r.message) continue
        const updated = normalizeWahaMessage(r.message, {
          contactMap: contactMap.value,
          activeChatId: chatId,
        })
        const idx = messages.value.findIndex((x) => x.id === m.id)
        if (idx >= 0) {
          const next = [...messages.value]
          next[idx] = { ...next[idx], ...updated, media: updated.media }
          messages.value = next
          setCachedThread(chatId, next, Date.now())
        }
      } catch {
        /* skip */
      }
    }
  }

  /**
   * @param {string} chatId
   * @param {{ full?: boolean, scroll?: boolean }} [opts]
   */
  async function syncThread(chatId, opts = {}) {
    const gen = ++syncGen
    syncing.value = true
    error.value = ''
    try {
      const serverCache = await getWhatsAppThreadCache(chatId)
      if (gen !== syncGen) return
      if (Array.isArray(serverCache.contacts) && serverCache.contacts.length) {
        applyContactsList(serverCache.contacts)
      }
      if (serverCache.cached && Array.isArray(serverCache.messages) && serverCache.messages.length) {
        if (!messages.value.length) {
          applyRawThread(chatId, serverCache.messages, serverCache.updatedAt)
          if (opts.scroll) await scrollToBottom()
        }
      }

      const synced = await syncWhatsAppThread(chatId, {
        limit: 60,
        downloadMedia: false,
      })
      if (gen !== syncGen) return
      if (synced.ok && Array.isArray(synced.messages)) {
        if (Array.isArray(synced.contacts) && synced.contacts.length) {
          applyContactsList(synced.contacts)
        }
        applyRawThread(chatId, synced.messages, synced.updatedAt)
        if (opts.scroll) await scrollToBottom()
        void hydrateMediaLazy(chatId)
      } else if (!messages.value.length) {
        error.value = synced.error || 'Could not sync messages'
      }
    } catch (e) {
      if (gen === syncGen) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (gen === syncGen) syncing.value = false
      loading.value = false
    }
  }

  async function refreshMessages() {
    const chatId = activeChatId.value
    if (!chatId) {
      messages.value = []
      return
    }
    const hadCache = hydrateThreadFromClientCache(chatId)
    if (!hadCache) loading.value = true
    await syncThread(chatId, { scroll: true })
  }

  async function pollOnce() {
    if (!activeChatId.value) return
    try {
      const r = await fetchChatMessagesForChat(activeChatId.value, 30, {
        downloadMedia: false,
      })
      if (!r.ok || !Array.isArray(r.body)) return
      error.value = ''
      const incoming = normalizeList(r.body, activeChatId.value).filter((m) => m.id)
      const byId = new Map(messages.value.map((m) => [m.id, m]))
      let hasNew = false
      for (const m of incoming) {
        if (!byId.has(m.id)) hasNew = true
        const prev = byId.get(m.id)
        byId.set(m.id, prev?.media?.url ? { ...m, media: prev.media } : m)
      }
      const merged = [...byId.values()]
      messages.value = merged
      setCachedThread(activeChatId.value, merged, Date.now())
      if (incoming.length > 0) {
        const newest = [...incoming].sort((a, b) => b.ts - a.ts)[0]
        if (newest.id !== lastSeenId) {
          lastSeenId = newest.id
          if (hasNew) {
            await scrollToBottom()
            void hydrateMediaLazy(activeChatId.value)
          }
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
    lastSeenId = ''
    mediaGen++
    const had = hydrateThreadFromClientCache(chat.id, { scroll: true })
    if (!had) loading.value = true
    void syncThread(chat.id, { scroll: !had }).then(() => startPolling())
  }

  watch(activeChatId, () => {
    void resolveChatTitle()
  })

  onMounted(() => {
    syncActiveFromStorage()
    if (!configured.value) return
    hydrateContactsFromCache()
    const memChats = getCachedChats()
    if (memChats.length) {
      chats.value = memChats.map(normalizeWahaChat).filter((c) => c.id)
    }
    void loadChats().then(() => {
      if (!activeChatId.value) return
      const had = hydrateThreadFromClientCache(activeChatId.value, { scroll: true })
      if (!had) loading.value = true
      void syncThread(activeChatId.value, { scroll: !had }).then(() => startPolling())
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
    syncing,
    sending,
    error,
    wahaChatKindLabel,
    loadChats,
    refreshMessages,
    sendText,
    selectChat,
    loadContacts,
    stopPolling,
    startPolling,
    syncActiveFromStorage,
  }
}
