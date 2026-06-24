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
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_auto_respond_phone BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_auto_respond_where BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_auto_respond_who_at BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_url TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS waha_api_key_enc JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_url TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_password_enc JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_chat_guid TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_tts_enabled BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_auto_reply_enabled BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_webhook_token TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bluebubbles_contact_rules JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_enabled BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_host TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_port INTEGER
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_user TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_password_enc JSONB
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_from_email TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS smtp_from_name TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_notify_to TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_timezone TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_new_trip BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_daily_shift BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_weekly_summary BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_daily_shift_key TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_weekly_work_key TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_weekly_pay_key TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_trip_notify_fp TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_preplan BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_status_change BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_driver_mismatch BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_on_dispatch_instructions BOOLEAN
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_trip_cc TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_daily_shift_cc TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_weekly_summary_cc TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_daily_delay_mins INTEGER
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_status_notify_fp TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_dispatch_notify_fp TEXT
    `)
    await client.query(`
      ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS email_last_driver_mismatch_ms BIGINT
    `)
  } finally {
    client.release()
  }
}

const WAHA_CHAT_ID_MAX = 256
const BB_CHAT_GUID_MAX = 512

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
    return {
      chatId: '',
      ttsEnabled: null,
      dailyBriefingEnabled: null,
      autoRespondPhoneEnabled: null,
      autoRespondWhereEnabled: null,
      autoRespondWhoAtEnabled: null,
      wahaUrl: '',
      wahaApiKey: '',
    }
  }
  const p = await getPostgresPool()
  if (!p) {
    return {
      chatId: '',
      ttsEnabled: null,
      dailyBriefingEnabled: null,
      autoRespondPhoneEnabled: null,
      autoRespondWhereEnabled: null,
      autoRespondWhoAtEnabled: null,
      wahaUrl: '',
      wahaApiKey: '',
    }
  }
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT waha_chat_id, waha_tts_enabled, waha_daily_briefing_enabled,
            waha_auto_respond_phone, waha_auto_respond_where, waha_auto_respond_who_at,
            waha_url, waha_api_key_enc
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
  const autoRespondPhoneEnabled =
    row?.waha_auto_respond_phone === true
      ? true
      : row?.waha_auto_respond_phone === false
        ? false
        : null
  const autoRespondWhereEnabled =
    row?.waha_auto_respond_where === true
      ? true
      : row?.waha_auto_respond_where === false
        ? false
        : null
  const autoRespondWhoAtEnabled =
    row?.waha_auto_respond_who_at === true
      ? true
      : row?.waha_auto_respond_who_at === false
        ? false
        : null
  const wahaUrl = typeof row?.waha_url === 'string' ? row.waha_url.trim() : ''
  let wahaApiKey = ''
  if (row?.waha_api_key_enc && typeof row.waha_api_key_enc === 'object') {
    try { wahaApiKey = decryptString(row.waha_api_key_enc).trim() } catch { /* ignore */ }
  }
  return {
    chatId,
    ttsEnabled,
    dailyBriefingEnabled,
    autoRespondPhoneEnabled,
    autoRespondWhereEnabled,
    autoRespondWhoAtEnabled,
    wahaUrl,
    wahaApiKey,
  }
}

/**
 * @param {string} accountKey
 * @param {{
 *   chatId?: string,
 *   ttsEnabled?: boolean | null,
 *   dailyBriefingEnabled?: boolean | null,
 *   autoRespondPhoneEnabled?: boolean | null,
 *   autoRespondWhereEnabled?: boolean | null,
 *   autoRespondWhoAtEnabled?: boolean | null,
 * }} prefs
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
  const hasArPhone =
    prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoRespondPhoneEnabled')
  const hasArWhere =
    prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoRespondWhereEnabled')
  const hasArWhoAt =
    prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoRespondWhoAtEnabled')
  const ttsEnabled = hasTts && prefs.ttsEnabled === true
  const ttsNull = hasTts && prefs.ttsEnabled == null
  const dailyBriefingEnabled = hasBriefing && prefs.dailyBriefingEnabled === true
  const briefingNull = hasBriefing && prefs.dailyBriefingEnabled == null
  const arPhoneEnabled = hasArPhone && prefs.autoRespondPhoneEnabled === true
  const arPhoneNull = hasArPhone && prefs.autoRespondPhoneEnabled == null
  const arWhereEnabled = hasArWhere && prefs.autoRespondWhereEnabled === true
  const arWhereNull = hasArWhere && prefs.autoRespondWhereEnabled == null
  const arWhoAtEnabled = hasArWhoAt && prefs.autoRespondWhoAtEnabled === true
  const arWhoAtNull = hasArWhoAt && prefs.autoRespondWhoAtEnabled == null
  const hasUrl = prefs && Object.prototype.hasOwnProperty.call(prefs, 'wahaUrl')
  const hasKey = prefs && Object.prototype.hasOwnProperty.call(prefs, 'wahaApiKey')
  const hasChatId = prefs && Object.prototype.hasOwnProperty.call(prefs, 'chatId')

  if (hasArPhone) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_auto_respond_phone, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_auto_respond_phone = EXCLUDED.waha_auto_respond_phone,
         updated_at = now()`,
      [ak, arPhoneNull ? null : arPhoneEnabled],
    )
  }
  if (hasArWhere) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_auto_respond_where, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_auto_respond_where = EXCLUDED.waha_auto_respond_where,
         updated_at = now()`,
      [ak, arWhereNull ? null : arWhereEnabled],
    )
  }
  if (hasArWhoAt) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, waha_auto_respond_who_at, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         waha_auto_respond_who_at = EXCLUDED.waha_auto_respond_who_at,
         updated_at = now()`,
      [ak, arWhoAtNull ? null : arWhoAtEnabled],
    )
  }

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

  if (
    !hasTts &&
    !hasBriefing &&
    !hasChatId &&
    !hasUrl &&
    !hasKey &&
    !hasArPhone &&
    !hasArWhere &&
    !hasArWhoAt
  ) {
    return
  }

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

