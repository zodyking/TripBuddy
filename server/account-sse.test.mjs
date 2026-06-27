import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  registerSseConnection,
  broadcastToAccount,
} from './session-sse.mjs'

test('broadcastToAccount delivers only to matching account sessions', () => {
  /** @type {object[]} */
  const a1 = []
  /** @type {object[]} */
  const a2 = []
  registerSseConnection('s1', 'account-a', (p) => a1.push(p))
  registerSseConnection('s2', 'account-b', (p) => a2.push(p))
  broadcastToAccount('account-a', { type: 'automation', code: 'AUTOMATION_START' })
  assert.equal(a1.length, 1)
  assert.equal(a2.length, 0)
  assert.equal(a1[0].code, 'AUTOMATION_START')
})
