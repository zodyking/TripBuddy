/**
 * Speak a single chat message aloud (user double-tap).
 */
import { enqueueAnnouncement } from './alertAudioQueue.js'
import { formatChatDisplayName } from './chatDisplayName.js'
import { enableSpeechAlertsForBriefing } from './briefingSpeech.js'

/**
 * @param {{ text?: string, hasMedia?: boolean, media?: { kind?: string } | null, fromMe?: boolean, senderName?: string }} msg
 */
function messageBodyForSpeech(msg) {
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
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string }} msg
 */
export function speakChatMessageAloud(msg) {
  const speech = buildChatMessageSpeech(msg)
  if (!speech) return
  enableSpeechAlertsForBriefing()
  const id = String(msg?.id ?? '').trim() || String(Date.now())
  enqueueAnnouncement(speech, { category: `chatmsg:${id}` })
}
