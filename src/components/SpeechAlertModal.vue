<script setup>
import { computed } from 'vue'
import {
  speechAlertModalOpen,
  speechAlertModalText,
  speechAlertWordIndex,
  tokenizeSpeechWords,
} from '../stores/speechAlertModalStore.js'

const words = computed(() => tokenizeSpeechWords(speechAlertModalText.value))

const subtitleSizeClass = computed(() => {
  const n = words.value.length
  if (n > 18) return 'speech-subtitle-text--xs'
  if (n > 12) return 'speech-subtitle-text--sm'
  if (n > 8) return 'speech-subtitle-text--md'
  return 'speech-subtitle-text--lg'
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="speechAlertModalOpen && words.length"
      class="speech-subtitle-wrap"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p class="speech-subtitle-bar" :class="subtitleSizeClass">
        <span
          v-for="(word, i) in words"
          :key="`${i}-${word}`"
          class="speech-subtitle-word"
          :class="{ 'is-active': i === speechAlertWordIndex }"
        >{{ word }}<template v-if="i < words.length - 1">&nbsp;</template></span>
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.speech-subtitle-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--nav-height, 4rem) + env(safe-area-inset-bottom, 0px));
  z-index: 2147483001;
  pointer-events: none;
  display: flex;
  justify-content: center;
  padding: 0 0.35rem 0.35rem;
}

.speech-subtitle-bar {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0.55rem 0.85rem;
  background: #000;
  color: #fff;
  text-align: center;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.015em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  word-break: break-word;
}

.speech-subtitle-text--lg {
  font-size: clamp(1.35rem, 5.8vw, 2.85rem);
}

.speech-subtitle-text--md {
  font-size: clamp(1.15rem, 4.8vw, 2.25rem);
}

.speech-subtitle-text--sm {
  font-size: clamp(1rem, 4vw, 1.85rem);
}

.speech-subtitle-text--xs {
  font-size: clamp(0.9rem, 3.2vw, 1.45rem);
}

.speech-subtitle-word {
  color: #fff;
  transition: color 0.08s linear;
}

.speech-subtitle-word.is-active {
  color: #facc15;
}
</style>
