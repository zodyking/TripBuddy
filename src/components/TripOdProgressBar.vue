<script setup>
import { computed } from 'vue'

const props = defineProps({
  assignedMs: { type: Number, default: null },
  dispatchedMs: { type: Number, default: null },
  arrivedMs: { type: Number, default: null },
  distMeters: { type: Number, default: null },
  legOdMeters: { type: Number, default: null },
  denomNm: { type: Number, default: 180 },
  tripPhase: { type: String, default: 'none' },
})

const M1 = 7
const M2 = 50
const M3 = 93
const MIN_LEG_NM = 0.25

function fmtTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const distNm = computed(() => {
  if (props.distMeters == null || !Number.isFinite(props.distMeters)) return null
  return props.distMeters / 1852
})

const odLegNm = computed(() => {
  if (props.legOdMeters == null || !Number.isFinite(props.legOdMeters)) return null
  return props.legOdMeters / 1852
})

const coveredNm = computed(() => {
  const leg = odLegNm.value
  const rem = distNm.value
  if (leg == null || rem == null || leg < MIN_LEG_NM) return null
  return Math.max(0, leg - rem)
})

const odProgressFraction = computed(() => {
  const leg = odLegNm.value
  const rem = distNm.value
  if (leg == null || rem == null || leg < MIN_LEG_NM) return null
  return Math.min(1, Math.max(0, (leg - rem) / leg))
})

const fillPct = computed(() => {
  if (typeof props.arrivedMs === 'number' && Number.isFinite(props.arrivedMs) && props.arrivedMs > 0) {
    return 100
  }
  const frac = odProgressFraction.value
  if (frac != null) {
    return Math.round(Math.min(100, Math.max(0, 100 * frac)))
  }
  const rem = distNm.value
  if (props.tripPhase === 'dispatched' && rem != null) {
    const cap = Math.max(15, props.denomNm)
    const raw = 100 * (1 - Math.min(1, Math.max(0, rem) / cap))
    return Math.round(Math.min(100, Math.max(5, raw)))
  }
  if (typeof props.assignedMs === 'number' && Number.isFinite(props.assignedMs) && props.assignedMs > 0) {
    const elapsed = Math.max(0, Date.now() - props.assignedMs)
    const hours = elapsed / (1000 * 60 * 60)
    const bump = Math.min(28, hours * 4)
    return Math.round(Math.min(44, Math.max(5, 8 + bump)))
  }
  return 8
})

const milestoneMeta = computed(() => {
  const arrivedKnown = typeof props.arrivedMs === 'number' && Number.isFinite(props.arrivedMs) && props.arrivedMs > 0
  return [
    { key: 'asg', abbr: 'Asg', leftPct: M1, time: fmtTime(props.assignedMs) },
    { key: 'dsp', abbr: 'Dsp', leftPct: M2, time: fmtTime(props.dispatchedMs) },
    { key: 'arv', abbr: 'Arr', leftPct: M3, time: arrivedKnown ? fmtTime(props.arrivedMs) : '—' },
  ]
})

const statsLine = computed(() => {
  const rem = distNm.value
  const leg = odLegNm.value
  const cov = coveredNm.value
  if (rem != null && leg != null && cov != null) {
    return `${rem.toFixed(1)} NM · ${cov.toFixed(1)}/${leg.toFixed(1)}`
  }
  if (rem != null) return `${rem.toFixed(1)} NM out`
  return null
})

const ariaProgress = computed(() => {
  if (typeof props.arrivedMs === 'number' && Number.isFinite(props.arrivedMs) && props.arrivedMs > 0) {
    return 'Arrived.'
  }
  const rem = distNm.value
  const leg = odLegNm.value
  const cov = coveredNm.value
  if (rem != null && leg != null && cov != null) {
    return `${rem.toFixed(1)} NM to destination; about ${cov.toFixed(1)} of ${leg.toFixed(1)} NM along the leg.`
  }
  if (props.tripPhase === 'dispatched' && rem != null) {
    return `${rem.toFixed(1)} NM to destination.`
  }
  return 'Leg progress; location data may be incomplete.'
})

const ariaGroupLabel = computed(() => {
  const m = milestoneMeta.value
  return `Leg progress. Asg ${m[0].time}, Dsp ${m[1].time}, Arr ${m[2].time}. ${ariaProgress.value}`
})
</script>

<template>
  <div class="trip-od-progress" role="group" :aria-label="ariaGroupLabel">
    <div class="trip-od-progress__top">
      <span class="trip-od-progress__title">Leg progress</span>
      <span v-if="statsLine != null" class="trip-od-progress__stats">{{ statsLine }}</span>
      <span v-else class="trip-od-progress__stats trip-od-progress__stats--muted">—</span>
    </div>

    <div class="trip-od-progress__track-block">
      <div class="trip-od-progress__track" aria-hidden="true">
        <div class="trip-od-progress__fill" :style="{ width: fillPct + '%' }" />
        <div
          v-for="m in milestoneMeta"
          :key="'t-' + m.key"
          class="trip-od-progress__tick"
          :style="{ left: m.leftPct + '%' }"
        />
      </div>
      <div class="trip-od-progress__caps" aria-hidden="true">
        <span
          v-for="m in milestoneMeta"
          :key="'c-' + m.key"
          class="trip-od-progress__cap"
          :class="'trip-od-progress__cap--' + m.key"
        >
          <span class="trip-od-progress__abbr">{{ m.abbr }}</span>
          <span class="trip-od-progress__time">{{ m.time }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trip-od-progress {
  margin-top: 0.4rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.07));
}

.trip-od-progress__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.28rem;
  min-height: 1.1rem;
}

.trip-od-progress__title {
  flex: 0 1 auto;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #8f8f9c);
  white-space: nowrap;
}

.trip-od-progress__stats {
  flex: 1 1 auto;
  text-align: right;
  font-size: 0.62rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-orange, #f97316);
  min-width: 0;
  line-height: 1.2;
}

.trip-od-progress__stats--muted {
  color: var(--color-text-tertiary, #7a7a88);
  font-weight: 500;
}

.trip-od-progress__track-block {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.trip-od-progress__track {
  position: relative;
  height: 5px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.28);
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.45);
  overflow: visible;
}

.trip-od-progress__fill {
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, #6d3ea3 0%, #c2410c 100%);
  opacity: 0.92;
  transition: width 0.38s cubic-bezier(0.33, 1, 0.68, 1);
  box-shadow: 0 0 6px rgba(109, 62, 163, 0.35);
}

.trip-od-progress__tick {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 9px;
  margin-top: -4px;
  transform: translateX(-50%);
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.42);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  z-index: 1;
}

.trip-od-progress__caps {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: start;
  gap: 0 0.15rem;
  font-size: 0.52rem;
  line-height: 1.15;
  color: var(--color-text-tertiary, #8b8b98);
}

.trip-od-progress__cap {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.trip-od-progress__cap--asg {
  text-align: left;
}
.trip-od-progress__cap--dsp {
  text-align: center;
}
.trip-od-progress__cap--arv {
  text-align: right;
}

.trip-od-progress__abbr {
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 0.5rem;
  color: var(--color-text-tertiary, #7e7e8c);
}

.trip-od-progress__time {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  font-size: 0.52rem;
  color: var(--color-text-secondary, #a8a8b8);
}
</style>
