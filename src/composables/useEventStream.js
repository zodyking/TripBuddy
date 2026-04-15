import { ref, onMounted, onUnmounted } from 'vue'

/**
 * @param {{ onAssignment?: (data: object) => void, onLog?: (data: object) => void }} opts
 */
export function useEventStream(opts = {}) {
  const streamOk = ref(null)
  let es = null

  function connect() {
    if (es) es.close()
    es = new EventSource('/api/events', { withCredentials: true })
    streamOk.value = true
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data.type === 'assignment' && opts.onAssignment) opts.onAssignment(data)
        if (opts.onLog) opts.onLog(data)
      } catch {
        if (opts.onLog) opts.onLog({ type: 'parse', message: ev.data, ts: Date.now() })
      }
    }
    es.onerror = () => {
      streamOk.value = false
      if (opts.onLog) {
        opts.onLog({
          type: 'error',
          message: 'Live stream disconnected (is the API running on port 3847?)',
          ts: Date.now(),
        })
      }
    }
  }

  onMounted(() => connect())
  onUnmounted(() => {
    if (es) es.close()
  })

  return { streamOk, reconnect: connect }
}
