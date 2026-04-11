import { ref, onMounted, onUnmounted } from 'vue'
import { getHealth } from '../api.js'
import { reconnectLiveLogStream } from '../stores/liveLogStore.js'

/** Shared API reachability; updated by {@link useApiHealth} polling only. */
export const apiOk = ref(null)

const recoverListeners = new Set()
let pollTimer = null
let shellMountCount = 0

/**
 * Register a callback when API transitions offline → online (e.g. reconnect SSE).
 * @param {() => void} cb
 * @returns {() => void} unregister
 */
export function registerApiRecover(cb) {
  recoverListeners.add(cb)
  return () => recoverListeners.delete(cb)
}

export async function refreshHealth() {
  try {
    await getHealth()
    const wasDown = apiOk.value === false
    apiOk.value = true
    if (wasDown) {
      for (const fn of recoverListeners) {
        try {
          fn()
        } catch {
          /* ignore listener errors */
        }
      }
    }
  } catch {
    apiOk.value = false
  }
}

const API_WAIT_STEP_MS = 350

/**
 * Wait until the Fastify API answers /api/health (Vite may have just spawned it).
 * Reconnects the live log SSE when the API is reachable.
 * @param {number} [maxWaitMs]
 * @returns {Promise<boolean>}
 */
export async function ensureFedexApiReady(maxWaitMs = 45_000) {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await refreshHealth()
    if (apiOk.value === true) {
      reconnectLiveLogStream()
      return true
    }
    await new Promise((r) => setTimeout(r, API_WAIT_STEP_MS))
  }
  return false
}

/**
 * Start/stop health polling with the app shell lifecycle (call once from AppShell).
 * @returns {{ apiOk: import('vue').Ref<boolean|null>, refreshHealth: typeof refreshHealth }}
 */
export function useApiHealth() {
  onMounted(() => {
    shellMountCount += 1
    if (shellMountCount === 1) {
      void refreshHealth()
      pollTimer = setInterval(refreshHealth, 10_000)
    }
  })
  onUnmounted(() => {
    shellMountCount = Math.max(0, shellMountCount - 1)
    if (shellMountCount === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  })
  return { apiOk, refreshHealth }
}
