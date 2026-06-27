import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSession,
  isValidSession,
  SESSION_IDLE_MS,
  setSessionLastActivityAtForTest,
  touchSessionActivity,
  revokeAllSessionsForAccount,
} from './auth-session.mjs'

test('session expires after SESSION_IDLE_MS without activity', () => {
  const accountKey = 'idle-test-' + Date.now()
  const sid = createSession(accountKey, 'device-a')
  assert.ok(sid)
  assert.equal(isValidSession(sid), true)

  setSessionLastActivityAtForTest(sid, Date.now() - SESSION_IDLE_MS - 1)
  assert.equal(isValidSession(sid), false)

  revokeAllSessionsForAccount(accountKey)
})

test('touchSessionActivity resets idle timeout', () => {
  const accountKey = 'idle-touch-' + Date.now()
  const sid = createSession(accountKey, 'device-a')
  assert.ok(sid)

  setSessionLastActivityAtForTest(sid, Date.now() - SESSION_IDLE_MS + 60_000)
  assert.equal(isValidSession(sid), true)
  touchSessionActivity(sid)
  setSessionLastActivityAtForTest(sid, Date.now() - SESSION_IDLE_MS + 60_000)
  assert.equal(isValidSession(sid), true)

  revokeAllSessionsForAccount(accountKey)
})
