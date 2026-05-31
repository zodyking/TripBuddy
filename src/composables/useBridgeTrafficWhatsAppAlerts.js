/**
 * Detect red (heavy) / purple (standstill) bridge crossings and queue WhatsApp preview.
 */
import { ref, watch } from 'vue'
import {
  bridgeAlertKindForTraffic,
  buildBridgeTrafficAlertMessage,
  canOfferBridgeTrafficAlert,
  markBridgeTrafficAlertOffered,
} from '../utils/bridgeTrafficWhatsAppAlert.js'
import {
  openBridgeTrafficAlertPreview,
  bridgeTrafficAlertPreviewOpen,
} from '../stores/bridgeTrafficAlertStore.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {Map<string, string>} */
const lastLevelByRoute = new Map()

/** @type {{ row: unknown, kind: import('../utils/bridgeTrafficWhatsAppAlert.js').BridgeTrafficAlertKind, routeId: string }[]} */
const pendingQueue = []

let preparing = false
let queueRunning = false

/**
 * @param {{
 *   rankedRows: import('vue').ComputedRef<unknown[]> | import('vue').Ref<unknown[]>,
 *   rowRouteId: (row: unknown) => string,
 *   displayTitle: (row: unknown) => string,
 *   trafficLevelForRow: (row: unknown) => string,
 *   delayTierForRow: (row: unknown) => string,
 *   isClosedRow: (row: unknown) => boolean,
 *   captureBridgeTileImage?: (row: unknown) => Promise<Blob | null>,
 *   viewMode?: import('vue').ComputedRef<string> | import('vue').Ref<string>,
 *   crossingsReady?: import('vue').ComputedRef<boolean> | import('vue').Ref<boolean>,
 *   travelDirection?: import('vue').ComputedRef<'ToNY' | 'ToNJ'> | import('vue').Ref<'ToNY' | 'ToNJ'>,
 * }} hooks
 */
