import {
  filterKeyForLocationType,
  compareDirectoryTypeFilterKeys,
} from './directoryLocationTypes.js'
import { inferRegionFromDirectoryAddress } from './directoryAddressRegion.js'
import { collectRecentPlaceVisitTimes, orderDirectoryLocationsByRecentVisits } from './directoryTripHistorySmartPlaces.js'

/**
 * Fold one long vCard line to 75-octet chunks (continuation lines start with space).
 * @param {string} line
 * @returns {string[]}
 */
export function foldVcardContentLine(line) {
  const max = 75
  if (line.length <= max) return [line]
  /** @type {string[]} */
  const out = []
  out.push(line.slice(0, max))
  let rest = line.slice(max)
  while (rest.length > 0) {
    out.push(` ${rest.slice(0, max - 1)}`)
    rest = rest.slice(max - 1)
  }
  return out
}

export function escapeVcardText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

/**
 * vCard TEL value: digits only (no +1 / no leading +).
 * US 10-digit and 1 + 10-digit both normalize to 10 digits.
 */
export function phoneToVcardTel(phone) {
  const d = String(phone).replace(/\D/g, '')
  if (d.length === 10) return d
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  if (d.length >= 8) return d
  return ''
}

/**
 * Parse address string into vCard ADR components.
 * @param {string} addr
 * @returns {{ street: string, city: string, state: string, zip: string }}
 */
export function parseAddressForVcard(addr) {
  const parts = (addr || '').split(',').map((p) => p.trim())
  if (parts.length >= 4) {
    return {
      street: parts.slice(0, -3).join(', '),
      city: parts[parts.length - 3],
      state: parts[parts.length - 2],
      zip: parts[parts.length - 1],
    }
  }
  if (parts.length === 3) {
    return { street: parts[0], city: parts[1], state: '', zip: parts[2] }
  }
  if (parts.length === 2) {
    return { street: parts[0], city: parts[1], state: '', zip: '' }
  }
  return { street: addr, city: '', state: '', zip: '' }
}

/**
 * @param {string} rawName
 */