function generateWebhookToken() {
  return crypto.randomBytes(24).toString('hex')
}

/**
 * @param {string} accountKey
 */
export async function getBlueBubblesPrefsForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) {
    return {
      serverUrl: '',
      password: '',
      chatGuid: '',
      ttsEnabled: null,
      autoReplyEnabled: false,
      webhookToken: '',
      contactRules: [],
    }
  }
  const p = await getPostgresPool()
  if (!p) {
    return {
      serverUrl: '',
      password: '',
      chatGuid: '',
      ttsEnabled: null,
      autoReplyEnabled: false,
      webhookToken: '',
      contactRules: [],
    }
  }
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT bluebubbles_url, bluebubbles_password_enc, bluebubbles_chat_guid,
            bluebubbles_tts_enabled, bluebubbles_auto_reply_enabled,
            bluebubbles_webhook_token, bluebubbles_contact_rules
     FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  const row = rows[0]
  const chatGuid =
    typeof row?.bluebubbles_chat_guid === 'string'
      ? row.bluebubbles_chat_guid.trim().slice(0, BB_CHAT_GUID_MAX)
      : ''
  const ttsEnabled =
    row?.bluebubbles_tts_enabled === true
      ? true
      : row?.bluebubbles_tts_enabled === false
        ? false
        : null
  const autoReplyEnabled = row?.bluebubbles_auto_reply_enabled === true
  const serverUrl = typeof row?.bluebubbles_url === 'string' ? row.bluebubbles_url.trim() : ''
  let password = ''
  if (row?.bluebubbles_password_enc && typeof row.bluebubbles_password_enc === 'object') {
    try {
      password = decryptString(row.bluebubbles_password_enc).trim()
    } catch {
      /* ignore */
    }
  }
  let webhookToken =
    typeof row?.bluebubbles_webhook_token === 'string' ? row.bluebubbles_webhook_token.trim() : ''
  const contactRules = Array.isArray(row?.bluebubbles_contact_rules)
    ? row.bluebubbles_contact_rules
    : []
  return {
    serverUrl,
    password,
    chatGuid,
    ttsEnabled,
    autoReplyEnabled,
    webhookToken,
    contactRules,
  }
}

