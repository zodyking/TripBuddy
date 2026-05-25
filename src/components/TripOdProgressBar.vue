<script setup>
import { computed } from 'vue'

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

const fillPct = computed(() => {
  if (arrivedDone.value) return 100
  const leg = legMeters.value
  const d = distMetersSafe.value
  if (leg != null && leg > 0 && d != null) {
    const cov = Math.max(0, Math.min(leg, leg - d))
    const pct = Math.round(Math.min(100, Math.max(4, (100 * cov) / leg)))
    return Number.isFinite(pct) ? pct : 6
  }
  const dNm = distNm.value
  if (dNm != null) {
    const cap = Math.max(15, Number(props.denomNm) || 180)
    const raw = 100 * (1 - Math.min(1, Math.max(0, dNm) / cap))
    const pct = Math.round(Math.min(100, Math.max(5, raw)))
    return Number.isFinite(pct) ? pct : 6
  }
  const ph = String(props.tripPhase ?? '').toLowerCase()
  if (ph === 'dispatched') return 38
  if (ph === 'assigned') return 12
  return 6
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
  const out = [{ key: 'asg', abbr: 'ASG', label: 'Assigned', time: fmtTime(a0), leftPct: 4 }]
  const pD = pct(props.dispatchedMs)
  if (pD != null) {
    out.push({ key: 'dsp', abbr: 'DSP', label: 'Dispatched', time: fmtTime(props.dispatchedMs), leftPct: pD })
  }
  const pA = pct(props.arrivedMs)
  if (pA != null) {
    out.push({ key: 'arr', abbr: 'ARR', label: 'Arrived', time: fmtTime(props.arrivedMs), leftPct: pA })
  }
  return out
})

function onOpenMap() {
  if (!props.mapAvailable) return
  emit('open-map')
}
</script>

<template>
  <div class="trip-od-progress" role="group" :aria-label="ariaGroupLabel">
    <button
      type="button"
      class="trip-od-progress__hit tap"
      :disabled="!mapAvailable"
      :class="{ 'trip-od-progress__hit--active': mapAvailable }"
      :aria-label="
        mapAvailable
          ? 'Open map: origin, destination, route line, and your position when GPS is available'
          : 'Leg map unavailable until origin and destination coordinates load'
      "
      @click="onOpenMap"
    >
      <div class="trip-od-progress__head">
        <span class="trip-od-progress__title">Leg progress</span>
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
            <span class="trip-od-progress__marker-dot" :class="{ 'trip-od-progress__marker-dot--accent': m.key === 'asg' }" />
            <span class="trip-od-progress__marker-cap">
              <em :title="m.label">{{ m.abbr }}</em>
              <span>{{ m.time }}</span>
            </span>
          </div>
        </div>
      </div>
    </button>
    <p v-if="mapAvailable" class="trip-od-progress__hint">Tap bar for map</p>
  </div>
</template>

<style scoped>
.trip-od-progress {
  margin-top: 0.65rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.trip-od-progress__hit {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.35rem 0 0.15rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: transparent;
  text-align: left;
  cursor: default;
  color: inherit;
}

.trip-od-progress__hit--active {
  cursor: pointer;
}

.trip-od-progress__hit--active:hover {
  background: rgba(255, 255, 255, 0.04);
}

.trip-od-progress__hit--active:active {
  background: rgba(255, 255, 255, 0.07);
}

.trip-od-progress__hit:disabled {
  opacity: 1;
}

.trip-od-progress__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.trip-od-progress__title {
  font-size: var(--text-xs, 0.72rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #8b8b98);
}

.trip-od-progress__stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.28rem;
  white-space: nowrap;
}

.trip-od-progress__ratio {
  font-size: var(--text-xs, 0.78rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-accent-orange, #ff6b1a);
}

.trip-od-progress__ratio--muted {
  color: var(--color-text-tertiary, #8b8b98);
  font-weight: 600;
}

.trip-od-progress__unit {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #9a9aa8);
}

.trip-od-progress__unit--muted {
  opacity: 0.85;
}

.trip-od-progress__viz {
  position: relative;
  padding-bottom: 2.35rem;
}

.trip-od-progress__track {
  position: relative;
  height: 14px;
  border-radius: var(--radius-full, 9999px);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.07) 0%,
    var(--color-glass, rgba(22, 22, 29, 0.65)) 40%,
    rgba(0, 0, 0, 0.25) 100%
  );
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.45);
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
    0 0 14px rgba(123, 77, 181, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: width 0.5s var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
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
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--color-text-primary, #f4f4f8);
  border: 2px solid rgba(10, 10, 14, 0.65);
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.45);
}

.trip-od-progress__marker-dot--accent {
  background: var(--color-accent-orange, #ff6b1a);
  box-shadow: 0 0 0 2px rgba(255, 107, 26, 0.35);
}

.trip-od-progress__marker-cap {
  position: absolute;
  top: calc(50% + 11px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 3.25rem;
  text-align: center;
  font-size: 0.62rem;
  line-height: 1.15;
  color: var(--color-text-secondary, #c8c8d4);
}

.trip-od-progress__marker-cap em {
  font-style: normal;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary, #9a9aa8);
  font-size: 0.58rem;
}

.trip-od-progress__hint {
  margin: 0.2rem 0 0;
  font-size: 0.62rem;
  color: var(--color-text-tertiary, #7a7a88);
  letter-spacing: 0.02em;
}
</style>
