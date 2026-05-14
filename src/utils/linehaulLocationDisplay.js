import {
  DIRECTORY_LOCATION_TYPE_OTHER,
  filterKeyForLocationType,
  normalizeLocationTypeForStorage,
} from './directoryLocationTypes.js'

/**
 * Format FedEx v2 transportation-network location JSON for UI.
 * Rows may include `href` for address (Google Maps Street View) and phone (`tel:`).
 * @param {unknown} body
 * @returns {{
 *   rows: { label: string, value: string, href?: string }[],
 *   rawJson: string,
 * }}
 */
export function formatLinehaulLocationForDisplay(body) {
  let rawJson = ''
  try {
    rawJson =
      body !== undefined && body !== null
        ? JSON.stringify(body, null, 2)
        : ''
  } catch {
    rawJson = String(body)
  }

  const o = unwrapLocationRecord(body)
  if (!o) {
    return { rows: [], rawJson }
  }

  /** @type {{ label: string, value: string, href?: string }[]} */
  const rows = []
  const seen = new Set()

  /**
   * @param {string} label
   * @param {unknown} val
   * @param {string} [href]
   */
  function add(label, val, href) {
    if (val == null || val === '') return
    const s =
      typeof val === 'object'
        ? JSON.stringify(val)
        : String(val).trim()
    if (!s) return
    const key = `${label}\0${s}\0${href ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    /** @type {{ label: string, value: string, href?: string }} */
    const row = { label, value: s }
    if (href) row.href = href
    rows.push(row)
  }

  add('Location', o.locationName ?? o.name ?? o.siteName)
  add('Abbreviation', o.locationAbbrv)
  add('Location ID', o.locationId ?? o.id)

  const parts = collectAddressParts(o)
  const fullAddress = formatAddressOneLine(parts)
  if (fullAddress) {
    const mapsUrl = buildGoogleMapsStreetViewUrl(o, fullAddress)
    add('Address', fullAddress, mapsUrl)
  }

  const phoneRaw =
    o.phoneNumber ?? o.phone ?? o.primaryPhone ?? o.phoneNbr ?? o.telephone
  const phoneDisplay = formatPhoneDisplay(phoneRaw)
  const telHref = buildTelHref(phoneRaw)
  if (phoneDisplay && telHref) {
    add('Phone', phoneDisplay, telHref)
  } else if (phoneDisplay) {
    add('Phone', phoneDisplay)
  }

  const lat = o.latitudeValue ?? o.latitude ?? o.lat
  const lng = o.longitudeValue ?? o.longitude ?? o.lng ?? o.lon
  const latDir = o.latitudeDirection
  const lngDir = o.longitudeDirection
  if (lat != null && lng != null) {
    let coord = `${lat}, ${lng}`
    if (latDir && lngDir) {
      coord = `${lat}° ${latDir}, ${lng}° ${lngDir}`
    }
    add('Coordinates', coord)
  } else {
    add('Latitude', lat)
    add('Longitude', lng)
  }

  add('Time zone', o.timeZoneCode ?? o.timeZone)

  return { rows, rawJson }
}

/**
 * @param {Record<string, unknown>} o
 * @returns {{ street: string, city: string, state: string, zip: string }}
 */
function collectAddressParts(o) {
  let street =
    typeof o.address === 'string'
      ? o.address
      : String(o.addressLine1 ?? o.streetAddress ?? o.street1 ?? '').trim()

  let city = String(o.city ?? '').trim()
  let state = String(o.state ?? o.stateCode ?? '').trim()
  let zip = String(o.zipCode ?? o.postalCode ?? o.zip ?? '').trim()

  if (!street && !city && !state && !zip) {
    for (const nk of [
      'physicalAddress',
      'postalAddress',
      'locationAddress',
      'mailingAddress',
    ]) {
      const nest = o[nk]
      if (nest && typeof nest === 'object' && !Array.isArray(nest)) {
        const a = /** @type {Record<string, unknown>} */ (nest)
        street = String(a.addressLine1 ?? a.street ?? a.line1 ?? '').trim()
        city = String(a.city ?? a.cityName ?? '').trim()
        state = String(a.state ?? a.stateCode ?? '').trim()
        zip = String(a.postalCode ?? a.zipCode ?? a.zip ?? '').trim()
        break
      }
    }
  }

  return { street, city, state, zip }
}

/**
 * @param {{ street: string, city: string, state: string, zip: string }} p
 */
function formatAddressOneLine(p) {
  const { street, city, state, zip } = p
  const cityStateZip =
    city && state && zip
      ? `${city}, ${state} ${zip}`
      : city && state
        ? `${city}, ${state}`
        : [city, state, zip].filter(Boolean).join(', ')
  const parts = [street, cityStateZip].filter(Boolean)
  return parts.join(', ')
}

/**
 * Street View when lat/lng exist; otherwise search (opens Maps for the address).
 * @param {Record<string, unknown>} o
 * @param {string} fullAddress
 */
function buildGoogleMapsStreetViewUrl(o, fullAddress) {
  const ll = toSignedLatLng(o)
  if (ll) {
    const { lat, lng } = ll
    return `https://www.google.com/maps?layer=c&cbll=${lat},${lng}`
  }
  const q = encodeURIComponent(fullAddress)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

/**
 * @param {Record<string, unknown>} o
 * @returns {{ lat: number, lng: number } | null}
 */
function toSignedLatLng(o) {
  const latRaw = o.latitudeValue ?? o.latitude ?? o.lat
  const lngRaw = o.longitudeValue ?? o.longitude ?? o.lng ?? o.lon
  if (latRaw == null || lngRaw == null) return null
  let lat = Number(latRaw)
  let lng = Number(lngRaw)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  const latD = String(o.latitudeDirection ?? '').toUpperCase()
  const lngD = String(o.longitudeDirection ?? '').toUpperCase()
  if (latD === 'S') lat = -Math.abs(lat)
  else lat = Math.abs(lat)
  if (lngD === 'W') lng = -Math.abs(lng)
  else if (lngD === 'E') lng = Math.abs(lng)
  return { lat, lng }
}

/**
 * @param {unknown} v
 */
function buildTelHref(v) {
  if (v == null || v === '') return ''
  const d = String(v).replace(/\D/g, '')
  if (d.length === 10) return `tel:+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `tel:+${d}`
  if (d.length >= 8) return `tel:+${d}`
  return ''
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown> | null}
 */
function unwrapLocationRecord(body) {
  if (body == null) return null
  if (Array.isArray(body)) {
    const first = body.find(
      (x) => x != null && typeof x === 'object' && !Array.isArray(x),
    )
    return first ? /** @type {Record<string, unknown>} */ (first) : null
  }
  if (typeof body === 'object' && !Array.isArray(body)) {
    return /** @type {Record<string, unknown>} */ (body)
  }
  return null
}

/**
 * Prefer CSV / facility Status over generic Linehaul `locationType` (often operational, not Hub/Station).
 * @param {Record<string, unknown>} o
 */
function pickLocationStatusForDirectory(o) {
  const keys = [
    'Status',
    'status',
    'stationType',
    'facilityType',
    'facilityStatus',
    'locationStatus',
    'statusDescription',
    'locationCategory',
    'locationType',
    'bookingLocationType',
    'locType',
  ]
  /** @type {string[]} */
  const candidates = []
  const collect = (/** @type {Record<string, unknown>} */ obj) => {
    for (const k of keys) {
      const v = obj[k]
      if (v != null && String(v).trim()) candidates.push(String(v).trim())
    }
  }
  collect(o)
  const nested = o.locationDetails ?? o.locationDetail ?? o.facility
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    collect(/** @type {Record<string, unknown>} */ (nested))
  }
  for (const c of candidates) {
    if (filterKeyForLocationType(c) !== DIRECTORY_LOCATION_TYPE_OTHER) return c
  }
  return candidates[0] ?? ''
}

/**
 * @param {unknown} v
 */
function formatPhoneDisplay(v) {
  if (v == null || v === '') return null
  const d = String(v).replace(/\D/g, '')
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  if (d.length === 11 && d.startsWith('1')) {
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  return String(v).trim()
}

/**
 * Extract normalized location data for directory storage.
 * @param {unknown} body
 * @returns {{
 *   locationId: string,
 *   locationName: string,
 *   abbreviation: string,
 *   address: string,
 *   phone: string,
 *   latitude: number | null,
 *   longitude: number | null,
 *   timeZone: string,
 *   locationType?: string,
 *   district?: string,
 * } | null}
 */
export function extractLocationForDirectory(body) {
  const o = unwrapLocationRecord(body)
  if (!o) return null

  const id = o.locationId ?? o.id
  if (id == null || String(id).trim() === '') return null

  const parts = collectAddressParts(o)
  const latRaw = o.latitudeValue ?? o.latitude ?? o.lat
  const lngRaw = o.longitudeValue ?? o.longitude ?? o.lng ?? o.lon

  let lat = latRaw != null ? Number(latRaw) : null
  let lng = lngRaw != null ? Number(lngRaw) : null
  if (lat != null && Number.isNaN(lat)) lat = null
  if (lng != null && Number.isNaN(lng)) lng = null

  const latD = String(o.latitudeDirection ?? '').toUpperCase()
  const lngD = String(o.longitudeDirection ?? '').toUpperCase()
  if (lat != null && latD === 'S') lat = -Math.abs(lat)
  if (lng != null) {
    if (lngD === 'W') lng = -Math.abs(lng)
    else if (lngD === 'E') lng = Math.abs(lng)
  }

  const statusRaw = pickLocationStatusForDirectory(o)
  const locationType = normalizeLocationTypeForStorage(statusRaw)
  const districtRaw = String(o.district ?? o.District ?? '').trim()
  const district = districtRaw ? districtRaw.toUpperCase() : ''

  return {
    locationId: String(id).trim(),
    locationName: String(o.locationName ?? o.name ?? o.siteName ?? '').trim(),
    abbreviation: String(o.locationAbbrv ?? '').trim(),
    address: formatAddressOneLine(parts),
    phone: String(o.phoneNumber ?? o.phone ?? o.primaryPhone ?? o.phoneNbr ?? o.telephone ?? '').replace(/\D/g, ''),
    latitude: lat,
    longitude: lng,
    timeZone: String(o.timeZoneCode ?? o.timeZone ?? '').trim(),
    ...(locationType ? { locationType } : {}),
    ...(district ? { district } : {}),
  }
}
