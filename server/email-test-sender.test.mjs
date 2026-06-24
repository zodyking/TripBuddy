import test from 'node:test'
import assert from 'node:assert/strict'
import { EMAIL_TEST_KINDS, buildTestEmailForKind } from './email-test-sender.mjs'

test('EMAIL_TEST_KINDS includes all notification templates', () => {
  const ids = EMAIL_TEST_KINDS.map((k) => k.id)
  assert.ok(ids.includes('smtp'))
  assert.ok(ids.includes('new_trip'))
  assert.ok(ids.includes('weekly_summary'))
})

test('buildTestEmailForKind rejects unknown kind', async () => {
  await assert.rejects(() => buildTestEmailForKind('acct', 'not_a_kind'), /Unknown test email type/)
})
