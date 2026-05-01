/**
 * TomTom Traffic Raster tile key from Settings (localStorage only).
 * https://developer.tomtom.com/
 */
import { ref, computed } from 'vue'

const LS = 'fedextool_tomtom_traffic_key'

const override = ref('')

if (typeof window !== 'undefined') {
  try {
    const v = localStorage.getItem(LS)
    if (v) override.value = v.trim()
  } catch {
    /* private mode */
  }
}

export const trafficTomtomKeyOverride = override

/**
 * @param {string} key
 */
export function setTomtomTrafficKey(key) {
  const v = String(key ?? '').trim()
  if (typeof window === 'undefined') {
    override.value = v
    return
  }
  try {
    if (v) {
      localStorage.setItem(LS, v)
    } else {
      localStorage.removeItem(LS)
    }
  } catch {
    /* ignore */
  }
  override.value = v
}

/**
 * @returns {string}
 */
export function getTomtomKeyEffective() {
  return override.value
}

export const tomtomKeyEffective = computed(() => override.value)
