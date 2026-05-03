/**
 * Shared `L.icon` assets for maps — SVG data URLs; stable anchors at all zoom levels.
 */
import L from 'leaflet'

/**
 * Bundled raster URLs (Vite `?url`) — survives `public/` renames and gets correct hashes in production.
 * Replace files under `src/assets/map-markers/` to update art.
 */
import truckMarkerUrl from '../assets/map-markers/truck.png?url'
import trailer20MarkerUrl from '../assets/map-markers/20ft.png?url'
import trailer53MarkerUrl from '../assets/map-markers/53ft.png?url'

const userLocationTruckImg = truckMarkerUrl
const trailer20ftTopImg = trailer20MarkerUrl
const trailer53ftTopImg = trailer53MarkerUrl

/** Display width for bundled truck PNG (~bridge marker width). */
const USER_MARKER_IMG_W = 52
/** Cab silhouette height at map scale (chip stacks below). */
const USER_MARKER_IMG_H = 56
const RASTER_CHIP_H = 13
const RASTER_CHIP_GAP = 2

/** 20′ trailer column (~same width cap as bridges). */
const TRAILER_20_IMG_W = 52
const TRAILER_20_IMG_H = Math.round(TRAILER_20_IMG_W * (118 / 72))
/** 53′ trailer — taller column, same width cap. */
const TRAILER_53_IMG_W = 52
const TRAILER_53_IMG_H = Math.round(TRAILER_53_IMG_W * (248 / 76))

/** Real-world trailer dimensions in meters (length × width). */
const TRAILER_20FT_LENGTH_M = 6.1
const TRAILER_20FT_WIDTH_M = 2.44
const TRAILER_53FT_LENGTH_M = 16.15
const TRAILER_53FT_WIDTH_M = 2.6
/** Truck dimensions — same as 20ft trailer for consistent scaling. */
const TRUCK_LENGTH_M = TRAILER_20FT_LENGTH_M
const TRUCK_WIDTH_M = TRAILER_20FT_WIDTH_M

/**
 * Calculate meters per pixel at a given latitude and zoom level.
 * Based on Web Mercator projection (EPSG:3857).
 * @param {number} lat - Latitude in degrees
 * @param {number} zoom - Leaflet zoom level
 * @returns {number} meters per pixel
 */
export function metersPerPixel(lat, zoom) {
  const earthCircumference = 40075016.686
  const latRad = lat * Math.PI / 180
  return (earthCircumference * Math.cos(latRad)) / Math.pow(2, zoom + 8)
}

/**
 * Convert meters to pixels at a given latitude and zoom.
 * @param {number} meters - Real-world distance in meters
 * @param {number} lat - Latitude in degrees
 * @param {number} zoom - Leaflet zoom level
 * @returns {number} pixels
 */
export function metersToPixels(meters, lat, zoom) {
  const mpp = metersPerPixel(lat, zoom)
  return meters / mpp
}

/**
 * Get geo-scaled dimensions for a 20ft trailer at given lat/zoom.
 * @param {number} lat
 * @param {number} zoom
 * @param {{ minWidth?: number, maxWidth?: number }} [opts]
 * @returns {{ width: number, height: number }}
 */
export function getTrailer20ftGeoSize(lat, zoom, opts = {}) {
  const { minWidth = 16, maxWidth = 200 } = opts
  const widthPx = metersToPixels(TRAILER_20FT_WIDTH_M, lat, zoom)
  const lengthPx = metersToPixels(TRAILER_20FT_LENGTH_M, lat, zoom)
  const clampedW = Math.max(minWidth, Math.min(maxWidth, Math.round(widthPx)))
  const aspectRatio = TRAILER_20FT_LENGTH_M / TRAILER_20FT_WIDTH_M
  const clampedH = Math.round(clampedW * aspectRatio)
  return { width: clampedW, height: clampedH }
}

/**
 * Get geo-scaled dimensions for a 53ft trailer at given lat/zoom.
 * @param {number} lat
 * @param {number} zoom
 * @param {{ minWidth?: number, maxWidth?: number }} [opts]
 * @returns {{ width: number, height: number }}
 */
