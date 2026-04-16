<script setup>
import { useApiHealth } from '../composables/useApiHealth.js'

const { apiOk } = useApiHealth()
</script>

<template>
  <div
    class="api-status"
    :class="{ 'is-ok': apiOk === true, 'is-offline': apiOk === false }"
    role="status"
    :aria-label="apiOk === null ? 'API connecting' : apiOk ? 'API online' : 'API offline'"
  >
    <span class="api-dot" :class="{ 'animate-pulse-glow': apiOk === null }" />
    <span class="api-label">{{ apiOk === null ? 'Connecting' : apiOk ? 'Online' : 'Offline' }}</span>
  </div>
</template>

<style scoped>
.api-status {
  display: flex;
  align-items: center;
  gap: var(--space-1-5, 0.375rem);
  padding: var(--space-1, 0.25rem) var(--space-2-5, 0.625rem);
  border-radius: var(--radius-full, 9999px);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  flex-shrink: 0;
}

.api-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-full, 9999px);
  background: var(--color-text-tertiary, #6e6e7e);
  flex-shrink: 0;
}

.api-status.is-ok .api-dot {
  background: var(--color-success, #22c55e);
}

.api-status.is-offline .api-dot {
  background: var(--color-error, #ef4444);
}

.api-label {
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-medium, 500);
  color: var(--color-text-tertiary, #6e6e7e);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider, 0.05em);
}

.api-status.is-ok .api-label {
  color: var(--color-success, #22c55e);
}

.api-status.is-offline .api-label {
  color: var(--color-error, #ef4444);
}
</style>
