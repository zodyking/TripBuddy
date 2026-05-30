<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  assignedMs: { type: Number, default: null },
  dispatchedMs: { type: Number, default: null },
  arrivedMs: { type: Number, default: null },
  /** Truck → destination (m); null if no GPS / dest coords */
  distMeters: { type: Number, default: null },
  /** Origin → destination great-circle (m); drives covered/total NM ratio */
  legOdMeters: { type: Number, default: null },
  denomNm: { type: Number, default: 180 },
  /** @type {'none' | 'assigned' | 'dispatched' | string} */
  tripPhase: { type: String, default: 'none' },
  mapAvailable: { type: Boolean, default: false },
  /** When true, legs have changed and monotonic fill should reset. */
  legChangeTrigger: { type: [Number, String], default: '' },
})

const emit = defineEmits(['open-map'])

function fmtTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

const legMeters = computed(() => {
  const v = props.legOdMeters
  if (v == null || !Number.isFinite(v) || v <= 0) return null
  return v
})

const distMetersSafe = computed(() => {
  const v = props.distMeters
  if (v == null || !Number.isFinite(v) || v < 0) return null
  return v
})

const legNm = computed(() => {
  const m = legMeters.value
  if (m == null) return null
  return m / 1852
})

const distNm = computed(() => {
  const m = distMetersSafe.value
  if (m == null) return null
  return m / 1852
})

const arrivedDone = computed(() => {
  const a = props.arrivedMs
  return typeof a === 'number' && Number.isFinite(a) && a > 0
})

/** Remaining NM for display. */
const remainingNm = computed(() => {
  const m = distMetersSafe.value
  if (m == null) return null
  return m / 1852
})

const remainingNmDisplay = computed(() => {
  const nm = remainingNm.value
  if (nm == null) return null
  return `${nm.toFixed(1)} NM left`
})

/** Covered NM along leg heuristic: leg − remaining-to-dest, clamped. */
const coveredNm = computed(() => {
  if (arrivedDone.value && legNm.value != null) return legNm.value
  const leg = legMeters.value
  const d = distMetersSafe.value
  if (leg == null || d == null) return null
  const nm = Math.max(0, Math.min(leg, leg - d)) / 1852
  return nm
})

const nmRatioText = computed(() => {
  const leg = legNm.value
  if (leg == null || leg <= 0) return null
  const cov = coveredNm.value
  if (cov == null) return null
  return `${cov.toFixed(1)}/${leg.toFixed(1)}`
})

const ariaTailDist = computed(() => {
  const d = distNm.value
  if (d == null) return 'distance unknown'
  return `${d.toFixed(1)} nautical miles remaining to destination`
})

const ariaGroupLabel = computed(
  () => `Leg progress. ${nmRatioText.value ? `${nmRatioText.value} nautical miles covered of leg total` : 'Mileage ratio unavailable'}. ${ariaTailDist.value}.`,
)

/** Whether trip has been dispatched (fill only moves after dispatch). */
const isDispatched = computed(() => {
  const d = props.dispatchedMs
  return typeof d === 'number' && Number.isFinite(d) && d > 0
})

/** Computed raw fill pct before monotonic enforcement.
 *  Fill only moves between DSP and ARR - before dispatch stays at ~4% (ASG marker area).
 */
const fillPctRaw = computed(() => {
  if (arrivedDone.value) return 100

  // Before dispatch: no mileage-based progress, stay near ASG marker
  if (!isDispatched.value) {
    return 4
  }

  // After dispatch: GPS-based progress scales from ~4% (DSP position) to 100% (ARR)
  const leg = legMeters.value
  const d = distMetersSafe.value
  if (leg != null && leg > 0 && d != null) {
    const cov = Math.max(0, Math.min(leg, leg - d))
    const rawPct = (100 * cov) / leg
    // Scale so 0% distance covered = 4%, 100% covered = 100%
    const pct = Math.round(4 + (rawPct * 96) / 100)
    return Math.min(100, Math.max(4, pct))
  }
  const dNm = distNm.value
  if (dNm != null) {
    const cap = Math.max(15, Number(props.denomNm) || 180)
    const rawPct = 100 * (1 - Math.min(1, Math.max(0, dNm) / cap))
    const pct = Math.round(4 + (rawPct * 96) / 100)
    return Math.min(100, Math.max(4, pct))
  }
  // Phase fallback after dispatch but no GPS yet
  return 4
})

/** Monotonic fill: never go backward from GPS noise. */
const maxFillPctSeen = ref(0)

/** Reset monotonic max on leg change. */
watch(
  () => props.legChangeTrigger,
  () => {
    maxFillPctSeen.value = 0
  },
)

/** Also reset on arrival reset (arrivedMs going from truthy to null). */
watch(
  () => props.arrivedMs,
  (newVal, oldVal) => {
    if (oldVal != null && newVal == null) {
      maxFillPctSeen.value = 0
    }
  },
)

const fillPct = computed(() => {
  const raw = fillPctRaw.value
  if (arrivedDone.value) {
    maxFillPctSeen.value = 100
    return 100
  }
  if (raw > maxFillPctSeen.value) {
    maxFillPctSeen.value = raw
  }
  return maxFillPctSeen.value
})

/** Fixed marker positions: ASG/DSP grouped at start, ARR at end (always visible). */
const MARKER_ASG_PCT = 4
const MARKER_DSP_PCT = 14
const MARKER_ARR_PCT = 96

