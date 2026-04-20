<script setup>
/** Embedded FedEx dispatch home (same origin as quick actions). */
const TRIP_BUDDY_URL = 'https://fdxtools.fedex.com/grdlhldispatch/grdlhldispatch/home'
</script>

<template>
  <div class="trip-buddy-view">
    <iframe
      class="trip-buddy-frame"
      :src="TRIP_BUDDY_URL"
      title="Trip Buddy — FedEx dispatch"
      referrerpolicy="no-referrer"
    />
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
</style>
