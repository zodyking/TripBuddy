<script setup>
import { ref } from 'vue'
import {
  chatMessageSpeechOpen,
  chatMessageSpeechCurrent,
  chatMessageSpeechCount,
  chatMessageSpeechPositionLabel,
  canGoToOlderChatSpeech,
  canGoToNewerChatSpeech,
  goToOlderChatSpeech,
  goToNewerChatSpeech,
  closeChatMessageSpeech,
} from '../stores/chatMessageSpeechStore.js'
import { replayChatMessageSpeech } from '../utils/chatMessageSpeech.js'
import { cancelAllAlerts } from '../utils/alertAudioQueue.js'

const touchStartX = ref(0)
const touchStartY = ref(0)

function dismiss() {
  cancelAllAlerts()
  closeChatMessageSpeech()
}

function onReplay() {
  const item = chatMessageSpeechCurrent.value
  if (!item) return
  replayChatMessageSpeech(item)
}

function onTouchStart(e) {
  const t = e.changedTouches?.[0] || e.touches?.[0]
  if (!t) return
  touchStartX.value = t.clientX
  touchStartY.value = t.clientY
}

function onTouchEnd(e) {
  const t = e.changedTouches?.[0]
  if (!t) return
  const dx = t.clientX - touchStartX.value
  const dy = t.clientY - touchStartY.value
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return
  if (dx < 0) goToOlderChatSpeech()
  else goToNewerChatSpeech()
}

function fmtTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="chatMessageSpeechOpen && chatMessageSpeechCurrent"
      class="chat-speech-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-speech-title"
    >
      <div
        class="chat-speech-dialog"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <div class="chat-speech-head">
          <p id="chat-speech-title" class="chat-speech-eyebrow">WhatsApp message</p>
          <p v-if="chatMessageSpeechCount > 1" class="chat-speech-counter">
            {{ chatMessageSpeechPositionLabel }}
            <span class="chat-speech-counter-hint">· swipe for older</span>
          </p>
        </div>

        <p class="chat-speech-sender">
          {{ chatMessageSpeechCurrent.fromMe ? 'You' : chatMessageSpeechCurrent.senderLabel }}
        </p>
        <p class="chat-speech-body">
          {{ chatMessageSpeechCurrent.displayBody }}
        </p>
        <time class="chat-speech-time" :datetime="new Date(chatMessageSpeechCurrent.ts).toISOString()">
          {{ fmtTime(chatMessageSpeechCurrent.ts) }}
        </time>

        <div class="chat-speech-nav">
          <button
            type="button"
            class="chat-speech-nav-btn tap"
            :disabled="!canGoToOlderChatSpeech"
            aria-label="Older message"
            @click="goToOlderChatSpeech"
          >
            ← Older
          </button>
          <button type="button" class="chat-speech-replay-btn tap" @click="onReplay">
            Play again
          </button>
          <button
            type="button"
            class="chat-speech-nav-btn tap"
            :disabled="!canGoToNewerChatSpeech"
            aria-label="Newer message"
            @click="goToNewerChatSpeech"
          >
            Newer →
          </button>
        </div>

        <button type="button" class="chat-speech-close-btn tap" @click="dismiss">
          Close
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chat-speech-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483002;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
  background: rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}

.chat-speech-dialog {
  width: min(100%, 26rem);
  max-height: min(72vh, 28rem);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 1rem 1rem 0.85rem;
  border-radius: 1rem;
  background: var(--color-bg-elevated, #14141c);
  border: 1px solid rgba(168, 85, 247, 0.35);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  touch-action: pan-y;
}

.chat-speech-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.chat-speech-eyebrow {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-accent-purple-light, #9d6fd7);
}

.chat-speech-counter {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary, #a8a8b8);
}

.chat-speech-counter-hint {
  opacity: 0.85;
}

.chat-speech-sender {
  margin: 0;
  font-size: 1.05rem;
  font-weight: var(--weight-bold, 700);
  color: var(--color-text-primary, #f4f4f8);
}

.chat-speech-body {
  margin: 0;
  flex: 1;
  min-height: 3rem;
  max-height: 10rem;
  overflow-y: auto;
  font-size: 1.125rem;
  line-height: 1.5;
  color: var(--color-text-primary, #f4f4f8);
}

.chat-speech-time {
  font-size: 0.75rem;
  color: var(--color-text-tertiary, #6e6e7e);
}

.chat-speech-nav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0.4rem;
  align-items: center;
}

.chat-speech-nav-btn {
  min-height: 2.75rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary, #f4f4f8);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.chat-speech-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.chat-speech-replay-btn {
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(124, 58, 237, 0.35);
  color: var(--color-text-primary, #f4f4f8);
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
}

.chat-speech-close-btn {
  width: 100%;
  min-height: 3.75rem;
  margin-top: 0.25rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
  font-size: 1.125rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chat-speech-close-btn:active {
  transform: scale(0.98);
  background: var(--color-accent-purple-dark, #5c2d91);
}
</style>