const markerStyle = computed(() => {
  const a0 = props.assignedMs
  const hasAssigned = typeof a0 === 'number' && Number.isFinite(a0) && a0 > 0
  return [
    {
      key: 'asg',
      abbr: 'ASG',
      label: 'Assigned',
      time: hasAssigned ? fmtTime(a0) : '—',
      leftPct: MARKER_ASG_PCT,
    },
    {
      key: 'dsp',
      abbr: 'DSP',
      label: 'Dispatched',
      time: fmtTime(props.dispatchedMs),
      leftPct: MARKER_DSP_PCT,
    },
    {
      key: 'arr',
      abbr: 'ARR',
      label: 'Arrived',
      time: fmtTime(props.arrivedMs),
      leftPct: MARKER_ARR_PCT,
    },
  ]
})

function onOpenMap() {
  if (!props.mapAvailable) return
  emit('open-map')
}
</script>

<template>
  <div class="trip-od-progress" role="group" :aria-label="ariaGroupLabel">
    <div class="trip-od-progress__head">
      <span v-if="remainingNmDisplay" class="trip-od-progress__remaining">{{ remainingNmDisplay }}</span>
      <span v-else class="trip-od-progress__remaining trip-od-progress__remaining--muted">— NM left</span>
      <div class="trip-od-progress__head-right">
        <span class="trip-od-progress__stat" aria-hidden="true">
          <template v-if="nmRatioText">
            <span class="trip-od-progress__ratio">{{ nmRatioText }}</span>
            <span class="trip-od-progress__unit">NM</span>
          </template>
          <template v-else>
            <span class="trip-od-progress__ratio trip-od-progress__ratio--muted">—/—</span>
            <span class="trip-od-progress__unit trip-od-progress__unit--muted">NM</span>
          </template>
        </span>
        <button
          v-if="mapAvailable"
          type="button"
          class="trip-od-progress__map-btn tap"
          aria-label="Open leg route map"
          title="Leg route map"
          @click.stop="onOpenMap"
        >
          <svg class="trip-od-progress__map-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM10 5.47l4 1.4v11.66l-4-1.4V5.47zm-5 .99l3-1.01v11.7l-3 1.16V6.46zm14 11.08l-3 1.01V6.46l3-1.01v11.08z"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="trip-od-progress__viz" aria-hidden="true">
      <div class="trip-od-progress__track">
        <div class="trip-od-progress__fill" :style="{ width: fillPct + '%' }" />
        <div
          v-for="m in markerStyle"
          :key="m.key"
          class="trip-od-progress__marker"
          :style="{ left: m.leftPct + '%' }"
        >
          <span
            class="trip-od-progress__marker-dot"
            :class="{ 'trip-od-progress__marker-dot--accent': m.key === 'asg' }"
          />
          <span class="trip-od-progress__marker-cap">
            <em :title="m.label">{{ m.abbr }}</em>
            <span>{{ m.time }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trip-od-progress {
  margin-top: 0.4rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.trip-od-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
}

.trip-od-progress__remaining {
  font-size: 1.05rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-orange, #ff6b1a);
  letter-spacing: 0.01em;
  line-height: 1.1;
}

.trip-od-progress__remaining--muted {
  color: var(--color-text-tertiary, #8b8b98);
  font-weight: 700;
}

.trip-od-progress__head-right {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.trip-od-progress__stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  white-space: nowrap;
}

.trip-od-progress__ratio {
  font-size: 0.82rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary, #c8c8d4);
}

.trip-od-progress__ratio--muted {
  color: var(--color-text-tertiary, #8b8b98);
  font-weight: 600;
}

.trip-od-progress__unit {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #9a9aa8);
}

.trip-od-progress__unit--muted {
  opacity: 0.85;
}

.trip-od-progress__map-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-accent-purple-light, #c4b5fd);
  cursor: pointer;
}

.trip-od-progress__map-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  color: var(--color-text-primary, #f4f4f8);
}

.trip-od-progress__map-ico {
  width: 1.1rem;
  height: 1.1rem;
  display: block;
}

.trip-od-progress__viz {
  position: relative;
  padding-bottom: 1.6rem;
}

.trip-od-progress__track {
  position: relative;
  height: 16px;
  border-radius: var(--radius-full, 9999px);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.06) 0%,
    var(--color-glass, rgba(22, 22, 29, 0.65)) 40%,
    rgba(0, 0, 0, 0.25) 100%
  );
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
  overflow: visible;
}

.trip-od-progress__fill {
  height: 100%;
  border-radius: var(--radius-full, 9999px);
  background: linear-gradient(
    90deg,
    var(--color-accent-purple, #7b4db5) 0%,
    var(--color-accent-orange, #ff6b1a) 88%,
    #ffb38a 100%
  );
  box-shadow:
    0 0 12px rgba(123, 77, 181, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: width 0.25s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.trip-od-progress__marker {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.trip-od-progress__marker-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-text-primary, #f4f4f8);
  border: 1.5px solid rgba(10, 10, 14, 0.65);
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.4);
}

.trip-od-progress__marker-dot--accent {
  background: var(--color-accent-orange, #ff6b1a);
  box-shadow: 0 0 0 2px rgba(255, 107, 26, 0.32);
}

.trip-od-progress__marker-cap {
  position: absolute;
  top: calc(50% + 10px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 3.25rem;
  text-align: center;
  font-size: 0.65rem;
  line-height: 1.15;
  color: var(--color-text-secondary, #c8c8d4);
  font-weight: 600;
}

.trip-od-progress__marker-cap em {
  font-style: normal;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #9a9aa8);
  font-size: 0.62rem;
}
</style>
