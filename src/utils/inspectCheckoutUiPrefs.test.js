import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInspectCheckoutUiMode } from './inspectCheckoutUiPrefs.js'

test('normalizeInspectCheckoutUiMode defaults to smart action buttons', () => {
  assert.equal(normalizeInspectCheckoutUiMode(null), 'button')
  assert.equal(normalizeInspectCheckoutUiMode(''), 'button')
  assert.equal(normalizeInspectCheckoutUiMode('button'), 'button')
  assert.equal(normalizeInspectCheckoutUiMode('preview'), 'preview')
  assert.equal(normalizeInspectCheckoutUiMode('other'), 'button')
})
