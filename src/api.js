import { getTomtomKeyEffective, getHereKeyEffective } from './stores/trafficTileKey.js'

/**
 * All API calls include cookies (session auth). Use for `/api/*` only.
 * @param {RequestInfo} input
 * @param {RequestInit} [init]
 */
export function apiFetch(input, init = {}) {
  return fetch(input, { ...init, credentials: init.credentials ?? 'include' })
}

async function handleJson(res) {
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    if (
      res.status === 401 &&
      data.code === 'AUTH_REQUIRED' &&
      typeof window !== 'undefined'
    ) {
      const base = import.meta.env.BASE_URL || '/'
      const loginPath = `${base.replace(/\/$/, '')}/login`
      if (!window.location.pathname.endsWith('/login')) {
        window.location.assign(
          `${loginPath}?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search,
          )}`,
        )
      }
    }
    const errStr = typeof data.error === 'string' ? data.error.trim() : ''
    const msgStr = typeof data.message === 'string' ? data.message.trim() : ''
    const codeStr = typeof data.code === 'string' ? data.code.trim() : ''
    const msg =
      errStr ||
      msgStr ||
      (codeStr && msgStr ? `${codeStr}: ${msgStr}` : codeStr) ||
      res.statusText ||
      'Request failed'
    throw new Error(msg)
  }
  return data
}

/**
 * Whether server requires app login, and current session state.
 */
export async function getAuthStatus() {
  const r = await apiFetch('/api/auth/status')
  const text = await r.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }
  if (r.ok) return data
  if (r.status === 401 && data.code === 'AUTH_REQUIRED') {
    return { authEnabled: true, authenticated: false }
  }
  return { authEnabled: true, authenticated: false }
}

/**
 * Verify FedEx credentials via server Playwright (dispatch + PurpleID gate), set session cookie.
 */
export async function postAuthLogin(body) {
  const r = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

export async function postAuthLogout() {
  const r = await apiFetch('/api/auth/logout', { method: 'POST' })
  return handleJson(r)
}

/**
 * Record IP + optional geolocation before login (no session required).
 * @param {{
 *   latitude?: number | null,
 *   longitude?: number | null,
 *   accuracyM?: number | null,
 *   locationDenied?: boolean,
 * }} body
 */
export async function postLoginAccessLog(body = {}) {
  const r = await apiFetch('/api/login/access-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

/**
 * Record client IP on first app load (no session). Server stores source `page_visit`.
 */
export async function postVisitPing() {
  const r = await apiFetch('/api/visit', { method: 'POST' })
  return handleJson(r)
}

/**
 * Security audit: recent access attempts with IP and optional coordinates.
 */
export async function getSettingsAccessLog() {
  const r = await apiFetch('/api/settings/access-log')
  return handleJson(r)
}

/** @returns {Promise<{ ok: boolean, enabled: boolean, redirectUrl: string, polygon: Array<{ lat: number, lng: number }> }>} */
export async function getSettingsGeoFence() {
  const r = await apiFetch('/api/settings/geo-fence')
  return handleJson(r)
}

/**
 * @param {{ enabled?: boolean, redirectUrl?: string, polygon?: Array<{ lat: number, lng: number }> }} body
 */
export async function putSettingsGeoFence(body) {
  const r = await apiFetch('/api/settings/geo-fence', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

/**
 * @param {{ ip?: string }} [body]
 */
export async function postSettingsGeoFencePreview(body = {}) {
  const r = await apiFetch('/api/settings/geo-fence/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

export async function getHealth() {
  const r = await apiFetch('/api/health')
  return handleJson(r)
}

/** Port Authority bridge/tunnel times + stored series for trend charts. */
export async function getBridgesPanynj() {
  const r = await apiFetch('/api/bridges/panynj')
  return handleJson(r)
}

/** Verrazzano-Narrows Bridge traffic data (HERE/TomTom) + stored series for trend charts. */
export async function getVerrazzanoTraffic() {
  const r = await apiFetch('/api/bridges/verrazzano')
  return handleJson(r)
}

/** Highway traffic data (HERE/TomTom) + stored series for trend charts. */
export async function getHighwayTraffic() {
  const r = await apiFetch('/api/traffic/highways')
  return handleJson(r)
}

/**
 * HERE Traffic API: list stored routes + live traffic flow per route.
 * @see https://developer.here.com/documentation/traffic-api/dev_guide/topics/send-request-readme.html
 */
export async function getTrafficMonitoredRoutes() {
  const k = getHereKeyEffective().trim()
  const qs = k ? `?${new URLSearchParams({ hereKey: k }).toString()}` : ''
  const r = await apiFetch(`/api/traffic/monitored-routes${qs}`)
  return handleJson(r)
}

/**
 * Refresh all monitored routes (POST avoids long query strings).
 * @returns {Promise<Record<string, unknown>>}
 */
export async function postTrafficMonitoredRoutesSync() {
  const k = getHereKeyEffective().trim()
  const r = await apiFetch('/api/traffic/monitored-routes/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(k ? { hereKey: k } : {}),
  })
  return handleJson(r)
}

/**
 * Preview routed geometry before creating a monitored route.
 * @param {{ name?: string, pathPoints: Array<{ lat: number, lng: number }> }} body
 */
export async function postTrafficMonitoredRoutePreview(body) {
  const k = getHereKeyEffective().trim()
  const r = await apiFetch('/api/traffic/monitored-routes/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(body && typeof body === 'object' ? body : {}),
      ...(k ? { hereKey: k } : {}),
    }),
  })
  return handleJson(r)
}

/**
 * Create a monitored route (HERE stateless - stored locally).
 * @param {{ name: string, pathPoints: Array<{ lat: number, lng: number }> }} body
 */
export async function postTrafficMonitoredRouteCreate(body) {
  const k = getHereKeyEffective().trim()
  const r = await apiFetch('/api/traffic/monitored-routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(body && typeof body === 'object' ? body : {}),
      ...(k ? { hereKey: k } : {}),
    }),
  })
  return handleJson(r)
}

