import { readAssignmentForAccount } from './assignment-store.mjs'
import {
  extractOriginDest,
  extractTripOrgIds,
  buildEnhancedTrailerCards,
  buildDollySection,
  extractTripDispatchInstructions,
} from '../src/utils/tripDetailsDisplay.js'

/**
 * @typedef {{
 *   order: string,
 *   number: string,
 *   size: string,
 *   status: string,
 *   loadType: string,
 *   seal: string,
 *   weight: string,
 *   destination: string,
 * }} EmailTripTrailer
 */

/**
 * @typedef {{
 *   leg: string,
 *   origin: string,
 *   destination: string,
 *   route: string,
 *   driverName?: string,
 *   tractorNumber?: string,
 *   tripStatus?: string,
 *   outcome?: string,
 *   miles?: string,
 *   completedAt?: string,
 *   dollies: { label: string, value: string }[],
 *   dollySummary: string,
 *   trailers: EmailTripTrailer[],
 *   dispatchInstructions?: string,
 * }} EmailTripContext
 */

/** @param {string} s */
function clean(s) {
  const t = String(s ?? '').trim()
  return t || '—'
}

/**
 * Email display: terminal number only (strip location name).
 * @param {string} location
 */
export function emailTerminalId(location) {
  const s = String(location ?? '').trim()
  if (!s || s === '—') return '—'
  const fromBody = s.match(/^(\d{1,12})\b/)
  if (fromBody) return fromBody[1]
  const head = s.split(/\s*[·|]\s*/)[0]?.trim()
  if (head && /^\d+$/.test(head)) return head
  return s
}

/** @param {string} origin @param {string} destination */
export function formatEmailRoute(origin, destination) {
  const o = emailTerminalId(origin)
  const d = emailTerminalId(destination)
  return `${o} → ${d}`
}

/**
 * @param {unknown} body
 * @param {string} fallbackOrigin
 * @param {string} fallbackDestination
 */
function terminalIdsForEmail(body, fallbackOrigin, fallbackDestination) {
  if (body != null && typeof body === 'object' && !Array.isArray(body)) {
    const { originId, destinationId } = extractTripOrgIds(body)
    if (originId && destinationId) {
      return { origin: originId, destination: destinationId }
    }
  }
  return {
    origin: emailTerminalId(fallbackOrigin),
    destination: emailTerminalId(fallbackDestination),
  }
}

/** @param {unknown} body */
function legFromBody(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return ''
  const raw = /** @type {Record<string, unknown>} */ (body).dailyTripLegSequence
  if (raw == null) return ''
  const t = String(raw).trim()
  return /^\d+$/.test(t) ? t : ''
}

/** @param {unknown} body @returns {EmailTripTrailer[]} */
function trailersFromBody(body) {
  const cards = buildEnhancedTrailerCards(body)
  if (cards.length) {
    return cards.map((c) => {
      const seal = c.summaryRows.find((r) => r.label === 'Seal')?.value ?? '—'
      const dest = c.summaryRows.find((r) => r.label === 'Destination')?.value ?? '—'
      const weight = c.summaryRows.find((r) => r.label === 'Weight')?.value ?? '—'
      return {
        order: c.order,
        number: clean(c.trlrNbr),
        size: c.size || '—',
        status: clean(c.statusLabel),
        loadType: clean(c.loadType),
        seal: clean(seal),
        weight: clean(weight),
        destination: clean(dest),
      }
    })
  }

  const o =
    body && typeof body === 'object' && !Array.isArray(body)
      ? /** @type {Record<string, unknown>} */ (body)
      : {}
  const arr = o.trailers
  if (!Array.isArray(arr)) return []

  return arr.map((raw, i) => {
    const c =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? /** @type {Record<string, unknown>} */ (raw)
        : {}
    const rows = Array.isArray(c.summaryRows)
      ? /** @type {{ label?: string, value?: string }[]} */ (c.summaryRows)
      : []
    /** @param {string} lab */
    const valFor = (lab) => {
      const row = rows.find((r) => String(r?.label ?? '').trim() === lab)
      return row ? String(row.value ?? '').trim() : ''
    }
    return {
      order: c.order != null ? String(c.order) : String(i + 1),
      number: clean(c.trlrNbr),
      size: clean(c.size),
      status: clean(c.statusLabel),
      loadType: clean(c.loadType),
      seal: clean(valFor('Seal')),
      weight: clean(valFor('Weight')),
      destination: clean(valFor('Destination')),
    }
  })
}

