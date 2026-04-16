import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { LOCAL_DIR } from './config.mjs'

const LOG_FILE = path.join(LOCAL_DIR, 'access-log.json')
/** When `FEDEX_TOOL_DATA_DIR` points elsewhere, dev logs may still live under `server/.local`. */
const LEGACY_DEV_LOG_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.local',
  'access-log.json',
)
const MAX_ENTRIES = 500

/**
 * @typedef {Object} AccessLogEntry
 * @property {string} id
 * @property {string} at ISO timestamp
 * @property {string} ip
 * @property {string|null} forwardedFor raw X-Forwarded-For if present
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {number|null} accuracyM
 * @property {boolean} locationDenied client reported geolocation unavailable
 * @property {string|null} userAgent
 * @property {string} source e.g. login_ack
 */

/**
 * @param {string} file
 * @returns {Promise<AccessLogEntry[]>}
 */
async function readEntriesFromFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const data = JSON.parse(raw)
    if (data && Array.isArray(data.entries)) return data.entries
  } catch {
    /* empty */
  }
  return []
}

async function readRaw() {
  /** Merge primary store with legacy dev file when paths differ (fixes empty Security log in dev). */
  const paths = new Set([LOG_FILE])
  if (LEGACY_DEV_LOG_FILE !== LOG_FILE) {
    paths.add(LEGACY_DEV_LOG_FILE)
  }
  /** @type {Map<string, AccessLogEntry>} */
  const byId = new Map()
  for (const p of paths) {
    const chunk = await readEntriesFromFile(p)
    for (const e of chunk) {
      if (e && typeof e.id === 'string' && !byId.has(e.id)) {
        byId.set(e.id, e)
      }
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  )
}

/**
 * @param {Omit<AccessLogEntry, 'id' | 'at'> & { id?: string, at?: string }} row
 * @returns {Promise<AccessLogEntry>}
 */
export async function appendAccessEntry(row) {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  const entries = await readRaw()
  const entry = {
    id: row.id || crypto.randomBytes(8).toString('hex'),
    at: row.at || new Date().toISOString(),
    ip: String(row.ip || ''),
    forwardedFor: row.forwardedFor ?? null,
    latitude:
      row.latitude != null && Number.isFinite(Number(row.latitude))
        ? Number(row.latitude)
        : null,
    longitude:
      row.longitude != null && Number.isFinite(Number(row.longitude))
        ? Number(row.longitude)
        : null,
    accuracyM:
      row.accuracyM != null && Number.isFinite(Number(row.accuracyM))
        ? Number(row.accuracyM)
        : null,
    locationDenied: row.locationDenied === true,
    userAgent: typeof row.userAgent === 'string' ? row.userAgent.slice(0, 512) : null,
    source: typeof row.source === 'string' ? row.source.slice(0, 64) : 'login_ack',
  }
  entries.unshift(entry)
  const trimmed = entries.slice(0, MAX_ENTRIES)
  await fs.writeFile(LOG_FILE, JSON.stringify({ entries: trimmed }, null, 2), 'utf8')
  return entry
}

/**
 * @returns {Promise<AccessLogEntry[]>}
 */
export async function listAccessEntries() {
  return readRaw()
}
