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
        <div class="daily-briefing-hero" aria-hidden="true">
          <span class="daily-briefing-orb">
            <span class="daily-briefing-orb-core">AI</span>
          </span>
          <span class="daily-briefing-pulse daily-briefing-pulse--one"></span>
          <span class="daily-briefing-pulse daily-briefing-pulse--two"></span>
        </div>
        <p class="daily-briefing-eyebrow">WhatsApp daily briefing</p>
        <h2 id="daily-briefing-title" class="daily-briefing-title">
          {{ busy ? 'Building your briefing…' : 'Your chat briefing is ready' }}
        </h2>
        <p v-if="busy" class="daily-briefing-lead daily-briefing-loading">
          Pulling stored chat history, syncing the latest messages, and summarizing today's activity.
        </p>
        <p v-else-if="error" class="daily-briefing-lead daily-briefing-error">
          {{ error }}
        </p>
        <p v-else class="daily-briefing-lead">
          Review the clean summary before playback. It is scoped to today's messages from your monitored chat.
        </p>
        <div class="daily-briefing-status-grid" aria-label="Briefing status">
          <div class="daily-briefing-status-card">
            <span class="daily-briefing-status-value">{{ messageCount || '—' }}</span>
            <span class="daily-briefing-status-label">messages</span>
          </div>
          <div class="daily-briefing-status-card">
            <span class="daily-briefing-status-value">{{ busy ? 'Syncing' : error ? 'Needs attention' : 'Ready' }}</span>
            <span class="daily-briefing-status-label">status</span>
          </div>
          <div class="daily-briefing-status-card">
            <span class="daily-briefing-status-value">Today</span>
            <span class="daily-briefing-status-label">date scope</span>
          </div>
        </div>
        <div v-if="busy" class="daily-briefing-progress" aria-hidden="true">
          <span></span>
        </div>
        <div v-if="!busy && !error && preview" class="daily-briefing-preview">
          <p class="daily-briefing-preview-label">
            Summary preview
          </p>
          <p class="daily-briefing-preview-text">{{ preview }}</p>
        </div>
        <div v-if="!busy" class="daily-briefing-actions">
          <button type="button" class="btn ghost tap" @click="emit('dismiss')">
            {{ error ? 'Close' : 'Not now' }}
          </button>
          <button v-if="!error" type="button" class="btn primary tap daily-briefing-play" @click="emit('play')">
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
  padding: clamp(1rem, 3vw, 2rem);
  background:
    radial-gradient(circle at 20% 20%, rgba(123, 77, 181, 0.28), transparent 32rem),
    radial-gradient(circle at 80% 10%, rgba(255, 107, 26, 0.18), transparent 24rem),
    rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.daily-briefing-dialog {
  position: relative;
  width: min(100%, 42rem);
  max-height: min(88dvh, 46rem);
  overflow: hidden auto;
  padding: clamp(1.5rem, 4vw, 2.25rem);
  border-radius: 24px;
  background:
    linear-gradient(150deg, rgba(31, 25, 48, 0.97), rgba(13, 13, 19, 0.98)),
    var(--color-surface-elevated, #1a1528);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.58),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
}

.daily-briefing-dialog::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(123, 77, 181, 0.24), rgba(255, 107, 26, 0.16)),
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 100% 4px, 100% 2.5rem;
  opacity: 0.22;
  mask-image: linear-gradient(#000, transparent 55%);
}

.daily-briefing-hero {
  position: relative;
  width: 5.25rem;
  height: 5.25rem;
  margin: 0 auto 1rem;
  display: grid;
  place-items: center;
}

.daily-briefing-orb {
  position: relative;
  z-index: 2;
  width: 4.25rem;
  height: 4.25rem;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.86), transparent 0.45rem),
    linear-gradient(135deg, #9d6fd7, #7b4db5 52%, #ff6b1a);
  box-shadow:
    0 0 42px rgba(123, 77, 181, 0.55),
    0 12px 28px rgba(0, 0, 0, 0.45);
}

.daily-briefing-orb-core {
  width: 2.4rem;
  height: 2.4rem;
  display: grid;
  place-items: center;
  border-radius: inherit;
  background: rgba(8, 8, 10, 0.7);
  color: #fff7ed;
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.daily-briefing-pulse {
  position: absolute;
  inset: 0.4rem;
  border-radius: 999px;
  border: 1px solid rgba(157, 111, 215, 0.44);
  animation: daily-briefing-pulse 2.6s ease-out infinite;
}

.daily-briefing-pulse--two {
  animation-delay: 1.2s;
  border-color: rgba(255, 107, 26, 0.34);
}

.daily-briefing-eyebrow {
  position: relative;
  margin: 0 0 0.45rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-align: center;
  text-transform: uppercase;
  color: var(--color-accent-purple-light, #9d6fd7);
}

.daily-briefing-title {
  position: relative;
  margin: 0 0 0.7rem;
  font-size: clamp(1.55rem, 5vw, 2.35rem);
  line-height: 1.05;
  font-weight: 800;
  text-align: center;
  color: var(--color-text, #f4f4f5);
  letter-spacing: -0.04em;
}

.daily-briefing-lead {
  position: relative;
  max-width: 34rem;
  margin: 0 auto 1.2rem;
  font-size: clamp(0.95rem, 2.8vw, 1.05rem);
  line-height: 1.55;
  color: var(--color-text-muted, #a1a1aa);
  text-align: center;
}

.daily-briefing-loading {
  color: var(--color-accent-orange, #ff6b1a);
}

.daily-briefing-error {
  color: #f87171;
}

.daily-briefing-status-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0 0 1rem;
}

.daily-briefing-status-card {
  min-height: 4.1rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.2rem;
  padding: 0.75rem;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.09);
}

.daily-briefing-status-value {
  font-size: clamp(0.95rem, 3vw, 1.25rem);
  font-weight: 800;
  color: var(--color-text, #f4f4f5);
}

.daily-briefing-status-label {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted, #a1a1aa);
}

.daily-briefing-progress {
  position: relative;
  height: 0.55rem;
  margin: 0 0 1.1rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.daily-briefing-progress span {
  position: absolute;
  inset-block: 0;
  left: -35%;
  width: 45%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, #9d6fd7, #ff6b1a);
  animation: daily-briefing-load 1.35s ease-in-out infinite;
}

.daily-briefing-preview {
  position: relative;
  margin: 0 0 1.15rem;
  padding: 1rem;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.045));
  border: 1px solid rgba(255, 255, 255, 0.1);
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
  max-height: min(34vh, 16rem);
  overflow: auto;
  font-size: 0.95rem;
  line-height: 1.58;
  color: var(--color-text, #f4f4f5);
  white-space: pre-wrap;
}

.daily-briefing-actions {
  position: relative;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.daily-briefing-play {
  min-width: 9.5rem;
}

@keyframes daily-briefing-pulse {
  0% {
    opacity: 0.7;
    transform: scale(0.75);
  }
  100% {
    opacity: 0;
    transform: scale(1.45);
  }
}

@keyframes daily-briefing-load {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(300%);
  }
}

@media (max-width: 520px) {
  .daily-briefing-dialog {
    border-radius: 20px;
  }

  .daily-briefing-status-grid {
    grid-template-columns: 1fr;
  }

  .daily-briefing-actions {
    flex-direction: column-reverse;
  }

  .daily-briefing-actions .btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .daily-briefing-pulse,
  .daily-briefing-progress span {
    animation: none;
  }
}
</style>
