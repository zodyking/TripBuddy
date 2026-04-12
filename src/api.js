async function handleJson(res) {
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const msg = data.error || data.message || res.statusText || 'Request failed'
    throw new Error(msg)
  }
  return data
}

export async function getHealth() {
  const r = await fetch('/api/health')
  return handleJson(r)
}

export async function getAssignment() {
  const r = await fetch('/api/assignment')
  return handleJson(r)
}

export async function putAssignment(body) {
  const r = await fetch('/api/assignment', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

/**
 * @param {{ includeLinehaulBearer?: boolean }} [opts] When true, response includes decrypted JWT for Settings UI only.
 */
export async function getCredentials(opts = {}) {
  const q = opts.includeLinehaulBearer ? '?includeLinehaulBearer=1' : ''
  const r = await fetch(`/api/settings/credentials${q}`)
  return handleJson(r)
}

export async function putCredentials(body) {
  const r = await fetch('/api/settings/credentials', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function deleteCredentials() {
  const r = await fetch('/api/settings/credentials', { method: 'DELETE' })
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
  const r = await fetch('/api/fedex/linehaul/capture-bearer', {
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
  const r = await fetch(`/api/fedex/linehaul/tractor${qs ? `?${qs}` : ''}`)
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
  const r = await fetch(`/api/fedex/linehaul/driver${qs ? `?${qs}` : ''}`)
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
  const r = await fetch(
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
  const r = await fetch(`/api/fedex/linehaul/trips${qs ? `?${qs}` : ''}`)
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
  const r = await fetch(
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
  const r = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

/** Abort the current Playwright run (same as server cancel). */
export async function postCancelRun() {
  const r = await fetch('/api/run/cancel', { method: 'POST' })
  return handleJson(r)
}

/** In-browser check-in: new location while the same POST /api/run is waiting (same Playwright session). */
export async function postRetryLocation(runId, location) {
  const r = await fetch('/api/run/retry-location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, location }),
  })
  return handleJson(r)
}

export async function postCancelRetry(runId) {
  const r = await fetch('/api/run/cancel-retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
  })
  return handleJson(r)
}

export async function postOcr(formData) {
  const r = await fetch('/api/ocr', {
    method: 'POST',
    body: formData,
  })
  return handleJson(r)
}

export async function getAutomationPreview() {
  const r = await fetch('/api/automation/preview')
  return handleJson(r)
}

/** Declarative Playwright flow scripts per scenario (GET/PUT with full document). */
export async function getFlowScripts() {
  const r = await fetch('/api/settings/flow-scripts')
  return handleJson(r)
}

export async function putFlowScripts(body) {
  const r = await fetch('/api/settings/flow-scripts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function getAutomationsSchema() {
  const r = await fetch('/api/automations/schema')
  return handleJson(r)
}

export async function listAutomations() {
  const r = await fetch('/api/automations')
  return handleJson(r)
}

export async function getAutomation(id) {
  const r = await fetch(`/api/automations/${id}`)
  return handleJson(r)
}

export async function createAutomation(body = {}) {
  const r = await fetch('/api/automations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function updateAutomation(id, body) {
  const r = await fetch(`/api/automations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function deleteAutomation(id) {
  const r = await fetch(`/api/automations/${id}`, { method: 'DELETE' })
  return handleJson(r)
}

export async function duplicateAutomation(id) {
  const r = await fetch(`/api/automations/${id}/duplicate`, { method: 'POST' })
  return handleJson(r)
}

export async function runAutomation(id, body = {}) {
  const r = await fetch(`/api/automations/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleJson(r)
}

export async function listAutomationPresets() {
  const r = await fetch('/api/automations/presets')
  return handleJson(r)
}

export async function installAutomationPreset(presetId) {
  const r = await fetch(`/api/automations/presets/${presetId}/install`, { method: 'POST' })
  return handleJson(r)
}

export async function getXPathPickerStatus() {
  const r = await fetch('/api/xpath-picker/status')
  return handleJson(r)
}

export async function getXPathPickerPreview() {
  const r = await fetch('/api/xpath-picker/preview')
  return handleJson(r)
}

export async function startXPathPicker(url, headless = false) {
  const r = await fetch('/api/xpath-picker/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, headless }),
  })
  return handleJson(r)
}

export async function stopXPathPicker() {
  const r = await fetch('/api/xpath-picker/stop', { method: 'POST' })
  return handleJson(r)
}

export async function navigateXPathPicker(url) {
  const r = await fetch('/api/xpath-picker/navigate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  return handleJson(r)
}

export async function refreshXPathPicker() {
  const r = await fetch('/api/xpath-picker/refresh', { method: 'POST' })
  return handleJson(r)
}

export async function clearXPathPickerElements() {
  const r = await fetch('/api/xpath-picker/clear', { method: 'POST' })
  return handleJson(r)
}
