/**
 * Detect red (heavy) / purple (standstill) bridge crossings and queue WhatsApp preview.
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  bridgeAlertKindForTraffic,
  buildBridgeTrafficAlertMessage,
  canOfferBridgeTrafficAlert,
  markBridgeTrafficAlertOffered,
} from '../utils/bridgeTrafficWhatsAppAlert.js'
import {
  openBridgeTrafficAlertPreview,
  setBridgeTrafficAlertPreviewImage,
  bridgeTrafficAlertPreview,
  bridgeTrafficAlertPreviewOpen,
} from '../stores/bridgeTrafficAlertStore.js'
import { renderBridgeAlertPortraitBlob } from '../utils/bridgeAlertPortrait.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @type {Map<string, string>} */
const lastLevelByRoute = new Map()

/** @type {{ row: unknown, kind: import('../utils/bridgeTrafficWhatsAppAlert.js').BridgeTrafficAlertKind, routeId: string }[]} */
const pendingQueue = []

let preparing = false
let queueRunning = false
/** @type {ReturnType<typeof setInterval> | null} */
let retryScanTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let preparingSafetyTimer = null

/**
 * @param {{
 *   rankedRows: import('vue').ComputedRef<unknown[]> | import('vue').Ref<unknown[]>,
 *   rowRouteId: (row: unknown) => string,
 *   displayTitle: (row: unknown) => string,
 *   trafficLevelForRow: (row: unknown) => string,
 *   delayTierForRow: (row: unknown) => string,
 *   isClosedRow: (row: unknown) => boolean,
 *   seriesForRow?: (row: unknown) => Array<{ t?: number, m?: number, s?: number }>,
 *   bridgeChartStrokeColor?: (row: unknown) => string,
 *   trafficStatusTitle?: (row: unknown) => string,
 *   trendInfo?: (row: unknown) => { short: string },
 *   getBridgeCameraFeed?: (row: unknown) => unknown,
 *   captureBridgeTileImage?: (row: unknown) => Promise<Blob | null>,
 *   viewMode?: import('vue').ComputedRef<string> | import('vue').Ref<string>,
 *   crossingsReady?: import('vue').ComputedRef<boolean> | import('vue').Ref<boolean>,
 *   travelDirection?: import('vue').ComputedRef<'ToNY' | 'ToNJ'> | import('vue').Ref<'ToNY' | 'ToNJ'>,
 * }} hooks
 */
