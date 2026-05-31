/**
 * WAHA messenger: instant cache hydrate + background server sync + lazy media.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ensureWahaPrefsHydrated, syncCurrentWahaChatIdToServer } from '../utils/wahaPrefs.js'
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
  buildLidPhoneMap,
  buildParticipantNameMap,
  collectParticipantRawNamesFromMessages,
  listLids,
  getWahaMessageId,
  normalizeWahaMessage,
  normalizeWahaChat,
  wahaChatKindLabel,
} from '../utils/wahaApi.js'
import {
  getWhatsAppThreadCache,
  syncWhatsAppThread,
  fetchWhatsAppMessageMedia,
  postTranslateSenderNames,
  getSenderNameTranslationCache,
} from '../api.js'
import {
  needsEnglishSenderNameTranslation,
} from '../utils/senderNameLocale.js'
import { formatChatDisplayName } from '../utils/chatDisplayName.js'
import { announceChatMessage } from '../utils/chatMessageSpeech.js'
import { handleNewIncomingAutoRespondBatch } from '../utils/wahaAutoResponder.js'
import { isWahaTtsEnabled } from '../utils/wahaApi.js'
import {
  getCachedThread,
  setCachedThread,
  getCachedChats,
  setCachedChats,
  getCachedContactsMap,
  setCachedContactsMap,
  getCachedLidMap,
  setCachedLidMap,
  getCachedParticipantNames,
  setCachedParticipantNames,
  getCachedParticipantRawNames,
  setCachedParticipantRawNames,
  getCachedSenderTextEn,
  setCachedSenderTextEn,
} from '../stores/wahaChatStore.js'

/**
 * @param {{ scrollEl?: import('vue').Ref<HTMLElement | null>, poll?: boolean }} [opts]
 */
