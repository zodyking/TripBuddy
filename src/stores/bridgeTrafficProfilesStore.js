import { ref } from 'vue'
import {
  BRIDGE_TRAFFIC_PROFILES,
  setBridgeTrafficProfileOverrides,
} from '../utils/bridgeTrafficProfiles.js'
import {
  getBridgeTrafficProfileSettings,
  putBridgeTrafficProfileSettings,
} from '../api.js'

export const bridgeProfilesLoading = ref(false)
export const bridgeProfilesSaveMsg = ref('')
export const bridgeProfilesSaveError = ref('')

/** @type {import('vue').Ref<Record<string, import('../utils/bridgeTrafficProfiles.js').BridgeTrafficProfile>>} */
export const bridgeProfileOverridesDraft = ref({})

let hydrated = false

/**
 * Load saved overrides and apply to classification engine.
 * @param {{ force?: boolean }} [opts]
 */
export async function hydrateBridgeTrafficProfilesFromServer(opts = {}) {
  if (hydrated && !opts.force) return
  bridgeProfilesLoading.value = true
  bridgeProfilesSaveError.value = ''
  try {
    const d = await getBridgeTrafficProfileSettings()
    const overrides =
      d?.overrides && typeof d.overrides === 'object' ? d.overrides : {}
    bridgeProfileOverridesDraft.value = { ...overrides }
    setBridgeTrafficProfileOverrides(overrides)
    hydrated = true
  } catch {
    setBridgeTrafficProfileOverrides({})
    bridgeProfileOverridesDraft.value = {}
  } finally {
    bridgeProfilesLoading.value = false
  }
}

/**
 * @param {Record<string, import('../utils/bridgeTrafficProfiles.js').BridgeTrafficProfile>} overrides
 */
export async function saveBridgeTrafficProfileOverrides(overrides) {
  bridgeProfilesSaveMsg.value = ''
  bridgeProfilesSaveError.value = ''
  bridgeProfilesLoading.value = true
  try {
    const d = await putBridgeTrafficProfileSettings({ overrides })
    const saved =
      d?.overrides && typeof d.overrides === 'object' ? d.overrides : overrides
    bridgeProfileOverridesDraft.value = { ...saved }
    setBridgeTrafficProfileOverrides(saved)
    bridgeProfilesSaveMsg.value = 'Thresholds saved.'
    return true
  } catch (e) {
    bridgeProfilesSaveError.value = e instanceof Error ? e.message : String(e)
    return false
  } finally {
    bridgeProfilesLoading.value = false
  }
}

/** Defaults for settings UI (read-only reference). */
export function bridgeTrafficProfileDefaults() {
  return BRIDGE_TRAFFIC_PROFILES
}
