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
} from './ny511-traffic-feeds.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, 'test-fixtures', 'ny511-traffic-sample.json')

test('extractPrimaryArraysFrom511Json handles top-level array (511NY format)', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const events = raw.getevents
  const ev = extractPrimaryArraysFrom511Json(events)
  assert.equal(ev.length, 3)
})

test('normalize + NYC filter keeps I-278 / I-495 in bbox, drops Syracuse', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const evRows = rowsFrom511Response(raw.getevents, 'getevents', 'event')
  assert.equal(evRows.length, 3)
  const kept = evRows.filter((x) => x && passesNycTruckFilter(/** @type {any} */ (x)))
  assert.equal(kept.length, 2)
  const titles = kept.map((x) => x.title).join(' ')
  assert.match(titles, /I-278|Disabled Vehicle/i)
  assert.match(titles, /I-495|Paving/i)
})

test('dedupeNy511Items removes duplicate ids', () => {
  const a = normalize511RowToItem(
    { ID: 'x', EventSubType: 'GWB lane closure', Latitude: 40.85, Longitude: -73.95, RoadwayName: 'I-95' },
    'getevents',
    'event',
  )
  const b = normalize511RowToItem(
    { ID: 'x', EventSubType: 'GWB other', Latitude: 40.85, Longitude: -73.95, RoadwayName: 'I-95' },
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

test('normalize handles alert format (Message instead of Description)', () => {
  const alert = { Id: 'alert-1', Message: 'GWB delays expected', Notes: 'Use I-278 instead' }
  const item = normalize511RowToItem(alert, 'getalerts', 'alert')
  assert.ok(item)
  assert.equal(item.description, 'GWB delays expected')
  assert.ok(passesNycTruckFilter(/** @type {any} */ (item)))
})
