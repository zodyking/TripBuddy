import { ref, onBeforeUnmount } from 'vue'

const LONG_PRESS_MS = 550

/**
 * Map compass: tap toggles compass mode; long-press opens calibration (desktop).
 * Use {@link openCompassCalibration} from a dedicated control for reliable mobile access.
 */
export function useMapCompassLongPress() {
  const calibrationModalOpen = ref(false)
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null
  let suppressNextToggle = false

  function openCompassCalibration() {
    clearTimer()
    suppressNextToggle = false
    calibrationModalOpen.value = true
  }

  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onCompassPointerDown() {
    clearTimer()
    suppressNextToggle = false
    timer = setTimeout(() => {
      timer = null
      suppressNextToggle = true
      calibrationModalOpen.value = true
    }, LONG_PRESS_MS)
  }

  function onCompassPointerUp() {
    clearTimer()
  }

  /**
   * @param {() => void | Promise<void>} handler
   */
  function wrapCompassToggle(handler) {
    return async () => {
      if (suppressNextToggle) {
        suppressNextToggle = false
        return
      }
      await handler()
    }
  }

  onBeforeUnmount(() => clearTimer())

  return {
    calibrationModalOpen,
    openCompassCalibration,
    onCompassPointerDown,
    onCompassPointerUp,
    wrapCompassToggle,
  }
}
