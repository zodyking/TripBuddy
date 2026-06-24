import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEmailTripContextFromBody,
  buildEmailTripContextFromLedgerEntry,
  emailTerminalId,
  formatTrailersSummary,
  weeklyTripTableRow,
} from './email-trip-details.mjs'
import { tripDetailPlainText, tripDetailCardHtml, weeklySummaryEmail } from './email-templates.mjs'
import { buildDailyShiftSummary, buildWeeklyTripContexts } from './email-ledger-summary.mjs'
import { workWeekGroupMeta } from '../src/utils/workWeekGroup.js'

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

test('buildEmailTripContextFromBody uses terminal ids only in route', () => {
  const ctx = buildEmailTripContextFromBody(sampleBody)
  assert.equal(ctx.origin, '1234')
  assert.equal(ctx.destination, '5678')
  assert.equal(ctx.route, '1234 → 5678')
  assert.equal(ctx.leg, '3')
  assert.equal(ctx.tractorNumber, 'T-99')
  assert.equal(ctx.trailers.length, 2)
  assert.equal(ctx.trailers[0].number, '8123456')
  assert.equal(ctx.trailers[0].seal, 'SEAL123')
  assert.match(ctx.dollySummary, /D100/)
  assert.match(ctx.dollySummary, /D200/)
})

test('emailTerminalId strips terminal names', () => {
  assert.equal(emailTerminalId('89 · WOODBRIDGE'), '89')
  assert.equal(emailTerminalId('3117 · BETHPAGE - HD'), '3117')
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
  assert.equal(ctx.origin, '1234')
  assert.equal(ctx.destination, '5678')
  assert.equal(ctx.route, '1234 → 5678')
  assert.equal(ctx.outcome, 'delivered')
  assert.equal(ctx.trailers.length, 2)
  assert.match(ctx.dispatchInstructions || '', /Gate 5/)
})

test('trip detail plain text and html include equipment', () => {
  const ctx = buildEmailTripContextFromBody(sampleBody)
  const text = tripDetailPlainText(ctx)
  assert.match(text, /Route:/)
  assert.match(text, /Dollies:/)
  assert.match(text, /Trailer 1/)
  assert.match(text, /SEAL123/)
  const html = tripDetailCardHtml(ctx)
  assert.match(html, /1234 → 5678/)
  assert.match(html, /Trailers/)
  assert.match(html, /Dollies/)
  assert.doesNotMatch(html, /Outcome/)
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
    timeZone: 'America/New_York',
  })
  assert.equal(summary.tripCount, 1)
  assert.equal(summary.trips.length, 1)
  assert.equal(summary.tableRows.length, 1)
  assert.equal(summary.trips[0].origin, '111')
  assert.equal(summary.trips[0].trailers.length, 2)
  assert.equal(summary.tableRows[0][2], '111 → 222')
})

test('buildWeeklyTripContexts returns table rows and tractors used', () => {
  const ledger = [
    {
      dailyTripLegSequence: '1',
      completedAt: Date.parse('2026-06-18T10:00:00Z'),
      dispatchHeader: {
        origin: '111 · A',
        destination: '222 · B',
        historyOutcome: 'delivered',
      },
      tripDetails: sampleBody,
    },
    {
      dailyTripLegSequence: '2',
      completedAt: Date.parse('2026-06-19T10:00:00Z'),
      dispatchHeader: {
        origin: '333 · C',
        destination: '444 · D',
        historyOutcome: 'delivered',
      },
      tripDetails: { ...sampleBody, tractorNumber: 'T-88', dailyTripLegSequence: '2' },
    },
  ]
  const week = workWeekGroupMeta(Date.parse('2026-06-18T10:00:00Z'), {
    workWeekStartDay: 4,
    workWeekEndDay: 2,
    shiftStartMins: 0,
    shiftEndMins: 1439,
  })
  assert.ok(week?.key)
  const summary = buildWeeklyTripContexts(ledger, week, {
    workWeekStartDay: 4,
    workWeekEndDay: 2,
    shiftStartMins: 0,
    shiftEndMins: 1439,
    tractorNumber: 'T-99',
  })
  assert.equal(summary.tripCount, 2)
  assert.equal(summary.tableRows.length, 2)
  assert.ok(summary.tractorsUsed.includes('T-99'))
  assert.ok(summary.tractorsUsed.includes('T-88'))
})

test('weeklySummaryEmail includes driver, tractors, totals, and trip table', () => {
  const ctx = buildEmailTripContextFromBody(sampleBody)
  ctx.completedAt = 'Jun 18, 10:00 AM'
  ctx.miles = '210 mi'
  ctx.outcome = 'delivered'
  const mail = weeklySummaryEmail({
    weekLabel: 'Jun 18–23',
    workWeekLabel: 'Work week — Jun 18–23',
    payWeekLabel: 'Pay week — Jun 18–23',
    driverName: 'Brandon King',
    driverId: '123456',
    tractorsUsed: ['T-99', 'T-88'],
    tripCount: 1,
    totalMiles: 210,
    tableRows: [weeklyTripTableRow(ctx)],
  })
  assert.match(mail.html, /Brandon King/)
  assert.match(mail.html, /123456/)
  assert.match(mail.html, /#T-99/)
  assert.match(mail.html, /Total trips/)
  assert.match(mail.html, /Total miles/)
  assert.match(mail.html, /210 mi/)
  assert.match(mail.html, /Work week trips/)
  assert.match(mail.html, /1234 → 5678/)
  assert.doesNotMatch(mail.html, /Outcome/)
  assert.match(mail.text, /Dollies/)
})

test('formatTrailersSummary is concise for table cells', () => {
  const ctx = buildEmailTripContextFromBody(sampleBody)
  const summary = formatTrailersSummary(ctx.trailers)
  assert.match(summary, /T1/)
  assert.match(summary, /8123456/)
  assert.match(summary, /SEAL123/)
  assert.equal(weeklyTripTableRow(ctx).length, 6)
})
