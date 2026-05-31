/**
 * Client-side iMessage automation helpers (TTS + auto-reply trigger).
 */
import {
  getBlueBubblesContactRules,
  isBlueBubblesAutoReplyEnabled,
  isBlueBubblesConfigured,
  isBlueBubblesTtsEnabled,
  getBlueBubblesChatGuid,
} from './blueBubblesApi.js'
import { matchContactRule, shouldTtsForContact } from '../constants/blueBubblesContactRules.js'
import { announceIMessageChatMessage } from './imessageChatSpeech.js'
import { postIMessageAutoReply } from '../api.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {Set<string>} */
const announcedIds = new Set()
const ANNOUNCED_CAP = 400

/** @type {Set<string>} */
const autoReplyQueued = new Set()

function markAnnounced(id) {
  announcedIds.add(id)
  if (announcedIds.size > ANNOUNCED_CAP) {
    const first = announcedIds.values().next().value
    if (first) announcedIds.delete(first)
  }
}

/**
 * @param {{ id: string, text?: string, fromMe?: boolean, senderName?: string, senderHandle?: string, chatGuid?: string, ts?: number }} msg
 */
export function handleIncomingIMessageAutomation(msg) {
  if (!msg?.id || msg.fromMe) return
  if (!isBlueBubblesConfigured()) return

  const rules = getBlueBubblesContactRules()
  const ctx = { handle: msg.senderHandle, chatGuid: msg.chatGuid || getBlueBubblesChatGuid() }
  const rule = matchContactRule(rules, ctx)

  const globalTts = isBlueBubblesTtsEnabled()
  const ttsOn = shouldTtsForContact(rule, globalTts)
  if (ttsOn && !announcedIds.has(msg.id)) {
    announceIMessageChatMessage(msg, { rule })
    markAnnounced(msg.id)
  }

  if (!isBlueBubblesAutoReplyEnabled()) return
  if (!rule?.autoReplyEnabled) return
  if (autoReplyQueued.has(msg.id)) return
  autoReplyQueued.add(msg.id)

  void postIMessageAutoReply({
    messageId: msg.id,
    text: msg.text,
    handle: msg.senderHandle,
    chatGuid: msg.chatGuid || getBlueBubblesChatGuid(),
    senderLabel: msg.senderName,
  })
    .then((r) => {
      if (r?.replied) {
        pushLiveLog({
          type: 'info',
          message: `[iMessage] Auto-reply sent to ${msg.senderName || msg.senderHandle || 'contact'}`,
          ts: Date.now(),
        })
      }
    })
    .catch(() => {})
    .finally(() => {
      autoReplyQueued.delete(msg.id)
    })
}

/**
 * @param {Array<{ id: string, fromMe?: boolean }>} newMessages
 * @param {{ skipIfNoPriorMessages?: boolean, hadPriorMessages?: boolean }} [opts]
 */
export function handleNewIncomingIMessageBatch(newMessages, opts = {}) {
  if (opts.skipIfNoPriorMessages && !opts.hadPriorMessages) return
  if (!Array.isArray(newMessages) || !newMessages.length) return
  const sorted = [...newMessages].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  for (const m of sorted) {
    handleIncomingIMessageAutomation(m)
  }
}
