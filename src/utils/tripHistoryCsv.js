import { parseCsvRecords } from './csvParse.js'

/** @type {1} */
export const TRIP_HISTORY_CSV_FORMAT_VERSION = 1

export const TRIP_HISTORY_CSV_HEADERS = [
  'formatVersion',
  'id',
  'source',
  'dailyTripLegSequence',
  'recordedAt',
  'completedAt',
  'dispatchedAtMs',
  'outcomeTouchedAt',
  'historyAuditBucketMs',
  'federalHolidayMileage15xApproved',
  'outcome',
  'dispatchHeaderJson',
  'tripDetailsJson',
  'extraJson',
]

const KNOWN_ENTRY_KEYS = new Set([
  'id',
  'source',
  'dailyTripLegSequence',
  'recordedAt',
  'completedAt',
  'dispatchedAtMs',
  'outcomeTouchedAt',
  'historyAuditBucketMs',
  'federalHolidayMileage15xApproved',
  'outcome',
  'dispatchHeader',
  'tripDetails',
])

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvField(value) {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * @param {string[]} fields
 * @returns {string}
 */
export function stringifyCsvRow(fields) {
  return fields.map((f) => escapeCsvField(f)).join(',')
}

/**
 * @param {unknown} v
 * @returns {number | undefined}
 */
function parseOptionalMs(v) {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function parseJsonObjectColumn(raw, columnName) {
  const s = String(raw ?? '').trim()
  if (!s) return {}
  let parsed
  try {
    parsed = JSON.parse(s)
  } catch (e) {
    throw new Error(`${columnName}: invalid JSON (${e instanceof Error ? e.message : String(e)})`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${columnName}: must be a JSON object`)
  }
  return /** @type {Record<string, unknown>} */ (parsed)
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function extraFieldsFromEntry(entry) {
  /** @type {Record<string, unknown>} */
  const extra = {}
  for (const [k, v] of Object.entries(entry)) {
    if (!KNOWN_ENTRY_KEYS.has(k)) extra[k] = v
  }
  return extra
}

/**
 * @param {unknown} entry
 * @returns {Record<string, unknown> | null}
 */
export function normalizeTripHistoryEntryForExport(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const e = /** @type {Record<string, unknown>} */ (entry)
  const id = String(e.id ?? '').trim()
  if (!id) return null
  const dispatchHeader =
    e.dispatchHeader && typeof e.dispatchHeader === 'object' && !Array.isArray(e.dispatchHeader)
      ? /** @type {Record<string, unknown>} */ (e.dispatchHeader)
      : {}
  const tripDetails =
    e.tripDetails && typeof e.tripDetails === 'object' && !Array.isArray(e.tripDetails)
      ? /** @type {Record<string, unknown>} */ (e.tripDetails)
      : {}
  const extra = extraFieldsFromEntry(e)
  /** @type {Record<string, unknown>} */
  const out = {
    id,
    source: typeof e.source === 'string' ? e.source : '',
    dailyTripLegSequence: String(e.dailyTripLegSequence ?? '').trim(),
    dispatchHeader,
    tripDetails,
  }
  const rec = parseOptionalMs(e.recordedAt)
  if (rec != null) out.recordedAt = rec
  const comp = parseOptionalMs(e.completedAt)
  if (comp != null) out.completedAt = comp
  const disp = parseOptionalMs(e.dispatchedAtMs)
  if (disp != null) out.dispatchedAtMs = disp
  const ot = parseOptionalMs(e.outcomeTouchedAt)
  if (ot != null) out.outcomeTouchedAt = ot
  const audit = parseOptionalMs(e.historyAuditBucketMs)
  if (audit != null) out.historyAuditBucketMs = audit
  if (e.federalHolidayMileage15xApproved === true) {
    out.federalHolidayMileage15xApproved = true
  }
  if (typeof e.outcome === 'string' && e.outcome.trim()) {
    out.outcome = e.outcome.trim()
  }
  if (Object.keys(extra).length > 0) {
    for (const [k, v] of Object.entries(extra)) out[k] = v
  }
  return out
}

/**
 * @param {unknown[]} ledger
 * @returns {string}
 */
export function exportTripHistoryToCsv(ledger) {
  const rows = [stringifyCsvRow(TRIP_HISTORY_CSV_HEADERS)]
  const list = Array.isArray(ledger) ? ledger : []
  for (const raw of list) {
    const entry = normalizeTripHistoryEntryForExport(raw)
    if (!entry) continue
    const dispatchHeader =
      entry.dispatchHeader && typeof entry.dispatchHeader === 'object'
        ? /** @type {Record<string, unknown>} */ (entry.dispatchHeader)
        : {}
    const tripDetails =
      entry.tripDetails && typeof entry.tripDetails === 'object'
        ? /** @type {Record<string, unknown>} */ (entry.tripDetails)
        : {}
    const extra = extraFieldsFromEntry(entry)
    const fields = [
      String(TRIP_HISTORY_CSV_FORMAT_VERSION),
      String(entry.id ?? ''),
      String(entry.source ?? ''),
      String(entry.dailyTripLegSequence ?? ''),
      entry.recordedAt != null ? String(entry.recordedAt) : '',
      entry.completedAt != null ? String(entry.completedAt) : '',
      entry.dispatchedAtMs != null ? String(entry.dispatchedAtMs) : '',
      entry.outcomeTouchedAt != null ? String(entry.outcomeTouchedAt) : '',
      entry.historyAuditBucketMs != null ? String(entry.historyAuditBucketMs) : '',
      entry.federalHolidayMileage15xApproved === true ? 'true' : '',
      typeof entry.outcome === 'string' ? entry.outcome : '',
      JSON.stringify(dispatchHeader),
      JSON.stringify(tripDetails),
      Object.keys(extra).length > 0 ? JSON.stringify(extra) : '',
    ]
    rows.push(stringifyCsvRow(fields))
  }
  return `${rows.join('\n')}\n`
}

/**
 * @param {Record<string, string>} row
 * @param {number} rowIndex
 * @returns {Record<string, unknown>}
 */
export function tripHistoryEntryFromCsvRow(row, rowIndex = 0) {
  const fmt = String(row.formatVersion ?? '').trim()
  if (fmt && fmt !== String(TRIP_HISTORY_CSV_FORMAT_VERSION)) {
    throw new Error(
      `Row ${rowIndex + 1}: unsupported formatVersion "${fmt}" (expected ${TRIP_HISTORY_CSV_FORMAT_VERSION})`,
    )
  }
  const id = String(row.id ?? '').trim()
  const seq = String(row.dailyTripLegSequence ?? '').trim()
  if (!id && !/^\d+$/.test(seq)) {
    throw new Error(`Row ${rowIndex + 1}: needs id or dailyTripLegSequence`)
  }
  const dispatchHeader = parseJsonObjectColumn(row.dispatchHeaderJson, 'dispatchHeaderJson')
  const tripDetails = parseJsonObjectColumn(row.tripDetailsJson, 'tripDetailsJson')
  const extra = String(row.extraJson ?? '').trim()
    ? parseJsonObjectColumn(row.extraJson, 'extraJson')
    : {}
  /** @type {Record<string, unknown>} */
  const entry = {
    id: id || `import-${seq}-${rowIndex}`,
    source: String(row.source ?? '').trim() || 'import',
    dailyTripLegSequence: seq,
    dispatchHeader,
    tripDetails,
    ...extra,
  }
  const rec = parseOptionalMs(row.recordedAt)
  if (rec != null) entry.recordedAt = rec
  const comp = parseOptionalMs(row.completedAt)
  if (comp != null) entry.completedAt = comp
  const disp = parseOptionalMs(row.dispatchedAtMs)
  if (disp != null) entry.dispatchedAtMs = disp
  const ot = parseOptionalMs(row.outcomeTouchedAt)
  if (ot != null) entry.outcomeTouchedAt = ot
  const audit = parseOptionalMs(row.historyAuditBucketMs)
  if (audit != null) entry.historyAuditBucketMs = audit
  const hol = String(row.federalHolidayMileage15xApproved ?? '').trim().toLowerCase()
  if (hol === 'true' || hol === '1' || hol === 'yes') {
    entry.federalHolidayMileage15xApproved = true
  }
  const outcome = String(row.outcome ?? '').trim()
  if (outcome) entry.outcome = outcome
  return entry
}

/**
 * @param {string} csvText
 * @returns {{ entries: Record<string, unknown>[], errors: string[], totalRows: number }}
 */
export function parseTripHistoryFromCsv(csvText) {
  const rows = parseCsvRecords(csvText)
  /** @type {Record<string, unknown>[]} */
  const entries = []
  /** @type {string[]} */
  const errors = []
  /** @type {Set<string>} */
  const seenIds = new Set()
  rows.forEach((row, idx) => {
    try {
      const entry = tripHistoryEntryFromCsvRow(row, idx)
      const id = String(entry.id ?? '').trim()
      if (seenIds.has(id)) {
        errors.push(`Row ${idx + 1}: duplicate id "${id}"`)
        return
      }
      seenIds.add(id)
      entries.push(entry)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  })
  return { entries, errors, totalRows: rows.length }
}

/**
 * @param {unknown[]} existing
 * @param {unknown[]} imported
 * @returns {Record<string, unknown>[]}
 */
export function mergeTripHistoryLedgers(existing, imported) {
  const base = (Array.isArray(existing) ? existing : [])
    .map((x) => normalizeTripHistoryEntryForExport(x))
    .filter(Boolean)
  const incoming = (Array.isArray(imported) ? imported : [])
    .map((x) => normalizeTripHistoryEntryForExport(x))
    .filter(Boolean)
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map()
  for (const e of base) {
    byId.set(String(e.id), e)
  }
  for (const e of incoming) {
    byId.set(String(e.id), e)
  }
  return [...byId.values()]
}

/**
 * @param {Record<string, unknown>[]} entries
 * @param {number} [limit]
 */
export function tripHistoryCsvPreviewRows(entries, limit = 5) {
  const list = Array.isArray(entries) ? entries : []
  return list.slice(0, limit).map((e) => {
    const dh =
      e.dispatchHeader && typeof e.dispatchHeader === 'object'
        ? /** @type {Record<string, unknown>} */ (e.dispatchHeader)
        : {}
    return {
      id: String(e.id ?? ''),
      leg: String(e.dailyTripLegSequence ?? ''),
      origin: String(dh.origin ?? '').slice(0, 48),
      destination: String(dh.destination ?? '').slice(0, 48),
    }
  })
}
