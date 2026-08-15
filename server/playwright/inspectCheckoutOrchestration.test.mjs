import test from 'node:test'
import assert from 'node:assert/strict'
import { isInvalidDataEnteredCopy } from './inspectCheckoutOrchestration.mjs'

test('isInvalidDataEnteredCopy matches FedEx overlay title and body', () => {
  assert.equal(isInvalidDataEnteredCopy('Invalid Data Entered'), true)
  assert.equal(
    isInvalidDataEnteredCopy(
      'One or more of the values you entered are not valid. Please verify your entries and try again.',
    ),
    true,
  )
  assert.equal(isInvalidDataEnteredCopy('You are Dispatched!'), false)
  assert.equal(isInvalidDataEnteredCopy('Invalid Seal Number'), false)
})
