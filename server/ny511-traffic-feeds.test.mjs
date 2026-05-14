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

test('extractPrimaryArraysFrom511Json prefers Events array', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const ev = extractPrimaryArraysFrom511Json(raw)
  assert.equal(ev.length, 2)
})

test('normalize + NYC filter keeps I-278 / I-495 in bbox, drops Chicago', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'))
  const evRows = rowsFrom511Response(raw, 'events', 'events')
  assert.equal(evRows.length, 2)
  const kept = evRows.filter((x) => x && passesNycTruckFilter(/** @type {any} */ (x)))
  assert.equal(kept.length, 1)
  assert.match(String(kept[0].title), /I-278/i)

  const conRows = rowsFrom511Response(
    { construction: raw.construction },
    'construction',
    'construction',
  )
  assert.equal(conRows.length, 1)
  assert.ok(passesNycTruckFilter(/** @type {any} */ (conRows[0])))
})

test('dedupeNy511Items removes duplicate ids', () => {
  const a = normalize511RowToItem(
    { Id: 'x', Headline: 'GWB lane closure', Latitude: 40.85, Longitude: -73.95, RoadwayName: 'I-95' },
    'events',
    'events',
  )
  const b = normalize511RowToItem(
    { Id: 'x', Headline: 'GWB other', Latitude: 40.85, Longitude: -73.95, RoadwayName: 'I-95' },
    'events',
    'events',
  )
  assert.ok(a && b)
  const d = dedupeNy511Items([a, b])
  assert.equal(d.length, 1)
})

test('extractPrimaryArraysFrom511Json handles top-level array', () => {
  const arr = [{ Id: '1', Headline: 'BQE work', RoadwayName: 'I-278', Latitude: 40.7, Longitude: -73.99 }]
  const rows = extractPrimaryArraysFrom511Json(arr)
  assert.equal(rows.length, 1)
})
