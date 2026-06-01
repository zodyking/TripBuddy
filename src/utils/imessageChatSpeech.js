/**
 * iMessage / BlueBubbles chat message TTS + subtitles.
 */
import { enqueueAnnouncement, speakDirect } from './alertAudioQueue.js'
import { formatChatDisplayName } from './chatDisplayName.js'
import { contactTtsEnabled } from './blueBubblesContactRulesStore.js'
import { enableSpeechAlertsForBriefing } from './briefingSpeech.js'
import {
  tripVoiceIsGestureUnlocked,
  unlockTripVoiceFromUserGesture,
} from './tripVoiceAnnouncement.js'
import {
  showSpeechAlertModal,
  hideSpeechAlertModal,
} from '../stores/speechAlertModalStore.js'

/**
 * @param {{ text?: string, hasMedia?: boolean, media?: { kind?: string, count?: number } | null, fromMe?: boolean, senderName?: string }} msg
 */
export function imessageBodyForSpeech(msg) {
  const text = String(msg?.text ?? '').trim()
  if (text) return text
  if (!msg?.hasMedia) return ''
  const count = msg.media?.count
  if (count && count > 1) return `sent ${count} attachments`
  return 'sent an attachment'
}

/**
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string }} msg
 */
export function buildIMessageSpeech(msg) {
  const body = imessageBodyForSpeech(msg)
  if (!body) return ''
  const sender = formatChatDisplayName(String(msg.senderName || 'someone')).displayTitle || 'someone'
  if (msg.fromMe) return `You said, ${body}`
  return `${sender} said, ${body}`
}

/**
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string, ts?: number }} msg
 */
export function buildIMessageSpeechItem(msg) {
  const speech = buildIMessageSpeech(msg)
  const displayBody = imessageBodyForSpeech(msg)
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
    platform: 'imessage',
  }
}

/**
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string, ts?: number, senderHandle?: string, chatGuid?: string }} msg
 * @param {{ rule?: import('../constants/blueBubblesContactRules.js').ContactRule | null, focusNewest?: boolean }} [opts]
 */
export function announceIMessageChatMessage(msg, opts = {}) {
  if (!contactTtsEnabled(opts.rule ?? null)) return
  const item = buildIMessageSpeechItem(msg)
  if (!item) return
  enableSpeechAlertsForBriefing()
  unlockTripVoiceFromUserGesture({ silent: true })

  const category = `imessage:${item.id}`

  if (tripVoiceIsGestureUnlocked()) {
    showSpeechAlertModal(item.speech)
    speakDirect(item.speech)
    setTimeout(() => hideSpeechAlertModal(), Math.max(3000, item.speech.length * 80))
    return
  }

  enqueueAnnouncement(item.speech, { category })
}

/**
 * @param {{ text?: string, fromMe?: boolean, senderName?: string, hasMedia?: boolean, media?: object, id?: string, ts?: number }} msg
 */
export function speakIMessageAloud(msg) {
  const item = buildIMessageSpeechItem(msg)
  if (!item) return
  enqueueAnnouncement(item.speech, { category: `imessage-tap:${item.id}` })
}
