import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendWorkWeekScheduleChange,
  normalizeWorkWeekScheduleHistory,
  resolveWorkWeekDaysForTimestamp,
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

test('work week change applies from current week start forward only', () => {
  const changeAt = Date.parse('2026-06-25T15:00:00.000Z') // Wed
  const effectiveFrom = workWeekChangeEffectiveFromMs(changeAt, 4) // Thu start
  const history = appendWorkWeekScheduleChange(
    normalizeWorkWeekScheduleHistory(null, 0, 6),
    { effectiveFromMs: effectiveFrom, workWeekStartDay: 4, workWeekEndDay: 1 },
    changeAt,
  )
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