/** @param {unknown} body @returns {{ label: string, value: string }[]} */
function dolliesFromBody(body) {
  const dolly = buildDollySection(body)
  if (!dolly.show) return []
  return dolly.rows
    .filter((r) => r.value !== '—')
    .map((r) => ({ label: r.label, value: r.value }))
}

/** @param {{ label: string, value: string }[]} dollies */
function formatDollySummary(dollies) {
  if (!dollies.length) return '—'
  const nums = dollies
    .filter((d) => /dolly\s*number/i.test(d.label))
    .map((d) => d.value)
    .filter((v) => v && v !== '—')
  if (nums.length) return nums.join(', ')
  return dollies.map((d) => `${d.label}: ${d.value}`).join(' · ')
}

/** @param {EmailTripTrailer[]} trailers */
export function formatTrailersSummary(trailers) {
  if (!trailers?.length) return '—'
  return trailers
    .map((tr) => {
      const parts = [`T${tr.order}`]
      if (tr.number !== '—') parts.push(`#${tr.number}`)
      if (tr.seal !== '—') parts.push(`Seal ${tr.seal}`)
      return parts.join(' ')
    })
    .join(' · ')
}

/**
 * @param {import('./email-trip-details.mjs').EmailTripContext} trip
 * @returns {string[]}
 */
export function weeklyTripTableRow(trip) {
  const trailers = formatTrailersSummary(trip.trailers)
  const dollies = trip.dollySummary && trip.dollySummary !== '—' ? trip.dollySummary : '—'
  return [
    trip.completedAt || '—',
    trip.leg || '—',
    trip.route || formatEmailRoute(trip.origin, trip.destination),
    trailers,
    dollies,
    trip.miles || '—',
  ]
}

/** @param {import('./email-trip-details.mjs').EmailTripContext} trip */
export function dailyTripTableRow(trip) {
  return weeklyTripTableRow(trip)
}

/**
 * @param {unknown} body
 * @param {Partial<EmailTripContext>} [overrides]
 * @returns {EmailTripContext}
 */
export function buildEmailTripContextFromBody(body, overrides = {}) {
  const { origin: rawOrigin, destination: rawDestination } = extractOriginDest(body)
  const ids = terminalIdsForEmail(body, rawOrigin, rawDestination)
  const leg = legFromBody(body)
  const dollies = dolliesFromBody(body)
  const trailers = trailersFromBody(body)

  let tractorNumber = ''
  let tripStatus = ''
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const o = /** @type {Record<string, unknown>} */ (body)
    tractorNumber = String(o.tractorNumber ?? o.tractorNbr ?? '').trim()
    tripStatus = String(o.tripStatus ?? '').trim()
  }

  const o = clean(overrides.origin ? emailTerminalId(overrides.origin) : ids.origin)
  const d = clean(overrides.destination ? emailTerminalId(overrides.destination) : ids.destination)
  const route = formatEmailRoute(o, d)

  return {
    leg: clean(overrides.leg || leg),
    origin: o,
    destination: d,
    route,
    driverName: overrides.driverName,
    tractorNumber: overrides.tractorNumber || tractorNumber || undefined,
    tripStatus: overrides.tripStatus || tripStatus || undefined,
    outcome: overrides.outcome,
    miles: overrides.miles,
    completedAt: overrides.completedAt,
    dollies,
    dollySummary: formatDollySummary(dollies),
    trailers,
    dispatchInstructions:
      overrides.dispatchInstructions || extractTripDispatchInstructions(body) || undefined,
  }
}

