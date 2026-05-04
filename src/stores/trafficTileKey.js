/**
 * Traffic API keys: primary source is the signed-in user profile (PostgreSQL via API).
 * localStorage mirrors the last known key for faster paint and offline-ish reuse.
 * 
 * Supports TomTom (legacy, for tiles), HERE (route monitoring), and 511NY (cameras).
 * https://developer.tomtom.com/
 * https://platform.here.com/
 * https://511ny.org/developers/
 */
import { ref, computed } from 'vue'

// TomTom key (legacy - used for traffic tiles)
const LS_TOMTOM = 'fedextool_tomtom_traffic_key'
const tomtomOverride = ref('')

// HERE key (new - used for route monitoring)
const LS_HERE = 'fedextool_here_api_key'
const hereOverride = ref('')

// 511NY key (new - used for bridge cameras)
const LS_NY511 = 'fedextool_ny511_api_key'
const ny511Override = ref('')

if (typeof window !== 'undefined') {
  try {
    const tomtomVal = localStorage.getItem(LS_TOMTOM)
    if (tomtomVal) tomtomOverride.value = tomtomVal.trim()
    
    const hereVal = localStorage.getItem(LS_HERE)
    if (hereVal) hereOverride.value = hereVal.trim()
    
    const ny511Val = localStorage.getItem(LS_NY511)
    if (ny511Val) ny511Override.value = ny511Val.trim()
  } catch {
    /* private mode */
  }
}

// TomTom exports (legacy compatibility)
export const trafficTomtomKeyOverride = tomtomOverride

/**
 * @param {string} key
 */
export function setTomtomTrafficKey(key) {
  const v = String(key ?? '').trim()
  if (typeof window === 'undefined') {
    tomtomOverride.value = v
    return
  }
  try {
    if (v) {
      localStorage.setItem(LS_TOMTOM, v)
    } else {
      localStorage.removeItem(LS_TOMTOM)
    }
  } catch {
    /* ignore */
  }
  tomtomOverride.value = v
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
  return tomtomOverride.value
}

export const tomtomKeyEffective = computed(() => tomtomOverride.value)

// HERE exports (new)
export const hereApiKeyOverride = hereOverride

/**
 * @param {string} key
 */
export function setHereApiKey(key) {
  const v = String(key ?? '').trim()
  if (typeof window === 'undefined') {
    hereOverride.value = v
    return
  }
  try {
    if (v) {
      localStorage.setItem(LS_HERE, v)
    } else {
      localStorage.removeItem(LS_HERE)
    }
  } catch {
    /* ignore */
  }
  hereOverride.value = v
}

/**
 * Load encrypted-stored HERE key for the current session into memory + localStorage.
 * Safe to call when not logged in (no-op).
 */
export async function hydrateHereApiKeyFromServer() {
  if (typeof window === 'undefined') return
  try {
    const r = await fetch('/api/settings/credentials?includeHereApiKey=1', {
      credentials: 'include',
    })
    if (!r.ok) return
    const data = await r.json().catch(() => ({}))
    if (typeof data.hereApiKey === 'string') {
      setHereApiKey(data.hereApiKey)
    }
  } catch {
    /* ignore */
  }
}

/**
 * @returns {string}
 */
export function getHereKeyEffective() {
  return hereOverride.value
}

export const hereKeyEffective = computed(() => hereOverride.value)

// 511NY exports (for bridge cameras)
export const ny511ApiKeyOverride = ny511Override

/**
 * @param {string} key
 */
export function setNy511ApiKey(key) {
  const v = String(key ?? '').trim()
  if (typeof window === 'undefined') {
    ny511Override.value = v
    return
  }
  try {
    if (v) {
      localStorage.setItem(LS_NY511, v)
    } else {
      localStorage.removeItem(LS_NY511)
    }
  } catch {
    /* ignore */
  }
  ny511Override.value = v
}

/**
 * Load encrypted-stored 511NY key for the current session into memory + localStorage.
 * Safe to call when not logged in (no-op).
 */
export async function hydrateNy511ApiKeyFromServer() {
  if (typeof window === 'undefined') return
  try {
    const r = await fetch('/api/settings/credentials?includeNy511ApiKey=1', {
      credentials: 'include',
    })
    if (!r.ok) return
    const data = await r.json().catch(() => ({}))
    if (typeof data.ny511ApiKey === 'string') {
      setNy511ApiKey(data.ny511ApiKey)
    }
  } catch {
    /* ignore */
  }
}

/**
 * @returns {string}
 */
export function getNy511KeyEffective() {
  return ny511Override.value
}

export const ny511KeyEffective = computed(() => ny511Override.value)

/**
 * Hydrate all traffic API keys from server.
 */
export async function hydrateAllTrafficKeysFromServer() {
  await Promise.all([
    hydrateTomtomTrafficKeyFromServer(),
    hydrateHereApiKeyFromServer(),
    hydrateNy511ApiKeyFromServer(),
  ])
}
