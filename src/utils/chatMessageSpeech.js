/**
 * WhatsApp chat message TTS + swipeable popup.
 */
import { enqueueAnnouncement } from './alertAudioQueue.js'
import { formatChatDisplayName } from './chatDisplayName.js'
import { enableSpeechAlertsForBriefing } from './briefingSpeech.js'
import {
  pushChatMessageSpeech,
  focusChatMessageSpeechByCategory,
} from '../stores/chatMessageSpeechStore.js'
import { isWahaTtsEnabled } from './wahaApi.js'

/**
 * @param {{ text?: string, hasMedia?: boolean, media?: { kind?: string } | null, fromMe?: boolean, senderName?: string }} msg
 */
export function messageBodyForSpeech(msg) {
  const text = String(msg?.text ?? '').trim()
  if (text) return text
  if (!msg?.hasMedia) return ''
  const kind = msg.media?.kind
  if (kind === 'image') return 'sent an image'
  if (kind === 'video') return 'sent a video'
  if (kind === 'audio') return 'sent an audio message'
  return 'sent an attachment'
}

/**
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string }} msg
 */
export function buildChatMessageSpeech(msg) {
  const body = messageBodyForSpeech(msg)
  if (!body) return ''
  if (msg.fromMe) return body
  const sender = formatChatDisplayName(String(msg.senderName || 'someone')).displayTitle || 'someone'
  return `${sender} said, ${body}`
}

/**
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string, ts?: number }} msg
 */
export function buildChatSpeechItem(msg) {
  const speech = buildChatMessageSpeech(msg)
  const displayBody = messageBodyForSpeech(msg)
  if (!speech || !displayBody) return null
  const id = String(msg?.id ?? '').trim() || `ts-${Date.now()}`
  const senderLabel = msg.fromMe
    ? 'You'
    : formatChatDisplayName(String(msg.senderName || 'Unknown')).displayTitle
  return {
    id,
    speech,
    displayBody,
    senderLabel,
    fromMe: Boolean(msg.fromMe),
    ts: Number(msg?.ts) || Date.now(),
    receivedAt: Date.now(),
  }
}

/**
 * @param {string} category
 */
export function isWhatsAppTapToReadCategory(category) {
  return String(category || '').startsWith('whatsapp-tap:')
}

/**
 * @param {string} category
 * @deprecated Use isWhatsAppTapToReadCategory — only manual WhatsApp tap uses the popup.
 */
export function isChatMessageSpeechCategory(category) {
  return isWhatsAppTapToReadCategory(category)
}

/**
 * Show popup and queue TTS for a normalized chat message.
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string, ts?: number }} msg
 * @param {{ focusNewest?: boolean }} [opts]
 */
export function announceChatMessage(msg, opts = {}) {
  if (!isWahaTtsEnabled()) return
  const item = buildChatSpeechItem(msg)
  if (!item) return
  enqueueAnnouncement(item.speech, { category: `whatsapp:${item.id}` })
}

/**
 * @param {{ id: string, speech: string }} item
 */
export function replayChatMessageSpeech(item) {
  if (!item?.speech) return
  enableSpeechAlertsForBriefing()
  focusChatMessageSpeechByCategory(`whatsapp-tap:${item.id}`)
  enqueueAnnouncement(item.speech, { category: `whatsapp-tap:${item.id}` })
}

/**
 * Double-tap a message in the thread to show popup and read again.
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string, ts?: number }} msg
 */
export function speakChatMessageAloud(msg) {
  const item = buildChatSpeechItem(msg)
  if (!item) return
  enableSpeechAlertsForBriefing()
  pushChatMessageSpeech(item, { focusNewest: true })
  enqueueAnnouncement(item.speech, { category: `whatsapp-tap:${item.id}` })
}