export function getTrailer53ftGeoSize(lat, zoom, opts = {}) {
  const { minWidth = 16, maxWidth = 200 } = opts
  const widthPx = metersToPixels(TRAILER_53FT_WIDTH_M, lat, zoom)
  const lengthPx = metersToPixels(TRAILER_53FT_LENGTH_M, lat, zoom)
  const clampedW = Math.max(minWidth, Math.min(maxWidth, Math.round(widthPx)))
  const aspectRatio = TRAILER_53FT_LENGTH_M / TRAILER_53FT_WIDTH_M
  const clampedH = Math.round(clampedW * aspectRatio)
  return { width: clampedW, height: clampedH }
}

/**
 * Get geo-scaled dimensions for a truck at given lat/zoom.
 * @param {number} lat
 * @param {number} zoom
 * @param {{ minWidth?: number, maxWidth?: number }} [opts]
 * @returns {{ width: number, height: number }}
 */
export function getTruckGeoSize(lat, zoom, opts = {}) {
  const { minWidth = 16, maxWidth = 160 } = opts
  const widthPx = metersToPixels(TRUCK_WIDTH_M, lat, zoom)
  const lengthPx = metersToPixels(TRUCK_LENGTH_M, lat, zoom)
  const clampedW = Math.max(minWidth, Math.min(maxWidth, Math.round(widthPx)))
  const aspectRatio = TRUCK_LENGTH_M / TRUCK_WIDTH_M
  const clampedH = Math.round(clampedW * aspectRatio)
  return { width: clampedW, height: clampedH }
}

/** @param {string} svg */
function svgDataUrl(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`
}

/** Escape text for SVG `<text>` nodes. */
function escapeSvgText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Escape plain text for HTML marker chips. */
function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape double-quoted HTML attribute values (e.g. img src). */
function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Short label for marker chips (keep readable at ~7px font).
 * @param {string} raw
 */
function directoryMarkerIdLabel(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.length <= 7) return s
  return `${s.slice(0, 6)}…`
}

/**
 * Raster marker: image on top + optional ID chip below (matches directory / bridge pin labeling).
 * @param {string} rasterHref
 * @param {{ vw: number, vh: number, chipH?: number }} layout vw/vh = total marker box (anchor bottom-center).
 * @param {string} labelRaw
 * @param {string} rootClass extra class on root div
 * @param {string} [chipClass] extra class on chip (e.g. purple tractor label)
 */
function rasterMarkerDivIconBottomChip(
  rasterHref,
  layout,
  labelRaw = '',
  rootClass = '',
  chipClass = '',
) {
  const { vw, vh, chipH = RASTER_CHIP_H } = layout
  const raw = String(labelRaw ?? '')
    .trim()
    .replace(/^#/, '')
  const idRaw = raw ? directoryMarkerIdLabel(raw) : ''
  const fsPx =
    idRaw.length === 0 ? 0 : idRaw.length <= 5 ? 7.5 : idRaw.length <= 7 ? 6.5 : 6
  const chipExtraClass = chipClass ? ` ${chipClass}` : ''
  const chipHtml =
    idRaw !== ''
      ? `<div class="map-marker-raster-chip${chipExtraClass}" style="font-size:${fsPx}px">${escapeHtmlText(
          idRaw,
        )}</div>`
      : ''
  const gap = idRaw !== '' ? RASTER_CHIP_GAP : 0
  const imgBoxH = idRaw !== '' ? Math.max(vh - chipH - gap, 1) : vh
  const extraCls = rootClass ? ` ${rootClass}` : ''
  const html = `<div class="map-marker-raster-root${extraCls}" style="width:${vw}px;height:${vh}px"><img class="map-marker-raster-img" src="${escapeHtmlAttr(
    rasterHref,
  )}" alt="" role="presentation" decoding="async" width="${vw}" height="${imgBoxH}"/>${chipHtml}</div>`
  return L.divIcon({
    html,
    className: 'map-marker-raster-div-icon',
    iconSize: [vw, vh],
    iconAnchor: [Math.round(vw / 2), vh],
    popupAnchor: [0, -Math.round(vh * 0.52)],
  })
}