/**
 * Remove route from app storage (HERE is stateless, no remote cleanup needed).
 * @param {string} localId
 */
export async function postTrafficMonitoredRouteRemove(localId) {
  const id = encodeURIComponent(localId)
  const r = await apiFetch(`/api/traffic/monitored-routes/${id}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return handleJson(r)
}

export async function getAssignment() {
  const r = await apiFetch('/api/assignment')
  return handleJson(r)
}

export async function putAssignment(body) {
  const r = await apiFetch('/api/assignment', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

/**
 * @param {{ dailyTripLegSequence: string, outcome: 'delivered' | 'rejected' | 'removed' | 'none' }} p
 */
export async function patchTripHistoryOutcome(p) {
  return putAssignment({
    patchTripHistoryEntry: {
      dailyTripLegSequence: String(p.dailyTripLegSequence),
      outcome: p.outcome,
      touchedAt: Date.now(),
    },
  })
}

/**
 * Delete a trip from the history ledger by its dailyTripLegSequence.
 * @param {{ dailyTripLegSequence: string }} p
 */
export async function deleteTripHistoryEntry(p) {
  return putAssignment({
    deleteTripHistoryEntry: {
      dailyTripLegSequence: String(p.dailyTripLegSequence),
    },
  })
}

export async function getInAppNotifications() {
  const r = await apiFetch('/api/notifications')
  return handleJson(r)
}

/**
 * @param {{ id?: string, all?: boolean }} body
 */
export async function postInAppMarkRead(body) {
  const r = await apiFetch('/api/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function getDollyRegistry() {
  const r = await apiFetch('/api/dolly')
  return handleJson(r)
}

/**
 * @param {string} [legSeq]
 * @param {unknown} trip
 */
export async function syncDollyFromLinehaul(legSeq, trip) {
  const r = await apiFetch('/api/dolly/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legSeq: legSeq || '', trip: trip ?? null }),
  })
  return handleJson(r)
}

/** @param {{ dollyNbr: string, legSeq?: string }} p */
export async function putDollyNumber(p) {
  const r = await apiFetch('/api/dolly', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  return handleJson(r)
}

/** @param {{ dollyNbr: string, rating: 'none' | 'good' | 'bad' }} p */
export async function patchDollyRating(p) {
  const r = await apiFetch('/api/dolly', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  })
  return handleJson(r)
}

/**
 * Mark a FedEx daily trip leg sequence as user-completed (hide until API changes).
 * @param {string} dailyTripLegSequence
 */
export async function appendHiddenTripSequence(dailyTripLegSequence) {
  return putAssignment({
    appendHiddenDailyTripLegSequence: String(dailyTripLegSequence),
  })
}

/** SPA geo-fence redirect when dev proxy skips server HTML hook (no auth). */
export async function getPublicGeoFenceCheck() {
  const r = await apiFetch('/api/public/geo-fence-check')
  return handleJson(r)
}

/**
 * @param {{ includeLinehaulBearer?: boolean, includeTomtomApiKey?: boolean, includeHereApiKey?: boolean, includeNy511ApiKey?: boolean }} [opts]
 * When includeLinehaulBearer, response includes decrypted Linehaul JWT for Settings only.
 * When includeTomtomApiKey, response includes decrypted TomTom key for Settings only.
 * When includeHereApiKey, response includes decrypted HERE key for Settings only.
 * When includeNy511ApiKey, response includes decrypted 511NY key for Settings only.
 */
export async function getCredentials(opts = {}) {
  const q = new URLSearchParams()
  if (opts.includeLinehaulBearer) q.set('includeLinehaulBearer', '1')
  if (opts.includeTomtomApiKey) q.set('includeTomtomApiKey', '1')
  if (opts.includeHereApiKey) q.set('includeHereApiKey', '1')
  if (opts.includeNy511ApiKey) q.set('includeNy511ApiKey', '1')
  const qs = q.toString()
  const r = await apiFetch(`/api/settings/credentials${qs ? `?${qs}` : ''}`)
  return handleJson(r)
}

/**
 * Persist TomTom API key for the signed-in user (encrypted server-side).
 * @param {{ tomtomApiKey?: string }} body Empty string clears the stored key.
 */
export async function putTomtomApiKey(body) {
  const r = await apiFetch('/api/settings/tomtom-api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

/**
 * Persist HERE API key for the signed-in user (encrypted server-side).
 * @param {{ hereApiKey?: string }} body Empty string clears the stored key.
 */
export async function putHereApiKey(body) {
  const r = await apiFetch('/api/settings/here-api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

/**
 * Persist 511NY API key for the signed-in user (encrypted server-side).
 * @param {{ ny511ApiKey?: string }} body Empty string clears the stored key.
 */
export async function putNy511ApiKey(body) {
  const r = await apiFetch('/api/settings/ny511-api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

/** Per-account API usage counters and limits (server / PostgreSQL). */
export async function getApiQuotaSettings() {
  const r = await apiFetch('/api/settings/api-quota')
  return handleJson(r)
}

/** @param {{ limits?: Record<string, number | string> }} body */
export async function putApiQuotaLimits(body) {
  const r = await apiFetch('/api/settings/api-quota-limits', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return handleJson(r)
}

export async function postApiQuotaReset() {
  const r = await apiFetch('/api/settings/api-quota-reset', {
    method: 'POST',
  })
  return handleJson(r)
}

/**
 * Get 511NY camera feeds for bridge crossings.
 * Returns cameras for: Bayonne, Goethals, Outerbridge, Verrazzano (ToNJ/ToNY).
 * @param {{ key?: string }} [opts] Optional API key override
 */
export async function getNy511Cameras(opts = {}) {
  const q = new URLSearchParams()
  if (opts.key) q.set('key', opts.key)
  const qs = q.toString()
  const r = await apiFetch(`/api/511ny/cameras${qs ? `?${qs}` : ''}`)
  return handleJson(r)
}

export async function putCredentials(body) {
  const r = await apiFetch('/api/settings/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function deleteCredentials() {
  const r = await apiFetch('/api/settings/credentials', { method: 'DELETE' })
  return handleJson(r)
}

/**
 * Capture Linehaul Apigee JWT from a fdxtools browser session (server Playwright).
 * @param {{
 *   headless?: boolean
 *   tryOktaLogin?: boolean
 *   clearSession?: boolean
 *   bypassValidityProbe?: boolean
 * }} [opts] clearSession default true. bypassValidityProbe true skips server probe (Settings manual + Home retry after 401).
 */
export async function postLinehaulCaptureBearer(opts = {}) {
  const r = await apiFetch('/api/fedex/linehaul/capture-bearer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  })
  return handleJson(r)
}

/**
 * Linehaul GET — never throws; use for Test buttons and snapshot refresh.
 * @returns {{ ok: boolean, status: number, body?: unknown, error?: string }}
 */
export async function fetchFedexLinehaulTractor(opts = {}) {
  const q = new URLSearchParams()
  if (opts.tractor) q.set('tractor', String(opts.tractor))
  const qs = q.toString()
  const r = await apiFetch(`/api/fedex/linehaul/tractor${qs ? `?${qs}` : ''}`)
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      body: parsed.body,
      error:
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`,
    }
  }
  return {
    ok: parsed.ok !== false,
    status: parsed.status ?? r.status,
    body: parsed.body,
    error:
      typeof parsed.error === 'string' ? parsed.error : undefined,
  }
}

