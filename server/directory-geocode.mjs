import { forwardGeocodeNominatim } from './ip-geolocation.mjs'
import { readDirectory, patchLocation } from './locations-directory-store.mjs'
import { emitLog } from './log-bus.mjs'

/**
 * @param {string} a
 * @param {string} b
 */
function compareLocationIdNumeric(a, b) {
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  const na = parseInt(sa, 10)
  const nb = parseInt(sb, 10)
  const aNum = /^\d+$/.test(sa) && Number.isFinite(na)
  const bNum = /^\d+$/.test(sb) && Number.isFinite(nb)
  if (aNum && bNum && na !== nb) return na - nb
  if (aNum && !bNum) return -1
  if (!aNum && bNum) return 1
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * @param {import('./locations-directory-store.mjs').LocationEntry | null | undefined} e
 */
function hasValidCoords(e) {
  if (!e) return false
  const rawLat = e.latitude
  const rawLng = e.longitude
  if (rawLat == null || rawLng == null) return false
  if (rawLat === '' || rawLng === '') return false
  const lat = Number(rawLat)
  const lng = Number(rawLng)
  return Number.isFinite(lat) && Number.isFinite(lng)
}

/**
 * Count directory entries with a non-empty address but missing coordinates.
 * @param {Record<string, import('./locations-directory-store.mjs').LocationEntry>} directory
 */
function countMissingCoords(directory) {
  let n = 0
  for (const e of Object.values(directory)) {
    if (!e) continue
    const addr = String(e.address ?? '').trim()
    if (!addr) continue
    if (!hasValidCoords(e)) n++
  }
  return n
}

/** @type {{ inBatch: boolean, lastRemaining: number, lastMissingBefore: number, lastUpdated: number, lastProcessed: number, lastFailed: number, lastBatchAt: number | null, lastError: string | null }} */
const geocodeStatus = {
  inBatch: false,
  lastRemaining: 0,
  lastMissingBefore: 0,
  lastUpdated: 0,
  lastProcessed: 0,
  lastFailed: 0,
  lastBatchAt: null,
  lastError: null,
}

/** Serialize concurrent batch runs (HTTP + background worker). */
let geocodeMutex = Promise.resolve()

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withGeocodeLock(fn) {
  const prev = geocodeMutex
  /** @type {(v?: void) => void} */
  let release = () => {}
  geocodeMutex = new Promise((r) => {
    release = r
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

function envInt(name, fallback, min, max) {
  const n = Math.floor(Number(process.env[name]))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Snapshot for Directory UI (poll). Does not start geocoding.
 */
export function getDirectoryGeocodeStatus() {
  return {
    ok: true,
    inBatch: geocodeStatus.inBatch,
    lastRemaining: geocodeStatus.lastRemaining,
    lastMissingBefore: geocodeStatus.lastMissingBefore,
    lastUpdated: geocodeStatus.lastUpdated,
    lastProcessed: geocodeStatus.lastProcessed,
    lastFailed: geocodeStatus.lastFailed,
    lastBatchAt: geocodeStatus.lastBatchAt,
    lastError: geocodeStatus.lastError,
  }
}

/**
 * Geocode one directory row by id (address → lat/lng, persisted).
 * @param {string} locationId
 * @returns {Promise<{ ok: boolean, updated: boolean, error?: string, entry?: import('./locations-directory-store.mjs').LocationEntry }>}
 */
export async function geocodeDirectoryLocationById(locationId) {
  const id = String(locationId ?? '').trim()
  if (!id) {
    return { ok: false, updated: false, error: 'locationId is required' }
  }
  const directory = await readDirectory()
  const existing = directory[id]
  if (!existing) {
    return { ok: false, updated: false, error: 'Location not found' }
  }
  const addr = String(existing.address ?? '').trim()
  if (!addr) {
    return { ok: false, updated: false, error: 'No address to geocode' }
  }
  if (hasValidCoords(existing)) {
    return { ok: true, updated: false, entry: existing }
  }

  const coords = await forwardGeocodeNominatim(addr)
  if (!coords) {
    return { ok: false, updated: false, error: 'Geocoder returned no results' }
  }

  const result = await patchLocation(id, {
    latitude: coords.lat,
    longitude: coords.lng,
  })
  return { ok: true, updated: result.updated, entry: result.entry }
}

/**
 * Geocode up to `max` locations that have an address but no coordinates.
 * Waits `delayMs` between Nominatim calls (usage policy: ~1 req/s per deployment).
 * @param {{ max?: number, delayMs?: number }} [opts]
 */
async function geocodeMissingDirectoryLocationsImpl(opts = {}) {
  const defMax = envInt('DIRECTORY_GEOCODE_BATCH_MAX', 30, 1, 60)
  const defDelay = envInt('DIRECTORY_GEOCODE_DELAY_MS', 1150, 1000, 3000)
  const max = Math.min(60, Math.max(1, Number(opts.max) || defMax))
  const delayMs = Math.min(3000, Math.max(1000, Number(opts.delayMs) || defDelay))

  let directory = await readDirectory()
  const missingBefore = countMissingCoords(directory)
  geocodeStatus.lastMissingBefore = missingBefore
  const ids = Object.keys(directory).sort(compareLocationIdNumeric)

  /** @type {{ locationId: string, error: string }[]} */
  const failed = []
  let updated = 0
  let processed = 0
  let first = true

  for (const id of ids) {
    if (processed >= max) break
    const e = directory[id]
    if (!e) continue
    const addr = String(e.address ?? '').trim()
    if (!addr) continue
    if (hasValidCoords(e)) continue

    if (!first) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
    first = false

    processed++
    const coords = await forwardGeocodeNominatim(addr)
    if (!coords) {
      failed.push({ locationId: id, error: 'No geocode result' })
      continue
    }

    try {
      const result = await patchLocation(id, {
        latitude: coords.lat,
        longitude: coords.lng,
      })
      if (result.updated) updated++
      directory[id] = result.entry
    } catch (err) {
      failed.push({
        locationId: id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  directory = await readDirectory()
  const remaining = countMissingCoords(directory)

  geocodeStatus.lastRemaining = remaining
  geocodeStatus.lastMissingBefore = missingBefore
  geocodeStatus.lastUpdated = updated
  geocodeStatus.lastProcessed = processed
  geocodeStatus.lastFailed = failed.length
  geocodeStatus.lastBatchAt = Date.now()
  geocodeStatus.lastError = failed.length ? `${failed.length} failed in batch` : null

  return {
    ok: true,
    updated,
    processed,
    failed,
    remaining,
    missingBefore,
  }
}

/**
 * @param {{ max?: number, delayMs?: number }} [opts]
 */
export async function geocodeMissingDirectoryLocations(opts = {}) {
  return withGeocodeLock(async () => {
    geocodeStatus.inBatch = true
    geocodeStatus.lastError = null
    try {
      return await geocodeMissingDirectoryLocationsImpl(opts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      geocodeStatus.lastError = msg
      emitLog('error', `[directory-geocode] batch failed: ${msg}`)
      throw e
    } finally {
      geocodeStatus.inBatch = false
    }
  })
}

let workerTimer = null

/**
 * Background worker: periodically processes a small batch so the API does not
 * depend on the Directory page or a signed-in browser tab.
 */
export function startDirectoryGeocodeBackground() {
  if (workerTimer) return { ok: false, message: 'Directory geocode worker already running' }

  const intervalMs = envInt('DIRECTORY_GEOCODE_WORKER_INTERVAL_MS', 22_000, 8000, 180_000)
  const batchMax = envInt('DIRECTORY_GEOCODE_WORKER_BATCH_MAX', 12, 1, 30)
  const delayMs = envInt('DIRECTORY_GEOCODE_DELAY_MS', 1150, 1000, 3000)

  const tick = async () => {
    try {
      const dir = await readDirectory()
      const missing = countMissingCoords(dir)
      if (missing <= 0) return
      await geocodeMissingDirectoryLocations({ max: batchMax, delayMs })
    } catch {
      /* logged in geocodeMissingDirectoryLocations */
    }
  }

  emitLog(
    'info',
    `[directory-geocode] background worker every ${intervalMs}ms (batch max ${batchMax}, nominatim delay ${delayMs}ms)`,
  )

  workerTimer = setInterval(() => {
    void tick()
  }, intervalMs)

  if (typeof workerTimer.unref === 'function') {
    workerTimer.unref()
  }

  const initialDelayMs = envInt('DIRECTORY_GEOCODE_WORKER_START_MS', 8000, 2000, 120_000)
  setTimeout(() => {
    void tick()
  }, initialDelayMs)

  return { ok: true, intervalMs, batchMax, delayMs, initialDelayMs }
}
