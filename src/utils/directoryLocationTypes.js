/**
 * FedEx Ground directory station / facility types (CSV `Status` column and `locationType` field).
 * Order is used for statistics and filter chips.
 */
export const DIRECTORY_STATION_TYPES = Object.freeze([
  'Annex',
  'Hub',
  'Hub Local',
  'NFS',
  'Smartpost Hub',
  'Station',
  'Sub Station',
])

/** Filter bucket for unrecognized `locationType` values. */
export const DIRECTORY_LOCATION_TYPE_OTHER = 'Other'

/**
 * @param {string} raw
 */
function normUpperSpaced(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/&/g, ' AND ')
    .toUpperCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Map stored / CSV status text to a filter bucket (one of {@link DIRECTORY_STATION_TYPES} or {@link DIRECTORY_LOCATION_TYPE_OTHER}).
 * @param {unknown} raw `locationType` or CSV `Status`
 * @returns {typeof DIRECTORY_STATION_TYPES[number] | typeof DIRECTORY_LOCATION_TYPE_OTHER}
 */
export function filterKeyForLocationType(raw) {
  const u = normUpperSpaced(raw)
  if (!u) return DIRECTORY_LOCATION_TYPE_OTHER
  const compact = u.replace(/\s/g, '')

  if (compact === 'HUBLOCAL' || u === 'HUB LOCAL') return 'Hub Local'
  if (u === 'SUB STATION' || compact === 'SUBSTATION' || (u.includes('SUB') && u.includes('STATION'))) {
    return 'Sub Station'
  }
  if (
    u === 'SMARTPOST HUB' ||
    compact === 'SMARTPOSTHUB' ||
    u === 'SMART POST HUB' ||
    u.includes('SMARTPOST')
  ) {
    return 'Smartpost Hub'
  }

  if (u === 'ANNEX') return 'Annex'
  if (u === 'NFS' || compact === 'NFS') return 'NFS'

  if (u.includes('HUB') && u.includes('LOCAL')) return 'Hub Local'
  if (u === 'HUB' || u === 'HUBS' || (u.endsWith(' HUB') && !u.includes('SMARTPOST'))) return 'Hub'

  if (
    u === 'STATION' ||
    u === 'STN' ||
    u === 'PUD' ||
    u === 'P AND D' ||
    u === 'SERVICE CENTER' ||
    u === 'GROUND STATION' ||
    (u.includes('PICKUP') && u.includes('DELIVERY')) ||
    (u.includes('STATION') && !u.includes('SUB'))
  ) {
    return 'Station'
  }

  return DIRECTORY_LOCATION_TYPE_OTHER
}

/**
 * Value to persist on import / upsert: canonical label when known, otherwise trimmed original.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeLocationTypeForStorage(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  const key = filterKeyForLocationType(trimmed)
  if (key === DIRECTORY_LOCATION_TYPE_OTHER) return trimmed
  return key
}

/**
 * @param {Array<{ locationType?: string }>} locations
 * @returns {Record<string, number>}
 */
export function countByDirectoryLocationType(locations) {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const t of DIRECTORY_STATION_TYPES) {
    counts[t] = 0
  }
  counts[DIRECTORY_LOCATION_TYPE_OTHER] = 0
  if (!Array.isArray(locations)) return counts
  for (const loc of locations) {
    const k = filterKeyForLocationType(loc?.locationType)
    counts[k] += 1
  }
  return counts
}

/**
 * Sort type keys for chip display (known types first, then Other).
 * @param {string} a
 * @param {string} b
 */
export function compareDirectoryTypeFilterKeys(a, b) {
  const idx = (x) => {
    if (x === DIRECTORY_LOCATION_TYPE_OTHER) return DIRECTORY_STATION_TYPES.length + 1
    const i = DIRECTORY_STATION_TYPES.indexOf(x)
    return i === -1 ? DIRECTORY_STATION_TYPES.length : i
  }
  return idx(a) - idx(b)
}
