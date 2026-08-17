import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseInspectCheckoutProgress,
  inspectCheckoutOutcomeSpeech,
  isInspectCheckoutAutomation,
  isClientGeneratedLiveLog,
  isInspectRetryProgressKey,
} from './inspectCheckoutProgress.js'

test('parseInspectCheckoutProgress maps dolly / seal / trailer errors with numbers and TTS', () => {
  const dolly = parseInspectCheckoutProgress('Dolly candidate rejected: 123456 — trying next')
  assert.equal(dolly?.button, 'Dolly 123456 rejected')
  assert.equal(dolly?.error, 'Dolly 123456 was rejected')
  assert.match(dolly?.tts || '', /Dolly 1, 2, 3, 4, 5, 6 was rejected/)
  assert.equal(dolly?.ttsKey, 'invalid_dolly_123456')

  const seal = parseInspectCheckoutProgress('Invalid seal: 999 for Trailer 2 — trying next')
  assert.equal(seal?.button, 'Seal 999 T2 rejected')
  assert.equal(seal?.error, 'Seal 999 for trailer 2 was rejected')
  assert.match(seal?.tts || '', /Seal 9, 9, 9 for trailer 2 was rejected/)
  assert.equal(seal?.ttsKey, 'invalid_seal_2_999')

  const trailer = parseInspectCheckoutProgress('Invalid trailer number: 835125 — will retry')
  assert.equal(trailer?.button, 'Trailer 835125 rejected')
  assert.match(trailer?.tts || '', /trailer 8, 3, 5, 1, 2, 5 was rejected/)
  assert.equal(trailer?.ttsKey, 'invalid_trailer_835125')

  const batch = parseInspectCheckoutProgress('Invalid trailer number: 835125, 822697 — will retry')
  assert.equal(batch?.button, 'Trailers 835125, 822697 rejected')
  assert.match(batch?.tts || '', /trailer 8, 3, 5, 1, 2, 5, and trailer 8, 2, 2, 6, 9, 7 were rejected/)
})

test('retry progress keys are the entering-field steps that bounced the Home button', () => {
  const retry = parseInspectCheckoutProgress('Trying seal candidate: 888 for Trailer 2')
  assert.equal(retry?.button, 'Entering seal T2')
  assert.equal(retry?.error, '')
  assert.equal(isInspectRetryProgressKey(retry?.ttsKey || ''), true)

  const dollyTry = parseInspectCheckoutProgress('Trying dolly candidate: 687818')
  assert.equal(isInspectRetryProgressKey(dollyTry?.ttsKey || ''), true)

  const trailerTry = parseInspectCheckoutProgress('Filled trailer number: 835125')
  assert.equal(isInspectRetryProgressKey(trailerTry?.ttsKey || ''), true)

  const rejected = parseInspectCheckoutProgress('Invalid seal: 999 for Trailer 2 — trying next')
  assert.equal(isInspectRetryProgressKey(rejected?.ttsKey || ''), false)
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
