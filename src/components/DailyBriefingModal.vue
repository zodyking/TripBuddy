<script setup>
defineProps({
  open: { type: Boolean, default: false },
  messageCount: { type: Number, default: 0 },
  preview: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['play', 'dismiss'])
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="daily-briefing-backdrop"
      role="presentation"
      @click.self="!busy && emit('dismiss')"
    >
      <div
        class="daily-briefing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-briefing-title"
      >
        <h2 id="daily-briefing-title" class="daily-briefing-title">
          {{ busy ? 'Generating briefing…' : 'Would you like a briefing?' }}
        </h2>
        <p v-if="busy" class="daily-briefing-lead daily-briefing-loading">
          Fetching today's messages and summarizing with AI…
        </p>
        <p v-else-if="error" class="daily-briefing-lead daily-briefing-error">
          {{ error }}
        </p>
        <p v-else class="daily-briefing-lead">
          Hear a spoken AI summary of today's WhatsApp group chat.
        </p>
        <div v-if="!busy && !error && preview" class="daily-briefing-preview">
          <p class="daily-briefing-preview-label">
            {{ messageCount > 0 ? `${messageCount} message${messageCount === 1 ? '' : 's'} summarized` : 'Ready to play' }}
          </p>
          <p class="daily-briefing-preview-text">{{ preview }}</p>
        </div>
        <div v-if="!busy" class="daily-briefing-actions">
          <button type="button" class="btn ghost tap" @click="emit('dismiss')">
            {{ error ? 'Close' : 'Not now' }}
          </button>
          <button v-if="!error" type="button" class="btn primary tap" @click="emit('play')">
            Yes, brief me
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.daily-briefing-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.65);
}

.daily-briefing-dialog {
  width: min(100%, 24rem);
  padding: 1.25rem 1.35rem;
  border-radius: 12px;
  background: var(--color-surface-elevated, #1a1528);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.daily-briefing-title {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text, #f4f4f5);
}

.daily-briefing-lead {
  margin: 0 0 0.75rem;
  font-size: 0.9375rem;
  line-height: 1.45;
  color: var(--color-text-muted, #a1a1aa);
}

.daily-briefing-loading {
  color: var(--color-accent-orange, #ff6b1a);
}

.daily-briefing-error {
  color: #f87171;
}

.daily-briefing-preview {
  margin: 0 0 0.9rem;
  padding: 0.75rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.daily-briefing-preview-label {
  margin: 0 0 0.35rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent-purple-light, #9d6fd7);
}

.daily-briefing-preview-text {
  margin: 0;
  max-height: min(28vh, 12rem);
  overflow: auto;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--color-text, #f4f4f5);
  white-space: pre-wrap;
}

.daily-briefing-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
</style>
