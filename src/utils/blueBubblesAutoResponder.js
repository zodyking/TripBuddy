/**
 * Client-side iMessage automation (per-contact rules only).
 */
import { isBlueBubblesConfigured } from './blueBubblesApi.js'
import {
  findContactRule,
  contactTtsEnabled,
  contactAutoReplyEnabled,
} from './blueBubblesContactRulesStore.js'
import { announceIMessageChatMessage, buildIMessageSpeech } from './imessageChatSpeech.js'
import { postIMessageAutoReply } from '../api.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {Set<string>} */
const announcedIds = new Set()
const ANNOUNCED_CAP = 800

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

  const ctx = { handle: msg.senderHandle, chatGuid: msg.chatGuid }
  const rule = findContactRule(ctx)

  if (contactTtsEnabled(rule) && !announcedIds.has(msg.id)) {
    const speech = buildIMessageSpeech(msg)
    if (speech) {
      pushLiveLog({ type: 'info', message: `[iMessage] ${speech}`, ts: Date.now() })
    }
    announceIMessageChatMessage(msg, { rule })
    markAnnounced(msg.id)
  }

  if (!contactAutoReplyEnabled(rule)) return
  if (autoReplyQueued.has(msg.id)) return
  autoReplyQueued.add(msg.id)

  void postIMessageAutoReply({
    messageId: msg.id,
    text: msg.text,
    handle: msg.senderHandle,
    chatGuid: msg.chatGuid,
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
 * @param {Array<{ id: string, fromMe?: boolean, ts?: number }>} newMessages
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
