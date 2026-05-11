import { forwardGeocodeNominatim } from './ip-geolocation.mjs'
import { readDirectory, patchLocation } from './locations-directory-store.mjs'

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
 * Count directory entries with a non-empty address but missing coordinates.
 * @param {Record<string, import('./locations-directory-store.mjs').LocationEntry>} directory
 */
function countMissingCoords(directory) {
  let n = 0
  for (const e of Object.values(directory)) {
    if (!e) continue
    const addr = String(e.address ?? '').trim()
    if (!addr) continue
    const lat = e.latitude != null ? Number(e.latitude) : NaN
    const lng = e.longitude != null ? Number(e.longitude) : NaN
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) n++
  }
  return n
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
  const lat0 = existing.latitude != null ? Number(existing.latitude) : NaN
  const lng0 = existing.longitude != null ? Number(existing.longitude) : NaN
  if (Number.isFinite(lat0) && Number.isFinite(lng0)) {
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
 * Waits `delayMs` between Nominatim calls (usage policy).
 * @param {{ max?: number, delayMs?: number }} [opts]
 */
export async function geocodeMissingDirectoryLocations(opts = {}) {
  const max = Math.min(30, Math.max(1, Number(opts.max) || 8))
  const delayMs = Math.max(900, Number(opts.delayMs) || 1100)

  let directory = await readDirectory()
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
    const lat = e.latitude != null ? Number(e.latitude) : NaN
    const lng = e.longitude != null ? Number(e.longitude) : NaN
    if (Number.isFinite(lat) && Number.isFinite(lng)) continue

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
    } catch (err) {
      failed.push({
        locationId: id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    directory = await readDirectory()
  }

  const remaining = countMissingCoords(await readDirectory())

  return {
    ok: true,
    updated,
    processed,
    failed,
    remaining,
  }
}
