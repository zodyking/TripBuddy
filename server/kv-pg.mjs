import pg from 'pg'
import { DATABASE_URL } from './config.mjs'

const { Pool } = pg

const TABLE = 'fedextool_kv'

/** @type {import('pg').Pool | null} */
let pool = null
let schemaReady = false
let canUse = false

/**
 * @returns {string} Required for all persistence. No in-repo default without explicit opt-in to local dev.
 */
function connectionString() {
  const s = (process.env.DATABASE_URL || '').trim()
  if (s) return s
  if (process.env.NODE_ENV === 'test' && process.env.FEDEX_TOOL_TEST_PG_URL) {
    return process.env.FEDEX_TOOL_TEST_PG_URL
  }
  if ((process.env.USE_LOCAL_POSTGRES || '') === '1') {
    const host = (process.env.PGHOST || 'localhost').trim()
    const port = Number(process.env.PGPORT || 5432)
    const user = (process.env.PGUSER || 'postgres').trim()
    const pass = process.env.PGPASSWORD || ''
    const db = (process.env.PGDATABASE || 'fedextool').trim()
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`
  }
  return null
}

export function isPostgresConfigured() {
  return !!connectionString()
}

/**
 * @returns {Promise<import('pg').Pool | null>}
 */
export async function getPostgresPool() {
  if (!isPostgresConfigured()) return null
  if (pool) return pool
  const c = connectionString()
  if (!c) return null
  pool = new Pool({ connectionString: c, max: 10, idleTimeoutMillis: 10_000 })
  try {
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          k TEXT PRIMARY KEY,
          v JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${TABLE}_updated_at ON ${TABLE} (updated_at)`,
      )
    } finally {
      client.release()
    }
    schemaReady = true
    canUse = true
  } catch (e) {
    console.error('[kv-pg] Failed to init PostgreSQL:', e.message || e)
    canUse = false
    if (pool) {
      await pool.end().catch(() => {})
      pool = null
    }
  }
  return canUse ? pool : null
}

/**
 * Boot-time: require PostgreSQL with retries (Dokploy often restarts app + DB together).
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 */
export async function requirePostgresOrThrow(opts = {}) {
  const attempts = Math.max(1, Math.min(30, Math.floor(opts.attempts ?? 12)))
  const delayMs = Math.max(500, Math.min(15_000, Math.floor(opts.delayMs ?? 2500)))
  if (!isPostgresConfigured()) {
    throw new Error(
      'DATABASE_URL is required. Set it to a PostgreSQL connection string (Dokploy service or managed DB).',
    )
  }
  let lastErr = ''
  for (let i = 1; i <= attempts; i += 1) {
    if (pool && !canUse) {
      await pool.end().catch(() => {})
      pool = null
      schemaReady = false
      canUse = false
    }
    const p = await getPostgresPool()
    if (p && canUse) {
      if (i > 1) {
        console.log(`[postgres] Connected after ${i} attempt(s)`)
      }
      return
    }
    lastErr = 'PostgreSQL connection failed. Check DATABASE_URL and network access.'
    if (i < attempts) {
      console.warn(`[postgres] Attempt ${i}/${attempts} failed; retrying in ${delayMs}ms…`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error(lastErr)
}

/**
 * @param {string} key
 * @returns {Promise<unknown | null>} Parsed JSON, or null if missing
 */
export async function pgGetJson(key) {
  const p = await getPostgresPool()
  if (!p) {
    throw new Error('Database not available')
  }
  const { rows } = await p.query(`SELECT v FROM ${TABLE} WHERE k = $1`, [key])
  if (rows[0] && rows[0].v !== undefined) return rows[0].v
  return null
}

/**
 * @param {string} key
 * @param {unknown} value JSON-serializable
 */
export async function pgSetJson(key, value) {
  const p = await getPostgresPool()
  if (!p) {
    throw new Error('Database not available')
  }
  const s = JSON.stringify(value)
  await p.query(
    `INSERT INTO ${TABLE} (k, v, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
    [key, s],
  )
}

export async function closePostgresPool() {
  if (pool) {
    await pool.end().catch(() => {})
    pool = null
    canUse = false
    schemaReady = false
  }
}

export function postgresReady() {
  return canUse && schemaReady
}

export { DATABASE_URL }
