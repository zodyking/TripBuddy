import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyBridgeTraffic,
  levelFromProfile,
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

  it('GWB upper To NJ 13 min / 27 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 12,
      travelDirection: 'ToNJ',
      facilityModifier: 'Upper',
      routeTravelTime: 13,
      routeSpeed: 27,
    })
    assert.equal(r.level, 'low')
  })

  it('GWB upper To NY 18 min / 17 mph → low (not global red)', () => {
    const r = classifyBridgeTraffic({
      routeId: 211,
      travelDirection: 'ToNY',
      facilityModifier: 'Upper',
      routeTravelTime: 18,
      routeSpeed: 17,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('GWB upper To NY 7 mph at 22 min is not standstill (normal crawl)', () => {
    const r = classifyBridgeTraffic({
      routeId: 211,
      travelDirection: 'ToNY',
      facilityModifier: 'Upper',
      routeTravelTime: 22,
      routeSpeed: 7,
    })
    assert.notEqual(r.level, 'standstill')
  })

  it('GWB upper To NY 50 min / 8 mph → standstill', () => {
    const r = classifyBridgeTraffic({
      routeId: 211,
      travelDirection: 'ToNY',
      facilityModifier: 'Upper',
      routeTravelTime: 50,
      routeSpeed: 8,
    })
    assert.equal(r.level, 'standstill')
  })

  it('Goethals To NJ spike 9 min / 12 mph → standstill', () => {
    const r = classifyBridgeTraffic({
      routeId: 87,
      travelDirection: 'ToNJ',
      routeTravelTime: 9,
      routeSpeed: 12,
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

  it('Verrazzano To NJ 11 min / 40 mph → low', () => {
    const r = classifyBridgeTraffic({
      routeId: 'verrazzano',
      travelDirection: 'ToNJ',
      routeTravelTime: 11,
      routeSpeed: 40,
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

describe('levelFromProfile standstill rules', () => {
  it('requires time threshold for very low speed on GWB NY', () => {
    const p = BRIDGE_TRAFFIC_PROFILES.george_washington_bridge__upper__to_ny
    assert.equal(levelFromProfile(22, 7, p), 'medium')
    assert.equal(levelFromProfile(45, 8, p), 'standstill')
  })
})
