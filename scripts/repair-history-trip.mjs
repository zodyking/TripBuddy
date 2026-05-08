#!/usr/bin/env node
/**
 * Search / repair missing trips in `tripHistoryLedger` (assignment KV in PostgreSQL).
 *
 * Prerequisites: DATABASE_URL (same as production). Run from repo root:
 *
 *   DATABASE_URL="postgresql://..." node scripts/repair-history-trip.mjs --username YOUR_LOGIN --search --origin 3117 --dest 89 --yesterday-utc
 *
 * Scan every user's assignment (slow):
 *
 *   DATABASE_URL="..." node scripts/repair-history-trip.mjs --scan-db --origin 3117 --dest 89
 *
 * Insert / upsert one leg (you need dailyTripLegSequence from FedEx / Linehaul API):
 *
 *   DATABASE_URL="..." node scripts/repair-history-trip.mjs --username YOUR_LOGIN --apply \
 *     --leg-seq 274299999 --origin 3117 --dest 89 \
 *     --completed-at "2026-05-08T05:16:00.000Z" --miles 61 --hours 1.3
 *
 * Notes:
 * - Origin/destination matching uses the same leading-numeric rule as History (dispatchHeader strings).
 * - `--apply` uses server merge logic via writeAssignment + upsertTripHistoryEntry (run scoped to your account).
 * - By default we do NOT add the leg to hiddenDailyTripLegSequences (trip already complete). Use --also-hide if needed.
 */

import { accountKeyForUsername } from '../server/account-identity.mjs'
import { readAssignmentForAccount, writeAssignment } from '../server/assignment-store.mjs'
import { runWithCredentialAccountKey } from '../server/request-context.mjs'
import { getPostgresPool } from '../server/kv-pg.mjs'

/** @param {unknown} v */
function leadingLocationId(v) {
  const s = String(v ?? '').trim()
  const m = s.match(/^\s*(\d+)/)
  return m ? m[1] : ''
}

function yesterdayUtcYmd() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const o = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--search') o.search = true
    if (a === '--scan-db') o.scanDb = true
    if (a === '--apply') o.apply = true
    if (a === '--force') o.force = true
    if (a === '--also-hide') o.alsoHide = true
    if (a === '--yesterday-utc') {
      o.ondate = yesterdayUtcYmd()
      continue
    }
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '')
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        console.error(`Missing value for ${a}`)
        process.exit(1)
      }
      o[key] = next
      i++
    }
  }
  return o
}

/** @param {string} dk */
function parseDayKeyUtc(dk) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return null
  const t = Date.parse(`${dk}T00:00:00.000Z`)
  return Number.isFinite(t) ? t : null
}

/**
 * @param {unknown} entry
 * @param {string} originWant
 * @param {string} destWant
 */
function entryMatchesOd(entry, originWant, destWant) {
  if (!entry || typeof entry !== 'object') return false
  const e = /** @type {Record<string, unknown>} */ (entry)
  const dh = e.dispatchHeader && typeof e.dispatchHeader === 'object' ? e.dispatchHeader : {}
  const o = leadingLocationId(dh.origin)
  const d = leadingLocationId(dh.destination)
  return o === originWant && d === destWant
}

/**
 * @param {unknown} entry
 * @param {number | null} dayStart
 * @param {number | null} dayEnd
 */
function entryInDayRange(entry, dayStart, dayEnd) {
  if (dayStart == null || dayEnd == null) return true
  if (!entry || typeof entry !== 'object') return false
  const e = /** @type {Record<string, unknown>} */ (entry)
  const t =
    typeof e.recordedAt === 'number' && Number.isFinite(e.recordedAt)
      ? e.recordedAt
      : typeof e.completedAt === 'number' && Number.isFinite(e.completedAt)
        ? e.completedAt
        : 0
  if (!t) return false
  return t >= dayStart && t < dayEnd
}

function printEntry(entry, idx) {
  const e = /** @type {Record<string, unknown>} */ (entry)
  const dh =
    e.dispatchHeader && typeof e.dispatchHeader === 'object'
      ? /** @type {Record<string, unknown>} */ (e.dispatchHeader)
      : {}
  const seq = String(e.dailyTripLegSequence ?? '')
  const ra = e.recordedAt
  const ca = e.completedAt
  console.log(`--- #${idx} leg=${seq} id=${e.id}`)
  console.log(`    origin=${dh.origin} dest=${dh.destination}`)
  console.log(`    recordedAt=${ra} (${ra ? new Date(Number(ra)).toISOString() : ''})`)
  console.log(`    completedAt=${ca} (${ca ? new Date(Number(ca)).toISOString() : ''})`)
}

async function scanAllAssignments(origin, dest, onDate) {
  const pool = await getPostgresPool()
  if (!pool) throw new Error('PostgreSQL not configured (DATABASE_URL)')
  let dayStart = null
  let dayEnd = null
  if (onDate) {
    const d0 = parseDayKeyUtc(onDate)
    if (d0 == null) throw new Error(`Bad --on-date ${onDate}, want YYYY-MM-DD`)
    dayStart = d0
    dayEnd = d0 + 86400000
  }
  const { rows } = await pool.query(
    `SELECT k, v FROM fedextool_kv WHERE k LIKE $1`,
    ['u:%:assignment'],
  )
  console.log(`Scanned ${rows.length} assignment rows.\n`)
  let hits = 0
  for (const row of rows) {
    const k = String(row.k)
    const v = row.v
    if (!v || typeof v !== 'object') continue
    const ledger = /** @type {Record<string, unknown>} */ (v).tripHistoryLedger
    if (!Array.isArray(ledger)) continue
    const matches = ledger.filter(
      (e) =>
        entryMatchesOd(e, origin, dest) && entryInDayRange(e, dayStart, dayEnd),
    )
    if (matches.length === 0) continue
    hits++
    console.log(`Account KV key: ${k}`)
    matches.forEach((e, i) => printEntry(e, i))
    console.log('')
  }
  if (!hits) console.log('No matching ledger entries found.')
}