export function useBridgeTrafficWhatsAppAlerts(hooks) {
  const bootstrapped = ref(false)

  function crossingsActive() {
    if (hooks.viewMode?.value && hooks.viewMode.value !== 'crossings') return false
    if (hooks.crossingsReady?.value === false) return false
    return true
  }

  function clearPreparingSafetyTimer() {
    if (preparingSafetyTimer) {
      clearTimeout(preparingSafetyTimer)
      preparingSafetyTimer = null
    }
  }

  function armPreparingSafetyTimer() {
    clearPreparingSafetyTimer()
    preparingSafetyTimer = setTimeout(() => {
      preparing = false
      preparingSafetyTimer = null
      void processQueue()
    }, 45000)
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
   */
  async function captureImageForRow(row, kind) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 300))

    if (typeof hooks.captureBridgeTileImage === 'function') {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 350 * attempt))
        }
        const blob = await hooks.captureBridgeTileImage(row)
        if (blob) return blob
      }
    }

    const bridgeName = hooks.displayTitle(row)
    const o = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {}
    const level = hooks.trafficLevelForRow(row)
    const crossingMin =
      o.routeTravelTime != null && !o.isCrossingClosed ? String(o.routeTravelTime) : '—'
    const speedMph = o.routeSpeed != null ? String(o.routeSpeed) : '—'
    try {
      return await renderBridgeAlertPortraitBlob({
        bridgeName,
        statusLabel: hooks.trafficStatusTitle?.(row) ?? '',
        crossingMin,
        speedMph,
        trendShort: hooks.trendInfo?.(row)?.short ?? '·',
        strokeColor: hooks.bridgeChartStrokeColor?.(row) ?? '#f87171',
        accentColor: level === 'standstill' ? '#a78bfa' : '#f87171',
        series: hooks.seriesForRow?.(row) ?? [],
        cameraFeed: hooks.getBridgeCameraFeed?.(row) ?? null,
      })
    } catch {
      return null
    }
  }

  /**
   * @param {unknown} row
   * @param {import('../utils/bridgeTrafficWhatsAppAlert.js').BridgeTrafficAlertKind} kind
   * @returns {Promise<boolean>}
   */
  async function preparePreview(row, kind) {
    const routeId = hooks.rowRouteId(row)
    if (!routeId || preparing || bridgeTrafficAlertPreviewOpen.value) return false
    if (!crossingsActive()) return false
    if (!canOfferBridgeTrafficAlert(routeId)) return false

    preparing = true
    armPreparingSafetyTimer()
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

      openBridgeTrafficAlertPreview({
        routeId,
        bridgeName,
        alertKind: kind,
        message,
        imageUrl: '',
        imageBlob: null,
        imageLoading: true,
      })
      markBridgeTrafficAlertOffered(routeId)

      void captureImageForRow(row, kind)
        .then((blob) => {
          if (bridgeTrafficAlertPreviewOpen.value && bridgeTrafficAlertPreview.value?.routeId === routeId) {
            setBridgeTrafficAlertPreviewImage(routeId, blob)
            if (!blob) {
              pushLiveLog({
                type: 'info',
                message: `[Bridge alert] Preview for ${bridgeName} — card snapshot unavailable`,
                ts: Date.now(),
              })
            }
          }
        })
        .catch((e) => {
          if (bridgeTrafficAlertPreviewOpen.value && bridgeTrafficAlertPreview.value?.routeId === routeId) {
            setBridgeTrafficAlertPreviewImage(routeId, null)
          }
          pushLiveLog({
            type: 'warn',
            message: `[Bridge alert] Image capture failed: ${e instanceof Error ? e.message : String(e)}`,
            ts: Date.now(),
          })
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
      clearPreparingSafetyTimer()
    }
  }

  /**
   * Queue every bridge currently in heavy / standstill state.
   */
  function scanActiveAlerts() {
    if (!crossingsActive()) return
    const rows = hooks.rankedRows.value
    if (!Array.isArray(rows) || !rows.length) return

    for (const row of rows) {
      if (hooks.isClosedRow(row)) continue
      const routeId = hooks.rowRouteId(row)
      if (!routeId) continue
      const level = hooks.trafficLevelForRow(row)
      const tier = hooks.delayTierForRow(row)
      lastLevelByRoute.set(routeId, level)
      const kind = bridgeAlertKindForTraffic(level, tier)
      if (kind) enqueueAlert(row, kind)
    }
  }

  function recordLevels(rows) {
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (hooks.isClosedRow(row)) continue
      const routeId = hooks.rowRouteId(row)
      if (!routeId) continue
      lastLevelByRoute.set(routeId, hooks.trafficLevelForRow(row))
    }
  }

  function scanTransitions(rows) {
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
      const entered =
        kind === 'gridlock'
          ? prev !== 'standstill'
          : prev !== 'high' && prev !== 'standstill'
      if (entered) enqueueAlert(row, kind)
    }
  }

  function startRetryScanTimer() {
    if (retryScanTimer) return
    let passes = 0
    retryScanTimer = setInterval(() => {
      passes += 1
      if (!crossingsActive() || bridgeTrafficAlertPreviewOpen.value || passes > 15) {
        if (retryScanTimer) {
          clearInterval(retryScanTimer)
          retryScanTimer = null
        }
        return
      }
      scanActiveAlerts()
    }, 2000)
  }

  function scheduleScan() {
    if (!crossingsActive()) return
    scanActiveAlerts()
  }

  onMounted(() => {
    bootstrapped.value = false
    startRetryScanTimer()
    window.setTimeout(() => scheduleScan(), 500)
    window.setTimeout(() => scheduleScan(), 1500)
  })

  onBeforeUnmount(() => {
    if (retryScanTimer) {
      clearInterval(retryScanTimer)
      retryScanTimer = null
    }
    clearPreparingSafetyTimer()
    preparing = false
  })

  watch(
    () => hooks.rankedRows.value,
    (rows) => {
      if (!Array.isArray(rows) || !rows.length) return
      if (!bootstrapped.value) {
        recordLevels(rows)
        bootstrapped.value = true
        scheduleScan()
        return
      }
      scanTransitions(rows)
    },
    { deep: true, immediate: true },
  )

  watch(
    () => [hooks.crossingsReady?.value, hooks.viewMode?.value, hooks.rankedRows.value?.length ?? 0],
    () => {
      if (crossingsActive()) scheduleScan()
    },
    { immediate: true },
  )

  watch(bridgeTrafficAlertPreviewOpen, (open, wasOpen) => {
    if (wasOpen && !open) {
      window.setTimeout(() => void processQueue(), 400)
    }
  })
}
