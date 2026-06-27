import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  exportTripHistoryToCsv,
  parseTripHistoryFromCsv,
  mergeTripHistoryLedgers,
  tripHistoryEntryFromCsvRow,
} from '../src/utils/tripHistoryCsv.js'

const sampleLedger = [
  {
    id: 'h-274299999',
    source: 'linehaul',
    dailyTripLegSequence: '274299999',
    recordedAt: 1715128560000,
    completedAt: 1715132160000,
    dispatchedAtMs: 1715129000000,
    outcomeTouchedAt: 1715132200000,
    historyAuditBucketMs: 1715120000000,
    federalHolidayMileage15xApproved: true,
    outcome: 'delivered',
    dispatchHeader: {
      origin: '3117 · Memphis',
      destination: '89 · Nashville',
      historyOutcome: 'delivered',
      instructions: 'Gate B',
    },
    tripDetails: {
      trailers: [{ trailerNumber: 'T123', sealNumber: 'S456' }],
      dollies: [{ dollyNumber: 'D100' }],
      mileage: { totalMiles: '61', runTimeHours: 1.3 },
      tractor: '123456',
    },
    customFutureField: { nested: true },
  },
  {
    id: 'h-manual-1',
    source: 'manual_audit',
    dailyTripLegSequence: '999001',
    completedAt: 1715200000000,
    dispatchHeader: { origin: '100', destination: '200' },
    tripDetails: {},
  },
]

test('exportTripHistoryToCsv includes full nested data', () => {
  const csv = exportTripHistoryToCsv(sampleLedger)
  assert.match(csv, /^formatVersion,id,source/)
  assert.match(csv, /h-274299999/)
  assert.match(csv, /"3117 · Memphis"/)
  assert.match(csv, /totalMiles/)
  assert.match(csv, /customFutureField/)
})

test('parseTripHistoryFromCsv round-trips ledger entries', () => {
  const csv = exportTripHistoryToCsv(sampleLedger)
  const { entries, errors, totalRows } = parseTripHistoryFromCsv(csv)
  assert.equal(errors.length, 0)
  assert.equal(totalRows, 2)
  assert.equal(entries.length, 2)
  const first = entries.find((e) => e.id === 'h-274299999')
  assert.ok(first)
  assert.equal(first.dailyTripLegSequence, '274299999')
  assert.equal(first.federalHolidayMileage15xApproved, true)
  assert.equal(
    /** @type {any} */ (first.dispatchHeader).origin,
    '3117 · Memphis',
  )
  assert.equal(
    /** @type {any} */ (first.tripDetails).mileage.totalMiles,
    '61',
  )
  assert.deepEqual(/** @type {any} */ (first).customFutureField, { nested: true })
})

test('mergeTripHistoryLedgers updates by id and keeps others', () => {
  const existing = [
    { id: 'a', dailyTripLegSequence: '1', dispatchHeader: {}, tripDetails: {} },
    { id: 'b', dailyTripLegSequence: '2', dispatchHeader: {}, tripDetails: {} },
  ]
  const imported = [
    {
      id: 'b',
      dailyTripLegSequence: '2',
      dispatchHeader: { origin: 'updated' },
      tripDetails: { tractor: '999' },
    },
    {
      id: 'c',
      dailyTripLegSequence: '3',
      dispatchHeader: {},
      tripDetails: {},
    },
  ]
  const merged = mergeTripHistoryLedgers(existing, imported)
  assert.equal(merged.length, 3)
  const b = merged.find((e) => e.id === 'b')
  assert.equal(/** @type {any} */ (b).dispatchHeader.origin, 'updated')
})

test('tripHistoryEntryFromCsvRow rejects invalid JSON', () => {
  assert.throws(() => {
    tripHistoryEntryFromCsvRow(
      {
        id: 'x',
        dispatchHeaderJson: '{bad',
        tripDetailsJson: '{}',
      },
      0,
    )
  }, /invalid JSON/)
})
