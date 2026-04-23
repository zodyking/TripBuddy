import pg from 'pg'

const { Pool } = pg

const TABLE = 'fedextool_kv'

/** @type {import('pg').Pool | null} */
let pool = null
let schemaReady = false
let canUse = false

function connectionString() {
  const s = (process.env.DATABASE_URL || '').trim()
  if (s) return s
  const host = (process.env.PGHOST || 'localhost').trim()
  const port = Number(process.env.PGPORT || 5432)
  const user = (process.env.PGUSER || 'postgres').trim()
  const pass = process.env.PGPASSWORD || ''
  const db = (process.env.PGDATABASE || 'fedextool').trim()
  if (process.env.USE_LOCAL_POSTGRES === '1') {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`
  }
  return null
}

/**
 * @returns {boolean} True if DATABASE_URL (or local postgres env) is configured
 */
export function isPostgresConfigured() {
  if ((process.env.DATABASE_URL || '').trim()) return true
  if ((process.env.USE_LOCAL_POSTGRES || '') === '1') return true
  return false
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
 * @param {string} key
 * @returns {Promise<unknown | null>} Parsed JSON, or null if missing
 */
export async function pgGetJson(key) {
  const p = await getPostgresPool()
  if (!p) return null
  try {
    const { rows } = await p.query(`SELECT v FROM ${TABLE} WHERE k = $1`, [key])
    if (rows[0] && rows[0].v !== undefined) return rows[0].v
  } catch (e) {
    console.error(`[kv-pg] get ${key}:`, e.message || e)
  }
  return null
}

/**
 * @param {string} key
 * @param {unknown} value JSON-serializable
 */
export async function pgSetJson(key, value) {
  const p = await getPostgresPool()
  if (!p) {
    throw new Error('PostgreSQL is not available')
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
