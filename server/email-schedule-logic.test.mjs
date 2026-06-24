import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeDailyShiftEmailDecision,
  computeWeeklyEmailDecision,
  isWeeklySendWindowReady,
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
  it('sends on work week last day after shift end and 2h trip idle', () => {
    // Thu–Mon work week: last day Monday. Shift ends 17:00, now Mon 20:00 EDT, last trip 17:30
    const monday8pm = Date.parse('2026-06-23T00:00:00.000Z') // Mon 20:00 EDT
    assert.equal(
      isWeeklySendWindowReady(
        monday8pm,
        'America/New_York',
        1,
        0,
        17 * 60,
      ),
      true,
    )
    const blocked = computeWeeklyEmailDecision({
      nowMs: monday8pm,
      timeZone: 'America/New_York',
      workWeekEndDay: 1,
      shiftStartMins: 0,
      shiftEndMins: 17 * 60,
      lastTripActivityMs: monday8pm - 60 * 60 * 1000,
    })
    assert.equal(blocked.shouldSend, false)

    const ready = computeWeeklyEmailDecision({
      nowMs: monday8pm,
      timeZone: 'America/New_York',
      workWeekEndDay: 1,
      shiftStartMins: 0,
      shiftEndMins: 17 * 60,
      lastTripActivityMs: monday8pm - 3 * 60 * 60 * 1000,
    })
    assert.equal(ready.shouldSend, true)
    assert.ok(ready.referenceMs > 0)
  })

  it('does not send on non-last work week day', () => {
    const tuesday = Date.parse('2026-06-23T04:00:00.000Z') // Tue 00:00 EDT
    const r = computeWeeklyEmailDecision({
      nowMs: tuesday,
      timeZone: 'America/New_York',
      workWeekEndDay: 1,
      shiftStartMins: 0,
      shiftEndMins: 17 * 60,
      lastTripActivityMs: 0,
    })
    assert.equal(r.shouldSend, false)
  })

  it('supports overnight shift ending the morning after last work day', () => {
    // Last day Monday, shift 19:00–07:00 → send Tuesday after 07:00 with idle
    const tuesday9am = Date.parse('2026-06-23T13:00:00.000Z') // Tue 09:00 EDT
    assert.equal(
      isWeeklySendWindowReady(
        tuesday9am,
        'America/New_York',
        1,
        19 * 60,
        7 * 60,
      ),
      true,
    )
    const r = computeWeeklyEmailDecision({
      nowMs: tuesday9am,
      timeZone: 'America/New_York',
      workWeekEndDay: 1,
      shiftStartMins: 19 * 60,
      shiftEndMins: 7 * 60,
      lastTripActivityMs: tuesday9am - 3 * 60 * 60 * 1000,
    })
    assert.equal(r.shouldSend, true)
  })
})
