<script setup>
import TrafficCrossingsContent from './TrafficCrossingsContent.vue'

defineOptions({ name: 'TrafficView' })
</script>

<template>
  <div class="traffic-hub">
    <div class="traffic-hub-panel">
      <TrafficCrossingsContent />
    </div>
  </div>
</template>

<style scoped>
.traffic-hub {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
}

.traffic-hub-panel {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.traffic-hub-panel > :deep(.bridges-page) {
  flex: 1 1 0;
  min-height: 0;
}
</style>
