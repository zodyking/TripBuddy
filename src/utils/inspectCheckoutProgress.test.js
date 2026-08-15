import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseInspectCheckoutProgress,
  inspectCheckoutOutcomeSpeech,
  isInspectCheckoutAutomation,
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
