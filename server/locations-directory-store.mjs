import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'

const DIRECTORY_FILE = path.join(LOCAL_DIR, 'locations-directory.json')

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
 * Read the entire directory from disk.
 * @returns {Promise<Record<string, LocationEntry>>}
 */
export async function readDirectory() {
  try {
    const raw = await fs.readFile(DIRECTORY_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Compare two location entries (ignoring lastUpdated).
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
 * Insert or update a location entry. Only writes if data actually changed.
 * @param {Omit<LocationEntry, 'lastUpdated'>} data
 * @returns {Promise<{ updated: boolean, entry: LocationEntry }>}
 */
export async function upsertLocation(data) {
  if (!data || !data.locationId) {
    throw new Error('locationId is required')
  }

  await fs.mkdir(LOCAL_DIR, { recursive: true })

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
  await fs.writeFile(DIRECTORY_FILE, JSON.stringify(directory, null, 2), 'utf8')

  return { updated: true, entry }
}

/**
 * Get all locations as an array sorted by locationName.
 * @returns {Promise<LocationEntry[]>}
 */
export async function listLocations() {
  const directory = await readDirectory()
  return Object.values(directory).sort((a, b) =>
    (a.locationName || '').localeCompare(b.locationName || ''),
  )
}

/**
 * Update only the phone field for a location (shared directory).
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
  await fs.writeFile(DIRECTORY_FILE, JSON.stringify(directory, null, 2), 'utf8')
  return { updated: true, entry }
}
