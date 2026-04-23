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
    a.timeZone === b.timeZone
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
 * @param {string} phone
 * @returns {Promise<{ updated: boolean, entry: LocationEntry }>}
 */
export async function updateLocationPhone(locationId, phone) {
  if (!locationId) {
    throw new Error('locationId is required')
  }
  const directory = await readDirectory()
  const existing = directory[locationId]
  if (!existing) {
    throw new Error('Location not found')
  }
  const nextPhone = String(phone ?? '').trim()
  const entry = {
    ...existing,
    phone: nextPhone,
    lastUpdated: new Date().toISOString(),
  }
  if (existing.phone === entry.phone) {
    return { updated: false, entry: existing }
  }
  directory[locationId] = entry
  await writeDirectory(directory)
  return { updated: true, entry }
}
