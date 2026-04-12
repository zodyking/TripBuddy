<script setup>
defineProps({
  title: { type: String, required: true },
  /** When true, section starts expanded */
  open: { type: Boolean, default: false },
  /** When false, title is static (no collapse / chevron) */
  collapsible: { type: Boolean, default: true },
})
</script>

<template>
  <details v-if="collapsible" class="settings-details" :open="open">
    <summary class="settings-summary">{{ title }}</summary>
    <div class="settings-body">
      <slot />
    </div>
  </details>
  <div v-else class="settings-details settings-details-static">
    <div class="settings-summary-static">{{ title }}</div>
    <div class="settings-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-details {
  position: relative;
  background: var(--color-glass, rgba(22, 22, 29, 0.72));
  backdrop-filter: blur(var(--blur-lg, 20px));
  -webkit-backdrop-filter: blur(var(--blur-lg, 20px));
  border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-xl, 1rem);
  padding: 0;
  overflow: hidden;
  box-shadow: var(--shadow-md, 0 4px 8px rgba(0, 0, 0, 0.3)),
              inset 0 1px 0 var(--color-glass-highlight, rgba(255, 255, 255, 0.03));
}

.settings-details::before {
  content: '';
  position: absolute;
  top: 0;
  left: var(--space-4, 1rem);
  right: var(--space-4, 1rem);
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-accent-purple, #7b4db5), var(--color-accent-orange, #ff6b1a), transparent);
  opacity: 0.4;
  border-radius: var(--radius-full, 9999px);
}

.settings-summary {
  list-style: none;
  cursor: pointer;
  font-weight: var(--weight-semibold, 600);
  font-size: var(--text-md, 1rem);
  padding: var(--space-4, 1rem);
  user-select: none;
  min-height: var(--touch-target, 2.75rem);
  display: flex;
  align-items: center;
  color: var(--color-text-primary, #f4f4f8);
  transition: var(--transition-colors);
  -webkit-tap-highlight-color: transparent;
}

.settings-summary:hover {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
}

.settings-summary::-webkit-details-marker {
  display: none;
}

.settings-summary::after {
  content: '';
  width: 0.5rem;
  height: 0.5rem;
  margin-left: auto;
  border-right: 2px solid var(--color-text-tertiary, #6e6e7e);
  border-bottom: 2px solid var(--color-text-tertiary, #6e6e7e);
  transform: rotate(45deg);
  transition: transform var(--duration-normal, 200ms) var(--ease-out);
}

.settings-details[open] .settings-summary::after {
  transform: rotate(-135deg);
}

.settings-summary-static {
  font-weight: var(--weight-semibold, 600);
  font-size: var(--text-md, 1rem);
  padding: var(--space-4, 1rem);
  user-select: none;
  min-height: var(--touch-target, 2.75rem);
  display: flex;
  align-items: center;
  color: var(--color-text-primary, #f4f4f8);
}

.settings-body {
  padding: 0 var(--space-4, 1rem) var(--space-4, 1rem);
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  animation: slide-up var(--duration-normal, 200ms) var(--ease-out);
}
</style>
