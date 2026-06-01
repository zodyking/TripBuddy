/**
 * Real-time iMessage delivery via server webhook → SSE → client TTS/automation.
 */
import { handleIncomingIMessageAutomation } from './blueBubblesAutoResponder.js'
import { filterNewInboxMessages } from './blueBubblesInboxTracker.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {Set<string>} */
const pushedIds = new Set()

/**
 * @param {object} data SSE payload from BlueBubbles webhook
 */
export function handleIMessageIncomingPush(data) {
  if (!data || data.type !== 'imessage-incoming') return
  const messageId = String(data.messageId ?? '').trim()
  if (!messageId || pushedIds.has(messageId)) return
  pushedIds.add(messageId)
  if (pushedIds.size > 600) {
    const first = pushedIds.values().next().value
    if (first) pushedIds.delete(first)
  }

  const msg = {
    id: messageId,
    text: String(data.text ?? '').trim(),
    senderHandle: String(data.handle ?? '').trim(),
    chatGuid: String(data.chatGuid ?? '').trim(),
    senderName: String(data.senderLabel ?? data.handle ?? '').trim() || 'Unknown',
    ts: Number(data.ts) || Date.now(),
    fromMe: false,
  }

  const fresh = filterNewInboxMessages([msg])
  if (!fresh.length) return

  pushLiveLog({
    type: 'info',
    message: `[iMessage] Incoming: ${msg.senderName}`,
    ts: Date.now(),
  })
  handleIncomingIMessageAutomation(fresh[0])
}
