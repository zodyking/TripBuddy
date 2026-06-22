import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDollyCandidates,
  shouldManuallyAddDollyToTrip,
  buildAddDollyConfirmMessage,
} from './inspectFieldResolver.mjs'

test('shouldManuallyAddDollyToTrip requires dolly and at most one trailer', () => {
  assert.equal(
    shouldManuallyAddDollyToTrip({ trailers: [], dolly: { number1: '123456' } }),
    true,
  )
  assert.equal(
    shouldManuallyAddDollyToTrip({
      trailers: [{ trlrNbr: 'T1' }],
      dolly: { number1: '123456' },
    }),
    true,
  )
  assert.equal(
    shouldManuallyAddDollyToTrip({
      trailers: [{ trlrNbr: 'T1' }, { trlrNbr: 'T2' }],
      dolly: { number1: '123456' },
    }),
    false,
  )
  assert.equal(
    shouldManuallyAddDollyToTrip({ trailers: [{ trlrNbr: 'T1' }] }),
    false,
  )
  assert.equal(shouldManuallyAddDollyToTrip({ dollyNumber1: '654321' }), true)
})

test('getDollyCandidates collects nested and flat fields', () => {
  const c = getDollyCandidates({ dolly: { number1: '111111', number2: '222222' } })
  assert.deepEqual(c, ['111111', '222222'])
})

test('buildAddDollyConfirmMessage includes dolly number when present', () => {
  assert.equal(
    buildAddDollyConfirmMessage('123456'),
    'Do you want to add dolly number 123456 to the dispatch?',
  )
  assert.equal(
    buildAddDollyConfirmMessage(''),
    'Do you want to add a dolly to the dispatch?',
  )
})
