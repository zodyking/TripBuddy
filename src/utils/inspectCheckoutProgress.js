/**
 * Map Inspect & Check Out live-log lines to a short button label and optional TTS.
 * Orchestration log copy is the source of truth — keep patterns aligned with
 * server/playwright/inspectCheckoutOrchestration.mjs.
 */

/**
 * @typedef {{
 *   button: string,
 *   error: string,
 *   tts: string,
 *   ttsKey: string,
 * }} InspectProgress
 */

/**
 * @param {unknown} message
 * @param {unknown} [type]
 * @returns {InspectProgress | null}
 */
export function parseInspectCheckoutProgress(message, type) {
  const m = String(message ?? '').trim()
  if (!m) return null
  const isWarn = type === 'warn' || type === 'error'

  if (/you are dispatched/i.test(m) && !/never appeared/i.test(m)) {
    return prog('Dispatched', '', 'Inspect and checkout complete. You are dispatched.', 'done')
  }
  if (/new trip details/i.test(m)) {
    return prog(
      'New trip details',
      'Trip details changed',
      'Inspect and checkout failed. New trip details were added. Begin a new check-in.',
      'new_trip',
    )
  }
  if (/no trip to inspect|inspectcheckoutcancelled/i.test(m)) {
    return prog('No trip', 'No trip to inspect', 'Inspect and checkout cancelled. No trip to inspect.', 'cancelled')
  }
  if (/dispatch button was never clicked|dispatch_not_clicked/i.test(m)) {
    return prog(
      'Dispatch timed out',
      'Dispatch was not clicked',
      'Inspect and checkout failed. The dispatch button was not clicked.',
      'dispatch_not_clicked',
    )
  }
  if (/you are dispatched.*never appeared|dispatch_not_confirmed/i.test(m)) {
    return prog(
      'Dispatch not confirmed',
      'Dispatch was not confirmed',
      'Inspect and checkout failed. Dispatch was not confirmed.',
      'dispatch_not_confirmed',
    )
  }
  if (/invalid data entered/i.test(m)) {
    return prog(
      'Invalid data',
      'Invalid data entered',
      'Invalid data entered. Retrying.',
      'invalid_data',
    )
  }

  const sealTrailer = m.match(/trailer\s+(\d+)/i)
  const sealN = sealTrailer ? sealTrailer[1] : ''
  if (/invalid seal/i.test(m)) {
    return prog(
      sealN ? `Invalid seal T${sealN}` : 'Invalid seal',
      sealN ? `Invalid seal number for trailer ${sealN}` : 'Invalid seal number',
      sealN
        ? `Invalid seal number for trailer ${sealN}. Trying the next seal.`
        : 'Invalid seal number. Trying the next seal.',
      `invalid_seal_${sealN || 'x'}`,
    )
  }
  if (/invalid trailer/i.test(m)) {
    return prog(
      'Invalid trailer #',
      'Invalid trailer number',
      'Invalid trailer number. Check the number and try again.',
      'invalid_trailer',
    )
  }
  if (/dolly candidate rejected|dolly validation failed/i.test(m)) {
    return prog(
      'Invalid dolly',
      'Dolly number rejected',
      'Dolly number was rejected. Trying the next number.',
      'invalid_dolly',
    )
  }

  if (/trying dolly|filled dolly|validate dolly/i.test(m)) {
    return prog('Entering dolly', '', '', 'dolly')
  }
  if (/dolly validated|clicked validate seals after dolly/i.test(m)) {
    return prog('Dolly validated', '', '', 'dolly_ok')
  }
  if (/add a dolly|manual dolly/i.test(m)) {
    return prog('Adding dolly', '', '', 'add_dolly')
  }
  if (/trying seal|batch seal|validate seal/i.test(m)) {
    return prog(sealN ? `Entering seal T${sealN}` : 'Entering seals', '', '', 'seals')
  }
  if (/seal validated/i.test(m)) {
    return prog(sealN ? `Seal T${sealN} ok` : 'Seals validated', '', '', 'seals_ok')
  }
  if (/trailer number|validate mt trailer|empty trailer input/i.test(m)) {
    return prog('Entering trailer #', '', '', 'trailer')
  }
  if (/begin inspection/i.test(m)) {
    return prog('Begin inspection', '', '', 'begin')
  }
  if (/checkbox|inspection checklist/i.test(m)) {
    return prog('Checklist', '', '', 'checklist')
  }
  if (/agree and check out/i.test(m)) {
    return prog('Checking out', '', '', 'agree')
  }
  if (/clicked yes on dispatch|dispatch confirmation/i.test(m)) {
    return prog('Confirming dispatch', '', '', 'dispatch_yes')
  }
  if (/clicked dispatch/i.test(m)) {
    return prog('Dispatching', '', '', 'dispatch')
  }
  if (/empty trailer modal|verified/i.test(m) && /dismiss/i.test(m)) {
    return prog('Empty trailer notice', '', '', 'empty_notice')
  }
  if (/dismissed inspect warning/i.test(m)) {
    return prog('Acknowledging warning', '', '', 'warning')
  }

  if (isWarn && /inspect/i.test(m)) {
    return prog('Inspect issue', clip(m, 42), clip(m, 160), `warn_${hashKey(m)}`)
  }

  return null
}

