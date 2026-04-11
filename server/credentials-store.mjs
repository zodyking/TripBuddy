import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_DIR } from './config.mjs'

const CRED_FILE = path.join(LOCAL_DIR, 'credentials.json')

const ALGO = 'aes-256-gcm'
const SCRYPT_SALT = 'fedextool-cred-v1'

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
 * @returns {{
 *   username: string | null,
 *   passwordEnc: object | null,
 *   tractorNumber: string | null,
 *   employeeNumber: string | null,
 *   linehaulBearerEnc: object | null,
 *   linehaulPollMinutes: number | null,
 * }}
 */
async function readFileRaw() {
  try {
    const raw = await fs.readFile(CRED_FILE, 'utf8')
    const data = JSON.parse(raw)
    let pollM = null
    if (typeof data.linehaulPollMinutes === 'number' && !Number.isNaN(data.linehaulPollMinutes)) {
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
      linehaulPollMinutes: pollM,
    }
  } catch {
    return {
      username: null,
      passwordEnc: null,
      tractorNumber: null,
      employeeNumber: null,
      linehaulBearerEnc: null,
      linehaulPollMinutes: null,
    }
  }
}

export async function getCredentialsMeta() {
  const {
    username,
    passwordEnc,
    tractorNumber,
    employeeNumber,
    linehaulBearerEnc,
    linehaulPollMinutes,
  } = await readFileRaw()
  const tn = tractorNumber?.trim() || null
  const en = employeeNumber?.trim() || null
  const poll =
    typeof linehaulPollMinutes === 'number' ? linehaulPollMinutes : 0
  return {
    username: username || null,
    hasPassword: Boolean(passwordEnc?.data && passwordEnc?.iv && passwordEnc?.tag),
    tractorNumber: tn,
    hasTractor: Boolean(tn),
    employeeNumber: en,
    hasEmployeeNumber: Boolean(en),
    hasLinehaulBearer: Boolean(
      linehaulBearerEnc?.data && linehaulBearerEnc?.iv && linehaulBearerEnc?.tag,
    ),
    linehaulPollMinutes: poll,
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
  const emp = typeof raw.employeeNumber === 'string' ? raw.employeeNumber.trim() : ''
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

/**
 * @param {{
 *   username?: string,
 *   password?: string,
 *   tractorNumber?: string,
 *   fedexLinehaulBearer?: string,
 *   clearFedexLinehaulBearer?: boolean,
 *   linehaulPollMinutes?: number,
 * }} body password optional = keep; linehaulPollMinutes 0–1440 (0 = no auto refresh)
 */
export async function saveCredentials(body) {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
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

  let linehaulPollMinutes = prev.linehaulPollMinutes
  if (typeof body.linehaulPollMinutes === 'number' && !Number.isNaN(body.linehaulPollMinutes)) {
    linehaulPollMinutes = Math.max(0, Math.min(24 * 60, Math.floor(body.linehaulPollMinutes)))
  }

  const next = {
    username: username || null,
    passwordEnc,
    tractorNumber,
    employeeNumber,
    linehaulBearerEnc,
    linehaulPollMinutes,
  }
  await fs.writeFile(CRED_FILE, JSON.stringify(next, null, 2), 'utf8')
  return getCredentialsMeta()
}

export async function clearCredentials() {
  await fs.mkdir(LOCAL_DIR, { recursive: true })
  await fs.writeFile(
    CRED_FILE,
    JSON.stringify(
      {
        username: null,
        passwordEnc: null,
        tractorNumber: null,
        employeeNumber: null,
        linehaulBearerEnc: null,
        linehaulPollMinutes: null,
      },
      null,
      2,
    ),
    'utf8',
  )
}
