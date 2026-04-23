import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'
import { readKVJson, writeKVJson } from './kv-store.mjs'
import { requestAsyncLocalStorage } from './request-context.mjs'

const LEGACY_CRED_FILE = path.join(LOCAL_DIR, 'credentials.json')
const USERS_DIR = path.join(LOCAL_DIR, 'users')

const KV_USER_META = (accountKey) => `usermeta:${accountKey || 'legacy'}`
const KV_CREDS = (accountKey) =>
  `creds:${accountKey || 'legacy'}`

const ALGO = 'aes-256-gcm'
const SCRYPT_SALT = 'fedextool-cred-v1'

/** @type {string | null} */
let lastActiveAccountKey = null

/**
 * Last user account used for API-backed automation (poll, runner).
 * Updated when a session is active and on successful login.
 */
export function setLastActiveAccountKey(key) {
  lastActiveAccountKey = typeof key === 'string' && key.length > 0 ? key : null
}

export function getLastActiveAccountKey() {
  return lastActiveAccountKey
}

/**
 * Stable filesystem-safe key from username (no PII in path).
 * @param {string} username
 */
export function accountKeyForUsername(username) {
  const t = typeof username === 'string' ? username.trim() : ''
  if (!t) return null
  return crypto.createHash('sha256').update(t.toLowerCase()).digest('hex')
}

function deriveKey() {
  const secret =
    process.env.FEDEX_TOOL_SECRET ||
    'fedextool-dev-only-change-fedx-tool-secret-in-env'
  return crypto.scryptSync(secret, SCRYPT_SALT, 32)
}