/**
 * Top-down truck PNG (`src/assets/map-markers/truck.png`).
 * Optional `vehicleId` shows a chip under the cab like bridge / directory markers.
 * @param {string} [vehicleId] tractor / unit number
 */
export function userLocationTruckIcon(vehicleId = '') {
  const vw = USER_MARKER_IMG_W
  const imgH = USER_MARKER_IMG_H
  const chipH = RASTER_CHIP_H
  const gap = RASTER_CHIP_GAP
  const raw = String(vehicleId ?? '').trim()
  const showChip = raw !== '' && directoryMarkerIdLabel(raw) !== ''
  const boxH = showChip ? imgH + chipH + gap : imgH
  return rasterMarkerDivIconBottomChip(
    userLocationTruckImg,
    { vw, vh: boxH, chipH },
    raw,
    'map-marker-raster-root--user-truck',
    'map-marker-raster-chip--tractor',
  )
}

/**
 * Trailer top PNG + optional number chip below image (`src/assets/map-markers/20ft.png` / `53ft.png`).
 * @param {string} rasterHref
 * @param {number} vw
 * @param {number} imgH drawable height for the PNG column (chip stacks below)
 * @param {string} trailerNumber
 */
function trailerTopDivIcon(rasterHref, vw, imgH, trailerNumber = '', pulseClass = '') {
  const chipH = RASTER_CHIP_H
  const gap = RASTER_CHIP_GAP
  const raw = String(trailerNumber ?? '')
    .trim()
    .replace(/^#/, '')
  const labelRaw = raw ? directoryMarkerIdLabel(raw) : ''
  const fsPx =
    labelRaw.length === 0 ? 0 : labelRaw.length <= 5 ? 7.5 : labelRaw.length <= 7 ? 6.5 : 6
  const chipHtml =
    labelRaw !== ''
      ? `<div class="map-marker-raster-chip map-marker-raster-chip--trailer" style="font-size:${fsPx}px">${escapeHtmlText(
          labelRaw,
        )}</div>`
      : ''
  const boxH = labelRaw !== '' ? imgH + chipH + gap : imgH
  const pulse =
    pulseClass && String(pulseClass).trim()
      ? ` ${escapeHtmlAttr(String(pulseClass).trim())}`
      : ''
  const html = `<div class="map-marker-raster-root map-marker-raster-root--trailer${pulse}" style="width:${vw}px;height:${boxH}px"><img class="map-marker-raster-img" src="${escapeHtmlAttr(
    rasterHref,
  )}" alt="" role="presentation" decoding="async" width="${vw}" height="${imgH}"/>${chipHtml}</div>`
  return L.divIcon({
    html,
    className: 'map-marker-raster-div-icon map-marker-raster-div-icon--trailer',
    iconSize: [vw, boxH],
    iconAnchor: [Math.round(vw / 2), boxH],
    popupAnchor: [0, -Math.round(boxH * 0.52)],
  })
}

/**
 * 20′ trailer top PNG + optional number chip (`src/assets/map-markers/20ft.png`).
 * @param {string} [trailerNumber]
 * @param {{ pulseHeavy?: boolean }} [opts]
 */
export function trailer20ftTopIcon(trailerNumber = '', opts = {}) {
  const pulse = opts.pulseHeavy ? 'map-marker-trailer-pulse-heavy' : ''
  return trailerTopDivIcon(trailer20ftTopImg, TRAILER_20_IMG_W, TRAILER_20_IMG_H, trailerNumber, pulse)
}

/**
 * 53′ trailer top PNG + optional number chip (`src/assets/map-markers/53ft.png`).
 * @param {string} [trailerNumber]
 * @param {{ pulseHeavy?: boolean }} [opts]
 */
export function trailer53ftTopIcon(trailerNumber = '', opts = {}) {
  const pulse = opts.pulseHeavy ? 'map-marker-trailer-pulse-heavy' : ''
  return trailerTopDivIcon(trailer53ftTopImg, TRAILER_53_IMG_W, TRAILER_53_IMG_H, trailerNumber, pulse)
}

/**
 * Geo-scaled 20′ trailer icon — size matches real-world dimensions at given lat/zoom.
 * @param {string} [trailerNumber]
 * @param {number} lat - marker latitude
 * @param {number} zoom - current map zoom level
 * @param {{ pulseHeavy?: boolean, minWidth?: number, maxWidth?: number }} [opts]
 */
export function trailer20ftTopIconGeoScaled(trailerNumber = '', lat, zoom, opts = {}) {
  const { pulseHeavy, minWidth, maxWidth } = opts
  const { width, height } = getTrailer20ftGeoSize(lat, zoom, { minWidth, maxWidth })
  const pulse = pulseHeavy ? 'map-marker-trailer-pulse-heavy' : ''
  return trailerTopDivIcon(trailer20ftTopImg, width, height, trailerNumber, pulse)
}

/**
 * Geo-scaled 53′ trailer icon — size matches real-world dimensions at given lat/zoom.
 * @param {string} [trailerNumber]
 * @param {number} lat - marker latitude
 * @param {number} zoom - current map zoom level
 * @param {{ pulseHeavy?: boolean, minWidth?: number, maxWidth?: number }} [opts]
 */
export function trailer53ftTopIconGeoScaled(trailerNumber = '', lat, zoom, opts = {}) {
  const { pulseHeavy, minWidth, maxWidth } = opts
  const { width, height } = getTrailer53ftGeoSize(lat, zoom, { minWidth, maxWidth })
  const pulse = pulseHeavy ? 'map-marker-trailer-pulse-heavy' : ''
  return trailerTopDivIcon(trailer53ftTopImg, width, height, trailerNumber, pulse)
}

/**
 * Geo-scaled truck icon — size matches real-world dimensions at given lat/zoom.
 * @param {string} [vehicleId] tractor / unit number
 * @param {number} lat - marker latitude
 * @param {number} zoom - current map zoom level
 * @param {{ minWidth?: number, maxWidth?: number }} [opts]
 */
export function userLocationTruckIconGeoScaled(vehicleId = '', lat, zoom, opts = {}) {
  const { minWidth, maxWidth } = opts
  const { width, height } = getTruckGeoSize(lat, zoom, { minWidth, maxWidth })
  const chipH = RASTER_CHIP_H
  const gap = RASTER_CHIP_GAP
  const raw = String(vehicleId ?? '').trim()
  const showChip = raw !== '' && directoryMarkerIdLabel(raw) !== ''
  const boxH = showChip ? height + chipH + gap : height
  return rasterMarkerDivIconBottomChip(
    userLocationTruckImg,
    { vw: width, vh: boxH, chipH },
    raw,
    'map-marker-raster-root--user-truck',
    'map-marker-raster-chip--tractor',
  )
}

/**
 * One-word label for bridge map pins (PANYNJ `routeId`).
 * @param {string} routeId
 */
export function bridgeShortLabelForRouteId(routeId) {
  const k = String(routeId ?? '').trim()
  const map = /** @type {Record<string, string>} */ ({
    // Bayonne
    217: 'Bayonne',
    222: 'Bayonne',
    // George Washington (upper deck per direction filter in UI)
    11: 'GW',
    12: 'GW',
    211: 'GW',
    212: 'GW',
    // Goethals
    86: 'Goethals',
    87: 'Goethals',
    // Outerbridge — short label fits marker without ellipsis
    260: 'Outer',
    2520: 'Outer',
  })
  if (k && map[k]) return map[k]
  return ''
}

/**
 * Single token from crossing display name for map pins when routeId is unknown.
 * @param {string} displayName
 */
export function bridgeShortLabelFromDisplayName(displayName) {
  const raw = String(displayName ?? '').trim()
  if (!raw) return ''
  const head = raw.split(/\s*[—–-]\s*/)[0]?.trim() || raw
  const word = head.split(/\s+/)[0] || head
  const cleaned = word.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')
  return cleaned ? cleaned.slice(0, 12) : ''
}

/**
 * @param {string} raw
 */
function bridgeMarkerLabelText(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.length <= 10) return s
  return `${s.slice(0, 9)}…`
}

