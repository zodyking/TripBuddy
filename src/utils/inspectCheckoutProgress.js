/**
 * Map Check In / Inspect & Check Out / Arrive live-log lines to a short
 * button label and optional TTS. Orchestration log copy is the source of
 * truth — keep patterns aligned with server/playwright flows.
 */

/**
 * @typedef {{
 *   button: string,
 *   error: string,
 *   tts: string,
 *   ttsKey: string,
 * }} InspectProgress
 */

const CLIENT_LOG_PREFIX = /^\[(Alert|Queue|Test|Direct|TripVoice)\]/i

/**
 * Client-side live-log lines (TTS / queue / tests). Never treat these as
 * automation progress — they used to re-enter the parser and stack forever.
 * @param {unknown} message
 */
export function isClientGeneratedLiveLog(message) {
  return CLIENT_LOG_PREFIX.test(String(message ?? '').trim())
}

/**
 * @param {unknown} message
 * @param {unknown} [type]
 * @returns {InspectProgress | null}
 */
export function parseInspectCheckoutProgress(message, _type) {
  const m = String(message ?? '').trim()
  if (!m) return null
  if (isClientGeneratedLiveLog(m)) return null

  if (/you are dispatched/i.test(m) && !/never appeared/i.test(m)) {
    return prog('Dispatched', '', 'Inspect and checkout complete. You are dispatched.', 'done')
  }
  if (/new trip details/i.test(m) || /requires re-checkin|re-checkin due to trip/i.test(m)) {
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
  if (/no recognized screen/i.test(m)) {
    return prog('Screen unknown', 'Screen was not recognized', '', 'idle_screen')
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

  const checkIn = parseCheckInProgress(m)
  if (checkIn) return checkIn
  const arrive = parseArriveProgress(m)
  if (arrive) return arrive

  return null
}

/**
 * @param {string} m
 * @returns {InspectProgress | null}
 */
function parseCheckInProgress(m) {
  if (/fedex reported a message after submit/i.test(m)) {
    return prog('Check-in issue', 'FedEx reported a message', '', 'checkin_banner')
  }
  if (/begin new check-in dialog.*could not/i.test(m)) {
    return prog('Check-in blocked', 'Could not continue check-in', '', 'checkin_begin_blocked')
  }
  if (/check-in mission complete/i.test(m)) {
    return prog('Check-in done', '', '', 'checkin_done')
  }
  if (/check-in finished/i.test(m)) {
    return prog('Check-in done', '', '', 'checkin_finished')
  }
  if (/check-in session ready/i.test(m)) {
    return prog('Session ready', '', '', 'checkin_ready')
  }
  if (/confirmed new check-in/i.test(m)) {
    return prog('Confirming check-in', '', '', 'checkin_confirm')
  }
  if (/starting new check-in/i.test(m)) {
    return prog('Starting check-in', '', '', 'checkin_start')
  }
  if (/check-in already started|opening check in/i.test(m)) {
    return prog('Opening check-in', '', '', 'checkin_open')
  }
  if (/using menu to (start|open) check-in/i.test(m)) {
    return prog('Opening check-in', '', '', 'checkin_menu')
  }
  if (/choosing check-in option/i.test(m)) {
    return prog('Choosing option', '', '', 'checkin_option')
  }
  if (/entering tractor and location/i.test(m)) {
    return prog('Entering tractor', '', '', 'checkin_tractor')
  }
  if (/retrying check-in with new location/i.test(m)) {
    return prog('Retrying location', '', '', 'checkin_retry_loc')
  }
  if (/submitting check-in retry/i.test(m)) {
    return prog('Submitting retry', '', '', 'checkin_retry_submit')
  }
  if (/submitting check-in/i.test(m)) {
    return prog('Submitting', '', '', 'checkin_submit')
  }
  if (/checking result/i.test(m)) {
    return prog('Checking result', '', '', 'checkin_result')
  }
  if (/contact linehaul/i.test(m)) {
    return prog('Contact Linehaul', '', '', 'checkin_linehaul')
  }
  if (/trip ready page detected/i.test(m)) {
    return prog('Trip ready', '', '', 'checkin_trip_ready')
  }
  if (/entered driver phone|sent phone number|phone modal/i.test(m)) {
    return prog('Phone number', '', '', 'checkin_phone')
  }
  if (/confirmed assistance|no assistance modal|assistance \(if any\)/i.test(m)) {
    return prog('Assistance', '', '', 'checkin_assist')
  }
  return null
}

/**
 * @param {string} m
 * @returns {InspectProgress | null}
 */
function parseArriveProgress(m) {
  if (/already arrived by geofence/i.test(m)) {
    return prog('Already arrived', '', '', 'arrive_geofence_skip')
  }
  if (/geofence arrival/i.test(m)) {
    return prog('Geofence arrive', '', '', 'arrive_geofence')
  }
  if (/arrive post-flow complete/i.test(m)) {
    return prog('Arrive done', '', '', 'arrive_done')
  }
  if (/clicked arrive/i.test(m)) {
    return prog('Tapping Arrive', '', '', 'arrive_click')
  }
  if (/selected tractor number option/i.test(m)) {
    return prog('Selecting tractor', '', '', 'arrive_tractor_opt')
  }
  if (/entered tractor number/i.test(m)) {
    return prog('Entering tractor', '', '', 'arrive_tractor')
  }
  if (/clicked continue/i.test(m)) {
    return prog('Continuing', '', '', 'arrive_continue')
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

/** @param {string} r */
function humanizeReason(r) {
  return r.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
