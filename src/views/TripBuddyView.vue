<script setup>
/**
 * FedEx blocks third-party iframes. We load dispatch through our API same-origin proxy
 * (/embed/trip-buddy → fdxtools.fedex.com) so the iframe can render.
 */
import { TRIP_BUDDY_PROXY_PREFIX } from '../tripBuddyProxy.js'

const iframeSrc = TRIP_BUDDY_PROXY_PREFIX
</script>

<template>
  <div class="trip-buddy-view">
    <iframe
      class="trip-buddy-frame"
      :src="iframeSrc"
      title="Trip Buddy — FedEx dispatch"
      referrerpolicy="no-referrer"
    />
    <p class="trip-buddy-fallback-hint">
      Blank? Ensure you are signed in — the embed is only available to authenticated sessions.
    </p>
  </div>
</template>

<style scoped>
.trip-buddy-view {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-base, #08080a);
}

.trip-buddy-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  display: block;
}

.trip-buddy-fallback-hint {
  flex-shrink: 0;
  margin: 0;
  padding: 0.5rem 0.75rem 0.75rem;
  font-size: 0.68rem;
  line-height: 1.35;
  color: var(--color-text-tertiary, #6e6e7e);
  text-align: center;
}
</style>
