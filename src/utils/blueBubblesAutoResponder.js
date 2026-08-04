/**
 * Client-side iMessage automation (per-contact rules only).
 */
import { isBlueBubblesConfigured, isBlueBubblesWebhookRegistered } from './blueBubblesApi.js'
import {
  findContactRule,
  contactTtsEnabled,
  contactOpenRouterReplyEnabled,
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
  if (!msg?.id) return
  if (!isBlueBubblesConfigured()) return

  // Match automation by conversation first (works for lastMessage polling).
  const rule =
    findContactRule({ chatGuid: msg.chatGuid, fromMe: msg.fromMe })
    ?? findContactRule({ handle: msg.senderHandle, chatGuid: msg.chatGuid, fromMe: msg.fromMe })

  if (!rule) {
    pushLiveLog({
      type: 'info',
      message: `[iMessage] Skipped speech (no automation saved for this chat)`,
      ts: Date.now(),
    })
    return
  }

  const ttsOn = contactTtsEnabled(rule)
  const openRouterOn = contactOpenRouterReplyEnabled(rule)

  if (!ttsOn && !openRouterOn) {
    pushLiveLog({
      type: 'info',
      message: `[iMessage] Skipped (no automation enabled for ${rule.label || rule.handle || 'contact'})`,
      ts: Date.now(),
    })
    return
  }

  if (ttsOn) {
    if (announcedIds.has(msg.id)) {
      /* already spoken */
    } else {
      const speech = buildIMessageSpeech(msg)
      if (!speech) {
        pushLiveLog({
          type: 'info',
          message: '[iMessage] Skipped speech (empty message body)',
          ts: Date.now(),
        })
      } else {
        pushLiveLog({ type: 'info', message: `[iMessage] ${speech}`, ts: Date.now() })
        announceIMessageChatMessage(msg, { rule })
        markAnnounced(msg.id)
      }
    }
  } else {
    pushLiveLog({
      type: 'info',
      message: `[iMessage] Skipped speech (read-aloud off for ${rule.label || rule.handle || 'contact'})`,
      ts: Date.now(),
    })
  }

  if (msg.fromMe || !openRouterOn) return
  // Webhook + server handler already replies; client poll/SSE only drives TTS here.
  if (isBlueBubblesWebhookRegistered()) return
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
        const mode = r.mode === 'ai-medium' ? 'AI medium reply' : 'Auto-reply'
        pushLiveLog({
          type: 'info',
          message: `[iMessage] ${mode} sent to ${msg.senderName || msg.senderHandle || 'contact'}`,
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
