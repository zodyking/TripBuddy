import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSession,
  destroySession,
  getActiveSessionIdsForAccount,
  getSessionAccountKey,
  isValidSession,
  MAX_SESSIONS_PER_ACCOUNT,
  revokeAllSessionsForAccount,
} from './auth-session.mjs'
import { parseDevicePayload } from './device-store.mjs'

test('createSession allows up to MAX_SESSIONS_PER_ACCOUNT per account', () => {
  const accountKey = 'test-account-' + Date.now()
  const s1 = createSession(accountKey, 'device-a')
  const s2 = createSession(accountKey, 'device-b')
  const s3 = createSession(accountKey, 'device-c')
  assert.ok(s1)
  assert.ok(s2)
  assert.equal(s3, null)
  assert.equal(getActiveSessionIdsForAccount(accountKey).length, MAX_SESSIONS_PER_ACCOUNT)
  assert.equal(isValidSession(s1), true)
  assert.equal(isValidSession(s2), true)
  revokeAllSessionsForAccount(accountKey)
  assert.equal(getActiveSessionIdsForAccount(accountKey).length, 0)
})

test('destroySession removes one session without affecting the other', () => {
  const accountKey = 'test-account-destroy-' + Date.now()
  const s1 = createSession(accountKey, 'device-a')
  const s2 = createSession(accountKey, 'device-b')
  assert.ok(s1 && s2)
  destroySession(s1)
  assert.equal(isValidSession(s1), false)
  assert.equal(isValidSession(s2), true)
  assert.equal(getSessionAccountKey(s2), accountKey)
  destroySession(s2)
})

test('parseDevicePayload validates device id and normalizes fields', () => {
  const payload = parseDevicePayload({
    deviceId: 'abc12345-device',
    name: 'Work laptop',
    os: 'macOS 14',
    deviceClass: 'mac',
    formFactor: 'desktop',
    browser: 'Safari',
    userAgent: 'Mozilla/5.0',
  })
  assert.equal(payload.deviceId, 'abc12345-device')
  assert.equal(payload.name, 'Work laptop')
  assert.equal(payload.formFactor, 'desktop')
  assert.throws(() => parseDevicePayload({ deviceId: 'short' }))
})
