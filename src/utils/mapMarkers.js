/**
 * Shared `L.icon` assets for maps — SVG data URLs; stable anchors at all zoom levels.
 */
import L from 'leaflet'

/** Raster markers served from `public/` (Vite base-aware paths). */
const userLocationTruckImg = `${import.meta.env.BASE_URL}truck.png`
const trailer20ftTopImg = `${import.meta.env.BASE_URL}20ft.png`
const trailer53ftTopImg = `${import.meta.env.BASE_URL}53ft.png`

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

/** Safe `href` / `xlink:href` value for embedded raster in SVG. */
function svgRasterHref(url) {
  return String(url ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
}

/**
 * Top-down truck PNG for “my location” (`public/truck.png`).
 * Anchor bottom-center.
 */
export function userLocationTruckIcon() {
  const href = svgRasterHref(userLocationTruckImg)
  const w = 96
  const h = 112
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image href="${href}" xlink:href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>
</svg>`
  return L.icon({
    iconUrl: svgDataUrl(svg),
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
    popupAnchor: [0, -Math.round(h * 0.55)],
    className: 'map-marker-img-icon map-marker-img-icon--user-truck',
  })
}

/**
 * Shared trailer top-view composite (PNG + optional number chip above image).
 * @param {string} rasterHref
 * @param {{ vw: number, vh: number, imgY: number, imgH: number, cls: string }} layout
 * @param {string} trailerNumber
 */
function trailerTopCompositeIcon(rasterHref, layout, trailerNumber = '') {
  const href = svgRasterHref(rasterHref)
  const { vw, vh, imgY, imgH, cls } = layout
  const raw = String(trailerNumber ?? '')
    .trim()
    .replace(/^#/, '')
  const labelRaw = raw ? directoryMarkerIdLabel(raw) : ''
  const labelEsc = escapeSvgText(labelRaw)
  const fs =
    labelRaw.length === 0 ? '0' : labelRaw.length <= 5 ? '7.5' : labelRaw.length <= 7 ? '6.5' : '6'
  const labelBlock =
    labelRaw !== ''
      ? `<rect x="5" y="2" width="${vw - 10}" height="11" rx="2.5" fill="#0f172a" stroke="#e2e8f0" stroke-opacity="0.35" stroke-width="0.6"/>
  <text x="${vw / 2}" y="9.6" text-anchor="middle" dominant-baseline="central" fill="#f8fafc" font-size="${fs}" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800">${labelEsc}</text>`
      : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">
  ${labelBlock}
  <image href="${href}" xlink:href="${href}" x="0" y="${imgY}" width="${vw}" height="${imgH}" preserveAspectRatio="xMidYMid meet"/>
</svg>`
  return L.icon({
    iconUrl: svgDataUrl(svg),
    iconSize: [vw, vh],
    iconAnchor: [Math.round(vw / 2), vh],
    popupAnchor: [0, -Math.round(vh * 0.52)],
    className: `map-marker-img-icon ${cls}`,
  })
}

/**
 * 20′ trailer top PNG + optional number chip (`public/20ft.png`).
 * @param {string} [trailerNumber]
 */
export function trailer20ftTopIcon(trailerNumber = '') {
  return trailerTopCompositeIcon(
    trailer20ftTopImg,
    { vw: 72, vh: 132, imgY: 14, imgH: 118, cls: 'map-marker-img-icon--trailer-20' },
    trailerNumber,
  )
}

/**
 * 53′ trailer top PNG + optional number chip (`public/53ft.png`).
 * @param {string} [trailerNumber]
 */
export function trailer53ftTopIcon(trailerNumber = '') {
  return trailerTopCompositeIcon(
    trailer53ftTopImg,
    { vw: 76, vh: 262, imgY: 14, imgH: 248, cls: 'map-marker-img-icon--trailer-53' },
    trailerNumber,
  )
}

/**
 * Short label for marker (keep readable at ~7px font).
 * @param {string} raw
 */
function directoryMarkerIdLabel(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (s.length <= 7) return s
  return `${s.slice(0, 6)}…`
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
