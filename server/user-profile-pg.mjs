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
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS openrouter_api_key_enc JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS openrouter_model TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS sender_name_translations JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS api_quota_state JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS gwb_upper_cam_youtube_url TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS helpers_auto_arrive_near_dest_enabled BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS helpers_auto_arrive_radius_nm DOUBLE PRECISION
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_chat_id TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_tts_enabled BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_daily_briefing_enabled BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_url TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_api_key_enc JSONB
    `)
  } finally {
    client.release()
  }
}

const WAHA_CHAT_ID_MAX = 256

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

/**
 * @param {string} accountKey
 * @returns {Promise<string>}
 */
export async function getOpenrouterApiKeyForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return ''
  const p = await getPostgresPool()
  if (!p) return ''
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT openrouter_api_key_enc FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const enc = rows[0]?.openrouter_api_key_enc
  if (!enc || typeof enc !== 'object') return ''
  try {
    return decryptString(enc).trim()
  } catch {
    return ''
  }
}

/**
 * @param {string} accountKey
 * @param {string} rawKey
 */
export async function setOpenrouterApiKeyForAccount(accountKey, rawKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const v = String(rawKey ?? '').trim()
  const enc = v ? encryptString(v) : null
  await p.query(
    `INSERT INTO ${TABLE} (account_key, openrouter_api_key_enc, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (account_key) DO UPDATE SET
       openrouter_api_key_enc = EXCLUDED.openrouter_api_key_enc,
       updated_at = now()`,
    [ak, enc ? JSON.stringify(enc) : null],
  )
}

/**
 * @param {string} accountKey
 * @returns {Promise<string>}
 */
export async function getOpenrouterModelForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return ''
  const p = await getPostgresPool()
  if (!p) return ''
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT openrouter_model FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  return String(rows[0]?.openrouter_model ?? '').trim()
}

/**
 * @param {string} accountKey
 * @param {string} modelId
 */
export async function setOpenrouterModelForAccount(accountKey, modelId) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const v = String(modelId ?? '').trim() || null
  await p.query(
    `INSERT INTO ${TABLE} (account_key, openrouter_model, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (account_key) DO UPDATE SET
       openrouter_model = EXCLUDED.openrouter_model,
       updated_at = now()`,
    [ak, v],
  )
}

/**
 * Learned English display strings for non-English sender names (keyed by original text).
 * @param {string} accountKey
 * @returns {Promise<Record<string, string>>}
 */
export async function getSenderNameTranslationsForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return {}
  const p = await getPostgresPool()
  if (!p) return {}
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT sender_name_translations FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const raw = rows[0]?.sender_name_translations
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k ?? '').trim()
    const val = String(v ?? '').trim()
    if (key && val) out[key] = val
  }
  return out
}

/**
 * @param {string} accountKey
 * @param {Record<string, string>} additions original text -> English
 */
export async function mergeSenderNameTranslationsForAccount(accountKey, additions) {
  const ak = String(accountKey || '').trim()
  if (!ak || !additions || typeof additions !== 'object') return
  const p = await getPostgresPool()
  if (!p) return
  await ensureUserProfileTable()
  const current = await getSenderNameTranslationsForAccount(ak)
  const merged = { ...current }
  for (const [k, v] of Object.entries(additions)) {
    const key = String(k ?? '').trim()
    const val = String(v ?? '').trim()
    if (key && val) merged[key] = val
  }
  await p.query(
    `INSERT INTO ${TABLE} (account_key, sender_name_translations, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (account_key) DO UPDATE SET
       sender_name_translations = EXCLUDED.sender_name_translations,
       updated_at = now()`,
    [ak, JSON.stringify(merged)],
  )
}

const GWB_YT_URL_MAX = 512

const HELPERS_RADIUS_NM_MIN = 0.25
const HELPERS_RADIUS_NM_MAX = 25
const HELPERS_RADIUS_NM_DEFAULT = 2

function clampHelpersRadiusNm(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return HELPERS_RADIUS_NM_DEFAULT
  return Math.min(HELPERS_RADIUS_NM_MAX, Math.max(HELPERS_RADIUS_NM_MIN, x))
}

/**
 * @param {string} accountKey
 * @returns {Promise<{ enabled: boolean, radiusNm: number }>}
 */
export async function getHelpersAutoArrivePrefsForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) {
    return { enabled: false, radiusNm: HELPERS_RADIUS_NM_DEFAULT }
  }
  const p = await getPostgresPool()
  if (!p) {
    return { enabled: false, radiusNm: HELPERS_RADIUS_NM_DEFAULT }
  }
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT helpers_auto_arrive_near_dest_enabled, helpers_auto_arrive_radius_nm
     FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const row = rows[0]
  const enabled = row?.helpers_auto_arrive_near_dest_enabled === true
  const rawNm = row?.helpers_auto_arrive_radius_nm
  const nm =
    rawNm != null && Number.isFinite(Number(rawNm))
      ? clampHelpersRadiusNm(Number(rawNm))
      : HELPERS_RADIUS_NM_DEFAULT
  return { enabled, radiusNm: nm }
}

/**
 * @param {string} accountKey
 * @param {{ enabled: boolean, radiusNm: number }} prefs
 */
export async function setHelpersAutoArrivePrefsForAccount(accountKey, prefs) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const enabled = Boolean(prefs?.enabled)
  const radiusNm = clampHelpersRadiusNm(prefs?.radiusNm)
  await p.query(
    `INSERT INTO ${TABLE} (account_key, helpers_auto_arrive_near_dest_enabled, helpers_auto_arrive_radius_nm, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (account_key) DO UPDATE SET
       helpers_auto_arrive_near_dest_enabled = EXCLUDED.helpers_auto_arrive_near_dest_enabled,
       helpers_auto_arrive_radius_nm = EXCLUDED.helpers_auto_arrive_radius_nm,
       updated_at = now()`,
    [ak, enabled, radiusNm],
  )
}

/**
 * @param {string} accountKey
 * @returns {Promise<{ chatId: string, ttsEnabled: boolean | null, dailyBriefingEnabled: boolean | null }>}
 */
export async function getWahaPrefsForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) {
    return { chatId: '', ttsEnabled: null, dailyBriefingEnabled: null, wahaUrl: '', wahaApiKey: '' }
  }
  const p = await getPostgresPool()
  if (!p) {
    return { chatId: '', ttsEnabled: null, dailyBriefingEnabled: null, wahaUrl: '', wahaApiKey: '' }
  }
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT waha_chat_id, waha_tts_enabled, waha_daily_briefing_enabled, waha_url, waha_api_key_enc
     FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const row = rows[0]
  const chatId =
    typeof row?.waha_chat_id === 'string' ? row.waha_chat_id.trim().slice(0, WAHA_CHAT_ID_MAX) : ''
  const ttsEnabled =
    row?.waha_tts_enabled === true
      ? true
      : row?.waha_tts_enabled === false
        ? false
        : null
  const dailyBriefingEnabled =
    row?.waha_daily_briefing_enabled === true
      ? true
      : row?.waha_daily_briefing_enabled === false
        ? false
        : null
  const wahaUrl = typeof row?.waha_url === 'string' ? row.waha_url.trim() : ''
  let wahaApiKey = ''
  if (row?.waha_api_key_enc && typeof row.waha_api_key_enc === 'object') {
    try { wahaApiKey = decryptString(row.waha_api_key_enc).trim() } catch { /* ignore */ }
  }
  return { chatId, ttsEnabled, dailyBriefingEnabled, wahaUrl, wahaApiKey }
}

/**
 * @param {string} accountKey
 * @param {{ chatId?: string, ttsEnabled?: boolean | null, dailyBriefingEnabled?: boolean | null }} prefs
 */
export async function setWahaPrefsForAccount(accountKey, prefs) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const chatId = String(prefs?.chatId ?? '').trim().slice(0, WAHA_CHAT_ID_MAX)
  const hasTts = prefs && Object.prototype.hasOwnProperty.call(prefs, 'ttsEnabled')
  const hasBriefing =
    prefs && Object.prototype.hasOwnProperty.call(prefs, 'dailyBriefingEnabled')
  const ttsEnabled = hasTts && prefs.ttsEnabled === true
  const ttsNull = hasTts && prefs.ttsEnabled == null
  const dailyBriefingEnabled = hasBriefing && prefs.dailyBriefingEnabled === true
  const briefingNull = hasBriefing && prefs.dailyBriefingEnabled == null

  if (hasTts && hasBriefing) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_chat_id, waha_tts_enabled, waha_daily_briefing_enabled, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_chat_id = EXCLUDED.waha_chat_id,
         waha_tts_enabled = EXCLUDED.waha_tts_enabled,
         waha_daily_briefing_enabled = EXCLUDED.waha_daily_briefing_enabled,
         updated_at = now()`,
      [
        ak,
        chatId || null,
        ttsNull ? null : ttsEnabled,
        briefingNull ? null : dailyBriefingEnabled,
      ],
    )
    return
  }

  if (hasTts) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_chat_id, waha_tts_enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_chat_id = COALESCE(EXCLUDED.waha_chat_id, ${TABLE}.waha_chat_id),
         waha_tts_enabled = EXCLUDED.waha_tts_enabled,
         updated_at = now()`,
      [ak, chatId || null, ttsNull ? null : ttsEnabled],
    )
    return
  }

  if (hasBriefing) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_chat_id, waha_daily_briefing_enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_chat_id = COALESCE(EXCLUDED.waha_chat_id, ${TABLE}.waha_chat_id),
         waha_daily_briefing_enabled = EXCLUDED.waha_daily_briefing_enabled,
         updated_at = now()`,
      [ak, chatId || null, briefingNull ? null : dailyBriefingEnabled],
    )
    return
  }

  const hasUrl = prefs && Object.prototype.hasOwnProperty.call(prefs, 'wahaUrl')
  const hasKey = prefs && Object.prototype.hasOwnProperty.call(prefs, 'wahaApiKey')
  const hasChatId = prefs && Object.prototype.hasOwnProperty.call(prefs, 'chatId')

  if (!hasTts && !hasBriefing && !hasChatId && !hasUrl && !hasKey) return

  if (hasChatId) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_chat_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_chat_id = EXCLUDED.waha_chat_id,
         updated_at = now()`,
      [ak, chatId || null],
    )
  }

  if (hasUrl) {
    const url = String(prefs.wahaUrl ?? '').trim().slice(0, 500)
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_url, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_url = EXCLUDED.waha_url,
         updated_at = now()`,
      [ak, url || null],
    )
  }
  if (hasKey) {
    const raw = String(prefs.wahaApiKey ?? '').trim()
    const enc = raw ? encryptString(raw) : null
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_api_key_enc, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_api_key_enc = EXCLUDED.waha_api_key_enc,
         updated_at = now()`,
      [ak, enc ? JSON.stringify(enc) : null],
    )
  }
}

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
