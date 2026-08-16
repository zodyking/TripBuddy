import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseInspectCheckoutProgress,
  inspectCheckoutOutcomeSpeech,
  isInspectCheckoutAutomation,
  isClientGeneratedLiveLog,
} from './inspectCheckoutProgress.js'

test('parseInspectCheckoutProgress maps dolly / seal / trailer errors', () => {
  const dolly = parseInspectCheckoutProgress('Dolly candidate rejected: 123456 — trying next')
  assert.equal(dolly?.button, 'Invalid dolly')
  assert.match(dolly?.tts || '', /Dolly number was rejected/)

  const seal = parseInspectCheckoutProgress('Invalid seal: 999 for Trailer 2 — trying next')
  assert.equal(seal?.button, 'Invalid seal T2')
  assert.match(seal?.tts || '', /trailer 2/)

  const trailer = parseInspectCheckoutProgress('Invalid trailer number after batch validate — will retry next pass')
  assert.equal(trailer?.button, 'Invalid trailer #')
})

test('parseInspectCheckoutProgress maps live steps without TTS', () => {
  const dolly = parseInspectCheckoutProgress('Trying dolly candidate: 687818')
  assert.equal(dolly?.button, 'Entering dolly')
  assert.equal(dolly?.tts, '')

  const dispatch = parseInspectCheckoutProgress('Clicked DISPATCH button')
  assert.equal(dispatch?.button, 'Dispatching')
  assert.equal(dispatch?.tts, '')
})

test('parseInspectCheckoutProgress maps terminal outcomes', () => {
  const ok = parseInspectCheckoutProgress('Inspect & Check Out complete: You are Dispatched!')
  assert.equal(ok?.button, 'Dispatched')
  assert.match(ok?.tts || '', /You are dispatched/)

  const data = parseInspectCheckoutProgress('Dismissed Invalid Data Entered (OK) — continuing inspect/checkout')
  assert.equal(data?.button, 'Invalid data')
  assert.match(data?.tts || '', /Invalid data entered/)
})

test('inspectCheckoutOutcomeSpeech covers failure reasons', () => {
  assert.match(inspectCheckoutOutcomeSpeech('dispatch_not_clicked'), /not clicked/)
  assert.match(inspectCheckoutOutcomeSpeech('dispatch_not_confirmed'), /not confirmed/)
  assert.match(inspectCheckoutOutcomeSpeech('dispatched'), /complete/)
  assert.match(
    inspectCheckoutOutcomeSpeech('x', { requiresReCheckin: true }),
    /New trip details/,
  )
})

test('isInspectCheckoutAutomation matches name and action types', () => {
  assert.equal(isInspectCheckoutAutomation({ name: 'Inspect & Checkout' }), true)
  assert.equal(
    isInspectCheckoutAutomation({ actions: [{ type: 'inspectCheckoutContinue' }] }),
    true,
  )
  assert.equal(isInspectCheckoutAutomation({ name: 'Check In' }), false)
})

test('isClientGeneratedLiveLog skips TTS and queue lines', () => {
  assert.equal(isClientGeneratedLiveLog('[Alert] Inspect & Checkout: hello'), true)
  assert.equal(isClientGeneratedLiveLog('[Queue] next'), true)
  assert.equal(isClientGeneratedLiveLog('[Test] testErrorAlert called'), true)
  assert.equal(isClientGeneratedLiveLog('Inspect & Check Out requires re-checkin due to trip changes'), false)
})

test('parseInspectCheckoutProgress ignores stacked [Alert] failure lines', () => {
  const stacked =
    '[Alert] Inspect & Checkout: [Alert] Inspect & Checkout [Alert] Inspect & Checkout: Inspect & Check Out requires re-checkin due to trip changes'
  assert.equal(parseInspectCheckoutProgress(stacked, 'warn'), null)
  assert.equal(
    parseInspectCheckoutProgress('[Alert] Inspect & Checkout: Inspect & Check Out requires re-checkin due to trip changes', 'warn'),
    null,
  )
})

test('parseInspectCheckoutProgress maps re-checkin without a unique warn hash', () => {
  const parsed = parseInspectCheckoutProgress(
    'Inspect & Check Out requires re-checkin due to trip changes',
    'warn',
  )
  assert.equal(parsed?.button, 'New trip details')
  assert.equal(parsed?.ttsKey, 'new_trip')
  assert.equal(parsed?.error, 'Trip details changed')
})

test('parseInspectCheckoutProgress does not treat unknown inspect warns as progress', () => {
  assert.equal(parseInspectCheckoutProgress('Inspect & Check Out post-gate finished', 'info'), null)
  assert.equal(parseInspectCheckoutProgress('Inspect & Check Out: something unexpected', 'warn'), null)
})

test('parseInspectCheckoutProgress maps check-in and arrive steps', () => {
  assert.equal(parseInspectCheckoutProgress('Opening Check In')?.button, 'Opening check-in')
  assert.equal(parseInspectCheckoutProgress('Submitting check-in')?.button, 'Submitting')
  assert.equal(parseInspectCheckoutProgress('FedEx reported a message after submit', 'warn')?.button, 'Check-in issue')
  assert.equal(parseInspectCheckoutProgress('Clicked Arrive (xpath)')?.button, 'Tapping Arrive')
  assert.equal(parseInspectCheckoutProgress('Tractor already arrived by geofence — skipping manual arrive')?.button, 'Already arrived')
})
