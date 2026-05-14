/**
 * Build server/data/fedex-ground-directory-seed.json from a FedEx Ground facilities CSV
 * (columns: Station Number, Station Name, Address 1, …, Lat, Long).
 *
 * Usage (from repo root):
 *   node server/scripts/build-fedex-directory-seed.mjs path/to/fedex_ground_facilities_geocoded.csv
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsvRecords } from '../../src/utils/csvParse.js'
import { normalizeLocationTypeForStorage } from '../../src/utils/directoryLocationTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.join(__dirname, '..', 'data', 'fedex-ground-directory-seed.json')

const csvPath = (process.argv[2] || process.env.FEDEX_GROUND_CSV || '').trim()
if (!csvPath) {
  console.error(
    'Usage: node server/scripts/build-fedex-directory-seed.mjs <csv-path>\n' +
      '   or: FEDEX_GROUND_CSV=<csv-path> node server/scripts/build-fedex-directory-seed.mjs',
  )
  process.exit(1)
}

const text = await fs.readFile(csvPath, 'utf8')
const rows = parseCsvRecords(text)
/** @type {Array<Record<string, unknown>>} */
const entries = []
for (const r of rows) {
  const id = String(r['Station Number'] ?? '').trim()
  if (!id) continue
  const addr1 = String(r['Address 1'] ?? '').trim()
  const addr2 = String(r['Address 2'] ?? '').trim()
  const city = String(r.City ?? '').trim()
  const state = String(r.State ?? '').trim()
  const zip = String(r.Zip ?? '').trim()
  const addressParts = [addr1, addr2, city, state, zip].filter(Boolean)
  const latS = String(r.Lat ?? r.lat ?? r.latitude ?? '').trim()
  const lngS = String(r.Long ?? r.lng ?? r.lon ?? r.longitude ?? '').trim()
  const lat = latS ? Number(latS) : NaN
  const lng = lngS ? Number(lngS) : NaN
  entries.push({
    locationId: id,
    locationName: String(r['Station Name'] ?? '').trim(),
    abbreviation: String(r['Station Abbreviation'] ?? '').trim(),
    address: addressParts.join(', '),
    phone: String(r.Phone ?? '').trim(),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    timeZone: '',
    locationType: normalizeLocationTypeForStorage(r.Status ?? ''),
    district: String(r.District ?? '').trim().toUpperCase(),
  })
}

await fs.mkdir(path.dirname(outPath), { recursive: true })
await fs.writeFile(outPath, `${JSON.stringify(entries)}\n`, 'utf8')
console.log(`Wrote ${entries.length} entries to ${outPath}`)
