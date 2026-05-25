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
})

function fmtTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const distNm = computed(() => {
  if (props.distMeters == null || !Number.isFinite(props.distMeters)) return null
  return props.distMeters / 1852
})

/** Progress fill driven by distance to destination (closer → fuller). */
const fillPct = computed(() => {
  const dNm = distNm.value
  if (dNm == null) return 6
  const cap = Math.max(15, props.denomNm)
  const raw = 100 * (1 - Math.min(1, Math.max(0, dNm) / cap))
  return Math.round(Math.min(100, Math.max(5, raw)))
})

const timelineEndMs = computed(() => {
  const a = props.arrivedMs
  if (typeof a === 'number' && Number.isFinite(a) && a > 0) return a
  return Date.now()
})

const markerStyle = computed(() => {
  const a0 = props.assignedMs
  if (!(typeof a0 === 'number' && Number.isFinite(a0) && a0 > 0)) return []
  const end = timelineEndMs.value
  const span = Math.max(60_000, end - a0)
  /** @param {number | null | undefined} ms */
  const pct = (ms) => {
    if (!(typeof ms === 'number' && Number.isFinite(ms) && ms > 0)) return null
    const p = ((ms - a0) / span) * 100
    return Math.min(96, Math.max(4, p))
  }
  const out = [
    { key: 'asg', label: 'Assigned', time: fmtTime(a0), leftPct: 4 },
  ]
  const pD = pct(props.dispatchedMs)
  if (pD != null) out.push({ key: 'dsp', label: 'Dispatched', time: fmtTime(props.dispatchedMs), leftPct: pD })
  const pA = pct(props.arrivedMs)
  if (pA != null) out.push({ key: 'arv', label: 'Arrived', time: fmtTime(props.arrivedMs), leftPct: pA })
  return out
})
</script>

<template>
  <div class="trip-od-progress" role="group" aria-label="Trip progress to destination">
    <div class="trip-od-progress__head">
      <span class="trip-od-progress__title">Progress to destination</span>
      <span v-if="distNm != null" class="trip-od-progress__nm">{{ distNm.toFixed(1) }} NM out</span>
      <span v-else class="trip-od-progress__nm trip-od-progress__nm--muted">Distance —</span>
    </div>
    <div class="trip-od-progress__track" aria-hidden="true">
      <div class="trip-od-progress__fill" :style="{ width: fillPct + '%' }" />
      <div
        v-for="m in markerStyle"
        :key="m.key"
        class="trip-od-progress__marker"
        :style="{ left: m.leftPct + '%' }"
      >
        <span class="trip-od-progress__marker-dot" />
        <span class="trip-od-progress__marker-cap">
          <em>{{ m.label }}</em>
          <span>{{ m.time }}</span>
        </span>
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
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
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
}

.trip-od-progress__marker {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.trip-od-progress__marker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 1px;
  background: var(--color-text-primary, #f4f4f8);
  border: 1px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.35);
}

.trip-od-progress__marker-cap {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 4.5rem;
  text-align: center;
  font-size: 0.62rem;
  line-height: 1.15;
  color: var(--color-text-secondary, #c8c8d4);
}

.trip-od-progress__marker-cap em {
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #9a9aa8);
  font-size: 0.58rem;
}
</style>
