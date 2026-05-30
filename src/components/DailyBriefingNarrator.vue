<script setup>
import { computed } from 'vue'
import { tokenizeBriefingWords } from '../utils/dailyBriefingPlayback.js'

const props = defineProps({
  active: { type: Boolean, default: false },
  text: { type: String, default: '' },
  wordIndex: { type: Number, default: -1 },
})

const emit = defineEmits(['close'])

const words = computed(() => tokenizeBriefingWords(props.text))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active && text"
      class="daily-briefing-narrator"
      role="region"
      aria-live="polite"
      aria-label="Daily briefing playback"
    >
      <div class="daily-briefing-narrator-inner">
        <p class="daily-briefing-narrator-label">Daily briefing</p>
        <p class="daily-briefing-narrator-text">
          <span
            v-for="(word, i) in words"
            :key="i"
            class="daily-briefing-narrator-word"
            :class="{
              'is-active': i === wordIndex,
              'is-spoken': wordIndex >= 0 && i < wordIndex,
            }"
          >{{ word }} </span>
        </p>
        <button
          type="button"
          class="btn ghost tap daily-briefing-narrator-close"
          @click="emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.daily-briefing-narrator {
  position: fixed;
  inset: 0;
  z-index: 2147482999;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(8, 8, 10, 0.55) 40%,
    rgba(8, 8, 10, 0.92) 100%
  );
}

.daily-briefing-narrator-inner {
  pointer-events: auto;
  width: min(100%, 42rem);
  max-height: min(52vh, 22rem);
  padding: 1rem 1.1rem 0.85rem;
  border-radius: var(--radius-xl, 1rem);
  background: rgba(22, 22, 29, 0.94);
  border: 1px solid rgba(167, 139, 250, 0.35);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.daily-briefing-narrator-label {
  margin: 0;
  font-size: var(--text-xs, 0.6875rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-accent-purple-light, #9d6fd7);
}

.daily-briefing-narrator-text {
  margin: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  font-size: var(--text-base, 0.9375rem);
  line-height: 1.55;
  color: var(--color-text-secondary, #a8a8b8);
}

.daily-briefing-narrator-word {
  transition: color 0.12s ease, background-color 0.12s ease;
  border-radius: 0.2em;
  padding: 0 0.05em;
}

.daily-briefing-narrator-word.is-spoken {
  color: var(--color-text-primary, #f4f4f8);
}

.daily-briefing-narrator-word.is-active {
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(123, 77, 181, 0.35);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.daily-briefing-narrator-close {
  align-self: flex-end;
  margin-top: 0.15rem;
}
</style>
