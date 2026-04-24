import { ref, computed } from 'vue'
import {
  getInAppNotifications,
  postInAppMarkRead,
} from '../api.js'

/** @typedef {{ id: string, message: string, type?: string, source?: string, ts: number, read?: boolean, extra?: object }} InAppItem */

const items = ref(/** @type {InAppItem[]} */ ([]))
const toasts = ref(/** @type {Array<{ id: string, message: string, ts: number }> */ ([]))
const menuOpen = ref(false)
const loading = ref(false)

const unreadCount = computed(
  () => items.value.filter((i) => i && !i.read).length,
)

const MAX_TOASTS = 3

/**
 * @param {InAppItem} raw
 */
export function pushInAppFromStream(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return
  const m = String(raw.message || '').trim()
  if (!m) return
  const n = {
    id: String(raw.id),
    message: m,
    type: raw.type,
    source: raw.source,
    ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
    read: String(raw.read) === 'true' || raw.read === true,
    extra: raw.extra,
  }
  const list = [n, ...items.value.filter((x) => x.id !== n.id)]
  items.value = list.slice(0, 100)
  toasts.value = [
    { id: n.id, message: m, ts: n.ts },
    ...toasts.value.filter((t) => t.id !== n.id).slice(0, MAX_TOASTS - 1),
  ]
}

/**
 * @param {string} id
 */
function dismissToast(id) {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

export async function fetchInAppInbox() {
  loading.value = true
  try {
    const d = await getInAppNotifications()
    if (d && Array.isArray(d.items)) {
      items.value = d.items
    }
  } catch {
    /* unauth or offline */
  } finally {
    loading.value = false
  }
}

/**
 * @param {string} id
 */
export async function markInAppItemRead(id) {
  if (!id) return
  try {
    const d = await postInAppMarkRead({ id })
    if (d && Array.isArray(d.items)) {
      items.value = d.items
    }
  } catch {
    /* */
  } finally {
    dismissToast(id)
  }
}

export async function markInAppAllRead() {
  try {
    const d = await postInAppMarkRead({ all: true })
    if (d && Array.isArray(d.items)) {
      items.value = d.items
    }
  } catch {
    /* */
  } finally {
    toasts.value = []
  }
}

export {
  items,
  toasts,
  menuOpen,
  loading,
  unreadCount,
  dismissToast,
}
