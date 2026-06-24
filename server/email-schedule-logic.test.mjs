import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeDailyShiftEmailDecision,
  computeWeeklyEmailDecision,
} from '../src/utils/shiftCalendar.js'

describe('computeDailyShiftEmailDecision', () => {
  it('fires after midnight when default shift end is 23:59 with 30m delay', () => {
    const tuesday0029 = Date.parse('2026-06-23T04:29:00.000Z') // Mon 00:29 America/New_York (EDT)
    const before = computeDailyShiftEmailDecision({
      nowMs: tuesday0029 - 5 * 60 * 1000,
      timeZone: 'America/New_York',
      shiftStartMins: 0,
      shiftEndMins: 1439,
      dailyDelayMins: 30,
    })
    const after = computeDailyShiftEmailDecision({
      nowMs: tuesday0029,
      timeZone: 'America/New_York',
      shiftStartMins: 0,
      shiftEndMins: 1439,
      dailyDelayMins: 30,
    })
    assert.equal(before.shouldSend, false)
    assert.equal(after.shouldSend, true)
    assert.equal(after.shiftDayKey, '2026-06-22')
  })

  it('fires same day for afternoon shift end', () => {
    const sendAt = Date.parse('2026-06-22T21:30:00.000Z') // 17:30 EDT
    const r = computeDailyShiftEmailDecision({
      nowMs: sendAt,
      timeZone: 'America/New_York',
      shiftStartMins: 0,
      shiftEndMins: 17 * 60,
      dailyDelayMins: 30,
    })
    assert.equal(r.shouldSend, true)
    assert.equal(r.shiftDayKey, '2026-06-22')
  })
})

describe('computeWeeklyEmailDecision', () => {
  it('allows a 60-minute Monday morning window', () => {
    const monday6 = Date.parse('2026-06-22T10:00:00.000Z') // Mon 06:00 EDT
    const monday615 = Date.parse('2026-06-22T10:15:00.000Z')
    assert.equal(
      computeWeeklyEmailDecision({ nowMs: monday6, timeZone: 'America/New_York' }).shouldSend,
      true,
    )
    assert.equal(
      computeWeeklyEmailDecision({ nowMs: monday615, timeZone: 'America/New_York' }).shouldSend,
      true,
    )
  })
})
