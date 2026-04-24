import { ref } from 'vue'
import { pushInAppFromStream, fetchInAppInbox } from './inAppNotificationsStore.js'

const MAX_ENTRIES = 400
/** Persist at most this many lines to localStorage (quota safety). */
const PERSIST_MAX = 300
const STORAGE_KEY = 'fedextool-live-log-v1'
const PERSIST_DEBOUNCE_MS = 400

/** @type {ReturnType<typeof setTimeout> | null} */
let persistTimer = null

function normalizeStoredEntry(e) {
  if (!e || typeof e !== 'object') return null
  return {
    ...e,
    ts: typeof e.ts === 'number' ? e.ts : Date.now(),
    type: typeof e.type === 'string' ? e.type : 'info',
    message: typeof e.message === 'string' ? e.message : '',
  }
}

function loadPersistedEntries() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeStoredEntry)
      .filter(Boolean)
      .slice(-MAX_ENTRIES)
  } catch {
    return []
  }
}

function schedulePersist() {
  if (typeof localStorage === 'undefined') return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      const arr = liveLogEntries.value
      const toSave = arr.slice(-PERSIST_MAX)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {
      /* quota or private mode */
    }
  }, PERSIST_DEBOUNCE_MS)
}

/**
 * Dev: bypass Vite proxy (buffers SSE). Prod: same-origin path under BASE_URL.
 * Override API origin with VITE_API_ORIGIN (e.g. http://127.0.0.1:3847).
 */
export function getLiveEventsUrl() {
  if (import.meta.env.DEV) {
    // Same-origin via Vite proxy so session cookies (auth) are sent with EventSource.
    return '/api/events'
  }
  const b = import.meta.env.BASE_URL || '/'
  if (b === '/' || b === '') return '/api/events'
  return `${b.replace(/\/$/, '')}/api/events`
}

/** @type {import('vue').Ref<object[]>} */
export const liveLogEntries = ref(loadPersistedEntries())

/** @type {Set<(data: object) => void>} */
const assignmentListeners = new Set()

/** @type {Set<(data: object) => void>} */
const sessionListeners = new Set()

/** @type {EventSource | null} */
let eventSource = null

/** Throttle repeated EventSource error spam while the API is still starting. */
let lastStreamErrorLoggedAt = 0
const STREAM_ERROR_LOG_COOLDOWN_MS = 12_000

/**
 * Append a log line (server SSE or client-side). Same shape as before: type, message, ts, …
 * @param {object} entry
 */
export function pushLiveLog(entry) {
  if (!entry || typeof entry !== 'object') return
  const normalized = {
    ...entry,
    ts: entry.ts ?? Date.now(),
    type: entry.type ?? 'info',
    message: entry.message ?? '',
  }
  liveLogEntries.value = [
    ...liveLogEntries.value.slice(-(MAX_ENTRIES - 1)),
    normalized,
  ]
  schedulePersist()
}

/** Clear on-screen log and remove persisted copy. */
export function clearLiveLog() {
  liveLogEntries.value = []
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {(data: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function registerAssignmentListener(fn) {
  assignmentListeners.add(fn)
  return () => assignmentListeners.delete(fn)
}

/**
 * @param {(data: object) => void} fn
 * @returns {() => void}
 */
export function registerSessionListener(fn) {
  sessionListeners.add(fn)
  return () => sessionListeners.delete(fn)
}

function notifySessionListeners(data) {
  for (const fn of sessionListeners) {
    try {
      fn(data)
    } catch {
      /* ignore */
    }
  }
}

function notifyAssignment(data) {
  for (const fn of assignmentListeners) {
    try {
      fn(data)
    } catch {
      /* ignore listener errors */
    }
  }
}

export function connectLiveLogStream() {
  if (typeof EventSource === 'undefined') return
  if (eventSource) return

  const url = getLiveEventsUrl()
  eventSource = new EventSource(url)
  eventSource.onopen = () => {
    lastStreamErrorLoggedAt = 0
  }
  eventSource.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      if (data.type === 'session') {
        notifySessionListeners(data)
      }
      if (data.type === 'inapp' && data.id) {
        pushInAppFromStream(/** @type {any} */(data))
        if (data.source === 'dispatch') {
          notifyAssignment({ ...data, type: 'assignment', source: 'save' })
        }
      } else if (data.type === 'assignment') {
        notifyAssignment(data)
      }
      pushLiveLog(data)
    } catch {
      pushLiveLog({ type: 'parse', message: String(ev.data), ts: Date.now() })
    }
  }
  eventSource.onerror = () => {
    const now = Date.now()
    if (now - lastStreamErrorLoggedAt < STREAM_ERROR_LOG_COOLDOWN_MS) return
    lastStreamErrorLoggedAt = now
    pushLiveLog({
      type: 'error',
      message:
        'Live stream disconnected — waiting for API on port 3847 (autostarts with vite, or run npm run dev).',
      ts: now,
    })
  }
}

export function disconnectLiveLogStream() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

export function reconnectLiveLogStream() {
  disconnectLiveLogStream()
  connectLiveLogStream()
}