/**
 * Directory: flat purple office block + ID strip on the facade (no map-pin shield).
 * viewBox 0 0 44 48 — anchor bottom center.
 * @param {boolean} selected
 * @param {string} [locationId]
 */
function directoryBuildingSvg(selected, locationId = '') {
  const strokeRing = selected ? '#faf5ff' : '#e9d5ff'
  const ring = selected
    ? `<rect x="8.5" y="6.5" width="27" height="37" rx="3.5" fill="none" stroke="${strokeRing}" stroke-width="2" opacity="0.95"/>`
    : ''

  const idRaw = directoryMarkerIdLabel(locationId)
  const idEsc = escapeSvgText(idRaw)
  const idBlock =
    idRaw !== ''
      ? `<rect x="11" y="34.5" width="22" height="8.5" rx="1.8" fill="#1e1b4b" stroke="#faf5ff" stroke-opacity="0.35" stroke-width="0.65"/>
  <text x="22" y="39.35" text-anchor="middle" dominant-baseline="central" fill="#faf5ff" font-size="${idRaw.length > 5 ? '6.25' : '7.25'}" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="700">${idEsc}</text>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="48" viewBox="0 0 44 48">
  <defs>
    <linearGradient id="dirBlk" x1="22" y1="8" x2="22" y2="42" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${selected ? '#c4b5fd' : '#a78bfa'}"/>
      <stop offset="55%" stop-color="${selected ? '#7b4db5' : '#6d28d9'}"/>
      <stop offset="100%" stop-color="#4c1d95"/>
    </linearGradient>
    <linearGradient id="dirWin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e1b4b" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  <ellipse cx="22" cy="46" rx="13" ry="2.2" fill="#000" opacity="0.22"/>
  ${ring}
  <rect x="10" y="8" width="24" height="36" rx="3" fill="url(#dirBlk)" stroke="${strokeRing}" stroke-width="1.15"/>
  <rect x="13.5" y="11" width="17" height="20.5" rx="1.2" fill="#faf5ff" fill-opacity="0.1" stroke="#faf5ff" stroke-opacity="0.28" stroke-width="0.75"/>
  <rect x="15.5" y="13.5" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="20.1" y="13.5" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="24.7" y="13.5" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="15.5" y="18.8" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="20.1" y="18.8" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="24.7" y="18.8" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="15.5" y="24.1" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="20.1" y="24.1" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <rect x="24.7" y="24.1" width="3.8" height="3.2" rx="0.45" fill="url(#dirWin)"/>
  <path d="M18.5 29.2h7v3.8h-7z" fill="#312e81"/>
  <circle cx="22" cy="31.2" r="0.75" fill="#faf5ff" fill-opacity="0.72"/>
  ${idBlock}
</svg>`
}