/**
 * @returns {{ ok: boolean, status: number, body?: unknown, error?: string }}
 */
export async function fetchFedexLinehaulDriver(opts = {}) {
  const q = new URLSearchParams()
  if (opts.driver) q.set('driver', String(opts.driver))
  const qs = q.toString()
  const r = await apiFetch(`/api/fedex/linehaul/driver${qs ? `?${qs}` : ''}`)
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      body: parsed.body,
      error:
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`,
    }
  }
  return {
    ok: parsed.ok !== false,
    status: parsed.status ?? r.status,
    body: parsed.body,
    error:
      typeof parsed.error === 'string' ? parsed.error : undefined,
  }
}

/**
 * Trip preparation / trip status by reference id — never throws.
 * @returns {{ ok: boolean, status: number, body?: unknown, error?: string }}
 */
export async function fetchFedexLinehaulTripStatus(opts = {}) {
  const q = new URLSearchParams()
  if (opts.referenceId) q.set('referenceId', String(opts.referenceId))
  const qs = q.toString()
  const r = await apiFetch(
    `/api/fedex/linehaul/trip-status${qs ? `?${qs}` : ''}`,
  )
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      body: parsed.body,
      error:
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`,
    }
  }
  return {
    ok: parsed.ok !== false,
    status: parsed.status ?? r.status,
    body: parsed.body,
    error:
      typeof parsed.error === 'string' ? parsed.error : undefined,
  }
}

