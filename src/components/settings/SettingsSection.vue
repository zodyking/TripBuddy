<script setup>
defineProps({
  title: { type: String, required: true },
  /** When true, section starts expanded */
  open: { type: Boolean, default: false },
})
</script>

<template>
  <details class="settings-details" :open="open">
    <summary class="settings-summary">{{ title }}</summary>
    <div class="settings-body">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.settings-details {
  background: var(--card, #1a1a21);
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  padding: 0;
  overflow: hidden;
}
.settings-summary {
  list-style: none;
  cursor: pointer;
  font-weight: 600;
  font-size: 1rem;
  padding: 0.85rem 1rem;
  user-select: none;
  min-height: 44px;
  display: flex;
  align-items: center;
}
.settings-summary::-webkit-details-marker {
  display: none;
}
.settings-summary::after {
  content: '';
  width: 0.5rem;
  height: 0.5rem;
  margin-left: auto;
  border-right: 2px solid var(--muted, #9898a8);
  border-bottom: 2px solid var(--muted, #9898a8);
  transform: rotate(45deg);
  transition: transform 0.15s ease;
}
.settings-details[open] .settings-summary::after {
  transform: rotate(-135deg);
}
.settings-body {
  padding: 0 1rem 1rem;
  border-top: 1px solid var(--border, #2e2e38);
}
</style>
