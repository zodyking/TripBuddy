<script setup>
import { ref, watch, computed } from 'vue'
import {
  useCompassOrientation,
  setCompassHeadingOffset,
} from '../composables/useCompassOrientation.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** When true, keep device orientation listener after close (map compass mode on). */
  mapCompassModeActive: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const {
  smoothHeading,
  headingOffsetDeg,
  permissionState,
  errorMessage,
  isTracking,
  startTracking,
  stopTracking,
} = useCompassOrientation()

const wasTrackingWhenOpened = ref(false)

function close() {
  emit('update:modelValue', false)
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      if (!wasTrackingWhenOpened.value && !props.mapCompassModeActive) {
        stopTracking()
      }
      return
    }
    wasTrackingWhenOpened.value = isTracking.value
    if (!wasTrackingWhenOpened.value) {
      try {
        await startTracking()
      } catch {
        /* dialog still opens; heading may stay unavailable */
      }
    }
  },
)

const offsetSigned = computed(() => {
  const v = headingOffsetDeg.value
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return v > 180 ? v - 360 : v
})

function onOffsetSliderInput(/** @type {Event} */ e) {
  const t = /** @type {HTMLInputElement} */ (e.target)
  const raw = Number(t.value)
  if (!Number.isFinite(raw)) return
  setCompassHeadingOffset(Math.round(raw))
}

function nudgeOffset(delta) {
  let next = offsetSigned.value + delta
  next = Math.max(-180, Math.min(180, Math.round(next)))
  setCompassHeadingOffset(next)
}

function resetOffset() {
  setCompassHeadingOffset(0)
}

const headingDisplay = computed(() => {
  const h = smoothHeading.value
  if (h == null || !Number.isFinite(h)) return '—'
  return `${Math.round(h)}°`
})

