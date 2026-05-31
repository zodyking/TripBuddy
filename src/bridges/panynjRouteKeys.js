/**
 * Stable keys for PANYNJ crossing-time history when routeId values change (esp. GWB decks).
 */
import { isGwbUpperRouteId } from './gwbRoutes.js'

/**
 * @param {unknown} v
 * @returns {'ToNY' | 'ToNJ' | ''}
 */
export function normalizePanynjTravelDir(v) {
  const s = String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[–—-]/g, '')
    .toUpperCase()
  if (s === 'TONY' || s === 'TOWARDNY') return 'ToNY'
  if (s === 'TONJ' || s === 'TOWARDNJ') return 'ToNJ'
  if (s.includes('TO') && s.includes('NY') && !s.includes('NJ')) return 'ToNY'
  if (s.includes('TO') && s.includes('NJ') && !s.includes('NY')) return 'ToNJ'
  return ''
}

/**
 * Storage key for time-series points (stable across PANYNJ routeId churn).
 * @param {unknown} row
 * @returns {string}
 */
export function canonicalPanynjSeriesKey(row) {
  if (row == null || typeof row !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (row)
  const id = String(o.routeId ?? '').trim()
  const name = String(o.crossingDisplayName ?? '')
  const dir = normalizePanynjTravelDir(o.travelDirection)
  const mod = String(o.facilityModifier ?? '').trim().toLowerCase()

  if (/george washington bridge/i.test(name) && dir) {
    const upper =
      mod === 'upper' || (mod !== 'lower' && isGwbUpperRouteId(o.routeId, dir))
    if (upper) {
      return dir === 'ToNY' ? 'gwb-upper-tony' : 'gwb-upper-tonj'
    }
    if (mod === 'lower') {
      return dir === 'ToNY' ? 'gwb-lower-tony' : 'gwb-lower-tonj'
    }
  }

  return id
}

/**
 * All KV keys that may hold history for a live API row (legacy routeIds + canonical).
 * @param {unknown} row
 * @returns {string[]}
 */
export function panynjSeriesStorageKeys(row) {
  if (row == null || typeof row !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (row)
  const id = String(o.routeId ?? '').trim()
  const canonical = canonicalPanynjSeriesKey(row)
  const keys = new Set()
  if (id) keys.add(id)
  if (canonical) keys.add(canonical)
  const dir = normalizePanynjTravelDir(o.travelDirection)
  if (/george washington bridge/i.test(String(o.crossingDisplayName ?? '')) && dir) {
    if (canonical === 'gwb-upper-tonj') {
      keys.add('12')
      keys.add('5219')
    } else if (canonical === 'gwb-upper-tony') {
      keys.add('211')
      keys.add('881')
    } else if (canonical === 'gwb-lower-tonj') {
      keys.add('11')
    } else if (canonical === 'gwb-lower-tony') {
      keys.add('212')
    }
  }
  return [...keys]
}
