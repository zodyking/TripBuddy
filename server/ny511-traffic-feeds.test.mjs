import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractPrimaryArraysFrom511Json,
  normalize511RowToItem,
  passesNycTruckFilter,
  dedupeNy511Items,
  rowsFrom511Response,
  parseNy511DateMs,
  isNy511ItemActiveInTimeWindow,
  passesTransitNoiseBlob,
  passesAllowedTruckEventType,
  passesMetroAlertRelevance,
} from './ny511-traffic-feeds.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, 'test-fixtures', 'ny511-traffic-sample.json')

test('parseNy511DateMs parses dd/MM/yyyy HH:mm:ss', () => {
  const ms = parseNy511DateMs('14/05/2026 12:00:00')
  assert.ok(ms != null && Number.isFinite(ms))
})

test('passesTransitNoiseBlob detects bus / transit copy', () => {
  assert.equal(passesTransitNoiseBlob('Normal paving on I-278'), false)
  assert.equal(passesTransitNoiseBlob('NJ TRANSIT bus detour'), true)
})

test('passesAllowedTruckEventType rejects transitOperations', () => {
  const row = normalize511RowToItem(
    { ID: 't', EventType: 'transitOperations', RoadwayName: 'I-278', Latitude: 40.7, Longitude: -73.99 },
    'getevents',
    'event',
  )
  assert.ok(row)
  assert.equal(passesAllowedTruckEventType(/** @type {any} */ (row)), false)
})

test('passesMetroAlertRelevance: NYC area vs upstate', () => {
  const nyc = normalize511RowToItem(
    { Id: 'a', Message: 'GWB delays', AreaNames: ['New York City Area'] },
    'getalerts',
    'alert',
  )
  const buf = normalize511RowToItem(
    { Id: 'b', Message: 'Winter advisory I-90 near Buffalo', AreaNames: ['Niagara Buffalo Area'] },
    'getalerts',
    'alert',
  )
  assert.ok(nyc && buf)
  assert.equal(passesMetroAlertRelevance(nyc._blob || ''), true)
  assert.equal(passesMetroAlertRelevance(buf._blob || ''), false)
})

test('isNy511ItemActiveInTimeWindow excludes not-yet-started events', () => {
  const row = normalize511RowToItem(
    {
      ID: 'future',
      EventType: 'roadwork',
      RoadwayName: 'I-678 North',
      Latitude: 40.75,
      Longitude: -73.82,
      StartDate: '20/08/2026 00:00:00',
      PlannedEndDate: '21/08/2026 23:59:00',
    },
    'getevents',
    'event',
  )
  assert.ok(row)
  const may = parseNy511DateMs('14/05/2026 12:00:00')
  assert.ok(may != null)
  assert.equal(isNy511ItemActiveInTimeWindow(/** @type {any} */ (row), /** @type {number} */ (may)), false)
})

test('normalize maps LanesStatus into impactSummary when Severity is Unknown', () => {
  const row = normalize511RowToItem(
    {
      ID: 'lanes-1',
      EventType: 'roadwork',
      RoadwayName: 'I-278 West',
      Latitude: 40.7,
      Longitude: -73.98,
      Severity: 'Unknown',
      LanesStatus: 'All lanes closed',
      StartDate: '01/01/2026 00:00:00',
      PlannedEndDate: '31/12/2026 23:59:00',
    },
    'getevents',
    'event',
  )
  assert.ok(row)
  assert.equal(row?.impactSummary, 'All lanes closed')
  assert.equal(row?.severity, undefined)
})

test('isNy511ItemActiveInTimeWindow drops ended work', () => {
  const row = normalize511RowToItem(
    {
      ID: 'old',
      EventType: 'roadwork',
      RoadwayName: 'I-495 East',
      Latitude: 40.752,
      Longitude: -73.893,
      StartDate: '01/01/2020 00:00:00',
      PlannedEndDate: '02/01/2020 12:00:00',
    },
    'getevents',
    'event',
  )
  assert.ok(row)
  assert.equal(isNy511ItemActiveInTimeWindow(/** @type {any} */ (row), Date.now()), false)
})

test('extractPrimaryArraysFrom511Json handles top-level array (511NY format)', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const events = raw.getevents
  const ev = extractPrimaryArraysFrom511Json(events)
  assert.equal(ev.length, 4)
})

test('normalize + filters: roadwork I-278 kept, transit & old & future dropped', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const now = parseNy511DateMs('14/05/2026 14:00:00')
  assert.ok(now != null)

  const evRows = rowsFrom511Response(raw.getevents, 'getevents', 'event')
  assert.equal(evRows.length, 4)

  const kept = evRows.filter((x) => {
    if (!x) return false
    if (!passesAllowedTruckEventType(/** @type {any} */ (x))) return false
    if (!passesNycTruckFilter(/** @type {any} */ (x))) return false
    if (!isNy511ItemActiveInTimeWindow(/** @type {any} */ (x), /** @type {number} */ (now))) return false
    return true
  })
  assert.equal(kept.length, 1)
  assert.match(String(kept[0].title), /I-278/i)
})

test('dedupeNy511Items removes duplicate ids per feed', () => {
  const a = normalize511RowToItem(
    { ID: 'x', EventType: 'roadwork', RoadwayName: 'I-95', Latitude: 40.85, Longitude: -73.95 },
    'getevents',
    'event',
  )
  const b = normalize511RowToItem(
    { ID: 'x', EventType: 'roadwork', RoadwayName: 'I-95', Latitude: 40.85, Longitude: -73.95 },
    'getevents',
    'event',
  )
  assert.ok(a && b)
  const d = dedupeNy511Items([a, b])
  assert.equal(d.length, 1)
})

test('extractPrimaryArraysFrom511Json handles object wrapper', () => {
  const wrapper = { events: [{ ID: '1', RoadwayName: 'I-278', Latitude: 40.7, Longitude: -73.99 }] }
  const rows = extractPrimaryArraysFrom511Json(wrapper)
  assert.equal(rows.length, 1)
})

test('normalize handles alert format', () => {
  const item = normalize511RowToItem(
    { Id: 'alert-1', Message: 'GWB delays expected', Notes: 'Use I-278 instead', AreaNames: ['New York City Area'] },
    'getalerts',
    'alert',
  )
  assert.ok(item)
  assert.equal(item.kind, 'Alert')
  assert.ok(passesMetroAlertRelevance(item._blob || ''))
})
