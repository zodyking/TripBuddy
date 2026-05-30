/**
 * Composable for WhatsApp chat message polling and TTS reading.
 */
import { ref, onBeforeUnmount } from 'vue'
import {
  fetchChatMessages,
  isWahaConfigured,
  isWahaTtsEnabled,
  getWahaPollInterval,
  getWahaChatId,
  listContacts,
  listLids,
  buildContactNameMap,
  buildLidPhoneMap,
  buildParticipantNameMap,
  normalizeWahaMessage,
} from '../utils/wahaApi.js'
import { buildEnglishParticipantDisplayMap } from '../utils/senderNameTranslateClient.js'
import { englishDisplayName } from '../utils/senderNameLocale.js'
import { getCachedSenderTextEn } from '../stores/wahaChatStore.js'
import { enqueueAnnouncement } from '../utils/alertAudioQueue.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {Map<string, string>} */
let contactMap = new Map()
/** @type {Map<string, string>} */
let lidMap = new Map()
/** @type {Map<string, string>} */
let participantNameMap = new Map()
let contactsLoaded = false

function getMsgId(msg) {
  if (!msg) return ''
  if (typeof msg.id === 'string') return msg.id
  if (msg.id && typeof msg.id === 'object') return msg.id._serialized || msg.id.id || ''
  return ''
}

/**
 * @param {ReturnType<typeof normalizeWahaMessage>} norm
 */
function messageTextForSpeech(norm) {
  const text = String(norm.text || '').trim()
  if (text) return text
  if (norm.hasMedia) {
    const kind = norm.media?.kind
    if (kind === 'image') return 'sent an image'
    if (kind === 'video') return 'sent a video'
    if (kind === 'audio') return 'sent an audio message'
    return 'sent an attachment'
  }
  return ''
}

/**
 * @param {ReturnType<typeof normalizeWahaMessage>} norm
 */
function buildNewMessageSpeech(norm) {
  const body = messageTextForSpeech(norm)
  if (!body) return ''
  const sender = String(norm.senderName || '').trim() || 'someone'
  return `New message from ${sender}, ${body}`
}

async function ensureContacts() {
  if (contactsLoaded) return
  try {
    const [cr, lr] = await Promise.all([
      listContacts({ limit: 500 }),
      listLids({ limit: 500 }),
    ])
    if (cr.ok && Array.isArray(cr.body)) {
      contactMap = buildContactNameMap(cr.body)
    }
    if (lr.ok && Array.isArray(lr.body)) {
      lidMap = buildLidPhoneMap(lr.body)
    }
  } catch {
    /* optional */
  }
  contactsLoaded = true
}

export function useWhatsAppGroup() {
  const messages = ref([])
  const polling = ref(false)
  const error = ref('')
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null
  /** Track last seen message ID to only speak new ones */
  let lastSeenId = ''

  async function pollOnce() {
    if (!isWahaConfigured()) return
    try {
      const r = await fetchChatMessages(30)
      if (!r.ok || !Array.isArray(r.body)) {
        error.value = `Poll failed: ${r.status}`
        return
      }
      error.value = ''
      const chatId = getWahaChatId()
      const incoming = r.body

      if (lastSeenId && isWahaTtsEnabled()) {
        await ensureContacts()
        const newMsgs = []
        for (const msg of incoming) {
          const msgId = getMsgId(msg)
          if (msgId === lastSeenId) break
          if (msg.fromMe) continue
          newMsgs.push(msg)
        }
        const rawParticipantMap = buildParticipantNameMap(incoming, {
          contactMap,
          lidMap,
          activeChatId: chatId,
        })
        participantNameMap = await buildEnglishParticipantDisplayMap(rawParticipantMap)
        const textEn = getCachedSenderTextEn()
        for (const raw of newMsgs.reverse()) {
          const norm = normalizeWahaMessage(raw, {
            contactMap,
            lidMap,
            participantMap: participantNameMap,
            activeChatId: chatId,
          })
          if (norm.senderName) {
            norm.senderName = englishDisplayName(norm.senderName, textEn)
          }
          const speech = buildNewMessageSpeech(norm)
          if (!speech) continue
          pushLiveLog({ type: 'info', message: `[WhatsApp] TTS: ${speech}`, ts: Date.now() })
          enqueueAnnouncement(speech, { category: `whatsapp:${norm.id}` })
        }
      }

      if (incoming.length > 0) {
        lastSeenId = getMsgId(incoming[0])
      }
      messages.value = incoming.slice(0, 50)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function startPolling() {
    if (pollTimer) return
    if (!isWahaConfigured()) return
    polling.value = true
    lastSeenId = ''
    contactsLoaded = false
    lidMap = new Map()
    participantNameMap = new Map()
    pollOnce().then(() => {
      if (!pollTimer) {
        pollTimer = setInterval(pollOnce, getWahaPollInterval())
      }
    })
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    polling.value = false
  }

  function seedLastSeen() {
    if (messages.value.length > 0) {
      lastSeenId = getMsgId(messages.value[0])
    }
  }

  onBeforeUnmount(() => {
    stopPolling()
  })

  return {
    messages,
    polling,
    error,
    pollOnce,
    startPolling,
    stopPolling,
    seedLastSeen,
  }
}