/**
 * @param {boolean} selected
 * @param {string} [locationId]
 */
export function directoryBuildingIcon(selected, locationId = '') {
  return L.icon({
    iconUrl: svgDataUrl(directoryBuildingSvg(selected, locationId)),
    iconSize: [44, 48],
    iconAnchor: [22, 48],
    popupAnchor: [0, -46],
    className: 'map-marker-img-icon map-marker-img-icon--directory',
  })
}

/**
 * Bridge: twin towers + suspended deck + cables + one-word label strip (readable at small size).
 */
function bridgeSvg(opts) {
  const {
    stroke = '#c4b5fd',
    tower = '#4338ca',
    deck = '#312e81',
    glow = '#a78bfa',
    dim = false,
    selected = false,
    shortLabel = '',
  } = opts
  const op = dim ? 0.5 : 1
  const selRing = selected
    ? `<ellipse cx="26" cy="15" rx="17.5" ry="11.5" fill="none" stroke="${glow}" stroke-width="2" opacity="0.92"/>`
    : ''

  const labelRaw = bridgeMarkerLabelText(shortLabel)
  const labelEsc = escapeSvgText(labelRaw)
  const fs =
    labelRaw.length === 0 ? '0' : labelRaw.length <= 3 ? '8.5' : labelRaw.length <= 7 ? '7.25' : '6.35'
  const labelBlock =
    labelRaw !== ''
      ? `<rect x="5" y="49.5" width="42" height="10.5" rx="2.2" fill="#0f172a" fill-opacity="0.92" stroke="${stroke}" stroke-opacity="0.55" stroke-width="0.75"/>
  <text x="26" y="54.85" text-anchor="middle" dominant-baseline="central" fill="#f5f3ff" font-size="${fs}" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800">${labelEsc}</text>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="62" viewBox="0 0 52 62" opacity="${op}">
  <defs>
    <linearGradient id="brTower" x1="26" y1="10" x2="26" y2="36">
      <stop offset="0%" stop-color="${tower}"/>
      <stop offset="100%" stop-color="${deck}"/>
    </linearGradient>
  </defs>
  <ellipse cx="26" cy="57.5" rx="12" ry="3" fill="#000" opacity="0.18"/>
  ${selRing}
  <rect x="9" y="14" width="5.5" height="22" rx="1.2" fill="url(#brTower)" stroke="${stroke}" stroke-width="1.15"/>
  <rect x="37.5" y="14" width="5.5" height="22" rx="1.2" fill="url(#brTower)" stroke="${stroke}" stroke-width="1.15"/>
  <path d="M6 33h40v6H6z" fill="${deck}" stroke="${stroke}" stroke-width="1.25"/>
  <path d="M11 14 Q26 26 41 14" fill="none" stroke="${stroke}" stroke-width="1.35" stroke-linecap="round" opacity="0.88"/>
  <path d="M11 17 Q26 27 41 17" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
  <line x1="9" y1="36" x2="43" y2="36" stroke="${stroke}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="2.5 2"/>
  ${labelBlock}
</svg>`
}

