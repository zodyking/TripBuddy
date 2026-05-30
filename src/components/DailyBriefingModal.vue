<script setup>
defineProps({
  open: { type: Boolean, default: false },
  messageCount: { type: Number, default: 0 },
  preview: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['play', 'dismiss'])
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="daily-briefing-backdrop"
      role="presentation"
      @click.self="emit('dismiss')"
    >
      <div
        class="daily-briefing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-briefing-title"
      >
        <h2 id="daily-briefing-title" class="daily-briefing-title">Daily briefing</h2>
        <p class="daily-briefing-lead">
          Play today’s WhatsApp briefing? ({{ messageCount }} message{{ messageCount === 1 ? '' : 's' }} summarized.)
        </p>
        <div class="daily-briefing-actions">
          <button type="button" class="btn ghost tap" :disabled="busy" @click="emit('dismiss')">
            Not now
          </button>
          <button type="button" class="btn primary tap" :disabled="busy" @click="emit('play')">
            Play briefing
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

.daily-briefing-preview {
  margin: 0 0 1rem;
  max-height: 8rem;
  overflow-y: auto;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--color-text-muted, #a1a1aa);
  opacity: 0.9;
}

.daily-briefing-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
</style>
