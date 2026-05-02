/**
 * TomTom API key: primary source is the signed-in user profile (PostgreSQL via API).
 * localStorage mirrors the last known key for faster paint and offline-ish reuse.
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
 * Load encrypted-stored TomTom key for the current session into memory + localStorage.
 * Safe to call when not logged in (no-op).
 */
export async function hydrateTomtomTrafficKeyFromServer() {
  if (typeof window === 'undefined') return
  try {
    const r = await fetch('/api/settings/credentials?includeTomtomApiKey=1', {
      credentials: 'include',
    })
    if (!r.ok) return
    const data = await r.json().catch(() => ({}))
    const k = typeof data.tomtomApiKey === 'string' ? data.tomtomApiKey.trim() : ''
    if (k) setTomtomTrafficKey(k)
  } catch {
    /* ignore */
  }
}

/**
 * @returns {string}
 */
export function getTomtomKeyEffective() {
  return override.value
}

export const tomtomKeyEffective = computed(() => override.value)
