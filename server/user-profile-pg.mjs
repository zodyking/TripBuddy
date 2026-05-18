/**
 * Per-user profile in PostgreSQL (fedextool_user_profile).
 * Stores API keys (TomTom, HERE) encrypted at rest (same AES-256-GCM pattern as credentials).
 */
import crypto from 'node:crypto'
import { getPostgresPool } from './kv-pg.mjs'

const TABLE = 'fedextool_user_profile'
const ALGO = 'aes-256-gcm'
const SCRYPT_SALT = 'fedextool-user-prof-v1'

function deriveKey() {
  const secret =
    process.env.FEDEX_TOOL_SECRET ||
    'fedextool-dev-only-change-fedx-tool-secret-in-env'
  return crypto.scryptSync(secret, SCRYPT_SALT, 32)
}

function encryptString(plain) {
  const key = deriveKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  }
}

function decryptString(blob) {
  if (!blob?.data || !blob?.iv || !blob?.tag) return ''
  const key = deriveKey()
  const iv = Buffer.from(blob.iv, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const data = Buffer.from(blob.data, 'base64')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export async function ensureUserProfileTable() {
  const p = await getPostgresPool()
  if (!p) return
  const client = await p.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        account_key TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        tomtom_api_key_enc JSONB,
        here_api_key_enc JSONB
      )
    `)
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${TABLE}_updated_at ON ${TABLE} (updated_at)`,
    )
    // Add HERE column if table already exists without it
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS here_api_key_enc JSONB
    `)
    // Add 511NY column if table already exists without it
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ny511_api_key_enc JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS api_quota_state JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS gwb_upper_cam_youtube_url TEXT
    `)
  } finally {
    client.release()
  }
}

/**
 * @param {string} accountKey
 * @returns {Promise<string>} decrypted key or ''
 */
export async function getTomtomApiKeyForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return ''
  const p = await getPostgresPool()
  if (!p) return ''
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT tomtom_api_key_enc FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const enc = rows[0]?.tomtom_api_key_enc
  if (!enc || typeof enc !== 'object') return ''
  try {
    return decryptString(enc).trim()
  } catch {
    return ''
  }
}

/**
 * @param {string} accountKey
 * @param {string} rawKey plain key or empty to clear
 */
export async function setTomtomApiKeyForAccount(accountKey, rawKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const v = String(rawKey ?? '').trim()
  const enc = v ? encryptString(v) : null
  await p.query(
    `INSERT INTO ${TABLE} (account_key, tomtom_api_key_enc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (account_key) DO UPDATE SET
       tomtom_api_key_enc = EXCLUDED.tomtom_api_key_enc,
       updated_at = now()`,
    [ak, enc ? JSON.stringify(enc) : null],
  )
}

/**
 * @param {string} accountKey
 * @returns {Promise<string>} decrypted key or ''
 */
export async function getHereApiKeyForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return ''
  const p = await getPostgresPool()
  if (!p) return ''
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT here_api_key_enc FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const enc = rows[0]?.here_api_key_enc
  if (!enc || typeof enc !== 'object') return ''
  try {
    return decryptString(enc).trim()
  } catch {
    return ''
  }
}

/**
 * @param {string} accountKey
 * @param {string} rawKey plain key or empty to clear
 */
export async function setHereApiKeyForAccount(accountKey, rawKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const v = String(rawKey ?? '').trim()
  const enc = v ? encryptString(v) : null
  await p.query(
    `INSERT INTO ${TABLE} (account_key, here_api_key_enc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (account_key) DO UPDATE SET
       here_api_key_enc = EXCLUDED.here_api_key_enc,
       updated_at = now()`,
    [ak, enc ? JSON.stringify(enc) : null],
  )
}

/**
 * @param {string} accountKey
 * @returns {Promise<string>} decrypted key or ''
 */
export async function getNy511ApiKeyForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return ''
  const p = await getPostgresPool()
  if (!p) return ''
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT ny511_api_key_enc FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const enc = rows[0]?.ny511_api_key_enc
  if (!enc || typeof enc !== 'object') return ''
  try {
    return decryptString(enc).trim()
  } catch {
    return ''
  }
}

/**
 * @param {string} accountKey
 * @param {string} rawKey plain key or empty to clear
 */
export async function setNy511ApiKeyForAccount(accountKey, rawKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const v = String(rawKey ?? '').trim()
  const enc = v ? encryptString(v) : null
  await p.query(
    `INSERT INTO ${TABLE} (account_key, ny511_api_key_enc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (account_key) DO UPDATE SET
       ny511_api_key_enc = EXCLUDED.ny511_api_key_enc,
       updated_at = now()`,
    [ak, enc ? JSON.stringify(enc) : null],
  )
}

const GWB_YT_URL_MAX = 512

/**
 * @param {string} accountKey
 * @returns {Promise<string>} trimmed URL or ''
 */
export async function getGwbUpperCamYoutubeUrlForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return ''
  const p = await getPostgresPool()
  if (!p) return ''
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT gwb_upper_cam_youtube_url FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const u = rows[0]?.gwb_upper_cam_youtube_url
  return typeof u === 'string' ? u.trim().slice(0, GWB_YT_URL_MAX) : ''
}

/**
 * @param {string} accountKey
 * @param {string} rawUrl full watch/embed/shorts URL or empty to clear
 */
export async function setGwbUpperCamYoutubeUrlForAccount(accountKey, rawUrl) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const v = String(rawUrl ?? '')
    .trim()
    .slice(0, GWB_YT_URL_MAX)
  await p.query(
    `INSERT INTO ${TABLE} (account_key, gwb_upper_cam_youtube_url, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (account_key) DO UPDATE SET
       gwb_upper_cam_youtube_url = EXCLUDED.gwb_upper_cam_youtube_url,
       updated_at = now()`,
    [ak, v || null],
  )
}
