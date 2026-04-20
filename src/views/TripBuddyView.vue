<script setup>
/**
 * FedEx dispatch blocks embedding in iframes (X-Frame-Options / CSP).
 * We show the app chrome and open the real URL in a new tab / same device browser.
 */
const TRIP_BUDDY_URL = 'https://fdxtools.fedex.com/grdlhldispatch/home'

function openTripBuddy() {
  window.open(TRIP_BUDDY_URL, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="trip-buddy-view">
    <div class="trip-buddy-inner">
      <h1 class="trip-buddy-title">Trip Buddy</h1>
      <p class="trip-buddy-lead">
        FedEx does not allow this site to be shown inside the app window for security reasons.
        Use the button below to open dispatch in your browser.
      </p>
      <button type="button" class="trip-buddy-open tap" @click="openTripBuddy">
        Open Trip Buddy
      </button>
      <a
        class="trip-buddy-link"
        :href="TRIP_BUDDY_URL"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ TRIP_BUDDY_URL }}
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

.trip-buddy-inner {
  max-width: 26rem;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4, 1rem);
}

.trip-buddy-title {
  margin: 0;
  font-size: var(--text-xl, 1.25rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  letter-spacing: var(--tracking-tight, -0.02em);
}

.trip-buddy-lead {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.5;
  color: var(--color-text-secondary, #a8a8b8);
}

.trip-buddy-open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0.65rem 1.5rem;
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
  width: 100%;
  max-width: 20rem;
}

.trip-buddy-open:hover {
  border-color: rgba(123, 77, 181, 0.65);
  background: linear-gradient(
    165deg,
    rgba(123, 77, 181, 0.45) 0%,
    rgba(123, 77, 181, 0.18) 100%
  );
}

.trip-buddy-open:focus-visible {
  outline: 2px solid var(--color-accent-purple, #7b4db5);
  outline-offset: 3px;
}

.trip-buddy-link {
  font-size: var(--text-xs, 0.6875rem);
  color: var(--color-accent-purple-light, #a78bfa);
  word-break: break-all;
  line-height: 1.4;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.trip-buddy-link:hover {
  color: #c4b5fd;
}
</style>
