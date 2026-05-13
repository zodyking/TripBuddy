/**
 * Normalize FedEx / directory location ids for map keys (digits only).
 * @param {unknown} id
 */
export function normalizeDirectoryLocationId(id) {
  return String(id ?? '')
    .replace(/\D/g, '')
    .trim()
}

/**
 * @param {Array<{ locationId?: string, locationName?: string, address?: string }>} locations
 * @returns {Map<string, { locationName: string, address: string }>}
 */
export function buildDirectoryLocationMap(locations) {
  /** @type {Map<string, { locationName: string, address: string }>} */
  const m = new Map()
  if (!Array.isArray(locations)) return m
  for (const loc of locations) {
    const id = normalizeDirectoryLocationId(loc?.locationId)
    if (!id) continue
    m.set(id, {
      locationName: String(loc?.locationName ?? '').trim(),
      address: String(loc?.address ?? '').trim(),
    })
  }
  return m
}

/**
 * @param {Map<string, { locationName: string, address: string }>} map
 * @param {unknown} locationId
 * @returns {{ locationName: string, address: string } | null}
 */
export function directoryLookup(map, locationId) {
  const k = normalizeDirectoryLocationId(locationId)
  if (!k) return null
  return map.get(k) ?? null
}