/**
 * @param {string} accountKey
 * @returns {Promise<string | null>} account key if token matches
 */
export async function resolveBlueBubblesWebhookAccount(webhookToken) {
  const token = String(webhookToken || '').trim()
  if (!token) return null
  const p = await getPostgresPool()
  if (!p) return null
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT account_key FROM ${TABLE} WHERE bluebubbles_webhook_token = $1 LIMIT 1`,
    [token],
  )
  return typeof rows[0]?.account_key === 'string' ? rows[0].account_key.trim() : null
}

/**
 * @param {string} accountKey
 * @param {{
 *   serverUrl?: string,
 *   password?: string,
 *   chatGuid?: string,
 *   ttsEnabled?: boolean | null,
 *   autoReplyEnabled?: boolean,
 *   contactRules?: unknown[],
 *   ensureWebhookToken?: boolean,
 * }} prefs
 */
export async function setBlueBubblesPrefsForAccount(accountKey, prefs) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()

  const hasUrl = prefs && Object.prototype.hasOwnProperty.call(prefs, 'serverUrl')
  const hasPassword = prefs && Object.prototype.hasOwnProperty.call(prefs, 'password')
  const hasChatGuid = prefs && Object.prototype.hasOwnProperty.call(prefs, 'chatGuid')
  const hasTts = prefs && Object.prototype.hasOwnProperty.call(prefs, 'ttsEnabled')
  const hasAutoReply = prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoReplyEnabled')
  const hasRules = prefs && Object.prototype.hasOwnProperty.call(prefs, 'contactRules')

  if (hasUrl) {
    const url = String(prefs.serverUrl ?? '').trim().slice(0, 500)
    await p.query(
      `INSERT INTO ${TABLE} (account_key, bluebubbles_url, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         bluebubbles_url = EXCLUDED.bluebubbles_url,
         updated_at = now()`,
      [ak, url || null],
    )
  }

  if (hasPassword) {
    const plain = String(prefs.password ?? '').trim()
    const enc = plain ? encryptString(plain) : null
    await p.query(
      `INSERT INTO ${TABLE} (account_key, bluebubbles_password_enc, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (account_key) DO UPDATE SET
         bluebubbles_password_enc = EXCLUDED.bluebubbles_password_enc,
         updated_at = now()`,
      [ak, enc ? JSON.stringify(enc) : null],
    )
  }

  if (hasChatGuid) {
    const guid = String(prefs.chatGuid ?? '').trim().slice(0, BB_CHAT_GUID_MAX)
    await p.query(
      `INSERT INTO ${TABLE} (account_key, bluebubbles_chat_guid, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         bluebubbles_chat_guid = EXCLUDED.bluebubbles_chat_guid,
         updated_at = now()`,
      [ak, guid || null],
    )
  }

  if (hasTts) {
    const ttsVal = prefs.ttsEnabled === true ? true : prefs.ttsEnabled === false ? false : null
    await p.query(
      `INSERT INTO ${TABLE} (account_key, bluebubbles_tts_enabled, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         bluebubbles_tts_enabled = EXCLUDED.bluebubbles_tts_enabled,
         updated_at = now()`,
      [ak, ttsVal],
    )
  }

  if (hasAutoReply) {
    await p.query(
      `INSERT INTO ${TABLE} (account_key, bluebubbles_auto_reply_enabled, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (account_key) DO UPDATE SET
         bluebubbles_auto_reply_enabled = EXCLUDED.bluebubbles_auto_reply_enabled,
         updated_at = now()`,
      [ak, prefs.autoReplyEnabled === true],
    )
  }

  if (hasRules) {
    const rules = Array.isArray(prefs.contactRules) ? prefs.contactRules : []
    await p.query(
      `INSERT INTO ${TABLE} (account_key, bluebubbles_contact_rules, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (account_key) DO UPDATE SET
         bluebubbles_contact_rules = EXCLUDED.bluebubbles_contact_rules,
         updated_at = now()`,
      [ak, JSON.stringify(rules)],
    )
  }

  if (prefs?.ensureWebhookToken) {
    const existing = await getBlueBubblesPrefsForAccount(ak)
    if (!existing.webhookToken) {
      const token = generateWebhookToken()
      await p.query(
        `INSERT INTO ${TABLE} (account_key, bluebubbles_webhook_token, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (account_key) DO UPDATE SET
           bluebubbles_webhook_token = COALESCE(${TABLE}.bluebubbles_webhook_token, EXCLUDED.bluebubbles_webhook_token),
           updated_at = now()`,
        [ak, token],
      )
    }
  }
}

const SMTP_HOST_MAX = 255
const SMTP_USER_MAX = 255
const SMTP_EMAIL_MAX = 320
const SMTP_CC_MAX = 960
const DEFAULT_EMAIL_TZ = 'America/New_York'
const DEFAULT_DAILY_DELAY_MINS = 30

function rowToSmtpPrefs(row) {
  if (!row) {
    return {
      enabled: false,
      host: '',
      port: 587,
      secure: false,
      user: '',
      password: '',
      fromEmail: '',
      fromName: 'TripBuddy',
      notifyTo: '',
      timezone: DEFAULT_EMAIL_TZ,
      onNewTrip: true,
      onPreplan: true,
      onStatusChange: false,
      onDriverMismatch: false,
      onDispatchInstructions: false,
      onDailyShiftSummary: true,
      onWeeklySummary: true,
      tripCc: '',
      dailyShiftCc: '',
      weeklySummaryCc: '',
      dailyDelayMins: DEFAULT_DAILY_DELAY_MINS,
      lastDailyShiftKey: '',
      lastWeeklyWorkKey: '',
      lastWeeklyPayKey: '',
      lastTripNotifyFp: '',
      lastStatusNotifyFp: '',
      lastDispatchNotifyFp: '',
      lastDriverMismatchMs: 0,
    }
  }
  let password = ''
  const enc = row.smtp_password_enc
  if (enc && typeof enc === 'object') {
    try {
      password = decryptString(enc).trim()
    } catch {
      password = ''
    }
  }
  return {
    enabled: row.smtp_enabled === true,
    host: typeof row.smtp_host === 'string' ? row.smtp_host.trim().slice(0, SMTP_HOST_MAX) : '',
    port:
      typeof row.smtp_port === 'number' && Number.isFinite(row.smtp_port)
        ? Math.max(1, Math.min(65535, Math.floor(row.smtp_port)))
        : 587,
    secure: row.smtp_secure === true,
    user: typeof row.smtp_user === 'string' ? row.smtp_user.trim().slice(0, SMTP_USER_MAX) : '',
    password,
    fromEmail:
      typeof row.smtp_from_email === 'string'
        ? row.smtp_from_email.trim().slice(0, SMTP_EMAIL_MAX)
        : '',
    fromName:
      typeof row.smtp_from_name === 'string' && row.smtp_from_name.trim()
        ? row.smtp_from_name.trim().slice(0, 120)
        : 'TripBuddy',
    notifyTo:
      typeof row.email_notify_to === 'string'
        ? row.email_notify_to.trim().slice(0, SMTP_EMAIL_MAX)
        : '',
    timezone:
      typeof row.email_timezone === 'string' && row.email_timezone.trim()
        ? row.email_timezone.trim().slice(0, 64)
        : DEFAULT_EMAIL_TZ,
    onNewTrip: row.email_on_new_trip !== false,
    onPreplan: row.email_on_preplan !== false,
    onStatusChange: row.email_on_status_change === true,
    onDriverMismatch: row.email_on_driver_mismatch === true,
    onDispatchInstructions: row.email_on_dispatch_instructions === true,
    onDailyShiftSummary: row.email_on_daily_shift !== false,
    onWeeklySummary: row.email_on_weekly_summary !== false,
    tripCc:
      typeof row.email_trip_cc === 'string' ? row.email_trip_cc.trim().slice(0, SMTP_CC_MAX) : '',
    dailyShiftCc:
      typeof row.email_daily_shift_cc === 'string'
        ? row.email_daily_shift_cc.trim().slice(0, SMTP_CC_MAX)
        : '',
    weeklySummaryCc:
      typeof row.email_weekly_summary_cc === 'string'
        ? row.email_weekly_summary_cc.trim().slice(0, SMTP_CC_MAX)
        : '',
    dailyDelayMins:
      typeof row.email_daily_delay_mins === 'number' && Number.isFinite(row.email_daily_delay_mins)
        ? Math.max(0, Math.min(720, Math.floor(row.email_daily_delay_mins)))
        : DEFAULT_DAILY_DELAY_MINS,
    lastDailyShiftKey:
      typeof row.email_last_daily_shift_key === 'string'
        ? row.email_last_daily_shift_key.trim()
        : '',
    lastWeeklyWorkKey:
      typeof row.email_last_weekly_work_key === 'string'
        ? row.email_last_weekly_work_key.trim()
        : '',
    lastWeeklyPayKey:
      typeof row.email_last_weekly_pay_key === 'string'
        ? row.email_last_weekly_pay_key.trim()
        : '',
    lastTripNotifyFp:
      typeof row.email_last_trip_notify_fp === 'string'
        ? row.email_last_trip_notify_fp.trim()
        : '',
    lastStatusNotifyFp:
      typeof row.email_last_status_notify_fp === 'string'
        ? row.email_last_status_notify_fp.trim()
        : '',
    lastDispatchNotifyFp:
      typeof row.email_last_dispatch_notify_fp === 'string'
        ? row.email_last_dispatch_notify_fp.trim()
        : '',
    lastDriverMismatchMs:
      typeof row.email_last_driver_mismatch_ms === 'number' &&
      Number.isFinite(row.email_last_driver_mismatch_ms)
        ? Math.floor(row.email_last_driver_mismatch_ms)
        : 0,
  }
}

/** @param {string} accountKey */
export async function getSmtpPrefsForAccount(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) return rowToSmtpPrefs(null)
  const p = await getPostgresPool()
  if (!p) return rowToSmtpPrefs(null)
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT smtp_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc,
            smtp_from_email, smtp_from_name, email_notify_to, email_timezone,
            email_on_new_trip, email_on_preplan, email_on_status_change, email_on_driver_mismatch,
            email_on_dispatch_instructions, email_on_daily_shift, email_on_weekly_summary,
            email_trip_cc, email_daily_shift_cc, email_weekly_summary_cc, email_daily_delay_mins,
            email_last_daily_shift_key, email_last_weekly_work_key, email_last_weekly_pay_key,
            email_last_trip_notify_fp, email_last_status_notify_fp, email_last_dispatch_notify_fp,
            email_last_driver_mismatch_ms
     FROM ${TABLE} WHERE account_key = $1`,
    [ak],
  )
  return rowToSmtpPrefs(rows[0])
}

/** @param {string} accountKey @param {object} patch */
export async function patchSmtpSendStateForAccount(accountKey, patch) {
  const ak = String(accountKey || '').trim()
  if (!ak) return
  const p = await getPostgresPool()
  if (!p) return
  await ensureUserProfileTable()
  const sets = []
  const vals = [ak]
  let i = 2
  const add = (col, val) => {
    sets.push(`${col} = $${i}`)
    vals.push(val)
    i += 1
  }
  if (patch.lastDailyShiftKey !== undefined) {
    add('email_last_daily_shift_key', patch.lastDailyShiftKey || null)
  }
  if (patch.lastWeeklyWorkKey !== undefined) {
    add('email_last_weekly_work_key', patch.lastWeeklyWorkKey || null)
  }
  if (patch.lastWeeklyPayKey !== undefined) {
    add('email_last_weekly_pay_key', patch.lastWeeklyPayKey || null)
  }
  if (patch.lastTripNotifyFp !== undefined) {
    add('email_last_trip_notify_fp', patch.lastTripNotifyFp || null)
  }
  if (patch.lastStatusNotifyFp !== undefined) {
    add('email_last_status_notify_fp', patch.lastStatusNotifyFp || null)
  }
  if (patch.lastDispatchNotifyFp !== undefined) {
    add('email_last_dispatch_notify_fp', patch.lastDispatchNotifyFp || null)
  }
  if (patch.lastDriverMismatchMs !== undefined) {
    add('email_last_driver_mismatch_ms', patch.lastDriverMismatchMs || null)
  }
  if (!sets.length) return
  await p.query(
    `INSERT INTO ${TABLE} (account_key, updated_at) VALUES ($1, now())
     ON CONFLICT (account_key) DO UPDATE SET ${sets.join(', ')}, updated_at = now()`,
    vals,
  )
}

/** @param {string} accountKey @param {object} prefs */
export async function setSmtpPrefsForAccount(accountKey, prefs) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const p = await getPostgresPool()
  if (!p) throw new Error('Database not available')
  await ensureUserProfileTable()
  const prev = await getSmtpPrefsForAccount(ak)

  const enabled = typeof prefs.enabled === 'boolean' ? prefs.enabled : prev.enabled
  const host =
    typeof prefs.host === 'string' ? prefs.host.trim().slice(0, SMTP_HOST_MAX) : prev.host
  const port =
    typeof prefs.port === 'number' && Number.isFinite(prefs.port)
      ? Math.max(1, Math.min(65535, Math.floor(prefs.port)))
      : prev.port
  const secure = typeof prefs.secure === 'boolean' ? prefs.secure : prev.secure
  const user =
    typeof prefs.user === 'string' ? prefs.user.trim().slice(0, SMTP_USER_MAX) : prev.user
  let passwordEnc = null
  if (typeof prefs.password === 'string' && prefs.password.trim()) {
    passwordEnc = encryptString(prefs.password.trim())
  } else if (prev.password) {
    const { rows } = await p.query(
      `SELECT smtp_password_enc FROM ${TABLE} WHERE account_key = $1`,
      [ak],
    )
    passwordEnc = rows[0]?.smtp_password_enc ?? null
  }
  const fromEmail =
    typeof prefs.fromEmail === 'string'
      ? prefs.fromEmail.trim().slice(0, SMTP_EMAIL_MAX)
      : prev.fromEmail
  const fromName =
    typeof prefs.fromName === 'string' && prefs.fromName.trim()
      ? prefs.fromName.trim().slice(0, 120)
      : prev.fromName
  const notifyTo =
    typeof prefs.notifyTo === 'string'
      ? prefs.notifyTo.trim().slice(0, SMTP_EMAIL_MAX)
      : prev.notifyTo
  const timezone =
    typeof prefs.timezone === 'string' && prefs.timezone.trim()
      ? prefs.timezone.trim().slice(0, 64)
      : prev.timezone
  const onNewTrip =
    typeof prefs.onNewTrip === 'boolean' ? prefs.onNewTrip : prev.onNewTrip
  const onPreplan = typeof prefs.onPreplan === 'boolean' ? prefs.onPreplan : prev.onPreplan
  const onStatusChange =
    typeof prefs.onStatusChange === 'boolean' ? prefs.onStatusChange : prev.onStatusChange
  const onDriverMismatch =
    typeof prefs.onDriverMismatch === 'boolean'
      ? prefs.onDriverMismatch
      : prev.onDriverMismatch
  const onDispatchInstructions =
    typeof prefs.onDispatchInstructions === 'boolean'
      ? prefs.onDispatchInstructions
      : prev.onDispatchInstructions
  const onDailyShiftSummary =
    typeof prefs.onDailyShiftSummary === 'boolean'
      ? prefs.onDailyShiftSummary
      : prev.onDailyShiftSummary
  const onWeeklySummary =
    typeof prefs.onWeeklySummary === 'boolean' ? prefs.onWeeklySummary : prev.onWeeklySummary
  const tripCc =
    typeof prefs.tripCc === 'string' ? prefs.tripCc.trim().slice(0, SMTP_CC_MAX) : prev.tripCc
  const dailyShiftCc =
    typeof prefs.dailyShiftCc === 'string'
      ? prefs.dailyShiftCc.trim().slice(0, SMTP_CC_MAX)
      : prev.dailyShiftCc
  const weeklySummaryCc =
    typeof prefs.weeklySummaryCc === 'string'
      ? prefs.weeklySummaryCc.trim().slice(0, SMTP_CC_MAX)
      : prev.weeklySummaryCc
  const dailyDelayMins =
    typeof prefs.dailyDelayMins === 'number' && Number.isFinite(prefs.dailyDelayMins)
      ? Math.max(0, Math.min(720, Math.floor(prefs.dailyDelayMins)))
      : prev.dailyDelayMins

  await p.query(
    `INSERT INTO ${TABLE} (
       account_key, smtp_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc,
       smtp_from_email, smtp_from_name, email_notify_to, email_timezone,
       email_on_new_trip, email_on_preplan, email_on_status_change, email_on_driver_mismatch,
       email_on_dispatch_instructions, email_on_daily_shift, email_on_weekly_summary,
       email_trip_cc, email_daily_shift_cc, email_weekly_summary_cc, email_daily_delay_mins,
       updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
     ON CONFLICT (account_key) DO UPDATE SET
       smtp_enabled = EXCLUDED.smtp_enabled,
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       smtp_secure = EXCLUDED.smtp_secure,
       smtp_user = EXCLUDED.smtp_user,
       smtp_password_enc = COALESCE(EXCLUDED.smtp_password_enc, ${TABLE}.smtp_password_enc),
       smtp_from_email = EXCLUDED.smtp_from_email,
       smtp_from_name = EXCLUDED.smtp_from_name,
       email_notify_to = EXCLUDED.email_notify_to,
       email_timezone = EXCLUDED.email_timezone,
       email_on_new_trip = EXCLUDED.email_on_new_trip,
       email_on_preplan = EXCLUDED.email_on_preplan,
       email_on_status_change = EXCLUDED.email_on_status_change,
       email_on_driver_mismatch = EXCLUDED.email_on_driver_mismatch,
       email_on_dispatch_instructions = EXCLUDED.email_on_dispatch_instructions,
       email_on_daily_shift = EXCLUDED.email_on_daily_shift,
       email_on_weekly_summary = EXCLUDED.email_on_weekly_summary,
       email_trip_cc = EXCLUDED.email_trip_cc,
       email_daily_shift_cc = EXCLUDED.email_daily_shift_cc,
       email_weekly_summary_cc = EXCLUDED.email_weekly_summary_cc,
       email_daily_delay_mins = EXCLUDED.email_daily_delay_mins,
       updated_at = now()`,
    [
      ak,
      enabled,
      host || null,
      port,
      secure,
      user || null,
      passwordEnc ? JSON.stringify(passwordEnc) : null,
      fromEmail || null,
      fromName || null,
      notifyTo || null,
      timezone || DEFAULT_EMAIL_TZ,
      onNewTrip,
      onPreplan,
      onStatusChange,
      onDriverMismatch,
      onDispatchInstructions,
      onDailyShiftSummary,
      onWeeklySummary,
      tripCc || null,
      dailyShiftCc || null,
      weeklySummaryCc || null,
      dailyDelayMins,
    ],
  )
}

/** @returns {Promise<string[]>} */
export async function listAccountKeysWithSmtpEnabled() {
  const p = await getPostgresPool()
  if (!p) return []
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT account_key FROM ${TABLE} WHERE smtp_enabled = true AND email_notify_to IS NOT NULL AND trim(email_notify_to) <> ''`,
  )
  return rows.map((r) => String(r.account_key || '').trim()).filter(Boolean)
}
