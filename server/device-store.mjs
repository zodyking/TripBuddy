import crypto from 'node:crypto'
import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'
import {
  getActiveSessionIdsForAccount,
  getSessionEntry,
  destroySession,
} from './auth-session.mjs'

const MAX_DEVICES = 50
const DEVICE_ID_RE = /^[a-zA-Z0-9._-]{8,128}$/

/**
 * @typedef {Object} RegisteredDevice
 * @property {string} id
 * @property {string} name
 * @property {string} os
 * @property {'mobile' | 'desktop' | 'tablet'} formFactor
 * @property {string} [deviceClass]
 * @property {string} browser
 * @property {string|null} userAgent
 * @property {string} registeredAt
 * @property {string} lastSeenAt
 * @property {string|null} sessionId
 * @property {string|null} lastIp
 */

/**
 * @param {string} accountKey
 */
function devicesKey(accountKey) {
  return userScopeKey('devices', accountKey)
}

/**
 * @param {string} accountKey
 * @returns {Promise<RegisteredDevice[]>}
 */
async function readDevices(accountKey) {
  const doc = await readKeyJson(devicesKey(accountKey), () => ({ devices: [] }))
  if (!doc || typeof doc !== 'object' || !Array.isArray(/** @type {any} */ (doc).devices)) {
    return []
  }
  return /** @type {RegisteredDevice[]} */ (/** @type {any} */ (doc).devices)
}

/**
 * @param {string} accountKey
 * @param {RegisteredDevice[]} devices
 */
async function writeDevices(accountKey, devices) {
  await writeKeyJson(devicesKey(accountKey), {
    devices: devices.slice(0, MAX_DEVICES),
  })
}

/**
 * @param {unknown} v
 * @returns {'mobile' | 'desktop' | 'tablet'}
 */
function normalizeFormFactor(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'mobile' || s === 'tablet' || s === 'desktop') return s
  return 'desktop'
}

/**
 * @param {unknown} body
 * @returns {{
 *   deviceId: string,
 *   name: string,
 *   os: string,
 *   formFactor: 'mobile' | 'desktop' | 'tablet',
 *   deviceClass: string,
 *   browser: string,
 *   userAgent: string | null,
 * }}
 */
export function parseDevicePayload(body) {
  const b = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {}
  const deviceId = String(b.deviceId ?? '').trim()
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new Error('Invalid device id')
  }
  const deviceClass = String(b.deviceClass ?? '').trim().slice(0, 32)
  const os = String(b.os ?? 'Unknown OS').trim().slice(0, 80) || 'Unknown OS'
  const browser = String(b.browser ?? 'Unknown browser').trim().slice(0, 80) || 'Unknown browser'
  const defaultName = deviceClass
    ? `${browser} · ${deviceClass}`.slice(0, 80)
    : `${browser} on ${os}`.slice(0, 80)
  const nameRaw = String(b.name ?? '').trim()
  const name = (nameRaw || defaultName).slice(0, 80)
  const ua = typeof b.userAgent === 'string' ? b.userAgent.slice(0, 512) : null
  return {
    deviceId,
    name,
    os,
    formFactor: normalizeFormFactor(b.formFactor),
    deviceClass,
    browser,
    userAgent: ua,
  }
}

/**
 * @param {RegisteredDevice} d
 * @param {string} accountKey
 * @param {string} [currentSessionId]
 */
function enrichDevice(d, accountKey, currentSessionId = '') {
  const active = new Set(getActiveSessionIdsForAccount(accountKey))
  const sessionId = d.sessionId && active.has(d.sessionId) ? d.sessionId : null
  return {
    ...d,
    sessionId,
    isSignedIn: Boolean(sessionId),
    isCurrent: Boolean(currentSessionId && sessionId === currentSessionId),
  }
}

/**
 * @param {string} accountKey
 * @param {ReturnType<typeof parseDevicePayload>} payload
 * @param {{ sessionId?: string | null, ip?: string | null }} [meta]
 */
export async function upsertRegisteredDevice(accountKey, payload, meta = {}) {
  const now = new Date().toISOString()
  const list = await readDevices(accountKey)
  const idx = list.findIndex((d) => d.id === payload.deviceId)
  const sessionId =
    meta.sessionId === undefined
      ? idx >= 0
        ? list[idx].sessionId
        : null
      : meta.sessionId
  const lastIp =
    meta.ip !== undefined
      ? meta.ip == null
        ? null
        : String(meta.ip).slice(0, 64)
      : idx >= 0
        ? list[idx].lastIp
        : null
  /** @type {RegisteredDevice} */
  const next = {
    id: payload.deviceId,
    name: payload.name,
    os: payload.os,
    formFactor: payload.formFactor,
    ...(payload.deviceClass ? { deviceClass: payload.deviceClass } : {}),
    browser: payload.browser,
    userAgent: payload.userAgent,
    registeredAt: idx >= 0 ? list[idx].registeredAt : now,
    lastSeenAt: now,
    sessionId: sessionId ?? null,
    lastIp,
  }
  if (idx >= 0) list[idx] = next
  else list.unshift(next)
  list.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
  await writeDevices(accountKey, list)
  return next
}

/**
 * @param {string} accountKey
 * @param {string} [currentSessionId]
 */
