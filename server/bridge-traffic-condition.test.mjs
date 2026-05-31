import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyBridgeTraffic,
  isStandstillTraffic,
  levelFromProfile,
  STANDSTILL_ABSOLUTE_MINUTES,
  STANDSTILL_CRAWL_MAX_SPEED_MPH,
} from '../src/utils/bridgeTrafficCondition.js'
import { BRIDGE_TRAFFIC_PROFILES } from '../src/utils/bridgeTrafficProfiles.js'

describe('classifyBridgeTraffic (calibrated profiles)', () => {
  it('Bayonne 2 min / 44 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 217,
      travelDirection: 'ToNJ',
      routeTravelTime: 2,
      routeSpeed: 44,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('GWB upper To NJ (current routeId 5219) 13 min / 27 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 5219,
      travelDirection: 'ToNJ',
      facilityModifier: 'Upper',
      routeTravelTime: 13,
      routeSpeed: 27,
    })
    assert.equal(r.level, 'low')
  })

  it('GWB upper To NY (current routeId 881) 18 min / 17 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 881,
      travelDirection: 'ToNY',
      facilityModifier: 'Upper',
      routeTravelTime: 18,
      routeSpeed: 17,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('GWB upper To NY 22 min / 7 mph → medium (crawl, not gridlock)', () => {
    const r = classifyBridgeTraffic({
      routeId: 211,
      travelDirection: 'ToNY',
      facilityModifier: 'Upper',
      routeTravelTime: 22,
      routeSpeed: 7,
    })
    assert.equal(r.level, 'medium')
  })

  it('30+ min is standstill even at highway speed', () => {
    const r = classifyBridgeTraffic({
      routeId: 12,
      travelDirection: 'ToNJ',
      facilityModifier: 'Upper',
      routeTravelTime: 32,
      routeSpeed: 26,
    })
    assert.equal(r.level, 'standstill')
  })

  it('29 min @ 26 mph is not the absolute standstill rule', () => {
    const r = classifyBridgeTraffic({
      routeId: 'verrazzano',
      travelDirection: 'ToNJ',
      routeTravelTime: 29,
      routeSpeed: 26,
    })
    assert.notEqual(r.level, 'standstill')
  })

  it('Goethals To NJ 9 min / 9 mph → standstill', () => {
    const r = classifyBridgeTraffic({
      routeId: 87,
      travelDirection: 'ToNJ',
      routeTravelTime: 9,
      routeSpeed: 9,
    })
    assert.equal(r.level, 'standstill')
  })

  it('Outerbridge To NY 6 min / 49 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 2520,
      travelDirection: 'ToNY',
      routeTravelTime: 6,
      routeSpeed: 49,
    })
    assert.equal(r.level, 'low')
  })

  it('Verrazzano To NY 28 min / 34 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 'verrazzano',
      travelDirection: 'ToNY',
      routeTravelTime: 28,
      routeSpeed: 34,
    })
    assert.equal(r.level, 'low')
  })
})

describe('standstill compound rules', () => {
  it(`absolute ${STANDSTILL_ABSOLUTE_MINUTES} min threshold`, () => {
    const p = BRIDGE_TRAFFIC_PROFILES.bayonne_bridge__to_nj
    assert.equal(isStandstillTraffic(30, 50, p), true)
    assert.equal(isStandstillTraffic(29, 50, p), false)
  })

  it('crawl standstill only at or below crawl speed cap when under 30 min', () => {
    const p = BRIDGE_TRAFFIC_PROFILES.bayonne_bridge__to_nj
    assert.equal(
      isStandstillTraffic(20, STANDSTILL_CRAWL_MAX_SPEED_MPH + 5, p),
      false,
    )
  })

  it('GWB upper NY 45 min / 8 mph → standstill', () => {
    const p = BRIDGE_TRAFFIC_PROFILES.george_washington_bridge__upper__to_ny
    assert.equal(levelFromProfile(45, 8, p), 'standstill')
  })
})
