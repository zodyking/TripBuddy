import { ref } from 'vue'

/** Full-screen lock while server captures Linehaul bearer (Playwright). */
export const linehaulBearerCaptureOverlayVisible = ref(false)
/** 0–100; driven by time until the HTTP capture call completes. */
export const linehaulBearerCaptureProgress = ref(0)

/** @type {ReturnType<typeof setInterval> | null} */
let tickTimer = null

function clearTick() {
  if (tickTimer != null) {
    clearInterval(tickTimer)
    tickTimer = null
  }
}

/**
 * Show overlay and advance progress smoothly (no step labels — bar only).
 */
export function startLinehaulBearerCaptureOverlay() {
  clearTick()
  linehaulBearerCaptureOverlayVisible.value = true
  linehaulBearerCaptureProgress.value = 4
  const started = Date.now()
  tickTimer = setInterval(() => {
    const elapsed = Date.now() - started
    // Ease toward ~90% so completion can jump to 100%.
    const asym = 90 * (1 - Math.exp(-elapsed / 38_000))
    linehaulBearerCaptureProgress.value = Math.min(
      90,
      Math.max(linehaulBearerCaptureProgress.value, asym),
    )
  }, 160)
}

/**
 * @param {boolean} ok — false hides immediately; true fills bar then dismisses.
 */
export function finishLinehaulBearerCaptureOverlay(ok) {
  clearTick()
  if (ok) {
    linehaulBearerCaptureProgress.value = 100
    setTimeout(() => {
      linehaulBearerCaptureOverlayVisible.value = false
      linehaulBearerCaptureProgress.value = 0
    }, 380)
  } else {
    linehaulBearerCaptureOverlayVisible.value = false
    linehaulBearerCaptureProgress.value = 0
  }
}