export async function listRegisteredDevices(accountKey, currentSessionId = '') {
  const list = await readDevices(accountKey)
  const active = getActiveSessionIdsForAccount(accountKey)
  const activeSet = new Set(active)
  const synced = list.map((d) => {
    const sessionId = d.sessionId && activeSet.has(d.sessionId) ? d.sessionId : null
    return { ...d, sessionId }
  })
  await writeDevices(accountKey, synced)
  return synced.map((d) => enrichDevice(d, accountKey, currentSessionId))
}

/**
 * @param {string} accountKey
 * @param {string} [currentSessionId]
 */
export async function listActiveSessionDevices(accountKey, currentSessionId = '') {
  const devices = await listRegisteredDevices(accountKey, currentSessionId)
  const activeIds = getActiveSessionIdsForAccount(accountKey)
  /** @type {Map<string, RegisteredDevice>} */
  const bySession = new Map()
  for (const d of devices) {
    if (d.sessionId) bySession.set(d.sessionId, d)
  }
  return activeIds.map((sessionId) => {
    const dev = bySession.get(sessionId)
    const entry = getSessionEntry(sessionId)
    if (dev) {
      return {
        sessionId,
        deviceId: dev.id,
        name: dev.name,
        os: dev.os,
        deviceClass: dev.deviceClass ?? null,
        formFactor: dev.formFactor,
        browser: dev.browser,
        lastSeenAt: dev.lastSeenAt,
        lastIp: dev.lastIp,
      }
    }
    return {
      sessionId,
      deviceId: entry?.deviceId ?? null,
      name: 'Unknown device',
      os: '',
      deviceClass: null,
      formFactor: 'desktop',
      browser: '',
      lastSeenAt: null,
      lastIp: null,
    }
  })
}

/**
 * @param {string} accountKey
 * @param {string} deviceId
 * @param {string} name
 */
export async function renameRegisteredDevice(accountKey, deviceId, name) {
  const id = String(deviceId ?? '').trim()
  const nextName = String(name ?? '').trim().slice(0, 80)
  if (!DEVICE_ID_RE.test(id)) throw new Error('Invalid device id')
  if (!nextName) throw new Error('Device name is required')
  const list = await readDevices(accountKey)
  const idx = list.findIndex((d) => d.id === id)
  if (idx < 0) throw new Error('Device not found')
  list[idx] = { ...list[idx], name: nextName, lastSeenAt: new Date().toISOString() }
  await writeDevices(accountKey, list)
  return list[idx]
}

/**
 * @param {string} accountKey
 * @param {string} deviceId
 */
export async function revokeDeviceSession(accountKey, deviceId) {
  const id = String(deviceId ?? '').trim()
  if (!DEVICE_ID_RE.test(id)) throw new Error('Invalid device id')
  const list = await readDevices(accountKey)
  const idx = list.findIndex((d) => d.id === id)
  if (idx < 0) throw new Error('Device not found')
  const sid = list[idx].sessionId
  if (sid) {
    destroySession(sid)
    list[idx] = { ...list[idx], sessionId: null, lastSeenAt: new Date().toISOString() }
    await writeDevices(accountKey, list)
  }
  return { ok: true, revokedSessionId: sid ?? null }
}

/**
 * @param {string} sessionId
 * @param {string} accountKey
 */
export async function clearDeviceSessionLink(sessionId, accountKey) {
  if (!sessionId || !accountKey) return
  const list = await readDevices(accountKey)
  let changed = false
  const next = list.map((d) => {
    if (d.sessionId === sessionId) {
      changed = true
      return { ...d, sessionId: null }
    }
    return d
  })
  if (changed) await writeDevices(accountKey, next)
}

/**
 * Register a device without signing in (from Settings).
 * @param {string} accountKey
 * @param {ReturnType<typeof parseDevicePayload>} payload
 * @param {string | null} [ip]
 */
export async function registerDeviceOnly(accountKey, payload, ip = null) {
  return upsertRegisteredDevice(accountKey, payload, { sessionId: null, ip })
}

/**
 * @param {string} accountKey
 * @param {string} deviceId
 */
export async function deleteRegisteredDevice(accountKey, deviceId) {
  const id = String(deviceId ?? '').trim()
  if (!DEVICE_ID_RE.test(id)) throw new Error('Invalid device id')
  const list = await readDevices(accountKey)
  const target = list.find((d) => d.id === id)
  if (!target) throw new Error('Device not found')
  if (target.sessionId) destroySession(target.sessionId)
  await writeDevices(
    accountKey,
    list.filter((d) => d.id !== id),
  )
  return { ok: true }
}

/**
 * @param {string} accountKey
 */
export async function touchCurrentDevice(accountKey, deviceId, ip = null) {
  const id = String(deviceId ?? '').trim()
  if (!DEVICE_ID_RE.test(id)) return null
  const list = await readDevices(accountKey)
  const idx = list.findIndex((d) => d.id === id)
  if (idx < 0) return null
  list[idx] = {
    ...list[idx],
    lastSeenAt: new Date().toISOString(),
    ...(ip != null ? { lastIp: String(ip).slice(0, 64) } : {}),
  }
  await writeDevices(accountKey, list)
  return list[idx]
}
