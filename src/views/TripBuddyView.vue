<script setup>
import { onMounted, ref } from 'vue'
import { FEDEX_DISPATCH_HOME_URL } from '../fedexUrls.js'
import { copyTextToClipboard } from '../utils/copyToClipboard.js'

const url = FEDEX_DISPATCH_HOME_URL
const openedHint = ref('')
const copyHint = ref('')

function openTripBuddy() {
  const w = window.open(url, '_blank', 'noopener,noreferrer')
  if (!w) {
    openedHint.value =
      'Popup was blocked. Allow popups for this site or use Copy link and paste into the address bar.'
  } else {
    openedHint.value = ''
  }
}

async function copyLink() {
  const ok = await copyTextToClipboard(url)
  copyHint.value = ok ? 'Link copied' : 'Could not copy'
  window.setTimeout(() => {
    copyHint.value = ''
  }, 2000)
}

onMounted(() => {
  openedHint.value = ''
})
</script>

<template>
  <div class="trip-buddy-view">
    <div class="trip-buddy-card">
      <h1 class="trip-buddy-title">Trip Buddy</h1>
      <p class="trip-buddy-lead">
        FedEx dispatch cannot be embedded reliably inside a web page (framing blocks, sign-in, and
        security checks). Opening it in a <strong>new tab</strong> is the approach that always works.
      </p>
      <div class="trip-buddy-actions">
        <button type="button" class="trip-buddy-primary tap" @click="openTripBuddy">
          Open Trip Buddy in new tab
        </button>
        <button type="button" class="trip-buddy-secondary tap" @click="copyLink">
          Copy link
        </button>
      </div>
      <p v-if="openedHint" class="trip-buddy-warn">{{ openedHint }}</p>
      <p v-if="copyHint" class="trip-buddy-copy-feedback" aria-live="polite">{{ copyHint }}</p>
      <a
        class="trip-buddy-url"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ url }}
      </a>
    </div>
  </div>
</template>

<style scoped>
.trip-buddy-view {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-5, 1.25rem);
  box-sizing: border-box;
  background: var(--color-bg-base, #08080a);
}

.trip-buddy-card {
  max-width: 26rem;
  width: 100%;
  padding: var(--space-5, 1.25rem);
  border-radius: var(--radius-xl, 1rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: rgba(255, 255, 255, 0.03);
}

.trip-buddy-title {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-xl, 1.25rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  text-align: center;
}

.trip-buddy-lead {
  margin: 0 0 var(--space-5, 1.25rem);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.55;
  color: var(--color-text-secondary, #a8a8b8);
  text-align: center;
}

.trip-buddy-lead strong {
  color: var(--color-text-primary, #f4f4f8);
  font-weight: 600;
}

.trip-buddy-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.trip-buddy-primary {
  min-height: 48px;
  padding: 0.65rem 1.25rem;
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid rgba(123, 77, 181, 0.45);
  background: linear-gradient(
    165deg,
    rgba(123, 77, 181, 0.35) 0%,
    rgba(123, 77, 181, 0.12) 100%
  );
  color: var(--color-text-primary, #f4f4f8);
  font-size: var(--text-base, 0.9375rem);
  font-weight: var(--weight-semibold, 600);
  cursor: pointer;
}

.trip-buddy-primary:hover {
  border-color: rgba(123, 77, 181, 0.65);
}

.trip-buddy-secondary {
  min-height: 44px;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary, #a8a8b8);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: 600;
  cursor: pointer;
}

.trip-buddy-secondary:hover {
  color: var(--color-text-primary, #f4f4f8);
}

.trip-buddy-warn {
  margin: var(--space-4, 1rem) 0 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.45;
  color: #fbbf24;
  text-align: center;
}

.trip-buddy-copy-feedback {
  margin: var(--space-2, 0.5rem) 0 0;
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-success, #22c55e);
  text-align: center;
}

.trip-buddy-url {
  display: block;
  margin-top: var(--space-4, 1rem);
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-accent-purple-light, #a78bfa);
  word-break: break-all;
  line-height: 1.4;
  text-align: center;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.trip-buddy-url:hover {
  color: #c4b5fd;
}
</style>