const previewRotate = computed(() => {
  const h = smoothHeading.value
  if (h == null || !Number.isFinite(h)) return 'rotate(0deg)'
  return `rotate(${-h}deg)`
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.modelValue"
      class="cal-portal"
      role="presentation"
    >
      <div
        class="cal-backdrop tap"
        @click.self="close"
      />
      <div
        class="cal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-title"
      >
      <header class="cal-header">
        <h2 id="cal-title" class="cal-title">Compass calibration</h2>
        <button type="button" class="cal-close tap" aria-label="Close" @click="close">×</button>
      </header>

      <p class="cal-lead">
        Adjust the offset until the <strong>heading-up trailer map</strong> (when compass mode is on) matches how you
        are actually pointed on the ground. The ring preview uses the same bearing numbers as the live map — it is not
        tied to map road tiles. Tap the map compass to toggle heading-up mode; use the sliders button under the compass
        for this panel (press-and-hold on the compass also works on desktop).
      </p>

      <p v-if="permissionState === 'denied'" class="cal-warn" role="status">
        Compass permission denied — enable motion/orientation in device settings.
      </p>
      <p v-else-if="errorMessage" class="cal-warn" role="status">{{ errorMessage }}</p>

      <div class="cal-live">
        <div class="cal-live-label">Heading used for map</div>
        <div class="cal-heading-readout" aria-live="polite">{{ headingDisplay }}</div>
      </div>

      <div class="cal-preview-wrap" aria-hidden="true">
        <div class="cal-preview-ring">
          <div class="cal-preview-map" :style="{ transform: previewRotate }">
            <div class="cal-preview-grid" />
            <div class="cal-preview-road" />
          </div>
          <div class="cal-preview-chevron">▲</div>
        </div>
        <p class="cal-preview-caption">Preview — chevron is “forward”; grid rotates with compass</p>
      </div>

      <div class="cal-offset-block">
        <div class="cal-offset-head">
          <span class="cal-offset-label">Offset</span>
          <span class="cal-offset-value">{{ offsetSigned }}°</span>
        </div>
        <input
          class="cal-slider tap"
          type="range"
          min="-180"
          max="180"
          step="1"
          :value="offsetSigned"
          aria-valuemin="-180"
          aria-valuemax="180"
          :aria-valuenow="offsetSigned"
          aria-label="Heading offset in degrees"
          @input="onOffsetSliderInput"
        />
        <div class="cal-nudge-row">
          <button type="button" class="cal-nudge tap" @click="nudgeOffset(-5)">−5°</button>
          <button type="button" class="cal-nudge tap" @click="nudgeOffset(-1)">−1°</button>
          <button type="button" class="cal-nudge tap" @click="nudgeOffset(1)">+1°</button>
          <button type="button" class="cal-nudge tap" @click="nudgeOffset(5)">+5°</button>
        </div>
        <button type="button" class="cal-reset tap" @click="resetOffset">Reset offset to 0°</button>
      </div>

      <footer class="cal-footer">
        <button type="button" class="cal-done tap" @click="close">Done</button>
      </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Above dashboard overlays (e.g. trip-complete ~2147483000) and map popups */
.cal-portal {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  pointer-events: none;
}

.cal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.cal-dialog {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 1;
  transform: translate(-50%, -50%);
  width: min(22rem, calc(100vw - 1.5rem));
  max-height: min(90vh, 36rem);
  overflow: auto;
  padding: 1rem 1.1rem 1.1rem;
  border-radius: var(--radius-lg, 0.75rem);
  background: linear-gradient(165deg, #16161f 0%, #0c0c12 100%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  color: var(--color-text-primary, #f0f0f5);
  pointer-events: auto;
}

.cal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.cal-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.cal-close {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  margin: -0.25rem -0.35rem 0 0;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.cal-close:focus-visible {
  outline: 2px solid rgba(123, 77, 181, 0.9);
  outline-offset: 2px;
}

.cal-lead {
  margin: 0 0 0.85rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: rgba(200, 200, 215, 0.88);
}

.cal-warn {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.6rem;
  border-radius: var(--radius-md, 0.5rem);
  background: rgba(180, 90, 60, 0.2);
  border: 1px solid rgba(255, 140, 100, 0.35);
  font-size: 0.78rem;
  color: #ffc8b8;
}

.cal-live {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}

.cal-live-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(180, 180, 195, 0.85);
}

.cal-heading-readout {
  font-size: 1.35rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #a8e6ff;
}

.cal-preview-wrap {
  margin-bottom: 1rem;
}

.cal-preview-ring {
  position: relative;
  width: 11rem;
  height: 11rem;
  margin: 0 auto;
  border-radius: 50%;
  border: 2px solid rgba(123, 77, 181, 0.45);
  background: radial-gradient(circle at 50% 45%, #1e2430 0%, #0a0a10 72%);
  overflow: hidden;
}

.cal-preview-map {
  position: absolute;
  inset: -35%;
  transition: transform 0.12s ease-out;
  will-change: transform;
}

.cal-preview-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 14% 14%;
  opacity: 0.85;
}

.cal-preview-road {
  position: absolute;
  left: 50%;
  top: 15%;
  width: 18%;
  height: 70%;
  transform: translateX(-50%);
  border-radius: 0.2rem;
  background: linear-gradient(
    180deg,
    rgba(90, 140, 255, 0.35) 0%,
    rgba(60, 90, 160, 0.25) 100%
  );
  border: 1px solid rgba(140, 180, 255, 0.25);
}

.cal-preview-chevron {
  position: absolute;
  left: 50%;
  bottom: 0.55rem;
  transform: translateX(-50%);
  font-size: 1.25rem;
  color: #7b4db5;
  text-shadow: 0 0 12px rgba(123, 77, 181, 0.7);
  pointer-events: none;
}

.cal-preview-caption {
  margin: 0.45rem 0 0;
  text-align: center;
  font-size: 0.68rem;
  color: rgba(160, 160, 175, 0.9);
}

.cal-offset-block {
  padding-top: 0.25rem;
}

.cal-offset-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.35rem;
}

.cal-offset-label {
  font-size: 0.78rem;
  font-weight: 600;
}

.cal-offset-value {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: rgba(200, 210, 255, 0.95);
}

.cal-slider {
  width: 100%;
  height: 0.45rem;
  margin: 0.25rem 0 0.6rem;
  accent-color: #7b4db5;
  cursor: pointer;
}

.cal-nudge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.55rem;
}

.cal-nudge {
  flex: 1;
  min-width: 3.25rem;
  padding: 0.45rem 0.35rem;
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.cal-nudge:focus-visible,
.cal-reset:focus-visible,
.cal-done:focus-visible {
  outline: 2px solid rgba(123, 77, 181, 0.9);
  outline-offset: 2px;
}

.cal-reset {
  width: 100%;
  padding: 0.45rem;
  border-radius: var(--radius-md, 0.5rem);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  background: transparent;
  color: rgba(200, 200, 215, 0.95);
  font-size: 0.78rem;
  cursor: pointer;
}

.cal-footer {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
}

.cal-done {
  min-width: 6rem;
  padding: 0.55rem 1rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: linear-gradient(180deg, #8b5fd4 0%, #6b3fa8 100%);
  color: #fff;
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
}
</style>