export function sanitizeLocationNameForLabel(rawName) {
  const s = String(rawName ?? '').trim()
  if (!s) return ''
  const beforeDash = s.includes('-') ? s.split('-')[0].trim() : s
  return beforeDash.replace(/-/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Location name for vCard N family part: letters and numbers only, spaces between words.
 * @param {string} rawName
 */
export function sanitizeLocationNameForVcardFamilyName(rawName) {
  const s = String(rawName ?? '').trim()
  if (!s) return ''
  try {
    return s
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return s
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

/**
 * @param {{ locationId?: string, locationName?: string, abbreviation?: string }} loc
 */
export function vcardContactLabel(loc) {
  const idRaw = String(loc.locationId ?? '').trim()
  const id = idRaw.replace(/-/g, '')
  const namePart = sanitizeLocationNameForLabel(loc.locationName || '').replace(/-/g, '')
  if (!id && !namePart) {
    return String(loc.abbreviation || '').trim().replace(/-/g, '') || 'Location'
  }
  if (!namePart) return id
  if (!id) return namePart
  return `${id} ${namePart}`.trim()
}

/**
 * @param {'all' | 'ny-metro' | 'ny-metro-northeast'} filter
 * @param {Array<{ district?: string }>} locs
 */
export function filterLocationsByDistrictPreset(locs, filter) {
  if (filter === 'all') return locs
  const nyMetroDistricts = ['NEW YORK METRO']
  const northeastDistricts = ['NORTHEAST']
  if (filter === 'ny-metro') {
    return locs.filter((l) => nyMetroDistricts.includes((l.district || '').toUpperCase()))
  }
  if (filter === 'ny-metro-northeast') {
    const allowed = [...nyMetroDistricts, ...northeastDistricts]
    return locs.filter((l) => allowed.includes((l.district || '').toUpperCase()))
  }
  return locs
}

/**
 * @param {{ locationId: string }} a
 * @param {{ locationId: string }} b
 */
export function compareLocationIdNumeric(a, b) {
  const sa = String(a.locationId ?? '').trim()
  const sb = String(b.locationId ?? '').trim()
  const na = parseInt(sa, 10)
  const nb = parseInt(sb, 10)
  const aNum = /^\d+$/.test(sa) && Number.isFinite(na)
  const bNum = /^\d+$/.test(sb) && Number.isFinite(nb)
  if (aNum && bNum && na !== nb) return na - nb
  if (aNum && !bNum) return -1
  if (!aNum && bNum) return 1
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * @param {object} loc
 * @returns {{ loc: object, _geo: ReturnType<typeof inferRegionFromDirectoryAddress> }}
 */
export function enrichLocationForExportSort(loc) {
  const address = /** @type {{ address?: string }} */ (loc).address
  return {
    loc,
    _geo: inferRegionFromDirectoryAddress(String(address ?? '')),
  }
}

/**
 * @param {object} a
 * @param {object} b
 * @param {'id' | 'name' | 'state' | 'country' | 'type' | 'recent-first'} key
 * @param {'asc' | 'desc'} dir
 * @param {Map<string, number>} [recentMs] locationId (normalized) → ms for `recent-first`
 */
export function compareExportLocations(a, b, key, dir, recentMs) {
  const mul = dir === 'desc' ? -1 : 1
  const ga = enrichLocationForExportSort(a)
  const gb = enrichLocationForExportSort(b)
  if (key === 'recent-first' && recentMs instanceof Map) {
    const ida = String(/** @type {{ locationId?: string }} */ (a).locationId ?? '')
      .replace(/\D/g, '')
      .trim()
    const idb = String(/** @type {{ locationId?: string }} */ (b).locationId ?? '')
      .replace(/\D/g, '')
      .trim()
    const ta = ida ? recentMs.get(ida) ?? 0 : 0
    const tb = idb ? recentMs.get(idb) ?? 0 : 0
    if (ta !== tb) return (ta - tb) * mul
    return compareLocationIdNumeric(
      /** @type {{ locationId: string }} */ (a),
      /** @type {{ locationId: string }} */ (b),
    )
  }
  if (key === 'id') {
    return (
      compareLocationIdNumeric(
        /** @type {{ locationId: string }} */ (a),
        /** @type {{ locationId: string }} */ (b),
      ) * mul
    )
  }
  if (key === 'name') {
    const an = String(/** @type {{ locationName?: string }} */ (a).locationName ?? '')
      .trim()
      .localeCompare(
        String(/** @type {{ locationName?: string }} */ (b).locationName ?? '').trim(),
        undefined,
        { sensitivity: 'base' },
      )
    if (an !== 0) return an * mul
    return compareLocationIdNumeric(
      /** @type {{ locationId: string }} */ (a),
      /** @type {{ locationId: string }} */ (b),
    )
  }
  if (key === 'state') {
    const as = String((ga._geo.stateLabel || ga._geo.stateCode) ?? '')
      .trim()
      .localeCompare(String((gb._geo.stateLabel || gb._geo.stateCode) ?? '').trim(), undefined, {
        sensitivity: 'base',
      })
    if (as !== 0) return as * mul
    return compareLocationIdNumeric(
      /** @type {{ locationId: string }} */ (a),
      /** @type {{ locationId: string }} */ (b),
    )
  }
  if (key === 'country') {
    const ac = String(ga._geo.countryLabel ?? '')
      .trim()
      .localeCompare(String(gb._geo.countryLabel ?? '').trim(), undefined, { sensitivity: 'base' })
    if (ac !== 0) return ac * mul
    return compareLocationIdNumeric(
      /** @type {{ locationId: string }} */ (a),
      /** @type {{ locationId: string }} */ (b),
    )
  }
  if (key === 'type') {
    const at = filterKeyForLocationType(/** @type {{ locationType?: string }} */ (a).locationType)
    const bt = filterKeyForLocationType(/** @type {{ locationType?: string }} */ (b).locationType)
    const cmp = compareDirectoryTypeFilterKeys(at, bt)
    if (cmp !== 0) return cmp * mul
    return compareLocationIdNumeric(
      /** @type {{ locationId: string }} */ (a),
      /** @type {{ locationId: string }} */ (b),
    )
  }
  return compareLocationIdNumeric(
    /** @type {{ locationId: string }} */ (a),
    /** @type {{ locationId: string }} */ (b),
  )
}

/**
 * Stable sort for export list.
 * @param {object[]} locations
 * @param {'id' | 'name' | 'state' | 'country' | 'type' | 'recent-first'} sortKey
 * @param {'asc' | 'desc'} sortDir
 * @param {Map<string, number>} [recentMs]
 */
export function sortLocationsForVcardExport(locations, sortKey, sortDir, recentMs) {
  const arr = [...locations]
  arr.sort((a, b) => compareExportLocations(a, b, sortKey, sortDir, recentMs))
  return arr
}

/**
 * @param {object[]} sortedLocations
 * @param {{ photoB64?: string }} opts
 * @returns {{ body: string, itemCount: number }}
 */
export function buildDirectoryVcardString(sortedLocations, opts = {}) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'ORG:FedEx;', 'FN:FedEx']
  const b64 = opts.photoB64
  if (b64) {
    lines.push(...foldVcardContentLine(`PHOTO;ENCODING=b:${b64}`))
  }
  let item = 1
  let itemCount = 0
  for (const loc of sortedLocations) {
    const raw = /** @type {{ phone?: string, address?: string }} */ (loc).phone ?? ''
    const tel = phoneToVcardTel(raw)
    const label = vcardContactLabel(
      /** @type {{ locationId?: string, locationName?: string, abbreviation?: string }} */ (loc),
    )
    if (tel) {
      lines.push(`item${item}.TEL:${tel}`)
      lines.push(`item${item}.X-ABLabel:${escapeVcardText(label)}`)
      item += 1
      itemCount += 1
    }
    const addr = String(/** @type {{ address?: string }} */ (loc).address ?? '').trim()
    if (addr) {
      const { street, city, state, zip } = parseAddressForVcard(addr)
      const adrValue = `;;${escapeVcardText(street)};${escapeVcardText(city)};${escapeVcardText(state)};${escapeVcardText(zip)};`
      lines.push(`item${item}.ADR;type=WORK:${adrValue}`)
      lines.push(`item${item}.X-ABLabel:${escapeVcardText(label)}`)
      item += 1
      itemCount += 1
    }
  }
  lines.push('END:VCARD')
  return { body: lines.join('\r\n'), itemCount }
}

/**
 * One contact per file (directory card download). Given name = location id, family = sanitized name.
 * @param {object} loc
 * @param {{ photoB64?: string }} opts
 * @returns {{ body: string, itemCount: number }}
 */
export function buildSingleDirectoryContactVcard(loc, opts = {}) {
  const given = String(/** @type {{ locationId?: string }} */ (loc).locationId ?? '').trim() || 'Location'
  const family = sanitizeLocationNameForVcardFamilyName(
    String(/** @type {{ locationName?: string }} */ (loc).locationName ?? ''),
  )
  const lines = ['BEGIN:VCARD', 'VERSION:3.0']
  lines.push(
    `N:${escapeVcardText(family)};${escapeVcardText(given)};;;`,
  )
  const fn = family ? `${given} ${family}`.trim() : given
  lines.push(`FN:${escapeVcardText(fn)}`)
  lines.push('ORG:FedEx;')
  const b64 = opts.photoB64
  if (b64) {
    lines.push(...foldVcardContentLine(`PHOTO;ENCODING=b:${b64}`))
  }
  const raw = /** @type {{ phone?: string }} */ (loc).phone ?? ''
  const tel = phoneToVcardTel(raw)
  if (tel) {
    lines.push(`TEL;TYPE=WORK,VOICE:${tel}`)
  }
  const addr = String(/** @type {{ address?: string }} */ (loc).address ?? '').trim()
  if (addr) {
    const { street, city, state, zip } = parseAddressForVcard(addr)
    const adrValue = `;;${escapeVcardText(street)};${escapeVcardText(city)};${escapeVcardText(state)};${escapeVcardText(zip)};`
    lines.push(`ADR;TYPE=WORK:${adrValue}`)
  }
  lines.push('END:VCARD')
  const itemCount = (tel ? 1 : 0) + (addr ? 1 : 0)
  return { body: lines.join('\r\n'), itemCount }
}

/**
 * @param {object[]} sortedLocations
 */
export function vcardExportHasRenderableItems(sortedLocations) {
  for (const loc of sortedLocations) {
    const raw = /** @type {{ phone?: string, address?: string }} */ (loc).phone ?? ''
    if (phoneToVcardTel(raw)) return true
    if (String(/** @type {{ address?: string }} */ (loc).address ?? '').trim()) return true
  }
  return false
}

/**
 * @param {{
 *   allLocations: object[],
 *   scope: 'all' | 'ny-metro' | 'ny-metro-northeast' | 'smart-31d',
 *   sortKey: 'id' | 'name' | 'state' | 'country' | 'type' | 'recent-first',
 *   sortDir: 'asc' | 'desc',
 *   ledger: unknown[],
 *   nowMs?: number,
 *   windowMs?: number,
 * }} p
 * @returns {{ sorted: object[], recentMap: Map<string, number> | null }}
 */
export function resolveVcardExportLocations(p) {
  const {
    allLocations,
    scope,
    sortKey,
    sortDir,
    ledger,
    nowMs = Date.now(),
    windowMs,
  } = p
  const win = typeof windowMs === 'number' && windowMs > 0 ? windowMs : undefined
  let base = [...allLocations]

  if (scope === 'smart-31d') {
    const recentMap = collectRecentPlaceVisitTimes(ledger, nowMs, win)
    base = orderDirectoryLocationsByRecentVisits(base, recentMap)
    if (sortKey === 'recent-first') {
      return { sorted: sortLocationsForVcardExport(base, 'recent-first', sortDir, recentMap), recentMap }
    }
    return {
      sorted: sortLocationsForVcardExport(base, sortKey, sortDir, recentMap),
      recentMap,
    }
  }

  const district =
    scope === 'ny-metro' ? 'ny-metro' : scope === 'ny-metro-northeast' ? 'ny-metro-northeast' : 'all'
  base = filterLocationsByDistrictPreset(base, district)
  const sk = sortKey === 'recent-first' ? 'id' : sortKey
  return { sorted: sortLocationsForVcardExport(base, sk, sortDir), recentMap: null }
}

/**
 * @param {'all' | 'ny-metro' | 'ny-metro-northeast' | 'smart-31d'} scope
 */
export function vcardFilenameSuffix(scope) {
  if (scope === 'all') return ''
  if (scope === 'ny-metro') return '-ny-metro'
  if (scope === 'ny-metro-northeast') return '-ny-metro-northeast'
  if (scope === 'smart-31d') return '-smart-31d'
  return ''
}