/**
 * Planned mileage / routing for origin→destination org ids (`viewTripInfoDetails`).
 * Never throws.
 * @param {{ orgIdOrigin: string, orgIdDest: string, originId?: string }} opts
 * @returns {{ ok: boolean, status: number, body?: unknown, error?: string }}
 */
export async function fetchFedexLinehaulViewTripInfoDetails(opts = {}) {
  const q = new URLSearchParams()
  if (opts.orgIdOrigin) q.set('orgIdOrigin', String(opts.orgIdOrigin).trim())
  if (opts.orgIdDest) q.set('orgIdDest', String(opts.orgIdDest).trim())
  if (opts.originId) q.set('originId', String(opts.originId).trim())
  const qs = q.toString()
  const r = await apiFetch(
    `/api/fedex/linehaul/view-trip-info-details${qs ? `?${qs}` : ''}`,
  )
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      body: parsed.body,
      error:
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`,
    }
  }
  return {
    ok: parsed.ok !== false,
    status: parsed.status ?? r.status,
    body: parsed.body,
    error:
      typeof parsed.error === 'string' ? parsed.error : undefined,
  }
}

/**
 * Current trip details (`GET …/trips`) — never throws.
 * Omit opts to use server defaults (driver, tractor, location from tractor API).
 * Pass `dailyTripLegSequence` (digits) to use dispatch-era query only (`alreadyCalled` forwarded).
 * @returns {{ ok: boolean, status: number, body?: unknown, error?: string, noActiveTrip?: boolean }}
 */
export async function fetchFedexLinehaulTrips(opts = {}) {
  const q = new URLSearchParams()
  const keys = [
    'driverId',
    'locationId',
    'tractorNbr',
    'status',
    'alreadyCalled',
    'originId',
    'dailyTripLegSequence',
  ]
  for (const k of keys) {
    if (opts[k] !== undefined && opts[k] !== null && String(opts[k]).trim() !== '') {
      q.set(k, String(opts[k]).trim())
    }
  }
  const qs = q.toString()
  const r = await apiFetch(`/api/fedex/linehaul/trips${qs ? `?${qs}` : ''}`)
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      body: parsed.body,
      error:
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`,
    }
  }

  if (parsed.noActiveTrip === true) {
    return {
      ok: true,
      status: parsed.status ?? 200,
      body: null,
      noActiveTrip: true,
    }
  }

  if (typeof parsed.error === 'string' && parsed.error.trim() !== '') {
    return {
      ok: false,
      status: parsed.status ?? r.status,
      body: parsed.body,
      error: parsed.error,
    }
  }
  if (parsed.ok === false) {
    return {
      ok: false,
      status: parsed.status ?? r.status,
      body: parsed.body,
      error: `Trip API envelope ok=false (HTTP ${r.status})`,
    }
  }

  if (text.trim() === '' && r.status >= 200 && r.status < 300) {
    return {
      ok: false,
      status: r.status,
      body: undefined,
      error:
        'Empty response from trip details API. Restart the API server or check the Linehaul token.',
    }
  }

  return {
    ok: true,
    status: parsed.status ?? r.status,
    body: parsed.body,
    error: undefined,
    noActiveTrip: false,
  }
}

