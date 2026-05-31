import { ref } from 'vue'
import {
  markBridgeTrafficAlertDismissed,
  markBridgeTrafficAlertSent,
} from '../utils/bridgeTrafficWhatsAppAlert.js'

/** @typedef {'highTraffic' | 'gridlock'} BridgeTrafficAlertKind */

/**
 * @typedef {{
 *   routeId: string,
 *   bridgeName: string,
 *   alertKind: BridgeTrafficAlertKind,
 *   message: string,
 *   imageUrl: string,
 *   imageBlob: Blob,
 * }} BridgeTrafficAlertPreview
 */

export const bridgeTrafficAlertPreviewOpen = ref(false)

/** @type {import('vue').Ref<BridgeTrafficAlertPreview | null>} */
export const bridgeTrafficAlertPreview = ref(null)

export const bridgeTrafficAlertSending = ref(false)
export const bridgeTrafficAlertSendError = ref('')

/**
 * @param {BridgeTrafficAlertPreview} payload
 */
export function openBridgeTrafficAlertPreview(payload) {
  if (bridgeTrafficAlertPreview.value?.imageUrl) {
    URL.revokeObjectURL(bridgeTrafficAlertPreview.value.imageUrl)
  }
  bridgeTrafficAlertPreview.value = payload
  bridgeTrafficAlertPreviewOpen.value = true
  bridgeTrafficAlertSendError.value = ''
}

/**
 * @param {{ dismissed?: boolean }} [opts]
 */
export function closeBridgeTrafficAlertPreview(opts = {}) {
  const cur = bridgeTrafficAlertPreview.value
  if (opts.dismissed && cur?.routeId) {
    markBridgeTrafficAlertDismissed(cur.routeId)
  }
  if (cur?.imageUrl) URL.revokeObjectURL(cur.imageUrl)
  bridgeTrafficAlertPreview.value = null
  bridgeTrafficAlertPreviewOpen.value = false
  bridgeTrafficAlertSending.value = false
  bridgeTrafficAlertSendError.value = ''
}

/**
 * @param {string} routeId
 */
export function noteBridgeTrafficAlertSent(routeId) {
  markBridgeTrafficAlertSent(routeId)
  closeBridgeTrafficAlertPreview()
}
