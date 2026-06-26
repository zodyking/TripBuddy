import crypto from 'node:crypto'
import { accountKeyForUsername } from './account-identity.mjs'
import { getLastActiveAccountKey, setLastActiveAccountKey } from './active-account.mjs'
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { setTomtomApiKeyForAccount } from './user-profile-pg.mjs'
import { requestAsyncLocalStorage } from './request-context.mjs'
import { getDataAccountKey, keyForUser } from './scope-kv.mjs'
import {
  appendWorkWeekScheduleChange,
  sanitizeWorkWeekScheduleHistory,
} from '../src/utils/workWeekGroup.js'

const ALGO = 'aes-256-gcm'
const SCRYPT_SALT = 'fedextool-cred-v1'

/** 0=Sun .. 6=Sat for work-week boundaries in History */
const DOW = new Set([0, 1, 2, 3, 4, 5, 6])

/** US driver phone for Linehaul / check-in modals: digits only, max 10. */
function normalizeDriverPhoneDigits(v) {
  const d = String(v ?? '').replace(/\D/g, '').slice(0, 10)
  return d.length > 0 ? d : null
}

export { getLastActiveAccountKey, setLastActiveAccountKey }

export { accountKeyForUsername }

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

function credsKey(/** @type {string | null | undefined} */ accountKey) {
  const ak = accountKey && String(accountKey).length > 0 ? String(accountKey) : getDataAccountKey()
  return keyForUser(ak, 'credentials')
}

function userMetaKey(/** @type {string | null | undefined} */ accountKey) {
  const ak = accountKey && String(accountKey).length > 0 ? String(accountKey) : getDataAccountKey()
  return keyForUser(ak, 'usermeta')
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

/**
 * @returns {Promise<{
 *   username: string | null,
 *   passwordEnc: object | null,
 *   tractorNumber: string | null,
 *   employeeNumber: string | null,
 *   linehaulBearerEnc: object | null,
 *   driverName: string | null,
 *   linehaulPollMinutes: number | null,
 *   driverPhone: string | null,
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
  const rawStart = data.workWeekStartDay
  const rawEnd = data.workWeekEndDay
  const workWeekStartDay =
    typeof rawStart === 'number' && DOW.has(Math.floor(rawStart)) ? Math.floor(rawStart) : 0
  const workWeekEndDay =
    typeof rawEnd === 'number' && DOW.has(Math.floor(rawEnd)) ? Math.floor(rawEnd) : 6
  const rawSsm = data.shiftStartMins
  const rawSem = data.shiftEndMins
  const shiftStartMins =
    typeof rawSsm === 'number' && !Number.isNaN(rawSsm)
      ? Math.max(0, Math.min(1439, Math.floor(rawSsm)))
      : 0
  const shiftEndMins =
    typeof rawSem === 'number' && !Number.isNaN(rawSem)
      ? Math.max(0, Math.min(1439, Math.floor(rawSem)))
      : 1439
  const workWeekScheduleHistory = sanitizeWorkWeekScheduleHistory(data.workWeekScheduleHistory)
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
    workWeekStartDay,
    workWeekEndDay,
    workWeekScheduleHistory,
    shiftStartMins,
    shiftEndMins,
    driverPhone: normalizeDriverPhoneDigits(data.driverPhone),
    federalHolidayMileage15xEnabled:
      data.federalHolidayMileage15xEnabled === false ? false : true,
  }
}

async function readFileRawForAccount(accountKey) {
  const j = await readKeyJson(
    credsKey(accountKey),
    () => ({}),
  )
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
    workWeekStartDay: 0,
    workWeekEndDay: 6,
    workWeekScheduleHistory: [],
    shiftStartMins: 0,
    shiftEndMins: 1439,
    driverPhone: null,
    federalHolidayMileage15xEnabled: true,
  }
}

async function readFileRaw() {
  return readFileRawForAccount(resolveAccountKey())
}

/**
 * @param {string | null} accountKey
 */
export async function readUserMeta(accountKey) {
  const d = await readKeyJson(userMetaKey(accountKey), () => ({}))
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
  await writeKeyJson(userMetaKey(accountKey), next)
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
    workWeekStartDay,
    workWeekEndDay,
    shiftStartMins,
    shiftEndMins,
    driverPhone,
    federalHolidayMileage15xEnabled,
    workWeekScheduleHistory,
  } = await readFileRaw()
  const tn = tractorNumber?.trim() || null
  const en = employeeNumber?.trim() || null
  const poll =
    typeof linehaulPollMinutes === 'number' ? linehaulPollMinutes : 0
  const acc = resolveAccountKey()
  const verified = acc ? (await readUserMeta(acc)).appLoginVerified : false
  const wws =
    typeof workWeekStartDay === 'number' && DOW.has(Math.floor(workWeekStartDay))
      ? Math.floor(workWeekStartDay)
      : 0
  const wwe =
    typeof workWeekEndDay === 'number' && DOW.has(Math.floor(workWeekEndDay))
      ? Math.floor(workWeekEndDay)
      : 6
  const ssm =
    typeof shiftStartMins === 'number' && !Number.isNaN(shiftStartMins)
      ? Math.max(0, Math.min(1439, Math.floor(shiftStartMins)))
      : 0
  const sem =
    typeof shiftEndMins === 'number' && !Number.isNaN(shiftEndMins)
      ? Math.max(0, Math.min(1439, Math.floor(shiftEndMins)))
      : 1439
  const dp =
    typeof driverPhone === 'string' && driverPhone.trim().length > 0
      ? driverPhone.trim().replace(/\D/g, '').slice(0, 10)
      : ''
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
    workWeekStartDay: wws,
    workWeekEndDay: wwe,
    workWeekScheduleHistory,
    shiftStartMins: ssm,
    shiftEndMins: sem,
    appLoginVerified: verified,
    driverPhone: dp || null,
    federalHolidayMileage15xEnabled: federalHolidayMileage15xEnabled !== false,
  }
}

