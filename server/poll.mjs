import { POLL_INTERVAL_MS } from './config.mjs'
import { emitLog } from './log-bus.mjs'
import { pollFingerprintSafe } from './playwright/runner.mjs'
import { maybeUpdateAssignmentFromContext } from './assignment-logic.mjs'
import { publishInAppForLastActiveUser } from './notification-publish.mjs'

let intervalId = null
let lastSerialized = null
let lastFingerprint = null
let lastChangeAt = null
let pollErrors = 0

function serializeFingerprint(fp) {
  return JSON.stringify(fp)
}

export function getPollStatus() {
  return {
    running: intervalId != null,
    intervalMs: POLL_INTERVAL_MS,
    lastFingerprint,
    lastChangeAt,
    lastSerialized,
    pollErrors,
  }
}

export function startPoll({ headless = true } = {}) {
  if (intervalId) {
    return { ok: false, message: 'Poll already running' }
  }

  emitLog('poll', `Starting assignment poll every ${POLL_INTERVAL_MS}ms`)

  intervalId = setInterval(async () => {
    try {
      const fp = await pollFingerprintSafe({ headless })
      if (fp == null) return
      const next = serializeFingerprint(fp)
      if (lastSerialized != null && next !== lastSerialized) {
        lastChangeAt = Date.now()
        void (async () => {
          const r = await publishInAppForLastActiveUser({
            type: 'assignment',
            message: 'Home screen changed — check for a new dispatch',
            source: 'poll',
            extra: { previous: lastFingerprint, current: fp },
          })
          if (r && r.item) {
            emitLog('poll', `Notified: ${r.item.message}`)
          }
        })()
        void maybeUpdateAssignmentFromContext({
          source: 'poll',
          previous: lastFingerprint,
          current: fp,
        }).catch(() => {})
      }
      lastSerialized = next
      lastFingerprint = fp
      pollErrors = 0
    } catch (e) {
      pollErrors += 1
      emitLog('error', `Poll tick failed: ${e instanceof Error ? e.message : e}`)
    }
  }, POLL_INTERVAL_MS)

  void (async () => {
    try {
      const fp = await pollFingerprintSafe({ headless })
      if (fp == null) return
      lastSerialized = serializeFingerprint(fp)
      lastFingerprint = fp
      emitLog('poll', 'Initial fingerprint captured')
    } catch (e) {
      emitLog('error', `Initial poll failed: ${e instanceof Error ? e.message : e}`)
    }
  })()

  return { ok: true }
}

export function stopPoll() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    emitLog('poll', 'Assignment poll stopped')
  }
  return { ok: true }
}
