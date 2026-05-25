<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** First-seen / assigned instant (ms) */
  assignedMs: { type: Number, default: null },
  /** First dispatch / ENRT instant (ms) */
  dispatchedMs: { type: Number, default: null },
  /** Arrival instant when known (ms) */
  arrivedMs: { type: Number, default: null },
  /** Haversine distance to destination terminal (meters); null hides distance-driven fill */
  distMeters: { type: Number, default: null },
  /** NM cap for progress normalization (from paid miles or default) */
  denomNm: { type: Number, default: 180 },
  /**
   * Trip phase from FedEx/driver state. Distance-to-destination should only advance the bar
   * after dispatch; while assigned, the bar stays in the pre-departure segment.
   * @type {'assigned' | 'dispatched' | 'none'}
   */
  tripPhase: { type: String, default: 'none' },
})

/** X positions for Assigned / Dispatched / Arrive ticks (percent of track width). */
const M1 = 6
const M2 = 50
const M3 = 94

function fmtTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const distNm = computed(() => {
  if (props.distMeters == null || !Number.isFinite(props.distMeters)) return null
  return props.distMeters / 1852
})

/** 0..1 how "close" to destination in NM (1 = at dest). */
const distCloseFactor = computed(() => {
  const dNm = distNm.value
  if (dNm == null) return null
  const cap = Math.max(15, props.denomNm)
  return 1 - Math.min(1, Math.max(0, dNm) / cap)
})

/**
 * Fill maps to journey segments:
 * - Arrived (timestamp known): 100%
 * - Dispatched: 50% → 100% from distance (closer to destination = fuller bar)
 * - Assigned / none: early segment only (does not use proximity to destination, which misleads at the terminal)
 */
const fillPct = computed(() => {
  if (typeof props.arrivedMs === 'number' && Number.isFinite(props.arrivedMs) && props.arrivedMs > 0) {
    return 100
  }

  const close = distCloseFactor.value

  if (props.tripPhase === 'dispatched') {
    if (close == null) return 52
    const seg = 50 * close
    return Math.round(Math.min(100, Math.max(M2, M2 + seg)))
  }

  if (typeof props.assignedMs === 'number' && Number.isFinite(props.assignedMs) && props.assignedMs > 0) {
    const elapsed = Math.max(0, Date.now() - props.assignedMs)
    const hours = elapsed / (1000 * 60 * 60)
    const bump = Math.min(32, hours * 5)
    return Math.round(Math.min(M2 - 4, Math.max(6, 10 + bump)))
  }

  return 10
})

const milestoneMeta = computed(() => {
  const arrivedKnown = typeof props.arrivedMs === 'number' && Number.isFinite(props.arrivedMs) && props.arrivedMs > 0
  return [
    { key: 'asg', label: 'Assigned', leftPct: M1, time: fmtTime(props.assignedMs) },
    { key: 'dsp', label: 'Dispatched', leftPct: M2, time: fmtTime(props.dispatchedMs) },
    { key: 'arv', label: 'Arrive', leftPct: M3, time: arrivedKnown ? fmtTime(props.arrivedMs) : '—' },
  ]
})

const ariaProgress = computed(() => {
  if (typeof props.arrivedMs === 'number' && Number.isFinite(props.arrivedMs) && props.arrivedMs > 0) {
    return 'Trip complete; arrived.'
  }
  if (props.tripPhase === 'dispatched') {
    const d = distNm.value
    if (d != null) return `En route; about ${d.toFixed(1)} nautical miles to destination.`
    return 'En route; distance to destination not available.'
  }
  return 'Pre-departure; progress does not use distance to destination until dispatched.'
})
</script>

<template>
  <div class="trip-od-progress" role="group" :aria-label="`Trip progress to destination. ${ariaProgress}`">
    <div class="trip-od-progress__head">
      <span class="trip-od-progress__title">Progress to destination</span>
      <span v-if="distNm != null" class="trip-od-progress__nm">{{ distNm.toFixed(1) }} NM out</span>
      <span v-else class="trip-od-progress__nm trip-od-progress__nm--muted">Distance —</span>
    </div>

    <div class="trip-od-progress__milestones" aria-hidden="true">
      <div
        v-for="m in milestoneMeta"
        :key="m.key"
        class="trip-od-progress__ms-col"
        :class="`trip-od-progress__ms-col--${m.key}`"
      >
        <span class="trip-od-progress__ms-label">{{ m.label }}</span>
        <span class="trip-od-progress__ms-time">{{ m.time }}</span>
      </div>
    </div>

    <div class="trip-od-progress__track-wrap">
      <div class="trip-od-progress__track" aria-hidden="true">
        <div class="trip-od-progress__fill" :style="{ width: fillPct + '%' }" />
        <div
          v-for="m in milestoneMeta"
          :key="'tick-' + m.key"
          class="trip-od-progress__tick"
          :style="{ left: m.leftPct + '%' }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.trip-od-progress {
  margin-top: 0.65rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.trip-od-progress__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.trip-od-progress__title {
  font-size: var(--text-xs, 0.72rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #8b8b98);
}

.trip-od-progress__nm {
  font-size: var(--text-xs, 0.72rem);
  font-weight: 600;
  color: var(--color-accent-orange, #ff6b1a);
  white-space: nowrap;
}

.trip-od-progress__nm--muted {
  color: var(--color-text-tertiary, #8b8b98);
  font-weight: 500;
}

.trip-od-progress__milestones {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: start;
  gap: 0.25rem 0.35rem;
  margin-bottom: 0.4rem;
  font-size: 0.62rem;
  line-height: 1.2;
  color: var(--color-text-secondary, #c8c8d4);
}

.trip-od-progress__ms-col {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.trip-od-progress__ms-col--asg {
  text-align: left;
}
.trip-od-progress__ms-col--dsp {
  text-align: center;
}
.trip-od-progress__ms-col--arv {
  text-align: right;
}

.trip-od-progress__ms-label {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #9a9aa8);
  font-size: 0.58rem;
}

.trip-od-progress__ms-time {
  font-weight: 500;
  color: var(--color-text-secondary, #b6b6c4);
}

.trip-od-progress__track-wrap {
  position: relative;
  padding-bottom: 2px;
}

.trip-od-progress__track {
  position: relative;
  height: 10px;
  border-radius: var(--radius-full, 9999px);
  background: var(--color-glass, rgba(22, 22, 29, 0.55));
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
  overflow: visible;
}

.trip-od-progress__fill {
  height: 100%;
  border-radius: var(--radius-full, 9999px);
  background: linear-gradient(
    90deg,
    var(--color-accent-purple, #7b4db5),
    var(--color-accent-orange, #ff6b1a)
  );
  box-shadow: 0 0 12px rgba(123, 77, 181, 0.35);
  transition: width 0.45s var(--ease-out, ease-out);
  position: relative;
  z-index: 0;
}

.trip-od-progress__tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  border-radius: 1px;
  background: rgba(244, 244, 248, 0.92);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  z-index: 2;
  pointer-events: none;
}
</style>
