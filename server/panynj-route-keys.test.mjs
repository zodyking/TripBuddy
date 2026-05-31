import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPanynjSeriesKey,
  panynjSeriesStorageKeys,
} from '../src/bridges/panynjRouteKeys.js'
import { isGwbUpperDeckRow } from '../src/bridges/gwbRoutes.js'

describe('panynjRouteKeys', () => {
  it('canonical GWB upper keys are stable across routeId', () => {
    const row12 = {
      routeId: 12,
      crossingDisplayName: 'George Washington Bridge',
      travelDirection: 'ToNJ',
      facilityModifier: 'Upper',
    }
    const row5219 = { ...row12, routeId: 5219 }
    assert.equal(canonicalPanynjSeriesKey(row12), 'gwb-upper-tonj')
    assert.equal(canonicalPanynjSeriesKey(row5219), 'gwb-upper-tonj')
    assert.ok(panynjSeriesStorageKeys(row12).includes('12'))
    assert.ok(panynjSeriesStorageKeys(row5219).includes('5219'))
  })

  it('isGwbUpperDeckRow uses facilityModifier', () => {
    assert.equal(
      isGwbUpperDeckRow(
        {
          routeId: 999,
          crossingDisplayName: 'George Washington Bridge',
          travelDirection: 'ToNY',
          facilityModifier: 'Upper',
        },
        'ToNY',
      ),
      true,
    )
    assert.equal(
      isGwbUpperDeckRow(
        {
          routeId: 212,
          crossingDisplayName: 'George Washington Bridge',
          travelDirection: 'ToNY',
          facilityModifier: 'Lower',
        },
        'ToNY',
      ),
      false,
    )
  })
})