async function main() {
  const args = parseArgs(process.argv)
  const origin = String(args.origin || '').trim()
  const dest = String(args.dest || '').trim()
  const username = typeof args.username === 'string' ? args.username.trim() : ''
  const accountKeyIn = typeof args.accountkey === 'string' ? args.accountkey.trim() : ''
  const onDate = typeof args.ondate === 'string' ? args.ondate.trim() : ''

  if (!/^\d+$/.test(origin) || !/^\d+$/.test(dest)) {
    console.error('Require --origin DIGITS and --dest DIGITS')
    process.exit(1)
  }

  if (args.scanDb) {
    await scanAllAssignments(origin, dest, onDate || '')
    return
  }

  const ak = accountKeyIn || (username ? accountKeyForUsername(username) : null)
  if (!ak) {
    console.error('Provide --username LOGIN or --account-key HEX (or use --scan-db)')
    process.exit(1)
  }

  let dayStart = null
  let dayEnd = null
  if (onDate) {
    const d0 = parseDayKeyUtc(onDate)
    if (d0 == null) {
      console.error(`Bad --on-date ${onDate}`)
      process.exit(1)
    }
    dayStart = d0
    dayEnd = d0 + 86400000
  }

  const assignment = await readAssignmentForAccount(ak)
  const ledger = Array.isArray(assignment.tripHistoryLedger)
    ? assignment.tripHistoryLedger
    : []

  console.log(`Account key: ${ak}`)
  console.log(`Ledger size: ${ledger.length}`)
  console.log(
    `Hidden leg sequences: ${JSON.stringify(assignment.hiddenDailyTripLegSequences || [])}`,
  )
  console.log('')

  const matches = ledger.filter(
    (e) => entryMatchesOd(e, origin, dest) && entryInDayRange(e, dayStart, dayEnd),
  )

  if (!matches.length) {
    console.log(
      `No entries with origin ${origin} → dest ${dest}${onDate ? ` on ${onDate} (UTC)` : ''}.`,
    )
    console.log(
      'Tip: omit --on-date to see all legs with this O/D, or use --scan-db to search every account.',
    )
  } else {
    console.log(`Matches (${matches.length}):`)
    matches.forEach((e, i) => printEntry(e, i))
  }
  console.log('')

  if (!args.apply) return

  const seq = typeof args.legseq === 'string' ? args.legseq.trim() : ''
  if (!/^\d+$/.test(seq)) {
    console.error('--apply requires --leg-seq from FedEx Linehaul (dailyTripLegSequence)')
    process.exit(1)
  }

  const existingSeq = ledger.find((x) => x && String(x.dailyTripLegSequence) === seq)
  if (existingSeq && !args.force) {
    console.error(`Ledger already has leg ${seq}. Use --force to upsert anyway.`)
    process.exit(1)
  }

  let completedAt = Date.now()
  if (typeof args.completedat === 'string' && args.completedat.trim()) {
    const p = Date.parse(args.completedat.trim())
    if (!Number.isFinite(p)) {
      console.error('Bad --completed-at (ISO date)')
      process.exit(1)
    }
    completedAt = p
  }

  const miles = typeof args.miles === 'string' ? args.miles.trim() : ''
  const hours = typeof args.hours === 'string' ? args.hours.trim() : ''

  /** @type {Record<string, unknown>} */
  const tripDetails = {}
  if (miles || hours) {
    /** @type {Record<string, unknown>} */
    const mileage = {
      source: 'manual_repair_script',
      fetchedAt: Date.now(),
    }
    if (miles) mileage.totalMiles = miles
    if (hours) {
      const h = Number(hours)
      if (Number.isFinite(h)) mileage.runTimeHours = h
    }
    tripDetails.mileage = mileage
  }

  const body = {
    upsertTripHistoryEntry: {
      id: `h-${seq}`,
      source: 'linehaul',
      dailyTripLegSequence: seq,
      recordedAt: completedAt,
      completedAt,
      dispatchHeader: {
        source: 'linehaul',
        tripStatusText: 'DELIVERED (manual)',
        tripStatusKind: 'linehaul',
        origin: `${origin} · repair`,
        destination: `${dest} · repair`,
        instructions: '',
        historyOutcome: 'delivered',
        historyOutcomeAt: completedAt,
      },
      tripDetails,
    },
  }
  if (args.alsoHide) {
    body.appendHiddenDailyTripLegSequence = seq
  }

  await runWithCredentialAccountKey(ak, async () => {
    await writeAssignment(body)
  })

  console.log('\nUpserted trip history entry.')
  const verify = await readAssignmentForAccount(ak)
  const row = (verify.tripHistoryLedger || []).find(
    (x) => x && String(x.dailyTripLegSequence) === seq,
  )
  if (row) printEntry(row, 0)
  else console.log('Warning: leg not found after write — check DATABASE_URL / account key.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e)
  process.exit(1)
})
