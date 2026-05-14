import { normalizeDirectoryLocationId } from './directoryLocationLookup.js'

/** Default rolling window for “Smart list” (trip history → directory). */
export const SMART_LIST_WINDOW_MS = 31 * 24 * 60 * 60 * 1000

/**
 * Best-effort: leading FedEx-style location number from dispatch header line
 * (e.g. `3124 · Bethpage` → `3124`). Placeholders like `—` yield null.
 * @param {unknown} line
 * @returns {string | null}
 */
export function extractLeadingLocationIdFromDispatchLine(line) {
  const t = String(line ?? '').trim()
  if (!t || t === '—' || t === '-') return null
  const m = t.match(/^(\d+)/)
  return m ? m[1] : null
}

/**
 * Calendar / display anchor for a ledger row (matches History view prioritization).
 * @param {Record<string, unknown>} entry
 * @returns {number}
 */
export function tripHistoryLedgerAnchorMs(entry) {
  if (!entry || typeof entry !== 'object') return 0
  const auditRaw = entry.historyAuditBucketMs
  const audit =
    typeof auditRaw === 'number' && Number.isFinite(auditRaw) && auditRaw > 0 ? auditRaw : 0
  if (audit > 0) return audit
  const compRaw = entry.completedAt
  const comp =
    typeof compRaw === 'number' && Number.isFinite(compRaw) && compRaw > 0 ? compRaw : 0
  if (comp > 0) return comp
  const recRaw = entry.recordedAt
  const rec = typeof recRaw === 'number' && Number.isFinite(recRaw) && recRaw > 0 ? recRaw : 0
  return rec
}

/**
 * From trip history ledger rows, collect location ids touched within the window and
 * the latest anchor timestamp per id (origin + destination each count).
 * @param {unknown[]} ledger
 * @param {number} [nowMs]
 * @param {number} [windowMs]
 * @returns {Map<string, number>} normalized location id → latest visit ms
 */
export function collectRecentPlaceVisitTimes(ledger, nowMs = Date.now(), windowMs = SMART_LIST_WINDOW_MS) {
  /** @type {Map<string, number>} */
  const latest = new Map()
  if (!Array.isArray(ledger) || windowMs <= 0) return latest
  const cutoff = nowMs - windowMs
  for (const raw of ledger) {
    if (!raw || typeof raw !== 'object') continue
    const entry = /** @type {Record<string, unknown>} */ (raw)
    const t = tripHistoryLedgerAnchorMs(entry)
    if (t <= 0 || t < cutoff) continue
    const dh = entry.dispatchHeader
    if (!dh || typeof dh !== 'object') continue
    const h = /** @type {Record<string, unknown>} */ (dh)
    const lines = [h.origin, h.destination]
    for (const line of lines) {
      const id = extractLeadingLocationIdFromDispatchLine(line)
      if (!id) continue
      const key = normalizeDirectoryLocationId(id)
      if (!key) continue
      const prev = latest.get(key) ?? 0
      if (t > prev) latest.set(key, t)
    }
  }
  return latest
}

/**
 * Directory rows for Smart export: only ids seen in history, ordered by `recent-first`
 * (most recently visited first). Unmatched ids are dropped.
 * @template {{ locationId?: string }} T
 * @param {T[]} directoryLocations
 * @param {Map<string, number>} idToLatestMs
 * @returns {T[]}
 */
export function orderDirectoryLocationsByRecentVisits(directoryLocations, idToLatestMs) {
  if (!(idToLatestMs instanceof Map) || idToLatestMs.size === 0) return []
  const byId = new Map()
  for (const loc of directoryLocations) {
    const k = normalizeDirectoryLocationId(loc?.locationId)
    if (!k || !idToLatestMs.has(k)) continue
    byId.set(k, loc)
  }
  const orderedIds = [...idToLatestMs.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  /** @type {T[]} */
  const out = []
  for (const id of orderedIds) {
    const row = byId.get(id)
    if (row) out.push(row)
  }
  return out
}

/**
 * @param {unknown[]} ledger
 * @param {Array<{ locationId?: string }>} directoryLocations
 * @param {number} [nowMs]
 * @param {number} [windowMs]
 */
export function countSmartListMatches(ledger, directoryLocations, nowMs, windowMs) {
  const m = collectRecentPlaceVisitTimes(ledger, nowMs, windowMs)
  if (m.size === 0) return { historyIds: 0, directoryMatches: 0 }
  const set = new Set(m.keys())
  let directoryMatches = 0
  for (const loc of directoryLocations) {
    const k = normalizeDirectoryLocationId(loc?.locationId)
    if (k && set.has(k)) directoryMatches++
  }
  return { historyIds: m.size, directoryMatches }
}
