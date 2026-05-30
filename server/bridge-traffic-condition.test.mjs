import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyBridgeTraffic,
  bridgeDelayTierForRow,
} from '../src/utils/bridgeTrafficCondition.js'

describe('classifyBridgeTraffic', () => {
  it('Bayonne 2 min stays light vs its ~2 min baseline', () => {
    const r = classifyBridgeTraffic({
      routeId: 217,
      routeTravelTime: 2,
      routeSpeed: 44,
      routeTravelTimeHist: 2,
      routeSpeedHist: 45,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('GWB To NJ ~12 min is light (not global red)', () => {
    const r = classifyBridgeTraffic({
      routeId: 12,
      routeTravelTime: 12,
      routeSpeed: 27,
      routeTravelTimeHist: 12,
      routeSpeedHist: 28,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('GWB To NY ~18 min vs ~25 min hist is light', () => {
    const r = classifyBridgeTraffic({
      routeId: 211,
      routeTravelTime: 18,
      routeSpeed: 17,
      routeTravelTimeHist: 25,
      routeSpeedHist: 13,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('Outerbridge To NY 6 min vs ~7 min hist is light', () => {
    const r = classifyBridgeTraffic({
      routeId: 2520,
      routeTravelTime: 6,
      routeSpeed: 49,
      routeTravelTimeHist: 7,
      routeSpeedHist: 39,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('Goethals spike ~8 min is high or standstill', () => {
    const r = classifyBridgeTraffic({
      routeId: 87,
      routeTravelTime: 8,
      routeSpeed: 20,
      routeTravelTimeHist: 2,
      routeSpeedHist: 45,
    })
    assert.ok(r.level === 'high' || r.level === 'standstill')
    assert.equal(r.tier, 'red')
  })

  it('GWB To NY severe delay is standstill', () => {
    const r = classifyBridgeTraffic({
      routeId: 211,
      routeTravelTime: 70,
      routeSpeed: 9,
      routeTravelTimeHist: 25,
      routeSpeedHist: 13,
    })
    assert.equal(r.level, 'standstill')
    assert.equal(r.tier, 'red')
  })

  it('Verrazzano To NJ ~11 min near static baseline is light', () => {
    const r = classifyBridgeTraffic({
      routeId: 'verrazzano',
      travelDirection: 'ToNJ',
      routeTravelTime: 10.8,
      routeSpeed: 40,
    })
    assert.equal(r.level, 'low')
    assert.equal(r.tier, 'green')
  })

  it('Verrazzano To NY ~28 min near static baseline is not heavy', () => {
    const r = classifyBridgeTraffic({
      routeId: 'verrazzano',
      travelDirection: 'ToNY',
      routeTravelTime: 28.3,
      routeSpeed: 34,
    })
    assert.ok(['low', 'medium'].includes(r.level))
    assert.notEqual(r.level, 'standstill')
  })

  it('bridgeDelayTierForRow uses PANYNJ hist fields', () => {
    const tier = bridgeDelayTierForRow({
      routeId: 260,
      routeTravelTime: 4,
      routeSpeed: 46,
      routeTravelTimeHist: 4,
      routeSpeedHist: 47,
    })
    assert.equal(tier, 'green')
  })
})