/**
 * @param {unknown} entry Ledger row with dispatchHeader + tripDetails
 * @returns {EmailTripContext}
 */
export function buildEmailTripContextFromLedgerEntry(entry) {
  const dh =
    entry && typeof entry === 'object' && entry.dispatchHeader && typeof entry.dispatchHeader === 'object'
      ? /** @type {Record<string, unknown>} */ (entry.dispatchHeader)
      : {}
  const td =
    entry && typeof entry === 'object' && entry.tripDetails && typeof entry.tripDetails === 'object'
      ? entry.tripDetails
      : null

  const origin = emailTerminalId(clean(dh.origin))
  const destination = emailTerminalId(clean(dh.destination))
  const leg =
    entry && typeof entry === 'object'
      ? clean(/** @type {Record<string, unknown>} */ (entry).dailyTripLegSequence)
      : '—'

  const ctx = buildEmailTripContextFromBody(td, {
    leg,
    origin,
    destination,
    outcome: clean(dh.historyOutcome),
    dispatchInstructions: String(dh.instructions ?? '').trim() || undefined,
  })

  const ts =
    entry && typeof entry === 'object'
      ? /** @type {Record<string, unknown>} */ (entry).completedAt ??
        /** @type {Record<string, unknown>} */ (entry).outcomeTouchedAt ??
        /** @type {Record<string, unknown>} */ (entry).recordedAt
      : null
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    ctx.completedAt = new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const m = td?.mileage
  if (m && typeof m === 'object') {
    const total = String(/** @type {Record<string, unknown>} */ (m).totalMiles ?? '').trim()
    const n = Number(total)
    if (Number.isFinite(n)) ctx.miles = `${n} mi`
  }

  if (td?.tractorNumber) ctx.tractorNumber = String(td.tractorNumber).trim()
  if (td?.tripStatus) ctx.tripStatus = String(td.tripStatus).trim()

  return ctx
}

/**
 * @param {object | null | undefined} assignment
 * @param {'active' | 'preplan'} kind
 */
function snapshotForKind(assignment, kind) {
  if (!assignment || typeof assignment !== 'object') return null
  const a = /** @type {Record<string, unknown>} */ (assignment)
  if (kind === 'preplan') return a.persistedPrePlanTripSnapshot ?? null
  return a.persistedLinehaulTripSnapshot ?? null
}

/**
 * @param {string} accountKey
 * @param {object} extra Notification extra payload
 * @param {string} [eventKey]
 * @returns {Promise<EmailTripContext>}
 */
export async function resolveEmailTripContextForNotification(accountKey, extra, eventKey = '') {
  const leg = String(extra.leg ?? '').trim()
  const origin = String(extra.origin ?? '').trim()
  const destination = String(extra.destination ?? '').trim()

  const kind = eventKey === 'preplan_assigned' ? 'preplan' : 'active'
  const assignment = await readAssignmentForAccount(accountKey)
  const body = snapshotForKind(assignment, kind)

  const ctx = body
    ? buildEmailTripContextFromBody(body, {
        leg: leg || undefined,
        origin: origin || undefined,
        destination: destination || undefined,
      })
    : buildEmailTripContextFromBody(null, {
        leg: leg || '—',
        origin: origin || '—',
        destination: destination || '—',
      })

  if (!ctx.leg || ctx.leg === '—') {
    const fromSnap = legFromBody(body)
    if (fromSnap) ctx.leg = fromSnap
  }

  return ctx
}

/**
 * @param {string} accountKey
 * @returns {Promise<EmailTripContext | null>}
 */
export async function resolveActiveEmailTripContext(accountKey) {
  const assignment = await readAssignmentForAccount(accountKey)
  const body = snapshotForKind(assignment, 'active')
  if (!body) return null
  return buildEmailTripContextFromBody(body)
}