export function useWahaMessenger(opts = {}) {
  const shouldPoll = opts.poll !== false
  const messages = ref(/** @type {ReturnType<typeof normalizeWahaMessage>[]} */ ([]))
  const loading = ref(false)
  const syncing = ref(false)
  /** 0–100 for determinate loader in Chat */
  const syncProgress = ref(0)
  /** Human-readable sync step for Chat loader */
  const syncStatusLabel = ref('')
  const sending = ref(false)
  const error = ref('')
  /** Non-blocking hint when live sync fails but cached messages are shown */
  const syncWarning = ref('')
  const activeChatId = ref(getWahaChatId())
  const chatTitle = ref('')
  const chats = ref(/** @type {ReturnType<typeof normalizeWahaChat>[]} */ ([]))
  const chatsLoading = ref(false)
  /** @type {import('vue').Ref<Map<string, string>>} */
  const contactMap = ref(new Map())
  /** @type {import('vue').Ref<Map<string, string>>} lid @lid -> pn @c.us */
  const lidMap = ref(new Map())
  /** @type {import('vue').Ref<Map<string, string>>} participant JID -> display name (English when translated) */
  const participantNameMap = ref(new Map())
  /** @type {import('vue').Ref<Map<string, string>>} participant JID -> original resolved name */
  const participantRawNameMap = ref(new Map())
  /** @type {import('vue').Ref<Record<string, string>>} original text -> English */
  const senderTextEn = ref({})
  /** @type {import('vue').Ref<unknown[]>} */
  const rawThreadMessages = ref([])

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  let lastSeenId = ''
  let syncGen = 0
  let mediaGen = 0
  let translateGen = 0
  /** @type {Set<string>} */
  const translateQueued = new Set()

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
    reapplySenderNames()
  }

  function applyContactsList(list) {
    const map = buildContactNameMap(list)
    contactMap.value = map
    setCachedContactsMap(Object.fromEntries(map))
    reapplySenderNames()
  }

  async function resolveChatTitle() {
    const id = activeChatId.value
    if (!id) {
      chatTitle.value = ''
      return
    }
    const hit = chats.value.find((c) => c.id === id)
    if (hit) {
      chatTitle.value = formatChatDisplayName(hit.name).displayTitle
      return
    }
    chatTitle.value = id.split('@')[0] || id
  }

  function normalizeOpts(chatId) {
    return {
      contactMap: contactMap.value,
      lidMap: lidMap.value,
      participantMap: participantNameMap.value,
      senderTextEn: senderTextEn.value,
      activeChatId: chatId,
    }
  }

  function displayNameForParticipant(jid, rawName) {
    const raw = String(rawName ?? '').trim()
    if (!raw) return ''
    if (!needsEnglishSenderNameTranslation(raw)) return raw
    const en = senderTextEn.value[raw]
    return en || raw
  }

  function applyDisplayNamesFromRaw() {
    const display = new Map()
    for (const [jid, raw] of participantRawNameMap.value) {
      display.set(jid, displayNameForParticipant(jid, raw))
    }
    participantNameMap.value = display
  }

  function persistParticipantNames(chatId) {
    if (!chatId) return
    setCachedParticipantNames(chatId, Object.fromEntries(participantNameMap.value))
    setCachedParticipantRawNames(chatId, Object.fromEntries(participantRawNameMap.value))
    setCachedSenderTextEn(senderTextEn.value)
  }

  function hydrateParticipantNames(chatId) {
    const displayRec = getCachedParticipantNames(chatId)
    const rawRec = getCachedParticipantRawNames(chatId)
    senderTextEn.value = { ...getCachedSenderTextEn() }
    if (rawRec && typeof rawRec === 'object' && Object.keys(rawRec).length) {
      participantRawNameMap.value = new Map(Object.entries(rawRec))
      applyDisplayNamesFromRaw()
    } else if (displayRec && typeof displayRec === 'object' && Object.keys(displayRec).length) {
      participantNameMap.value = new Map(Object.entries(displayRec))
      participantRawNameMap.value = new Map(Object.entries(displayRec))
    } else {
      participantNameMap.value = new Map()
      participantRawNameMap.value = new Map()
    }
  }

  async function hydrateSenderTextEnFromServer() {
    try {
      const r = await getSenderNameTranslationCache()
      if (r?.ok && r.textEn && typeof r.textEn === 'object') {
        senderTextEn.value = { ...senderTextEn.value, ...r.textEn }
        applyDisplayNamesFromRaw()
        reapplySenderNames()
      }
    } catch {
      /* optional */
    }
  }

  async function localizeThreadSenderNames(chatId) {
    if (!chatId || !rawThreadMessages.value.length) return
    const opts = {
      contactMap: contactMap.value,
      lidMap: lidMap.value,
      activeChatId: chatId,
    }
    const { byJid, orphanTexts } = collectParticipantRawNamesFromMessages(
      rawThreadMessages.value,
      opts,
    )
    const mergedRaw = new Map(participantRawNameMap.value)
    for (const [k, v] of byJid) mergedRaw.set(k, v)
    participantRawNameMap.value = mergedRaw
    await ensureEnglishParticipantNames(chatId, [...orphanTexts])
  }

  async function ensureEnglishParticipantNames(chatId, orphanTexts = []) {
    if (!chatId) return
    const gen = ++translateGen
    const items = []
    const seenText = new Set()
    for (const [jid, raw] of participantRawNameMap.value) {
      const name = String(raw ?? '').trim()
      if (!name || !needsEnglishSenderNameTranslation(name)) continue
      if (senderTextEn.value[name]) continue
      const queueKey = `${jid}\0${name}`
      if (translateQueued.has(queueKey)) continue
      translateQueued.add(queueKey)
      items.push({ id: jid, text: name })
      seenText.add(name)
    }
    for (const text of orphanTexts) {
      const name = String(text ?? '').trim()
      if (!name || seenText.has(name)) continue
      if (!needsEnglishSenderNameTranslation(name)) continue
      if (senderTextEn.value[name]) continue
      const queueKey = `text\0${name}`
      if (translateQueued.has(queueKey)) continue
      translateQueued.add(queueKey)
      items.push({ id: queueKey, text: name })
      seenText.add(name)
    }
    if (!items.length) {
      applyDisplayNamesFromRaw()
      persistParticipantNames(chatId)
      return
    }
    try {
      const r = await postTranslateSenderNames({ items })
      if (gen !== translateGen) return
      if (r?.ok) {
        if (r.textEn && typeof r.textEn === 'object') {
          senderTextEn.value = { ...senderTextEn.value, ...r.textEn }
        }
        if (r.names && typeof r.names === 'object') {
          for (const [jid, en] of Object.entries(r.names)) {
            const raw = participantRawNameMap.value.get(jid)
            if (raw && en) senderTextEn.value[raw] = String(en)
          }
        }
        applyDisplayNamesFromRaw()
        persistParticipantNames(chatId)
        reapplySenderNames()
      }
    } catch {
      /* show raw names */
    } finally {
      for (const item of items) {
        translateQueued.delete(`${item.id}\0${item.text}`)
      }
    }
  }

  function absorbParticipantNames(raw, chatId) {
    const opts = {
      contactMap: contactMap.value,
      lidMap: lidMap.value,
      activeChatId: chatId,
    }
    const learned = buildParticipantNameMap(raw, opts)
    const { byJid, orphanTexts } = collectParticipantRawNamesFromMessages(raw, opts)
    const mergedRaw = new Map(participantRawNameMap.value)
    for (const [k, v] of learned) mergedRaw.set(k, v)
    for (const [k, v] of byJid) mergedRaw.set(k, v)
    participantRawNameMap.value = mergedRaw
    applyDisplayNamesFromRaw()
    persistParticipantNames(chatId)
    void ensureEnglishParticipantNames(chatId, [...orphanTexts])
  }

  function normalizeList(raw, chatId) {
    absorbParticipantNames(raw, chatId)
    const opts = normalizeOpts(chatId)
    return raw
      .map((m) => normalizeWahaMessage(m, opts))
      .filter((m) => m.id && (m.text || m.hasMedia))
  }

  function applyMessages(normalized, chatId, updatedAt, rawMessages) {
    messages.value = normalized
    if (Array.isArray(rawMessages) && rawMessages.length) {
      rawThreadMessages.value = rawMessages
      setCachedThread(chatId, rawMessages, updatedAt)
    }
    if (normalized.length > 0) {
      const newest = [...normalized].sort((a, b) => b.ts - a.ts)[0]
      lastSeenId = newest.id
    }
  }

  function reapplySenderNames() {
    const chatId = activeChatId.value
    if (!chatId || !rawThreadMessages.value.length) return
    messages.value = normalizeList(rawThreadMessages.value, chatId)
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
    const raw = cached?.rawMessages?.length
      ? cached.rawMessages
      : pickLegacyRaw(cached?.messages)
    if (!raw?.length) return false
    rawThreadMessages.value = raw
    hydrateParticipantNames(chatId)
    const normalized = normalizeList(raw, chatId)
    applyMessages(normalized, chatId, cached.updatedAt, raw)
    void localizeThreadSenderNames(chatId)
    loading.value = false
    if (opts.scroll) void scrollToBottom()
    return true
  }

  /** @param {unknown[] | undefined} messages */
  function pickLegacyRaw(messages) {
    if (!Array.isArray(messages) || !messages.length) return []
    const first = messages[0]
    if (first && typeof first === 'object' && ('body' in first || '_data' in first)) {
      return messages
    }
    return []
  }

  /**
   * @param {string} chatId
   * @param {unknown[]} rawMessages
   * @param {number} updatedAt
   */
  function applyRawThread(chatId, rawMessages, updatedAt) {
    rawThreadMessages.value = rawMessages
    const normalized = normalizeList(rawMessages, chatId)
    applyMessages(normalized, chatId, updatedAt, rawMessages)
    void localizeThreadSenderNames(chatId)
    return normalized
  }

  function applyLidMap(map) {
    lidMap.value = map
    setCachedLidMap(Object.fromEntries(map))
    reapplySenderNames()
  }

  function hydrateLidsFromCache() {
    const rec = getCachedLidMap()
    if (Object.keys(rec).length) {
      lidMap.value = new Map(Object.entries(rec))
    }
  }

  function applyLidsList(list) {
    const incoming = buildLidPhoneMap(list)
    const merged = new Map(lidMap.value)
    for (const [k, v] of incoming) merged.set(k, v)
    if (merged.size) applyLidMap(merged)
    else reapplySenderNames()
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

  async function loadLids() {
    try {
      const r = await listLids({ limit: 500 })
      if (r.ok && Array.isArray(r.body)) {
        applyLidsList(r.body)
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
    for (const m of pending.slice(0, 24)) {
      if (gen !== mediaGen) return
      try {
        const r = await fetchWhatsAppMessageMedia(chatId, m.id)
        if (gen !== mediaGen || !r.ok || !r.message) continue
        const updated = normalizeWahaMessage(r.message, normalizeOpts(chatId))
        const idx = messages.value.findIndex((x) => x.id === m.id)
        if (idx >= 0) {
          const next = [...messages.value]
          next[idx] = { ...next[idx], ...updated, media: updated.media }
          messages.value = next
          const rawIdx = rawThreadMessages.value.findIndex(
            (x) => getWahaMessageId(x) === m.id,
          )
          if (rawIdx >= 0) {
            const rawNext = [...rawThreadMessages.value]
            rawNext[rawIdx] = r.message
            rawThreadMessages.value = rawNext
            setCachedThread(chatId, rawNext, Date.now())
          }
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
  function setSyncStep(label, percent) {
    syncStatusLabel.value = label
    syncProgress.value = Math.min(100, Math.max(0, percent))
  }

  async function syncThread(chatId, opts = {}) {
    const gen = ++syncGen
    syncing.value = true
    error.value = ''
    syncWarning.value = ''
    setSyncStep('Preparing…', 8)
    try {
      setSyncStep('Loading saved messages…', 22)
      const serverCache = await getWhatsAppThreadCache(chatId)
      if (gen !== syncGen) return
      if (Array.isArray(serverCache.contacts) && serverCache.contacts.length) {
        applyContactsList(serverCache.contacts)
      }
      if (Array.isArray(serverCache.lids) && serverCache.lids.length) {
        applyLidsList(serverCache.lids)
      }
      if (serverCache.cached && Array.isArray(serverCache.messages) && serverCache.messages.length) {
        if (!messages.value.length) {
          applyRawThread(chatId, serverCache.messages, serverCache.updatedAt)
          if (opts.scroll) await scrollToBottom()
        }
      }

      setSyncStep('Syncing with WhatsApp…', 48)
      const synced = await syncWhatsAppThread(chatId, {
        limit: 60,
        downloadMedia: false,
      })
      if (gen !== syncGen) return
      setSyncStep('Updating thread…', 78)
      if (synced.ok && Array.isArray(synced.messages)) {
        if (Array.isArray(synced.contacts) && synced.contacts.length) {
          applyContactsList(synced.contacts)
        }
        if (Array.isArray(synced.lids) && synced.lids.length) {
          applyLidsList(synced.lids)
        }
        applyRawThread(chatId, synced.messages, synced.updatedAt)
        if (opts.scroll) await scrollToBottom()
        setSyncStep('Loading attachments…', 92)
        void hydrateMediaLazy(chatId)
        error.value = ''
        syncWarning.value =
          typeof synced.warning === 'string' ? synced.warning.trim() : ''
        setSyncStep('Ready', 100)
      } else if (messages.value.length) {
        syncWarning.value = synced.error || 'Live sync unavailable — showing cached messages'
        error.value = ''
      } else if (!messages.value.length) {
        error.value = synced.error || 'Could not sync messages'
      }
    } catch (e) {
      if (gen === syncGen) {
        const msg = e instanceof Error ? e.message : String(e)
        if (messages.value.length) {
          syncWarning.value = msg
          error.value = ''
        } else {
          error.value = msg
        }
      }
    } finally {
      if (gen === syncGen) {
        syncing.value = false
        loading.value = false
        if (!error.value) {
          const clearLater = () => {
            if (gen === syncGen && !syncing.value && !loading.value) {
              syncProgress.value = 0
              syncStatusLabel.value = ''
            }
          }
          if (typeof window !== 'undefined') {
            window.setTimeout(clearLater, 400)
          } else {
            clearLater()
          }
        } else {
          syncProgress.value = 0
          syncStatusLabel.value = ''
        }
      }
    }
  }

  /**
   * @param {string} messageId
   */
  async function fetchMessageMedia(messageId) {
    const chatId = activeChatId.value
    if (!chatId || !messageId) return
    const gen = mediaGen
    try {
      const r = await fetchWhatsAppMessageMedia(chatId, messageId)
      if (gen !== mediaGen || !r.ok || !r.message) return
      const updated = normalizeWahaMessage(r.message, normalizeOpts(chatId))
      const idx = messages.value.findIndex((x) => x.id === messageId)
      if (idx >= 0) {
        const next = [...messages.value]
        next[idx] = { ...next[idx], ...updated, media: updated.media || next[idx].media }
        messages.value = next
      }
    } catch {
      /* skip */
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
    setSyncStep(hadCache ? 'Refreshing…' : 'Loading messages…', hadCache ? 15 : 5)
    await syncThread(chatId, { scroll: true })
  }

  async function pollOnce() {
    if (!activeChatId.value) return
    try {
      const r = await fetchChatMessagesForChat(activeChatId.value, 30, {
        downloadMedia: false,
      })
      if (!r.ok || !Array.isArray(r.body)) {
        if (messages.value.length) error.value = ''
        return
      }
      error.value = ''
      const incoming = normalizeList(r.body, activeChatId.value).filter((m) => m.id)
      const byId = new Map(messages.value.map((m) => [m.id, m]))
      let hasNew = false
      for (const m of incoming) {
        if (!byId.has(m.id)) hasNew = true
        const prev = byId.get(m.id)
        let merged = prev?.media?.url ? { ...m, media: prev.media } : m
        if (!merged.senderName && prev?.senderName) {
          merged = { ...merged, senderName: prev.senderName }
        }
        byId.set(m.id, merged)
      }
      const prevIds = new Set(messages.value.map((m) => m.id))
      const hadPriorMessages = messages.value.length > 0
      const merged = [...byId.values()]
      const newIncoming = [...incoming].filter((m) => !prevIds.has(m.id) && !m.fromMe)
      if (hasNew && isWahaTtsEnabled()) {
        const newOnes = [...newIncoming].sort((a, b) => b.ts - a.ts)
        for (let i = newOnes.length - 1; i >= 0; i--) {
          announceChatMessage(newOnes[i], { focusNewest: i === 0 })
        }
      }
      if (hasNew && newIncoming.length) {
        handleNewIncomingAutoRespondBatch(newIncoming, {
          skipIfNoPriorMessages: true,
          hadPriorMessages,
        })
      }
      messages.value = merged
      const rawById = new Map(
        rawThreadMessages.value.map((m) => [getWahaMessageId(m), m]),
      )
      for (const raw of r.body) {
        const id = getWahaMessageId(raw)
        if (id) rawById.set(id, raw)
      }
      const rawMerged = [...rawById.values()]
      rawThreadMessages.value = rawMerged
      setCachedThread(activeChatId.value, rawMerged, Date.now())
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

  function selectChat(chat, opts = {}) {
    if (!chat?.id) return
    setWahaChatId(chat.id)
    void syncCurrentWahaChatIdToServer().catch(() => {})
    activeChatId.value = chat.id
    const formatted = formatChatDisplayName(
      String(opts.displayTitle || chat.name || chat.id),
    )
    chatTitle.value = formatted.displayTitle
    lastSeenId = ''
    mediaGen++
    rawThreadMessages.value = []
    participantNameMap.value = new Map()
    participantRawNameMap.value = new Map()
    hydrateParticipantNames(chat.id)
    const had = hydrateThreadFromClientCache(chat.id, { scroll: true })
    if (!had) loading.value = true
    void syncThread(chat.id, { scroll: !had }).then(() => startPolling())
  }

  watch(activeChatId, () => {
    void resolveChatTitle()
  })

  watch(
    () => [contactMap.value.size, lidMap.value.size],
    () => reapplySenderNames(),
  )

  watch(
    displayMessages,
    (list) => {
      const chatId = activeChatId.value
      if (!chatId || !Array.isArray(list)) return
      const needs = list.some((m) => m.hasMedia && !m.media?.url && m.id)
      if (needs) void hydrateMediaLazy(chatId)
    },
    { deep: true },
  )

  onMounted(() => {
    void (async () => {
      await ensureWahaPrefsHydrated()
      syncActiveFromStorage()
      if (!configured.value) return
      hydrateContactsFromCache()
      hydrateLidsFromCache()
      if (activeChatId.value) hydrateParticipantNames(activeChatId.value)
      void loadContacts()
      void loadLids()
      const memChats = getCachedChats()
      if (memChats.length) {
        chats.value = memChats.map(normalizeWahaChat).filter((c) => c.id)
      }
      void hydrateSenderTextEnFromServer().then(() => {
        void loadChats().then(() => {
          if (!activeChatId.value) return
          const had = hydrateThreadFromClientCache(activeChatId.value, { scroll: true })
          if (!had) loading.value = true
          void syncThread(activeChatId.value, { scroll: !had }).then(() => startPolling())
        })
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
    activeChatId,
    chatTitle,
    formatChatLabel,
    chats,
    chatsLoading,
    messages,
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
    fetchMessageMedia,
    sendText,
    selectChat,
    loadContacts,
    stopPolling,
    startPolling,
    syncActiveFromStorage,
  }
}