/**
 * Transportation-network location (v2) by location id — never throws.
 * @param {{ locationId: string, originId?: string }} opts
 * @returns {{ ok: boolean, status: number, body?: unknown, error?: string }}
 */
export async function fetchFedexLinehaulLocation(opts = {}) {
  const id =
    opts.locationId != null && String(opts.locationId).trim() !== ''
      ? String(opts.locationId).trim()
      : ''
  if (!id) {
    return { ok: false, status: 400, error: 'locationId is required' }
  }
  const q = new URLSearchParams()
  if (opts.originId != null && String(opts.originId).trim() !== '') {
    q.set('originId', String(opts.originId).trim())
  }
  const qs = q.toString()
  const r = await apiFetch(
    `/api/fedex/linehaul/locations/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`,
  )
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      body: parsed.body,
      error:
        typeof parsed.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`,
    }
  }
  return {
    ok: parsed.ok !== false,
    status: parsed.status ?? r.status,
    body: parsed.body,
    error:
      typeof parsed.error === 'string' ? parsed.error : undefined,
  }
}

/** Proxied GET to Apigee Linehaul tractor (uses saved tractor number or opts.tractor). Throws on error. */
export async function getFedexLinehaulTractor(opts = {}) {
  const r = await fetchFedexLinehaulTractor(opts)
  if (!r.ok) throw new Error(r.error || 'Request failed')
  return { ok: true, status: r.status, body: r.body }
}

/** Proxied GET to Apigee Linehaul driver. Throws on error. */
export async function getFedexLinehaulDriver(opts = {}) {
  const r = await fetchFedexLinehaulDriver(opts)
  if (!r.ok) throw new Error(r.error || 'Request failed')
  return { ok: true, status: r.status, body: r.body }
}

export async function postRun(body) {
  const r = await apiFetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

/** Abort the current Playwright run (same as server cancel). */
export async function postCancelRun() {
  const r = await apiFetch('/api/run/cancel', { method: 'POST' })
  return handleJson(r)
}

/** In-browser check-in: new location while the same POST /api/run is waiting (same Playwright session). */
export async function postRetryLocation(runId, location) {
  const r = await apiFetch('/api/run/retry-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, location }),
  })
  return handleJson(r)
}

/** In-browser Inspect & Check Out: dolly / seal / trailer while automation waits. */
export async function postRetryInspectField(runId, value) {
  const r = await apiFetch('/api/run/retry-inspect-field', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, value }),
  })
  return handleJson(r)
}

export async function postCancelRetry(runId) {
  const r = await apiFetch('/api/run/cancel-retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
  })
  return handleJson(r)
}

export async function getAutomationPreview() {
  const r = await apiFetch('/api/automation/preview')
  return handleJson(r)
}

/** Declarative Playwright flow scripts per scenario (GET/PUT with full document). */
export async function getFlowScripts() {
  const r = await apiFetch('/api/settings/flow-scripts')
  return handleJson(r)
}

export async function putFlowScripts(body) {
  const r = await apiFetch('/api/settings/flow-scripts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function getAutomationsSchema() {
  const r = await apiFetch('/api/automations/schema')
  return handleJson(r)
}

export async function listAutomations() {
  const r = await apiFetch('/api/automations')
  return handleJson(r)
}

export async function getAutomation(id) {
  const r = await apiFetch(`/api/automations/${id}`)
  return handleJson(r)
}

export async function createAutomation(body = {}) {
  const r = await apiFetch('/api/automations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function updateAutomation(id, body) {
  const r = await apiFetch(`/api/automations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function deleteAutomation(id) {
  const r = await apiFetch(`/api/automations/${id}`, { method: 'DELETE' })
  return handleJson(r)
}

export async function duplicateAutomation(id) {
  const r = await apiFetch(`/api/automations/${id}/duplicate`, { method: 'POST' })
  return handleJson(r)
}

export async function runAutomation(id, body = {}) {
  const r = await apiFetch(`/api/automations/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function listAutomationPresets() {
  const r = await apiFetch('/api/automations/presets')
  return handleJson(r)
}

export async function installAutomationPreset(presetId) {
  const r = await apiFetch(`/api/automations/presets/${presetId}/install`, { method: 'POST' })
  return handleJson(r)
}

// ---------------------------------------------------------------------------
// Location Directory
// ---------------------------------------------------------------------------

/**
 * Fetch all saved locations from the directory.
 * @returns {Promise<{ ok: boolean, locations: Array<{
 *   locationId: string,
 *   locationName: string,
 *   abbreviation: string,
 *   address: string,
 *   phone: string,
 *   latitude: number | null,
 *   longitude: number | null,
 *   timeZone: string,
 *   lastUpdated: string,
 * }> }>}
 */
export async function fetchDirectory() {
  const r = await apiFetch('/api/directory')
  return handleJson(r)
}

/**
 * Save or update a location in the directory.
 * @param {{
 *   locationId: string,
 *   locationName: string,
 *   abbreviation: string,
 *   address: string,
 *   phone: string,
 *   latitude: number | null,
 *   longitude: number | null,
 *   timeZone: string,
 * }} data
 * @returns {Promise<{ ok: boolean, updated: boolean }>}
 */
export async function saveLocationToDirectory(data) {
  const r = await apiFetch('/api/directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return handleJson(r)
}

/**
 * Update shared directory phone for a location (visible to all users).
 * @param {string} locationId
 * @param {string} phone
 */
export async function patchDirectoryPhone(locationId, phone) {
  const id = encodeURIComponent(String(locationId))
  const r = await apiFetch(`/api/directory/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phone ?? '' }),
  })
  return handleJson(r)
}