export function useBridgeTrafficWhatsAppAlerts(hooks) {
  const bootstrapped = ref(false)
  const scanScheduled = ref(false)

  function crossingsActive() {
    if (hooks.viewMode?.value && hooks.viewMode.value !== 'crossings') return false
    if (hooks.crossingsReady?.value === false) return false
    return true
  }

  /**
   * @param {unknown} row
   * @param {import('../utils/bridgeTrafficWhatsAppAlert.js').BridgeTrafficAlertKind} kind
   */
  function enqueueAlert(row, kind) {
    const routeId = hooks.rowRouteId(row)
    if (!routeId || !kind) return
    if (!canOfferBridgeTrafficAlert(routeId)) return
    if (pendingQueue.some((q) => q.routeId === routeId)) return
    pendingQueue.push({ row, kind, routeId })
    void processQueue()
  }

  async function processQueue() {
    if (queueRunning || preparing || bridgeTrafficAlertPreviewOpen.value) return
    if (!crossingsActive()) return
    queueRunning = true
    try {
      while (pendingQueue.length > 0) {
        if (bridgeTrafficAlertPreviewOpen.value || preparing) break
        const next = pendingQueue.shift()
        if (!next) continue
        if (!canOfferBridgeTrafficAlert(next.routeId)) continue
        const opened = await preparePreview(next.row, next.kind)
        if (opened) break
      }
    } finally {
      queueRunning = false
    }
  }

  /**
   * @param {unknown} row
   * @param {import('../utils/bridgeTrafficWhatsAppAlert.js').BridgeTrafficAlertKind} kind
   * @returns {Promise<boolean>} true if preview opened
   */
  async function preparePreview(row, kind) {
    const routeId = hooks.rowRouteId(row)
    if (!routeId || preparing || bridgeTrafficAlertPreviewOpen.value) return false
    if (!crossingsActive()) return false
    if (!canOfferBridgeTrafficAlert(routeId)) return false

    preparing = true
    try {
      const bridgeName = hooks.displayTitle(row)
      const o = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {}
      const crossingMin =
        o.routeTravelTime != null && !o.isCrossingClosed ? String(o.routeTravelTime) : '—'
      const travelDirection =
        o.travelDirection ?? hooks.travelDirection?.value ?? ''
      const message = buildBridgeTrafficAlertMessage(bridgeName, kind, {
        crossingMin,
        travelDirection,
      })

      let blob = null
      if (typeof hooks.captureBridgeTileImage === 'function') {
        for (let attempt = 0; attempt < 4 && !blob; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 350 * attempt))
          }
          blob = await hooks.captureBridgeTileImage(row)
        }
      }

      if (!blob) {
        pushLiveLog({
          type: 'warn',
          message: `[Bridge alert] Could not capture card for ${bridgeName} — try scrolling the list`,
          ts: Date.now(),
        })
        return false
      }

      markBridgeTrafficAlertOffered(routeId)
      const imageUrl = URL.createObjectURL(blob)
      openBridgeTrafficAlertPreview({
        routeId,
        bridgeName,
        alertKind: kind,
        message,
        imageUrl,
        imageBlob: blob,
      })
      return true
    } catch (e) {
      pushLiveLog({
        type: 'warn',
        message: `[Bridge alert] Preview failed: ${e instanceof Error ? e.message : String(e)}`,
        ts: Date.now(),
      })
      return false
    } finally {
      preparing = false
    }
  }

  /**
   * @param {unknown[]} rows
   * @param {{ includeActive?: boolean, includeTransitions?: boolean }} opts
   */
  function collectAlerts(rows, opts = {}) {
    const includeActive = opts.includeActive !== false
    const includeTransitions = opts.includeTransitions !== false
    if (!Array.isArray(rows)) return

    for (const row of rows) {
      if (hooks.isClosedRow(row)) continue
      const routeId = hooks.rowRouteId(row)
      if (!routeId) continue

      const level = hooks.trafficLevelForRow(row)
      const tier = hooks.delayTierForRow(row)
      const prev = lastLevelByRoute.get(routeId) ?? ''
      lastLevelByRoute.set(routeId, level)

      const kind = bridgeAlertKindForTraffic(level, tier)
      if (!kind) continue

      let shouldQueue = false
      if (includeActive) {
        shouldQueue = true
      }
      if (includeTransitions) {
        const entered =
          kind === 'gridlock'
            ? prev !== 'standstill'
            : prev !== 'high' && prev !== 'standstill'
        if (entered) shouldQueue = true
      }

      if (shouldQueue) enqueueAlert(row, kind)
    }
  }

  function scheduleActiveScan() {
    if (scanScheduled.value || !crossingsActive()) return
    scanScheduled.value = true
    window.setTimeout(() => {
      scanScheduled.value = false
      if (!crossingsActive()) return
      const rows = hooks.rankedRows.value
      if (!Array.isArray(rows) || !rows.length) return
      collectAlerts(rows, { includeActive: true, includeTransitions: false })
    }, 600)
  }

  function evaluateRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return

    if (!bootstrapped.value) {
      for (const row of rows) {
        if (hooks.isClosedRow(row)) continue
        const routeId = hooks.rowRouteId(row)
        if (!routeId) continue
        lastLevelByRoute.set(routeId, hooks.trafficLevelForRow(row))
      }
      bootstrapped.value = true
      scheduleActiveScan()
      return
    }

    collectAlerts(rows, { includeActive: false, includeTransitions: true })
  }

  watch(
    () => hooks.rankedRows.value,
    (rows) => evaluateRows(rows),
    { deep: true },
  )

  watch(
    () => [
      hooks.crossingsReady?.value,
      hooks.viewMode?.value,
      hooks.rankedRows.value?.length ?? 0,
    ],
    () => {
      if (!bootstrapped.value) return
      if (!crossingsActive()) return
      scheduleActiveScan()
    },
  )

  watch(bridgeTrafficAlertPreviewOpen, (open, wasOpen) => {
    if (wasOpen && !open) {
      window.setTimeout(() => void processQueue(), 400)
    }
  })
}
