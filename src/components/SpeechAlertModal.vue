<script setup>
import { speechAlertModalOpen, speechAlertModalText, hideSpeechAlertModal } from '../stores/speechAlertModalStore.js'
import { cancelAllAlerts } from '../utils/alertAudioQueue.js'

function dismiss() {
  cancelAllAlerts()
  hideSpeechAlertModal()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="speechAlertModalOpen"
      class="speech-alert-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="speech-alert-title"
      @click.self="dismiss"
    >
      <div class="speech-alert-dialog">
        <p id="speech-alert-title" class="speech-alert-label">Speaking alert</p>
        <p class="speech-alert-text">{{ speechAlertModalText }}</p>
        <button type="button" class="btn ghost tap speech-alert-dismiss" @click="dismiss">
          Dismiss
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.speech-alert-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom, 0px));
  background: rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.speech-alert-dialog {
  width: min(100%, 22rem);
  padding: 1rem 1.1rem;
  border-radius: var(--radius-lg, 0.75rem);
  background: var(--color-bg-elevated, #14141c);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.speech-alert-label {
  margin: 0 0 0.35rem;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-accent-purple, #a78bfa);
}

.speech-alert-text {
  margin: 0 0 0.85rem;
  font-size: 0.95rem;
  line-height: 1.45;
  color: var(--color-text-primary, #f4f4f8);
}

.speech-alert-dismiss {
  width: 100%;
}
</style>
