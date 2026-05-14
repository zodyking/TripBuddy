import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { G } from './scope-kv.mjs'

const DIRECTORY_KV = G('directory:locations')

/**
 * @typedef {Object} LocationEntry
 * @property {string} locationId
 * @property {string} locationName
 * @property {string} abbreviation
 * @property {string} address
 * @property {string} phone
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {string} timeZone
 * @property {string} lastUpdated
 * @property {string} [locationType] - e.g. STATION, SUBSTATION, HUB
 * @property {string} [district] - e.g. NEW YORK METRO, NORTHEAST
 */

/**
 * @returns {Promise<Record<string, LocationEntry>>}
 */
export async function readDirectory() {
  const fromKv = await readKeyJson(DIRECTORY_KV, () => ({}))
  if (fromKv && typeof fromKv === 'object' && !Array.isArray(fromKv)) {
    return /** @type {Record<string, LocationEntry>} */ (fromKv)
  }
  return {}
}

/**
 * @param {Record<string, LocationEntry>} directory
 */
async function writeDirectory(directory) {
  await writeKeyJson(DIRECTORY_KV, directory)
}

/**
 * Use `next` when non-empty after trim; otherwise keep `prev` (so trip auto-save does not wipe CSV import fields).
 * @param {unknown} next
 * @param {unknown} prev
 */
function mergeOptionalTextField(next, prev) {
  const s = next == null ? '' : String(next).trim()
  if (s) return s
  return prev == null ? '' : String(prev).trim()
}

/**
 * @param {LocationEntry} a
 * @param {LocationEntry} b
 * @returns {boolean}
 */
function entriesEqual(a, b) {
  return (
    a.locationId === b.locationId &&
    a.locationName === b.locationName &&
    a.abbreviation === b.abbreviation &&
    a.address === b.address &&
    a.phone === b.phone &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.timeZone === b.timeZone &&
    (a.locationType ?? '') === (b.locationType ?? '') &&
    (a.district ?? '') === (b.district ?? '')
  )
}

/**
 * @param {Omit<LocationEntry, 'lastUpdated'>} data
 * @returns {Promise<{ updated: boolean, entry: LocationEntry }>}
 */
export async function upsertLocation(data) {
  if (!data || !data.locationId) {
    throw new Error('locationId is required')
  }
  const directory = await readDirectory()
  const existing = directory[data.locationId]

  const entry = {
    locationId: String(data.locationId),
    locationName: String(data.locationName ?? ''),
    abbreviation: String(data.abbreviation ?? ''),
    address: String(data.address ?? ''),
    phone: String(data.phone ?? ''),
    latitude: data.latitude != null ? Number(data.latitude) : null,
    longitude: data.longitude != null ? Number(data.longitude) : null,
    timeZone: String(data.timeZone ?? ''),
    lastUpdated: new Date().toISOString(),
    locationType: mergeOptionalTextField(data.locationType, existing?.locationType),
    district: mergeOptionalTextField(data.district, existing?.district),
  }

  if (existing && entriesEqual(existing, entry)) {
    return { updated: false, entry: existing }
  }

  directory[data.locationId] = entry
  await writeDirectory(directory)
  return { updated: true, entry }
}

/**
 * @returns {Promise<LocationEntry[]>}
 */
export async function listLocations() {
  const directory = await readDirectory()
  return Object.values(directory).sort((a, b) =>
    (a.locationName || '').localeCompare(b.locationName || ''),
  )
}

/**
 * @param {string} locationId
 * @param {{
 *   phone?: string,
 *   locationName?: string,
 *   abbreviation?: string,
 *   address?: string,
 *   locationId?: string,
 *   latitude?: number | null,
 *   longitude?: number | null,
 * }} patch
 * @returns {Promise<{ updated: boolean, entry: LocationEntry }>}
 */
export async function patchLocation(locationId, patch) {
  if (!locationId) {
    throw new Error('locationId is required')
  }
  if (!patch || typeof patch !== 'object') {
    throw new Error('Invalid patch')
  }
  const directory = await readDirectory()
  const existing = directory[locationId]
  if (!existing) {
    throw new Error('Location not found')
  }

  const nextId =
    patch.locationId !== undefined && String(patch.locationId).trim()
      ? String(patch.locationId).trim()
      : existing.locationId

  if (!nextId) {
    throw new Error('locationId is required')
  }

  if (nextId !== locationId && directory[nextId]) {
    throw new Error('Location ID already exists')
  }

  const nextLat =
    patch.latitude !== undefined
      ? patch.latitude == null || Number.isNaN(Number(patch.latitude))
        ? null
        : Number(patch.latitude)
      : existing.latitude
  const nextLng =
    patch.longitude !== undefined
      ? patch.longitude == null || Number.isNaN(Number(patch.longitude))
        ? null
        : Number(patch.longitude)
      : existing.longitude

  const entry = {
    ...existing,
    locationId: nextId,
    locationName:
      patch.locationName !== undefined
        ? String(patch.locationName ?? '')
        : existing.locationName,
    abbreviation:
      patch.abbreviation !== undefined
        ? String(patch.abbreviation ?? '')
        : existing.abbreviation,
    address:
      patch.address !== undefined ? String(patch.address ?? '') : existing.address,
    phone:
      patch.phone !== undefined ? String(patch.phone ?? '').trim() : existing.phone,
    latitude: nextLat,
    longitude: nextLng,
    lastUpdated: new Date().toISOString(),
  }

  if (nextId === locationId && entriesEqual(existing, entry)) {
    return { updated: false, entry: existing }
  }

  if (nextId !== locationId) {
    delete directory[locationId]
  }
  directory[nextId] = entry
  await writeDirectory(directory)
  return { updated: true, entry }
}

/**
 * @param {string} locationId
 * @param {string} phone
 * @returns {Promise<{ updated: boolean, entry: LocationEntry }>}
 */
export async function updateLocationPhone(locationId, phone) {
  return patchLocation(locationId, { phone })
}

/**
 * Bulk upsert multiple locations at once (import).
 * @param {Array<Omit<import('./locations-directory-store.mjs').LocationEntry, 'lastUpdated'>>} entries
 * @returns {Promise<{ inserted: number, updated: number, skipped: number }>}
 */
export async function bulkUpsertLocations(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('entries must be an array')
  }
  const directory = await readDirectory()
  let inserted = 0
  let updated = 0
  let skipped = 0
  const now = new Date().toISOString()

  for (const data of entries) {
    if (!data || !data.locationId) {
      skipped++
      continue
    }
    const existing = directory[data.locationId]
    const entry = {
      locationId: String(data.locationId),
      locationName: String(data.locationName ?? ''),
      abbreviation: String(data.abbreviation ?? ''),
      address: String(data.address ?? ''),
      phone: String(data.phone ?? ''),
      latitude: data.latitude != null ? Number(data.latitude) : null,
      longitude: data.longitude != null ? Number(data.longitude) : null,
      timeZone: String(data.timeZone ?? ''),
      lastUpdated: now,
      locationType: mergeOptionalTextField(data.locationType, existing?.locationType),
      district: mergeOptionalTextField(data.district, existing?.district),
    }
    if (existing) {
      if (entriesEqual(existing, entry)) {
        skipped++
      } else {
        directory[data.locationId] = entry
        updated++
      }
    } else {
      directory[data.locationId] = entry
      inserted++
    }
  }

  if (inserted > 0 || updated > 0) {
    await writeDirectory(directory)
  }
  return { inserted, updated, skipped }
}