/**
 * @param {object} p
 * @param {'worse' | 'better' | 'neutral' | 'unk'} p.trendKey
 * @param {boolean} [p.isPick]
 * @param {boolean} [p.isClosed]
 * @param {boolean} [p.selected]
 * @param {string} [p.shortLabel] one-word (or short) name on the marker
 * @param {'green' | 'orange' | 'red'} [p.delayTier] crossing-time severity (overrides trend palette when set)
 */
export function bridgesCrossingIcon(p) {
  const tk = p.trendKey || 'unk'
  let stroke = '#c4b5fd'
  let tower = '#5b21b6'
  let deck = '#4c1d95'
  let glow = '#c4b5fd'
  if (p.isClosed) {
    stroke = '#94a3b8'
    tower = '#475569'
    deck = '#334155'
    glow = '#64748b'
  } else if (p.delayTier === 'green') {
    stroke = '#86efac'
    tower = '#15803d'
    deck = '#166534'
    glow = '#4ade80'
  } else if (p.delayTier === 'orange') {
    stroke = '#fdba74'
    tower = '#c2410c'
    deck = '#9a3412'
    glow = '#fb923c'
  } else if (p.delayTier === 'red') {
    stroke = '#fca5a5'
    tower = '#991b1b'
    deck = '#7f1d1d'
    glow = '#f87171'
  } else if (p.isPick) {
    stroke = '#6ee7b7'
    tower = '#059669'
    deck = '#065f46'
    glow = '#34d399'
  } else if (tk === 'worse') {
    stroke = '#fca5a5'
    tower = '#991b1b'
    deck = '#7f1d1d'
    glow = '#f87171'
  } else if (tk === 'better') {
    stroke = '#86efac'
    tower = '#15803d'
    deck = '#166534'
    glow = '#4ade80'
  } else if (tk === 'neutral') {
    stroke = '#fde68a'
    tower = '#a16207'
    deck = '#854d0e'
    glow = '#fbbf24'
  }

  return L.icon({
    iconUrl: svgDataUrl(
      bridgeSvg({
        stroke,
        tower,
        deck,
        glow,
        dim: !!p.isClosed,
        selected: !!p.selected,
        shortLabel: p.shortLabel || '',
      }),
    ),
    iconSize: [52, 62],
    iconAnchor: [26, 60],
    popupAnchor: [0, -54],
    className: 'map-marker-img-icon map-marker-img-icon--bridge',
  })
}

