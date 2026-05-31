<script setup>
import { computed } from 'vue'
import { parseMessageTextSegments } from '../utils/chatMessageLinks.js'

const props = defineProps({
  text: { type: String, default: '' },
})

const segments = computed(() => parseMessageTextSegments(props.text))
</script>

<template>
  <span class="chat-message-text">
    <template v-for="(seg, i) in segments" :key="i">
      <a
        v-if="seg.type === 'url'"
        class="chat-bubble-link"
        :href="seg.value"
        target="_blank"
        rel="noopener noreferrer"
        @click.stop
      >{{ seg.value }}</a>
      <span v-else>{{ seg.value }}</span>
    </template>
  </span>
</template>

<style scoped>
.chat-message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-bubble-link {
  color: var(--color-accent-purple-light, #9d6fd7);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-bubble-link:visited {
  color: #c4b5fd;
}

.chat-bubble-link:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
