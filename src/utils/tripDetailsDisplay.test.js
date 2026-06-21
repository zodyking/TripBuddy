import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DUAL_TRIPS_DETECTED_MESSAGE,
  formatTripDetailsFetchError,
} from './tripDetailsDisplay.js'

describe('formatTripDetailsFetchError', () => {
  it('maps HTTP 422 to dual-trips dispatch message', () => {
    assert.equal(formatTripDetailsFetchError('HTTP 422', 422), DUAL_TRIPS_DETECTED_MESSAGE)
  })

  it('maps error strings containing 422', () => {
    assert.equal(formatTripDetailsFetchError('Trip details HTTP 422', undefined), DUAL_TRIPS_DETECTED_MESSAGE)
  })

  it('passes through other errors unchanged', () => {
    assert.equal(formatTripDetailsFetchError('HTTP 500', 500), 'HTTP 500')
    assert.equal(formatTripDetailsFetchError(null, 404), null)
  })
})
