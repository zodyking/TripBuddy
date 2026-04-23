import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_DIR } from './config.mjs'
import { readKVJson, writeKVJson } from './kv-store.mjs'

const DIRECTORY_KV = 'directory:locations'
const DIRECTORY_FILE = path.join(LOCAL_DIR, 'locations-directory.json')
/** Same pattern as access-log: dev may have old data only under `server/.local`. */
const LEGACY_DEV_DIRECTORY_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.local',
  'locations-directory.json',
)

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
 * @param {string} file
 * @returns {Promise<Record<string, LocationEntry>>}
 */
async function readDirectoryFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return /** @type {Record<string, LocationEntry>} */ (data)
    }
  } catch {
    /* empty */
  }
  return {}
}

function newerEntry(a, b) {
  const ta = Date.parse(a.lastUpdated || '') || 0
  const tb = Date.parse(b.lastUpdated || '') || 0
  return ta >= tb ? a : b
}

/**
 * Read the entire directory from disk (merges primary + legacy dev file when paths differ).
 * @returns {Promise<Record<string, LocationEntry>>}
 */
export async function readDirectory() {
  const fromKv = await readKVJson(
    DIRECTORY_KV,
    DIRECTORY_FILE,
    () => ({}),
  )
  const primary =
    fromKv && typeof fromKv === 'object' && !Array.isArray(fromKv)
      ? /** @type {Record<string, LocationEntry>} */ (fromKv)
      : await readDirectoryFile(DIRECTORY_FILE)
  if (LEGACY_DEV_DIRECTORY_FILE === DIRECTORY_FILE) {
    return primary
  }
  const legacy = await readDirectoryFile(LEGACY_DEV_DIRECTORY_FILE)
  /** @type {Record<string, LocationEntry>} */
  const merged = { ...primary }
  for (const [id, leg] of Object.entries(legacy)) {
    const cur = merged[id]
    if (!cur) {
      merged[id] = leg
    } else {
      merged[id] = newerEntry(cur, leg)
    }
  }
  return merged
}

/**
 * Persist full directory object to the canonical file (and mirror legacy dev path when needed).
 * @param {Record<string, LocationEntry>} directory
 */
async function writeDirectoryFile(directory) {
  await writeKVJson(DIRECTORY_KV, DIRECTORY_FILE, directory)
  const payload = JSON.stringify(directory, null, 2)
  if (LEGACY_DEV_DIRECTORY_FILE !== DIRECTORY_FILE) {
    await fs.mkdir(path.dirname(LEGACY_DEV_DIRECTORY_FILE), { recursive: true })
    await fs.writeFile(LEGACY_DEV_DIRECTORY_FILE, payload, 'utf8')
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
  await writeDirectoryFile(directory)

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
  await writeDirectoryFile(directory)
  return { updated: true, entry }
}
