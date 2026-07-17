/**
 * FedEx Ground Linehaul trip API (Apigee) — same host/path shape as fdxtools Network tab.
 * IDs are path parameters; Authorization is the user's browser session JWT (short-lived).
 */

import {
  assertApiAllowed,
  recordApiCompletedCall,
  getQuotaAccountKey,
} from './api-quota.mjs'

export const LINEHAUL_TRIP_BASE =
  'https://fxg-prod-prod.apigee.net/linehaul/trip/v1'

export const LINEHAUL_TRIP_V2_BASE =
  'https://fxg-prod-prod.apigee.net/linehaul/trip/v2'

const ORIGIN = 'https://fdxtools.fedex.com'

/**
 * True if URL is a FedEx Linehaul Apigee request (matches browser Network tab).
 * @param {string} url
 */
export function isLinehaulApigeeUrl(url) {
  try {
    const u = new URL(url)
    return u.hostname.includes('apigee.net') && u.pathname.includes('/linehaul/')
  } catch {
    return false
  }
}

/** @param {() => Promise<{ ok: boolean, status: number }>} fn */
async function withFedexLinehaulQuota(fn) {
  const ak = getQuotaAccountKey()
  if (ak) await assertApiAllowed(ak, 'fedex_linehaul')
  const out = await fn()
  if (ak) await recordApiCompletedCall(ak, 'fedex_linehaul').catch(() => {})
  return out
}

/**
 * @param {'tractor' | 'driver'} resource
 * @param {string} id digits only
 * @param {string} bearerToken raw JWT (no "Bearer " prefix)
 */
export async function linehaulGet(resource, id, bearerToken) {
  return withFedexLinehaulQuota(async () => {
  const path =
    resource === 'tractor'
      ? `${LINEHAUL_TRIP_BASE}/tractor/${encodeURIComponent(id)}`
      : `${LINEHAUL_TRIP_BASE}/driver/${encodeURIComponent(id)}`
  const res = await fetch(path, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${bearerToken}`,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  }
  })
}

/**
 * Trip preparation / trip status by reference id (digits).
 * @param {string} referenceId concatenated driver + tractor + location id
 * @param {string} bearerToken raw JWT (no "Bearer " prefix)
 */
export async function linehaulTripStatusByReferenceId(referenceId, bearerToken) {
  return withFedexLinehaulQuota(async () => {
  const path = `${LINEHAUL_TRIP_BASE}/trip-preparation/trip/tripStatus/referenceId/${encodeURIComponent(referenceId)}`
  const res = await fetch(path, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${bearerToken}`,
      Origin: ORIGIN,
      Referer: `${ORIGIN}/`,
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  }
  })
}

/**
 * Trip list / details (`GET …/trips?…` per fdxtools).
 * @param {string} queryString driverId=…&locationId=…&tractorNbr=…&status=…&alreadyCalled=…
 * @param {string} bearerToken raw JWT
 * @param {{ originId?: string }} [opts] optional originId header (matches browser tab)
 */
/**
 * Active trip session for a driver (`GET …/trip-session/session/drivers/{driverId}`).
 * Returns `dailyTripLegSequence` while enroute even when APRVD list is empty.
 * @param {string} driverId digits only
 * @param {string} bearerToken raw JWT (no "Bearer " prefix)
 */
export async function linehaulTripSessionGet(driverId, bearerToken) {
  return withFedexLinehaulQuota(async () => {
    const path = `${LINEHAUL_TRIP_BASE}/trip-session/session/drivers/${encodeURIComponent(driverId)}`
    const res = await fetch(path, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${bearerToken}`,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
      },
    })
    const text = await res.text()
    let body
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body,
    }
  })
}

export async function linehaulTripsGet(queryString, bearerToken, opts = {}) {
  return withFedexLinehaulQuota(async () => {
  const qs = queryString.replace(/^\?/, '')
  const path = `${LINEHAUL_TRIP_BASE}/trips${qs ? `?${qs}` : ''}`
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${bearerToken}`,
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
  }
  if (opts.originId != null && String(opts.originId).trim() !== '') {
    headers.originId = String(opts.originId).trim()
  }
  const res = await fetch(path, { method: 'GET', headers })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  }
  })
}

/**
 * Transportation network location by id (v2) — path matches trip destination location number.
 * @param {string} locationId digits
 * @param {string} bearerToken raw JWT
 * @param {{ originId?: string }} [opts] originId header (Apigee)
 */
export async function linehaulTransportationNetworkLocationGet(
  locationId,
  bearerToken,
  opts = {},
) {
  return withFedexLinehaulQuota(async () => {
  const path = `${LINEHAUL_TRIP_V2_BASE}/transportation-network/locations/${encodeURIComponent(locationId)}`
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${bearerToken}`,
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
  }
  if (opts.originId != null && String(opts.originId).trim() !== '') {
    headers.originId = String(opts.originId).trim()
  }
  const res = await fetch(path, { method: 'GET', headers })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  }
  })
}

/**
 * Planned trip mileage / routing by origin and destination org ids (matches mobile “View trip info”).
 * `GET …/trip/v1/viewTripInfoDetails?orgIdOrigin=…&orgIdDest=…`
 * @param {string} orgIdOrigin digits
 * @param {string} orgIdDest digits
 * @param {string} bearerToken raw JWT
 * @param {{
 *   originIdHeader?: string,
 *   correlationId?: string,
 *   timeoutMs?: string | number,
 * }} [opts]
 */
export async function linehaulViewTripInfoDetailsGet(
  orgIdOrigin,
  orgIdDest,
  bearerToken,
  opts = {},
) {
  return withFedexLinehaulQuota(async () => {
  const oo = String(orgIdOrigin ?? '').trim()
  const od = String(orgIdDest ?? '').trim()
  const path = `${LINEHAUL_TRIP_BASE}/viewTripInfoDetails?${new URLSearchParams({
    orgIdOrigin: oo,
    orgIdDest: od,
  }).toString()}`
  /** @type {Record<string, string>} */
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Authorization: `Bearer ${bearerToken}`,
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    clientDeviceVendor: 'Apple',
    clientDeviceModel: 'iPhone',
    clientOSVersion: '18.7',
    clientOS: 'iOS',
    clientDeviceType: 'mobile',
    Timeout:
      opts.timeoutMs != null && opts.timeoutMs !== ''
        ? String(opts.timeoutMs)
        : '7500',
  }
  if (opts.originIdHeader != null && String(opts.originIdHeader).trim() !== '') {
    headers.originId = String(opts.originIdHeader).trim()
  }
  if (opts.correlationId != null && String(opts.correlationId).trim() !== '') {
    headers.CorrelationId = String(opts.correlationId).trim()
  }
  const res = await fetch(path, { method: 'GET', headers })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  return {
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  }
  })
}
