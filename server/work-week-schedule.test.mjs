import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendWorkWeekScheduleChange,
  normalizeWorkWeekScheduleHistory,
  resolveWorkWeekDaysForTimestamp,
  sanitizeWorkWeekScheduleHistory,
  workWeekChangeEffectiveFromMs,
  workWeekGroupMeta,
  workWeekGroupMetaForCreds,
} from '../src/utils/workWeekGroup.js'

test('normalizeWorkWeekScheduleHistory seeds baseline at epoch', () => {
  const h = normalizeWorkWeekScheduleHistory(null, 4, 1)
  assert.equal(h.length, 1)
  assert.equal(h[0].effectiveFromMs, 0)
  assert.equal(h[0].workWeekStartDay, 4)
  assert.equal(h[0].workWeekEndDay, 1)
})

test('sanitizeWorkWeekScheduleHistory does not invent baseline from current settings', () => {
  const h = sanitizeWorkWeekScheduleHistory(undefined)
  assert.equal(h.length, 0)
  const days = resolveWorkWeekDaysForTimestamp(Date.parse('2026-06-20T12:00:00.000Z'), {
    workWeekStartDay: 4,
    workWeekEndDay: 1,
    workWeekScheduleHistory: [],
  })
  assert.equal(days.workWeekStartDay, 4)
  assert.equal(days.workWeekEndDay, 1)
})

test('work week change applies from current week start forward only', () => {
  const changeAt = Date.parse('2026-06-25T15:00:00.000Z') // Wed
  const effectiveFrom = workWeekChangeEffectiveFromMs(changeAt, 4) // Thu start
  const history = appendWorkWeekScheduleChange([], {
    effectiveFromMs: effectiveFrom,
    workWeekStartDay: 4,
    workWeekEndDay: 1,
    priorWorkWeekStartDay: 0,
    priorWorkWeekEndDay: 6,
  }, changeAt)
  const creds = {
    workWeekStartDay: 4,
    workWeekEndDay: 1,
    workWeekScheduleHistory: history,
    shiftStartMins: 0,
    shiftEndMins: 1439,
  }

  const oldTrip = Date.parse('2026-06-20T12:00:00.000Z')
  const newTrip = Date.parse('2026-06-26T12:00:00.000Z')
  const oldDays = resolveWorkWeekDaysForTimestamp(oldTrip, creds)
  const newDays = resolveWorkWeekDaysForTimestamp(newTrip, creds)
  assert.equal(oldDays.workWeekStartDay, 0)
  assert.equal(oldDays.workWeekEndDay, 6)
  assert.equal(newDays.workWeekStartDay, 4)
  assert.equal(newDays.workWeekEndDay, 1)

  const oldMeta = workWeekGroupMetaForCreds(oldTrip, creds)
  const newMeta = workWeekGroupMetaForCreds(newTrip, creds)
  assert.notEqual(oldMeta?.key, newMeta?.key)

  const oldWithCurrentOnly = workWeekGroupMeta(oldTrip, {
    workWeekStartDay: 4,
    workWeekEndDay: 1,
    shiftStartMins: 0,
    shiftEndMins: 1439,
  })
  assert.notEqual(oldMeta?.key, oldWithCurrentOnly?.key)
})