/** Semi-trailer pin — fallback when trailer size is unknown / not 20′ or 53′ */
function trailerSemiSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
  <defs>
    <linearGradient id="trlPinG" x1="28" y1="4" x2="28" y2="52">
      <stop offset="0%" stop-color="#fb923c"/>
      <stop offset="45%" stop-color="#ea580c"/>
      <stop offset="100%" stop-color="#9a3412"/>
    </linearGradient>
    <linearGradient id="trlCabG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fdba74"/>
      <stop offset="100%" stop-color="#ea580c"/>
    </linearGradient>
  </defs>
  <ellipse cx="28" cy="53" rx="13" ry="3" fill="#000" opacity="0.22"/>
  <path d="M28 4c-1.2 0-2.3.4-3.2 1.1L11.5 15.8c-1.9 1.6-3 4-3 6.5v11c0 10 12 23 17.8 27 .9.7 2.1.7 3 0 5.8-4 17.8-17 17.8-27v-11c0-2.5-1.1-4.9-3-6.5L31.2 5.1c-.9-.7-2-1.1-3.2-1.1z" fill="url(#trlPinG)" stroke="#fff7ed" stroke-width="1.15"/>
  <rect x="13" y="17" width="28" height="13" rx="1.2" fill="#fff7ed" stroke="#c2410c" stroke-width="1"/>
  <rect x="15" y="19" width="24" height="3.5" rx="0.6" fill="#ea580c" opacity="0.45"/>
  <path d="M13 24 L9 28v8h7v-11l4-4z" fill="url(#trlCabG)" stroke="#9a3412" stroke-width="0.9"/>
  <rect x="8.5" y="28.5" width="4" height="3.5" rx="0.5" fill="#0f172a" opacity="0.9"/>
  <circle cx="17.5" cy="34.5" r="4" fill="#1e293b" stroke="#f8fafc" stroke-width="1.3"/>
  <circle cx="17.5" cy="34.5" r="1.8" fill="#475569"/>
  <circle cx="38.5" cy="34.5" r="4" fill="#1e293b" stroke="#f8fafc" stroke-width="1.3"/>
  <circle cx="38.5" cy="34.5" r="1.8" fill="#475569"/>
  <line x1="15" y1="23.5" x2="39" y2="23.5" stroke="#c2410c" stroke-width="1" opacity="0.65"/>
</svg>`
}

export function trailerFallbackPinIcon() {
  return L.icon({
    iconUrl: svgDataUrl(trailerSemiSvg()),
    iconSize: [56, 56],
    iconAnchor: [28, 56],
    popupAnchor: [0, -50],
    className: 'map-marker-img-icon map-marker-img-icon--trailer',
  })
}

/** Modal / preview — polished purple location pin */
function mapPinPreviewSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48">
  <defs>
    <linearGradient id="mpvG" x1="20" y1="2" x2="20" y2="44">
      <stop offset="0%" stop-color="#ddd6fe"/>
      <stop offset="100%" stop-color="#6d28d9"/>
    </linearGradient>
  </defs>
  <ellipse cx="20" cy="45" rx="10" ry="2.8" fill="#000" opacity="0.17"/>
  <path d="M20 2.5c-1.1 0-2 .4-2.8 1L6 13.5c-1.6 1.3-2.5 3.2-2.5 5.2v9.5c0 8 9.5 19 14.5 22.8.7.5 1.6.5 2.3 0 5-3.8 14.5-14.8 14.5-22.8v-9.5c0-2-0.9-3.9-2.5-5.2L22.8 3.5c-.8-.6-1.7-1-2.8-1z" fill="url(#mpvG)" stroke="#faf5ff" stroke-width="1.1"/>
  <circle cx="20" cy="18" r="6" fill="#faf5ff" fill-opacity="0.92"/>
  <circle cx="20" cy="18" r="3.2" fill="#7b4db5"/>
</svg>`
}

export function mapPinPreviewIcon() {
  return L.icon({
    iconUrl: svgDataUrl(mapPinPreviewSvg()),
    iconSize: [40, 48],
    iconAnchor: [20, 48],
    popupAnchor: [0, -44],
    className: 'map-marker-img-icon map-marker-img-icon--preview',
  })
}