/**
 * Spoken line for a finished inspect/checkout outcome reason.
 * @param {unknown} reason
 * @param {{ ok?: boolean, requiresReCheckin?: boolean }} [outcome]
 */
export function inspectCheckoutOutcomeSpeech(reason, outcome = {}) {
  if (outcome.requiresReCheckin) {
    return 'Inspect and checkout failed. New trip details were added. Begin a new check-in.'
  }
  const r = String(reason ?? '').trim()
  if (r === 'dispatched') return 'Inspect and checkout complete. You are dispatched.'
  if (r === 'cancelled' || r === 'no_trip') return 'Inspect and checkout cancelled. No trip to inspect.'
  if (r === 'new_trip_details') {
    return 'Inspect and checkout failed. New trip details were added. Begin a new check-in.'
  }
  if (r === 'dispatch_not_clicked') {
    return 'Inspect and checkout failed. The dispatch button was not clicked.'
  }
  if (r === 'dispatch_not_confirmed') {
    return 'Inspect and checkout failed. Dispatch was not confirmed.'
  }
  if (r === 'idle') return 'Inspect and checkout stopped. The screen was not recognized.'
  if (outcome.ok === false && r) {
    return `Inspect and checkout failed. ${humanizeReason(r)}.`
  }
  if (outcome.ok === false) return 'Inspect and checkout failed.'
  return ''
}

/**
 * @param {unknown} auto
 */
export function isInspectCheckoutAutomation(auto) {
  if (!auto || typeof auto !== 'object') return false
  const a = /** @type {Record<string, unknown>} */ (auto)
  if (/inspect/i.test(String(a.name ?? '')) || /inspect/i.test(String(a.manualButtonLabel ?? ''))) {
    return true
  }
  const actions = Array.isArray(a.actions) ? a.actions : []
  return actions.some((act) => {
    if (!act || typeof act !== 'object') return false
    const t = String(/** @type {Record<string, unknown>} */ (act).type ?? '')
    const action = String(/** @type {Record<string, unknown>} */ (act).action ?? '')
    return (
      t === 'inspectCheckoutContinue' ||
      t === 'inspectCheckoutHomeGate' ||
      action === 'inspectCheckoutContinue' ||
      action === 'inspectCheckoutHomeGate'
    )
  })
}

/**
 * @param {string} button
 * @param {string} error
 * @param {string} tts
 * @param {string} ttsKey
 * @returns {InspectProgress}
 */
function prog(button, error, tts, ttsKey) {
  return { button, error, tts, ttsKey }
}

/** @param {string} s @param {number} n */
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}…`
}

/** @param {string} s */
function hashKey(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

/** @param {string} r */
function humanizeReason(r) {
  return r.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