function encryptPassword(plain) {
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

function decryptPassword(blob) {
  const key = deriveKey()
  const iv = Buffer.from(blob.iv, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const data = Buffer.from(blob.data, 'base64')
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  )
}

/**
 * @param {string | null} accountKey
 */
export function credPathForAccount(accountKey) {
  if (!accountKey) return LEGACY_CRED_FILE
  return path.join(USERS_DIR, accountKey, 'credentials.json')
}

/**
 * @param {string | null} accountKey
 */
function metaPathForAccount(accountKey) {
  if (!accountKey) return path.join(LOCAL_DIR, 'user-meta.json')
  return path.join(USERS_DIR, accountKey, 'user-meta.json')
}

/**
 * Per-request: session’s account. Background (poll, no HTTP): last active login.
 */
function resolveAccountKey() {
  const req = requestAsyncLocalStorage.getStore()
  const fromReq =
    req && typeof req.credentialAccountKey === 'string'
      ? req.credentialAccountKey
      : null
  if (fromReq) return fromReq
  const last = getLastActiveAccountKey()
  if (last) return last
  return null
}

let legacyMigrated = false

async function maybeMigrateLegacyOnce() {
  if (legacyMigrated) return
  legacyMigrated = true
  try {
    const raw = await fs.readFile(LEGACY_CRED_FILE, 'utf8')
    const data = JSON.parse(raw)
    const u = typeof data.username === 'string' ? data.username.trim() : ''
    if (!u) return
    const key = accountKeyForUsername(u)
    if (!key) return
    const destDir = path.join(USERS_DIR, key)
    const destFile = path.join(destDir, 'credentials.json')
    try {
      await fs.access(destFile)
      return
    } catch {
      /* no dest — migrate */
    }
    await fs.mkdir(destDir, { recursive: true })
    await fs.writeFile(destFile, raw, 'utf8')
    const metaDest = path.join(destDir, 'user-meta.json')
    try {
      await fs.access(metaDest)
    } catch {
      await fs.writeFile(
        metaDest,
        JSON.stringify({ appLoginVerified: true }, null, 2),
        'utf8',
      )
    }
  } catch {
    /* no legacy file */
  }
}

/**
 * @returns {Promise<{
 *   username: string | null,
 *   passwordEnc: object | null,
 *   tractorNumber: string | null,
 *   employeeNumber: string | null,
 *   linehaulBearerEnc: object | null,
 *   driverName: string | null,
 *   linehaulPollMinutes: number | null,
 * }>}
 */
function parseCredData(data) {
  let pollM = null
  if (
    typeof data.linehaulPollMinutes === 'number' &&
    !Number.isNaN(data.linehaulPollMinutes)
  ) {
    pollM = Math.max(0, Math.min(24 * 60, Math.floor(data.linehaulPollMinutes)))
  }
  return {
    username: data.username ?? null,
    passwordEnc: data.passwordEnc ?? null,
    tractorNumber:
      typeof data.tractorNumber === 'string' ? data.tractorNumber : null,
    employeeNumber:
      typeof data.employeeNumber === 'string' ? data.employeeNumber : null,
    linehaulBearerEnc: data.linehaulBearerEnc ?? null,
    driverName: typeof data.driverName === 'string' ? data.driverName : null,
    linehaulPollMinutes: pollM,
  }
}

async function readFileRawForAccount(accountKey) {
  await maybeMigrateLegacyOnce()
  const file = credPathForAccount(accountKey)
  const kvKey = KV_CREDS(accountKey)
  const j = await readKVJson(kvKey, file, () => ({}))
  if (j && typeof j === 'object' && j !== null) {
    return parseCredData(/** @type {Record<string, unknown>} */ (j))
  }
  return {
    username: null,
    passwordEnc: null,
    tractorNumber: null,
    employeeNumber: null,
    linehaulBearerEnc: null,
    driverName: null,
    linehaulPollMinutes: null,
  }
}

async function readFileRaw() {
  return readFileRawForAccount(resolveAccountKey())
}

/**
 * @param {string | null} accountKey
 */
export async function readUserMeta(accountKey) {
  await maybeMigrateLegacyOnce()
  const file = metaPathForAccount(accountKey)
  const d = await readKVJson(
    KV_USER_META(accountKey),
    file,
    () => ({}),
  )
  if (d && typeof d === 'object') {
    return { appLoginVerified: /** @type {Record<string, unknown>} */ (d).appLoginVerified === true }
  }
  return { appLoginVerified: false }
}

/**
 * @param {string | null} accountKey
 * @param {Partial<{ appLoginVerified: boolean }>} patch
 */
export async function writeUserMeta(accountKey, patch) {
  const prev = await readUserMeta(accountKey)
  const next = { ...prev, ...patch }
  await writeKVJson(
    KV_USER_META(accountKey),
    metaPathForAccount(accountKey),
    next,
  )
  return next
}

export async function isAppLoginVerifiedForAccountKey(accountKey) {
  if (!accountKey) return false
  const m = await readUserMeta(accountKey)
  return m.appLoginVerified === true
}

/** After successful token capture from Settings while logged in (or scoped run). */
export async function markAppLoginVerifiedForCurrentScope() {
  const acc = resolveAccountKey()
  if (!acc) return
  await writeUserMeta(acc, { appLoginVerified: true })
}

export async function getCredentialsMeta() {
  const {
    username,
    passwordEnc,
    tractorNumber,
    employeeNumber,
    linehaulBearerEnc,
    driverName,
    linehaulPollMinutes,
  } = await readFileRaw()
  const tn = tractorNumber?.trim() || null
  const en = employeeNumber?.trim() || null
  const poll =
    typeof linehaulPollMinutes === 'number' ? linehaulPollMinutes : 0
  const acc = resolveAccountKey()
  const verified = acc ? (await readUserMeta(acc)).appLoginVerified : false
  return {
    username: username || null,
    hasPassword: Boolean(passwordEnc?.data && passwordEnc?.iv && passwordEnc?.tag),
    tractorNumber: tn,
    hasTractor: Boolean(tn),
    employeeNumber: en,
    hasEmployeeNumber: Boolean(en),
    hasLinehaulBearer: Boolean(
      linehaulBearerEnc?.data &&
        linehaulBearerEnc?.iv &&
        linehaulBearerEnc?.tag,
    ),
    driverName: driverName || null,
    linehaulPollMinutes: poll,
    appLoginVerified: verified,
  }
}

/** Non-empty trimmed tractor number for automation, or empty string */
export async function getTractorNumber() {
  const { tractorNumber } = await readFileRaw()
  return typeof tractorNumber === 'string' ? tractorNumber.trim() : ''
}

export async function getDecryptedPassword() {
  const { passwordEnc } = await readFileRaw()
  if (!passwordEnc?.data) return null
  try {
    return decryptPassword(passwordEnc)
  } catch {
    return null
  }
}

export async function getUsername() {
  const { username } = await readFileRaw()
  return username || null
}

/** FedEx employee / driver ID for Linehaul API path (digits). */
export async function getEmployeeNumber() {
  const { employeeNumber } = await readFileRaw()
  return typeof employeeNumber === 'string' ? employeeNumber.trim() : ''
}

const DIGITS_ONLY = /^\d+$/

/**
 * Linehaul GET /driver/{id}: Username/Driver ID (`username`) when all digits.
 * Legacy: `employeeNumber` in file only until next save clears it.
 */
export async function getLinehaulDriverId() {
  const raw = await readFileRaw()
  const u = typeof raw.username === 'string' ? raw.username.trim() : ''
  if (u && DIGITS_ONLY.test(u)) return u
  const emp =
    typeof raw.employeeNumber === 'string' ? raw.employeeNumber.trim() : ''
  if (emp && DIGITS_ONLY.test(emp)) return emp
  return ''
}

/** Decrypted fdxtools Apigee JWT for Linehaul GET (or null). */
export async function getDecryptedLinehaulBearer() {
  const { linehaulBearerEnc } = await readFileRaw()
  if (!linehaulBearerEnc?.data) return null
  try {
    return decryptPassword(linehaulBearerEnc)
  } catch {
    return null
  }
}

/** Scraped driver name from Okta userinfo (or null). */
export async function getDriverName() {
  const { driverName } = await readFileRaw()
  return driverName || null
}

/**
 * @param {{
 *   username?: string,
 *   password?: string,
 *   tractorNumber?: string,
 *   fedexLinehaulBearer?: string,
 *   clearFedexLinehaulBearer?: boolean,
 *   driverName?: string,
 *   clearDriverName?: boolean,
 *   linehaulPollMinutes?: number,
 * }} body password optional = keep; linehaulPollMinutes 0–1440 (0 = no auto refresh)
 */
export async function saveCredentials(body) {
  const acc = resolveAccountKey()
  const credFile = credPathForAccount(acc)
  await fs.mkdir(path.dirname(credFile), { recursive: true })

  const prev = await readFileRaw()
  const username =
    typeof body.username === 'string' ? body.username.trim() : prev.username

  let passwordEnc = prev.passwordEnc
  if (typeof body.password === 'string' && body.password.length > 0) {
    passwordEnc = encryptPassword(body.password)
  }

  let tractorNumber = prev.tractorNumber
  if (typeof body.tractorNumber === 'string') {
    const t = body.tractorNumber.trim()
    tractorNumber = t.length > 0 ? t : null
  }

  /** Merged model: driver id lives in `username` (Username/Driver ID). Stop persisting duplicate field. */
  const employeeNumber = null

  let linehaulBearerEnc = prev.linehaulBearerEnc
  if (body.clearFedexLinehaulBearer === true) {
    linehaulBearerEnc = null
  } else if (
    typeof body.fedexLinehaulBearer === 'string' &&
    body.fedexLinehaulBearer.trim().length > 0
  ) {
    let tok = body.fedexLinehaulBearer.trim()
    if (/^bearer\s+/i.test(tok)) {
      tok = tok.replace(/^bearer\s+/i, '').trim()
    }
    linehaulBearerEnc = encryptPassword(tok)
  }

  let driverName = prev.driverName
  if (body.clearDriverName === true) {
    driverName = null
  } else if (
    typeof body.driverName === 'string' &&
    body.driverName.trim().length > 0
  ) {
    driverName = body.driverName.trim()
  }

  let linehaulPollMinutes = prev.linehaulPollMinutes
  if (
    typeof body.linehaulPollMinutes === 'number' &&
    !Number.isNaN(body.linehaulPollMinutes)
  ) {
    linehaulPollMinutes = Math.max(
      0,
      Math.min(24 * 60, Math.floor(body.linehaulPollMinutes)),
    )
  }

  const next = {
    username: username || null,
    passwordEnc,
    tractorNumber,
    employeeNumber,
    linehaulBearerEnc,
    driverName,
    linehaulPollMinutes,
  }
  await writeKVJson(KV_CREDS(acc), credFile, next)
  return getCredentialsMeta()
}

export async function clearCredentials() {
  const acc = resolveAccountKey()
  const credFile = credPathForAccount(acc)
  const empty = {
    username: null,
    passwordEnc: null,
    tractorNumber: null,
    employeeNumber: null,
    linehaulBearerEnc: null,
    driverName: null,
    linehaulPollMinutes: null,
  }
  await writeKVJson(KV_CREDS(acc), credFile, empty)
}

/**
 * Verify password against stored hash for account (no HTTP request context).
 * @param {string} accountKey
 * @param {string} password
 */
export async function verifyPasswordForAccountKey(accountKey, password) {
  const raw = await readFileRawForAccount(accountKey)
  const pe = raw.passwordEnc
  if (!pe?.data) return false
  try {
    return decryptPassword(pe) === password
  } catch {
    return false
  }
}

/**
 * Username on file for account (for login fast-path username match).
 * @param {string} accountKey
 */
export async function getUsernameForAccountKey(accountKey) {
  const raw = await readFileRawForAccount(accountKey)
  return typeof raw.username === 'string' ? raw.username.trim() : ''
}
