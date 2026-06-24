import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/** Mirrors email-trip-activity.mjs combined fp helpers for unit tests. */
function combinedMonitorFp(activeFp, preplanFp) {
  return `a:${activeFp || ''}|p:${preplanFp || ''}`
}

function shouldRecordTripActivity(prevCombined, nextCombined, nextActive, nextPreplan) {
  if (nextCombined === prevCombined) return false
  const prevActive = prevCombined.match(/^a:([^|]*)/)?.[1] ?? ''
  const prevPreplan = prevCombined.match(/\|p:(.*)$/)?.[1] ?? ''
  const activeChanged = Boolean(nextActive) && nextActive !== prevActive
  const preplanChanged = Boolean(nextPreplan) && nextPreplan !== prevPreplan
  return activeChanged || preplanChanged
}

describe('email trip activity monitor', () => {
  it('records when active trip fingerprint changes', () => {
    const prev = combinedMonitorFp('', '')
    const nextActive = '1|||EWR|||BOS'
    const next = combinedMonitorFp(nextActive, '')
    assert.equal(shouldRecordTripActivity(prev, next, nextActive, ''), true)
  })

  it('does not record when trip clears to empty', () => {
    const prevActive = '1|||EWR|||BOS'
    const prev = combinedMonitorFp(prevActive, '')
    const next = combinedMonitorFp('', '')
    assert.equal(shouldRecordTripActivity(prev, next, '', ''), false)
  })

  it('does not record when fingerprint is unchanged', () => {
    const fp = '1|||EWR|||BOS'
    const combined = combinedMonitorFp(fp, '')
    assert.equal(shouldRecordTripActivity(combined, combined, fp, ''), false)
  })

  it('records when preplan appears', () => {
    const prev = combinedMonitorFp('1|||EWR|||BOS', '')
    const preplan = 'preplan:2|||BOS|||EWR'
    const next = combinedMonitorFp('1|||EWR|||BOS', preplan)
    assert.equal(shouldRecordTripActivity(prev, next, '1|||EWR|||BOS', preplan), true)
  })
})