/** Digits-only driver phone from saved credentials (same field as Settings), or empty string. */
export async function getDriverPhone() {
  const { driverPhone } = await readFileRaw()
  return typeof driverPhone === 'string' ? driverPhone.trim() : ''
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
 *   workWeekStartDay?: number,
 *   workWeekEndDay?: number,
 *   shiftStartMins?: number,
 *   shiftEndMins?: number,
 *   driverPhone?: string,
 *   federalHolidayMileage15xEnabled?: boolean,
 * }} body password optional = keep; linehaulPollMinutes 0–1440 (0 = no auto refresh)
 */
export async function saveCredentials(body) {
  const acc = resolveAccountKey() || getDataAccountKey()
  if (!acc) {
    throw new Error('No account for credentials save; log in or set FEDEX_TOOL_DATA_ACCOUNT_KEY')
  }

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

  let workWeekStartDay = prev.workWeekStartDay ?? 0
  let workWeekEndDay = prev.workWeekEndDay ?? 6
  if (
    typeof body.workWeekStartDay === 'number' &&
    !Number.isNaN(body.workWeekStartDay) &&
    DOW.has(Math.floor(body.workWeekStartDay))
  ) {
    workWeekStartDay = Math.floor(body.workWeekStartDay)
  }
  if (
    typeof body.workWeekEndDay === 'number' &&
    !Number.isNaN(body.workWeekEndDay) &&
    DOW.has(Math.floor(body.workWeekEndDay))
  ) {
    workWeekEndDay = Math.floor(body.workWeekEndDay)
  }

  let shiftStartMins = prev.shiftStartMins ?? 0
  let shiftEndMins = prev.shiftEndMins ?? 1439
  if (
    typeof body.shiftStartMins === 'number' &&
    !Number.isNaN(body.shiftStartMins)
  ) {
    shiftStartMins = Math.max(0, Math.min(1439, Math.floor(body.shiftStartMins)))
  }
  if (typeof body.shiftEndMins === 'number' && !Number.isNaN(body.shiftEndMins)) {
    shiftEndMins = Math.max(0, Math.min(1439, Math.floor(body.shiftEndMins)))
  }

  let driverPhone = prev.driverPhone ?? null
  if (typeof body.driverPhone === 'string') {
    driverPhone = normalizeDriverPhoneDigits(body.driverPhone)
  }

  let federalHolidayMileage15xEnabled = prev.federalHolidayMileage15xEnabled !== false
  if (typeof body.federalHolidayMileage15xEnabled === 'boolean') {
    federalHolidayMileage15xEnabled = body.federalHolidayMileage15xEnabled
  }

  const prevStart = prev.workWeekStartDay ?? 0
  const prevEnd = prev.workWeekEndDay ?? 6
  let workWeekScheduleHistory = sanitizeWorkWeekScheduleHistory(prev.workWeekScheduleHistory)
  const retroApply = body.workWeekRetroactiveApply === true
  const scheduleDaysChanged = workWeekStartDay !== prevStart || workWeekEndDay !== prevEnd
  if (scheduleDaysChanged || retroApply) {
    const effectiveFromMs =
      typeof body.workWeekChangeEffectiveFromMs === 'number' &&
      Number.isFinite(body.workWeekChangeEffectiveFromMs) &&
      body.workWeekChangeEffectiveFromMs >= 0
        ? Math.floor(body.workWeekChangeEffectiveFromMs)
        : undefined
    workWeekScheduleHistory = appendWorkWeekScheduleChange(workWeekScheduleHistory, {
      effectiveFromMs,
      workWeekStartDay,
      workWeekEndDay,
      priorWorkWeekStartDay: prevStart,
      priorWorkWeekEndDay: prevEnd,
    })
  }

  const next = {
    username: username || null,
    passwordEnc,
    tractorNumber,
    employeeNumber,
    linehaulBearerEnc,
    driverName,
    linehaulPollMinutes,
    workWeekStartDay,
    workWeekEndDay,
    workWeekScheduleHistory,
    shiftStartMins,
    shiftEndMins,
    driverPhone,
    federalHolidayMileage15xEnabled,
  }
  await writeKeyJson(credsKey(acc), next)
  return getCredentialsMeta()
}

export async function clearCredentials() {
  const acc = resolveAccountKey() || getDataAccountKey()
  if (!acc) {
    throw new Error('No account to clear; log in or set FEDEX_TOOL_DATA_ACCOUNT_KEY')
  }
  const empty = {
    username: null,
    passwordEnc: null,
    tractorNumber: null,
    employeeNumber: null,
    linehaulBearerEnc: null,
    driverName: null,
    linehaulPollMinutes: null,
    workWeekStartDay: 0,
    workWeekEndDay: 6,
    workWeekScheduleHistory: [],
    shiftStartMins: 0,
    shiftEndMins: 1439,
    driverPhone: null,
    federalHolidayMileage15xEnabled: true,
  }
  await writeKeyJson(credsKey(acc), empty)
  try {
    await setTomtomApiKeyForAccount(acc, '')
  } catch {
    /* ignore profile clear errors */
  }
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
