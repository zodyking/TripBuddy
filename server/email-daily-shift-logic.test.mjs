import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assignmentHasIncompleteActiveTrips,
  computeLedgerDisplayDate,
  ledgerEntriesForWorkDay,
  resolveDailyShiftSummaryDayKey,
  workShiftDayKeyForEntry,
} from './email-daily-shift-logic.mjs'
import { computeDailyShiftEmailDecision } from '../src/utils/shiftCalendar.js'
import { buildDailyShiftSummary } from './email-ledger-summary.mjs'

const shift = { shiftStartMins: 0, shiftEndMins: 1439 }

test('assignmentHasIncompleteActiveTrips respects hidden leg sequences', () => {
  assert.equal(
    assignmentHasIncompleteActiveTrips({
      persistedLinehaulTripSnapshot: { dailyTripLegSequence: '123' },
      hiddenDailyTripLegSequences: ['123'],
      tripHistoryLedger: [],
    }),
    false,
  )
  assert.equal(
    assignmentHasIncompleteActiveTrips({
      persistedLinehaulTripSnapshot: { dailyTripLegSequence: '456' },
      hiddenDailyTripLegSequences: [],
      tripHistoryLedger: [],
    }),
    true,
  )
  assert.equal(
    assignmentHasIncompleteActiveTrips({
      persistedLinehaulTripSnapshot: { dailyTripLegSequence: '789' },
      hiddenDailyTripLegSequences: [],
      tripHistoryLedger: [
        {
          dailyTripLegSequence: '789',
          dispatchHeader: { historyOutcome: 'removed' },
        },
      ],
    }),
    false,
  )
})

test('buildDailyShiftSummary includes removed trips for work day', () => {
  const ledger = [
    {
      id: 'a',
      source: 'linehaul',
      recordedAt: Date.parse('2026-06-22T10:00:00Z'),
      dailyTripLegSequence: '1',
      dispatchHeader: {
        origin: '89 · WOODBRIDGE',
        destination: '3117 · BETHPAGE',
        historyOutcome: 'delivered',
      },
      tripDetails: { currentLocationNumber: '89', tripDestNumber: '3117' },
    },
    {
      id: 'b',
      source: 'linehaul',
      recordedAt: Date.parse('2026-06-22T14:00:00Z'),
      dailyTripLegSequence: '2',
      dispatchHeader: {
        origin: '100 · A',
        destination: '200 · B',
        historyOutcome: 'removed',
      },
      tripDetails: {},
    },
  ]
  const summary = buildDailyShiftSummary(ledger, '2026-06-22', {
    ...shift,
    timeZone: 'America/New_York',
  })
  assert.equal(summary.tripCount, 2)
  assert.equal(summary.tableRows.length, 2)
})

test('computeDailyShiftEmailDecision waits for idle and incomplete trips', () => {
  const nowMs = Date.parse('2026-06-23T04:29:00.000Z')
  const blockedIdle = computeDailyShiftEmailDecision({
    nowMs,
    timeZone: 'America/New_York',
    shiftStartMins: 0,
    shiftEndMins: 1439,
    dailyDelayMins: 30,
    lastTripActivityMs: nowMs - 30 * 60 * 1000,
    idleMins: 120,
    hasIncompleteTrips: false,
  })
  assert.equal(blockedIdle.shouldSend, false)

  const blockedTrip = computeDailyShiftEmailDecision({
    nowMs,
    timeZone: 'America/New_York',
    shiftStartMins: 0,
    shiftEndMins: 1439,
    dailyDelayMins: 30,
    lastTripActivityMs: nowMs - 3 * 60 * 60 * 1000,
    idleMins: 120,
    hasIncompleteTrips: true,
  })
  assert.equal(blockedTrip.shouldSend, false)

  const ready = computeDailyShiftEmailDecision({
    nowMs,
    timeZone: 'America/New_York',
    shiftStartMins: 0,
    shiftEndMins: 1439,
    dailyDelayMins: 30,
    lastTripActivityMs: nowMs - 3 * 60 * 60 * 1000,
    idleMins: 120,
    hasIncompleteTrips: false,
  })
  assert.equal(ready.shouldSend, true)
  assert.equal(ready.shiftDayKey, '2026-06-22')
})

test('resolveDailyShiftSummaryDayKey picks most recent unsent work day', () => {
  const ledger = [
    { source: 'linehaul', recordedAt: Date.parse('2026-06-21T10:00:00Z') },
    { source: 'linehaul', recordedAt: Date.parse('2026-06-22T10:00:00Z') },
  ]
  const key = resolveDailyShiftSummaryDayKey(ledger, {
    endedShiftDayKey: '2026-06-22',
    lastDailyShiftKey: '',
    ...shift,
    timeZone: 'America/New_York',
  })
  assert.equal(key, '2026-06-22')
})

test('workShiftDayKeyForEntry uses linehaul recordedAt like History', () => {
  const entry = {
    source: 'linehaul',
    recordedAt: Date.parse('2026-06-22T10:00:00Z'),
    completedAt: Date.parse('2026-06-23T01:00:00Z'),
  }
  const dk = workShiftDayKeyForEntry(entry, shift, 'America/New_York')
  assert.equal(dk, '2026-06-22')
  assert.equal(computeLedgerDisplayDate(entry), entry.recordedAt)
})
