import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEmailTripContextFromBody,
  buildEmailTripContextFromLedgerEntry,
} from './email-trip-details.mjs'
import { tripDetailPlainText, tripDetailCardHtml } from './email-templates.mjs'
import { buildDailyShiftSummary } from './email-ledger-summary.mjs'

const sampleBody = {
  dailyTripLegSequence: '3',
  currentLocationNumber: '1234',
  currentLocationName: 'Memphis Hub',
  tripDestNumber: '5678',
  tripDest: 'Nashville Terminal',
  tractorNumber: 'T-99',
  tripStatus: 'APRVD',
  dollyNumber1: 'D100',
  dollyNumber2: 'D200',
  trailers: [
    {
      trlrOrder: 1,
      trlrNbr: '8123456',
      detlCodeLoadStatus: 'CLSD',
      emptyFlag: 'N',
      sealNumber: 'SEAL123',
      pkgWeight: 12000,
      loadDestNumber: '5678',
      loadDest: 'Nashville',
    },
    {
      trlrOrder: 2,
      trlrNbr: '8999999',
      detlCodeLoadStatus: 'LDNG',
      emptyFlag: 'Y',
      sealNumber: 'SEAL456',
      pkgWeight: 0,
    },
  ],
}

test('buildEmailTripContextFromBody includes full O/D, trailers, and dollies', () => {
  const ctx = buildEmailTripContextFromBody(sampleBody)
  assert.match(ctx.origin, /1234/)
  assert.match(ctx.origin, /Memphis/)
  assert.match(ctx.destination, /5678/)
  assert.match(ctx.destination, /Nashville/)
  assert.equal(ctx.leg, '3')
  assert.equal(ctx.tractorNumber, 'T-99')
  assert.equal(ctx.trailers.length, 2)
  assert.equal(ctx.trailers[0].number, '8123456')
  assert.equal(ctx.trailers[0].seal, 'SEAL123')
  assert.match(ctx.dollySummary, /D100/)
  assert.match(ctx.dollySummary, /D200/)
})

test('buildEmailTripContextFromLedgerEntry uses dispatch header and trip details', () => {
  const entry = {
    dailyTripLegSequence: '2',
    completedAt: Date.parse('2026-06-22T18:30:00Z'),
    dispatchHeader: {
      origin: '1234 · Memphis Hub',
      destination: '5678 · Nashville Terminal',
      historyOutcome: 'delivered',
      instructions: 'Gate 5',
    },
    tripDetails: sampleBody,
  }
  const ctx = buildEmailTripContextFromLedgerEntry(entry)
  assert.equal(ctx.origin, '1234 · Memphis Hub')
  assert.equal(ctx.destination, '5678 · Nashville Terminal')
  assert.equal(ctx.outcome, 'delivered')
  assert.equal(ctx.trailers.length, 2)
  assert.match(ctx.dispatchInstructions || '', /Gate 5/)
})

test('trip detail plain text and html include equipment', () => {
  const ctx = buildEmailTripContextFromBody(sampleBody)
  const text = tripDetailPlainText(ctx)
  assert.match(text, /Origin:/)
  assert.match(text, /Dollies:/)
  assert.match(text, /Trailer 1/)
  assert.match(text, /SEAL123/)
  const html = tripDetailCardHtml(ctx)
  assert.match(html, /Memphis Hub/)
  assert.match(html, /Trailers/)
  assert.match(html, /Dollies/)
})

test('buildDailyShiftSummary returns rich trip contexts', () => {
  const ledger = [
    {
      dailyTripLegSequence: '1',
      completedAt: Date.parse('2026-06-22T10:00:00Z'),
      dispatchHeader: {
        origin: '111 · A',
        destination: '222 · B',
        historyOutcome: 'delivered',
      },
      tripDetails: sampleBody,
    },
  ]
  const summary = buildDailyShiftSummary(ledger, '2026-06-22', {
    shiftStartMins: 0,
    shiftEndMins: 1439,
  })
  assert.equal(summary.tripCount, 1)
  assert.equal(summary.trips.length, 1)
  assert.match(summary.trips[0].origin, /111/)
  assert.equal(summary.trips[0].trailers.length, 2)
})
