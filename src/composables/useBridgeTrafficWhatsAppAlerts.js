/**
 * Detect red (heavy) / purple (standstill) bridge crossings and queue WhatsApp preview.
 */
import { ref, watch } from 'vue'
import { isWahaConfigured } from '../utils/wahaApi.js'
import {
  bridgeAlertKindForTraffic,
  buildBridgeTrafficAlertMessage,
  canOfferBridgeTrafficAlert,
} from '../utils/bridgeTrafficWhatsAppAlert.js'
import { renderBridgeAlertPortraitBlob } from '../utils/bridgeAlertPortrait.js'
import { openBridgeTrafficAlertPreview, bridgeTrafficAlertPreviewOpen } from '../stores/bridgeTrafficAlertStore.js'

/** @type {Map<string, string>} */
const lastLevelByRoute = new Map()
let preparing = false

/**
 * @param {{
 *   rankedRows: import('vue').ComputedRef<unknown[]> | import('vue').Ref<unknown[]>,
 *   rowRouteId: (row: unknown) => string,
 *   displayTitle: (row: unknown) => string,
 *   trafficLevelForRow: (row: unknown) => string,
 *   delayTierForRow: (row: unknown) => string,
 *   isClosedRow: (row: unknown) => boolean,
 *   seriesForRow: (row: unknown) => Array<{ t?: number, m?: number, s?: number }>,
 *   bridgeChartStrokeColor: (row: unknown) => string,
 *   trafficStatusTitle: (row: unknown) => string,
 *   trendInfo: (row: unknown) => { short: string },
 *   getBridgeCameraFeed?: (row: unknown) => {
 *     youtubeVideoId?: string | null,
 *     imageUrl?: string | null,
 *     videoUrl?: string | null,
 *     status?: string,
 *   } | null,
 *   payloadUpdatedAt?: import('vue').ComputedRef<number | null> | import('vue').Ref<number | null>,
 * }} hooks
 */
export function useBridgeTrafficWhatsAppAlerts(hooks) {
  const bootstrapped = ref(false)

  async function preparePreview(row, kind) {
    const routeId = hooks.rowRouteId(row)
    if (!routeId || preparing || bridgeTrafficAlertPreviewOpen.value) return
    if (!isWahaConfigured()) return
    if (!canOfferBridgeTrafficAlert(routeId)) return

    preparing = true
    try {
      const bridgeName = hooks.displayTitle(row)
      const o = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {}
      const crossingMin =
        o.routeTravelTime != null && !o.isCrossingClosed ? String(o.routeTravelTime) : '—'
      const speedMph = o.routeSpeed != null ? String(o.routeSpeed) : '—'
      const message = buildBridgeTrafficAlertMessage(bridgeName, kind, { crossingMin })
      const level = hooks.trafficLevelForRow(row)
      const accentColor = level === 'standstill' ? '#a78bfa' : '#f87171'
      const cameraFeed = hooks.getBridgeCameraFeed?.(row) ?? null
      const updatedMs = hooks.payloadUpdatedAt?.value
      const updatedAtLabel =
        typeof updatedMs === 'number' && Number.isFinite(updatedMs) && updatedMs > 0
          ? `Updated ${new Date(updatedMs).toLocaleString()}`
          : ''

      const blob = await renderBridgeAlertPortraitBlob({
        bridgeName,
        statusLabel: hooks.trafficStatusTitle(row),
        crossingMin,
        speedMph,
        trendShort: hooks.trendInfo(row).short,
        strokeColor: hooks.bridgeChartStrokeColor(row),
        accentColor,
        series: hooks.seriesForRow(row),
        updatedAtLabel,
        cameraFeed,
      })

      const imageUrl = URL.createObjectURL(blob)
      openBridgeTrafficAlertPreview({
        routeId,
        bridgeName,
        alertKind: kind,
        message,
        imageUrl,
        imageBlob: blob,
      })
    } catch {
      /* skip — portrait or WAHA unavailable */
    } finally {
      preparing = false
    }
  }

  function evaluateRows(rows) {
    if (!Array.isArray(rows)) return
    for (const row of rows) {
      if (hooks.isClosedRow(row)) continue
      const routeId = hooks.rowRouteId(row)
      if (!routeId) continue

      const level = hooks.trafficLevelForRow(row)
      const tier = hooks.delayTierForRow(row)
      const prev = lastLevelByRoute.get(routeId) ?? ''
      lastLevelByRoute.set(routeId, level)

      if (!bootstrapped.value) continue

      const kind = bridgeAlertKindForTraffic(level, tier)
      if (!kind) continue

      const entered =
        kind === 'gridlock'
          ? prev !== 'standstill'
          : prev !== 'high' && prev !== 'standstill'

      if (!entered) continue
      void preparePreview(row, kind)
    }
    bootstrapped.value = true
  }

  watch(
    () => hooks.rankedRows.value,
    (rows) => evaluateRows(rows),
    { deep: true, immediate: true },
  )
}
