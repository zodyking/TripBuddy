import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PAY_ROUND_BAND_MIN,
  PAY_ROUND_BAND_MAX,
  PAY_ROUND_TO_MI,
  billableMilesForPayEstimate,
  isPayMileageRounded,
} from '../src/utils/payMileageRounding.js'

test('billableMilesForPayEstimate rounds 34–49 mi to 50', () => {
  assert.equal(billableMilesForPayEstimate(33.9), 33.9)
  assert.equal(billableMilesForPayEstimate(PAY_ROUND_BAND_MIN), PAY_ROUND_TO_MI)
  assert.equal(billableMilesForPayEstimate(39), PAY_ROUND_TO_MI)
  assert.equal(billableMilesForPayEstimate(PAY_ROUND_BAND_MAX), PAY_ROUND_TO_MI)
  assert.equal(billableMilesForPayEstimate(50), 50)
  assert.equal(billableMilesForPayEstimate(54), 54)
})

test('isPayMileageRounded matches billable band only', () => {
  assert.equal(isPayMileageRounded(33), false)
  assert.equal(isPayMileageRounded(34), true)
  assert.equal(isPayMileageRounded(49), true)
  assert.equal(isPayMileageRounded(50), false)
})
