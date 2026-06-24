import { runWithCredentialAccountKey } from './request-context.mjs'
import { readAssignmentForAccount } from './assignment-store.mjs'
import {
  getDecryptedLinehaulBearer,
  getLinehaulDriverId,
  getTractorNumber,
} from './credentials-store.mjs'
import { linehaulGet, linehaulTripsGet } from './fedex-linehaul-api.mjs'
import {
  extractOriginDest,
  hasTripOriginAndDestination,
} from '../src/utils/tripDetailsDisplay.js'
import {
  getSmtpPrefsForAccount,
  patchSmtpSendStateForAccount,
  recordEmailTripActivityForAccount,
} from './user-profile-pg.mjs'

/** @param {unknown} body @param {'active' | 'preplan'} kind */
function tripFingerprint(body, kind = 'active') {
  if (!hasTripOriginAndDestination(body)) return ''
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return ''
  const o = /** @type {Record<string, unknown>} */ (body)
  const legRaw = o.dailyTripLegSequence
  const leg =
    legRaw != null && /^\d+$/.test(String(legRaw).trim()) ? String(legRaw).trim() : ''
  const { origin, destination } = extractOriginDest(body)
  const prefix = kind === 'preplan' ? 'preplan:' : ''
  return `${prefix}${leg}|||${origin}|||${destination}`
}

/** @param {string} activeFp @param {string} preplanFp */
function combinedMonitorFp(activeFp, preplanFp) {
  return `a:${activeFp || ''}|p:${preplanFp || ''}`
}

/**
 * @param {string} prevCombined
 * @param {string} nextCombined
 * @param {string} nextActive
 * @param {string} nextPreplan
 */
function shouldRecordTripActivity(prevCombined, nextCombined, nextActive, nextPreplan) {
  if (nextCombined === prevCombined) return false
  const prevActive = prevCombined.match(/^a:([^|]*)/)?.[1] ?? ''
  const prevPreplan = prevCombined.match(/\|p:(.*)$/)?.[1] ?? ''
  const activeChanged = Boolean(nextActive) && nextActive !== prevActive
  const preplanChanged = Boolean(nextPreplan) && nextPreplan !== prevPreplan
  return activeChanged || preplanChanged
}

/** @returns {Promise<unknown | null>} */
async function fetchActiveLinehaulTripBody() {
  const bearer = await getDecryptedLinehaulBearer()
  if (!bearer) return null

  const driverId = await getLinehaulDriverId()
  const tractorNbr = await getTractorNumber()
  if (!driverId || !tractorNbr) return null

  const tr = await linehaulGet('tractor', tractorNbr, bearer)
  const locationId = tr.body?.locationId
  if (locationId == null || !String(locationId).trim()) return null

  const loc = String(locationId).trim()
  const sp = new URLSearchParams()
  sp.set('driverId', driverId)
  sp.set('locationId', loc)
  sp.set('tractorNbr', tractorNbr)
  sp.set('status', 'APRVD')
  sp.set('alreadyCalled', 'false')

  const result = await linehaulTripsGet(sp.toString(), bearer, { originId: loc })
  if (result.status === 204 || !result.body) return null
  return result.body
}

/**
 * Server-side trip activity sync for weekly email idle detection.
 * Works without an active browser session when Linehaul bearer + credentials are stored.
 * @param {string} accountKey
 */
export async function maybeSyncEmailTripActivityForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return { skipped: 'no_account' }

  return runWithCredentialAccountKey(ak, async () => {
    const prefs = await getSmtpPrefsForAccount(ak)
    const prevCombined = prefs.lastMonitoredTripFp || ''

    let activeBody = null
    try {
      activeBody = await fetchActiveLinehaulTripBody()
    } catch (e) {
      console.error('[email-trip-activity] linehaul fetch failed', ak, e)
    }

    const assignment = await readAssignmentForAccount(ak)
    if (!activeBody && assignment?.persistedLinehaulTripSnapshot) {
      activeBody = assignment.persistedLinehaulTripSnapshot
    }

    const preplanBody = assignment?.persistedPrePlanTripSnapshot ?? null
    const activeFp = tripFingerprint(activeBody, 'active')
    const preplanFp = tripFingerprint(preplanBody, 'preplan')
    const nextCombined = combinedMonitorFp(activeFp, preplanFp)

    if (shouldRecordTripActivity(prevCombined, nextCombined, activeFp, preplanFp)) {
      await recordEmailTripActivityForAccount(ak)
    }

    if (nextCombined !== prevCombined) {
      await patchSmtpSendStateForAccount(ak, { lastMonitoredTripFp: nextCombined })
    }

    return { ok: true, activeFp: activeFp || null, preplanFp: preplanFp || null }
  })
}
