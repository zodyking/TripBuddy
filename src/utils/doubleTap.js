/**
 * Distinguish single vs double tap on the same target (touch + mouse).
 * @param {{
 *   onSingle: () => void,
 *   onDouble: () => void,
 *   delayMs?: number,
 * }} handlers
 */
export function createDoubleTapHandlers(handlers) {
  const delay = Math.max(200, Number(handlers.delayMs) || 320)
  /** @type {{ key: string, at: number, timer: ReturnType<typeof setTimeout> } | null} */
  let pending = null

  /**
   * @param {string} key stable id per row (e.g. chat id)
   */
  function onTap(key) {
    const now = Date.now()
    if (pending?.key === key && now - pending.at < delay) {
      clearTimeout(pending.timer)
      pending = null
      handlers.onDouble()
      return
    }
    if (pending?.timer) clearTimeout(pending.timer)
    const timer = setTimeout(() => {
      pending = null
      handlers.onSingle()
    }, delay)
    pending = { key, at: now, timer }
  }

  function cancelPending() {
    if (pending?.timer) clearTimeout(pending.timer)
    pending = null
  }

  return { onTap, cancelPending }
}
