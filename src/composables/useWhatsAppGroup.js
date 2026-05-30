/**
 * Composable for WhatsApp group message polling and TTS reading.
 */
import { ref, onBeforeUnmount } from 'vue'
import {
  fetchGroupMessages,
  isWahaConfigured,
  isWahaTtsEnabled,
  getWahaPollInterval,
  getWahaGroupId,
} from '../utils/wahaApi.js'
import { enqueueAnnouncement } from '../utils/alertAudioQueue.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

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
      const r = await fetchGroupMessages(30)
      if (!r.ok || !Array.isArray(r.body)) {
        error.value = `Poll failed: ${r.status}`
        return
      }
      error.value = ''
      const incoming = r.body

      if (lastSeenId && isWahaTtsEnabled()) {
        const newMsgs = []
        for (const msg of incoming) {
          if (msg.id === lastSeenId) break
          if (msg.fromMe) continue
          newMsgs.push(msg)
        }
        for (const msg of newMsgs.reverse()) {
          const sender = msg.senderName || msg.from || 'Someone'
          const text = msg.body || msg.text || ''
          if (!text) continue
          const speech = `${sender} says: ${text}`
          pushLiveLog({ type: 'info', message: `[WhatsApp] TTS: ${speech}`, ts: Date.now() })
          enqueueAnnouncement(speech, { category: `whatsapp:${msg.id}` })
        }
      }

      if (incoming.length > 0) {
        lastSeenId = incoming[0].id || ''
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
      lastSeenId = messages.value[0].id || ''
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
