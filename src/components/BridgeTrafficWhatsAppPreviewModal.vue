<script setup>
import { computed } from 'vue'
import {
  bridgeTrafficAlertPreview,
  bridgeTrafficAlertPreviewOpen,
  bridgeTrafficAlertSending,
  bridgeTrafficAlertSendError,
  closeBridgeTrafficAlertPreview,
  noteBridgeTrafficAlertSent,
} from '../stores/bridgeTrafficAlertStore.js'
import { sendChatImage } from '../utils/wahaApi.js'
import { isWahaConfigured, getWahaChatId } from '../utils/wahaApi.js'

const preview = computed(() => bridgeTrafficAlertPreview.value)
const canSend = computed(() => isWahaConfigured() && !!getWahaChatId())

const alertTitle = computed(() => {
  const k = preview.value?.alertKind
  if (k === 'gridlock') return 'Standstill / gridlock'
  if (k === 'highTraffic') return 'Heavy traffic'
  return 'Bridge traffic heads-up'
})

function dismiss() {
  closeBridgeTrafficAlertPreview({ dismissed: true })
}

async function confirmSend() {
  const p = preview.value
  if (!p || bridgeTrafficAlertSending.value) return
  if (!canSend.value) {
    bridgeTrafficAlertSendError.value =
      'Set up WhatsApp under Settings (monitored chat required).'
    return
  }
  bridgeTrafficAlertSending.value = true
  bridgeTrafficAlertSendError.value = ''
  try {
    const file = new File([p.imageBlob], `bridge-${p.routeId}-traffic.jpg`, {
      type: 'image/jpeg',
    })
    const r = await sendChatImage(file, p.message)
    if (!r.ok) {
      bridgeTrafficAlertSendError.value = `Send failed (${r.status}). Check WAHA connection.`
      return
    }
    noteBridgeTrafficAlertSent(p.routeId)
  } catch (e) {
    bridgeTrafficAlertSendError.value = e instanceof Error ? e.message : String(e)
  } finally {
    bridgeTrafficAlertSending.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="bridgeTrafficAlertPreviewOpen && preview"
      class="bridge-wa-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bridge-wa-preview-title"
    >
      <div class="bridge-wa-preview-dialog">
        <p id="bridge-wa-preview-title" class="bridge-wa-preview-eyebrow">Send to WhatsApp?</p>
        <h2 class="bridge-wa-preview-heading">{{ alertTitle }}</h2>
        <p class="bridge-wa-preview-bridge">{{ preview.bridgeName }}</p>

        <div class="bridge-wa-preview-image-wrap">
          <img
            :src="preview.imageUrl"
            class="bridge-wa-preview-image"
            alt="Bridge crossing traffic snapshot"
          />
        </div>

        <p class="bridge-wa-preview-message-label">Message</p>
        <p class="bridge-wa-preview-message">{{ preview.message }}</p>

        <p v-if="!canSend" class="bridge-wa-preview-warn">
          Configure a monitored WhatsApp chat in Settings before sending.
        </p>
        <p v-if="bridgeTrafficAlertSendError" class="bridge-wa-preview-err">
          {{ bridgeTrafficAlertSendError }}
        </p>

        <div class="bridge-wa-preview-actions">
          <button
            type="button"
            class="btn bridge-wa-preview-send tap"
            :disabled="bridgeTrafficAlertSending || !canSend"
            @click="confirmSend"
          >
            {{ bridgeTrafficAlertSending ? 'Sending…' : 'Send to chat' }}
          </button>
          <button
            type="button"
            class="btn bridge-wa-preview-cancel tap"
            :disabled="bridgeTrafficAlertSending"
            @click="dismiss"
          >
            Not now
          </button>
        </div>
        <p class="bridge-wa-preview-foot">
          One preview per bridge per hour. Sending uses your monitored WhatsApp chat.
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bridge-wa-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
}

.bridge-wa-preview-dialog {
  width: min(100%, 26rem);
  max-height: min(92vh, 44rem);
  overflow-y: auto;
  padding: 1.1rem 1rem 1rem;
  border-radius: 14px;
  background: #14141c;
  border: 1px solid #2a2a38;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
}

.bridge-wa-preview-eyebrow {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #a78bfa;
}

.bridge-wa-preview-heading {
  margin: 0.35rem 0 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: #f4f4f5;
}

.bridge-wa-preview-bridge {
  margin: 0.2rem 0 0.75rem;
  font-size: 0.9rem;
  color: #9ca3af;
}

.bridge-wa-preview-image-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 0.75rem;
  border-radius: 10px;
  overflow: hidden;
  background: #0a0a0e;
  border: 1px solid #2a2a38;
}

.bridge-wa-preview-image {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  aspect-ratio: 720 / 400;
}

.bridge-wa-preview-message-label {
  margin: 0 0 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
}

.bridge-wa-preview-message {
  margin: 0 0 0.85rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  background: #1a1a24;
  font-size: 0.95rem;
  line-height: 1.4;
  color: #e4e4e7;
}

.bridge-wa-preview-warn,
.bridge-wa-preview-err {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  line-height: 1.35;
}

.bridge-wa-preview-warn {
  color: #fbbf24;
}

.bridge-wa-preview-err {
  color: #f87171;
}

.bridge-wa-preview-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bridge-wa-preview-send {
  width: 100%;
  padding: 0.75rem 1rem;
  font-weight: 700;
  background: #7b4db5;
  color: #fff;
  border: none;
  border-radius: 10px;
}

.bridge-wa-preview-send:disabled {
  opacity: 0.5;
}

.bridge-wa-preview-cancel {
  width: 100%;
  padding: 0.65rem 1rem;
  background: transparent;
  color: #9ca3af;
  border: 1px solid #3f3f50;
  border-radius: 10px;
}

.bridge-wa-preview-foot {
  margin: 0.75rem 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: #6b7280;
  text-align: center;
}
</style>
