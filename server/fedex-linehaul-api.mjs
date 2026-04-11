/**
 * FedEx Ground Linehaul trip API (Apigee) — same host/path shape as fdxtools Network tab.
 * IDs are path parameters; Authorization is the user's browser session JWT (short-lived).
 */

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

/**
 * @param {'tractor' | 'driver'} resource
 * @param {string} id digits only
 * @param {string} bearerToken raw JWT (no "Bearer " prefix)
 */
export async function linehaulGet(resource, id, bearerToken) {
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
}

/**
 * Trip preparation / trip status by reference id (digits).
 * @param {string} referenceId concatenated driver + tractor + location id
 * @param {string} bearerToken raw JWT (no "Bearer " prefix)
 */
export async function linehaulTripStatusByReferenceId(referenceId, bearerToken) {
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
}

/**
 * Trip list / details (`GET …/trips?…` per fdxtools).
 * @param {string} queryString driverId=…&locationId=…&tractorNbr=…&status=…&alreadyCalled=…
 * @param {string} bearerToken raw JWT
 * @param {{ originId?: string }} [opts] optional originId header (matches browser tab)
 */
export async function linehaulTripsGet(queryString, bearerToken, opts = {}) {
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
}
