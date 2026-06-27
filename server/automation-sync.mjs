import { broadcastToAccount } from './session-sse.mjs'
import { emitLog } from './log-bus.mjs'

/**
 * Fan-out a structured event to every SSE connection for this account.
 * @param {string} accountKey
 * @param {Record<string, unknown>} payload
 */
export function publishAccountEvent(accountKey, payload) {
  const ak = String(accountKey ?? '').trim()
  if (!ak) return
  const tagged = { ...payload, accountKey, ts: Date.now() }
  broadcastToAccount(ak, tagged)
  const type = typeof payload.type === 'string' ? payload.type : 'account'
  const message = typeof payload.message === 'string' ? payload.message : ''
  emitLog(type, message, tagged)
}

/**
 * @param {string} accountKey
 * @param {{
 *   runId: string,
 *   automationId: string,
 *   automationName: string,
 *   deviceId?: string,
 * }} data
 */
export function publishAutomationStart(accountKey, data) {
  publishAccountEvent(accountKey, {
    type: 'automation',
    code: 'AUTOMATION_START',
    message: `${data.automationName} started`,
    runId: data.runId,
    automationId: data.automationId,
    automationName: data.automationName,
    deviceId: data.deviceId || '',
  })
}

/**
 * @param {string} accountKey
 * @param {{
 *   runId: string,
 *   automationId: string,
 *   automationName: string,
 *   deviceId?: string,
 *   ok: boolean,
 *   error?: string,
 *   variables?: Record<string, unknown>,
 * }} data
 */
export function publishAutomationComplete(accountKey, data) {
  publishAccountEvent(accountKey, {
    type: 'automation',
    code: 'AUTOMATION_COMPLETE',
    message: data.ok
      ? `${data.automationName} completed`
      : data.error || `${data.automationName} failed`,
    runId: data.runId,
    automationId: data.automationId,
    automationName: data.automationName,
    deviceId: data.deviceId || '',
    ok: data.ok === true,
    error: data.error || '',
    variables:
      data.variables && typeof data.variables === 'object' && !Array.isArray(data.variables)
        ? data.variables
        : {},
  })
}

/**
 * @param {string} accountKey
 * @param {{ reason?: string, runId?: string }} [meta]
 */
export function publishLinehaulRefresh(accountKey, meta = {}) {
  publishAccountEvent(accountKey, {
    type: 'linehaul',
    code: 'REFRESH',
    message: 'Refresh linehaul data',
    reason: meta.reason || 'sync',
    runId: meta.runId || '',
  })
}
