/**
 * Shared `L.icon` assets for maps — SVG data URLs; stable anchors at all zoom levels.
 */
import L from 'leaflet'

/** @param {string} svg */
function svgDataUrl(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`
}

/**
 * Directory: purple gradient pin + glass office tower (windows + door).
 * viewBox 0 0 48 56 — anchor bottom center.
 */
function directoryBuildingSvg(selected) {
  const strokeRing = selected ? '#faf5ff' : '#e9d5ff'
  const ring = selected
    ? `<circle cx="24" cy="17" r="15.5" fill="none" stroke="${strokeRing}" stroke-width="2.5" opacity="0.95"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
  <defs>
    <linearGradient id="dirPin" x1="24" y1="4" x2="24" y2="46" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${selected ? '#c4b5fd' : '#a78bfa'}"/>
      <stop offset="55%" stop-color="${selected ? '#7b4db5' : '#6d28d9'}"/>
      <stop offset="100%" stop-color="#4c1d95"/>
    </linearGradient>
    <linearGradient id="dirWin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e1b4b" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.98"/>
    </linearGradient>
  </defs>
  <ellipse cx="24" cy="52" rx="11" ry="3" fill="#000" opacity="0.2"/>
  ${ring}
  <path d="M24 3.5c-1.2 0-2.3.4-3.2 1.1L8 15.2c-1.8 1.5-2.8 3.8-2.8 6.1V29c0 9.5 11 22.2 17.5 26.8.8.6 1.9.6 2.7 0C31.8 51.2 42.8 38.5 42.8 29V21.3c0-2.3-1-4.6-2.8-6.1L27.2 4.6c-.9-.7-2-1.1-3.2-1.1z" fill="url(#dirPin)" stroke="${strokeRing}" stroke-width="1.2"/>
  <rect x="14" y="15" width="20" height="22" rx="1.5" fill="#faf5ff" fill-opacity="0.12" stroke="#faf5ff" stroke-opacity="0.35" stroke-width="0.85"/>
  <rect x="16.5" y="17.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="21.75" y="17.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="27" y="17.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="16.5" y="23.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="21.75" y="23.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="27" y="23.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="16.5" y="29.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="21.75" y="29.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <rect x="27" y="29.5" width="4.5" height="3.8" rx="0.55" fill="url(#dirWin)"/>
  <path d="M20.5 35.5h7v4.5h-7z" fill="#312e81"/>
  <circle cx="24" cy="37.8" r="0.9" fill="#faf5ff" fill-opacity="0.7"/>
</svg>`
}

/**
 * @param {boolean} selected
 */
export function directoryBuildingIcon(selected) {
  return L.icon({
    iconUrl: svgDataUrl(directoryBuildingSvg(selected)),
    iconSize: [48, 56],
    iconAnchor: [24, 56],
    popupAnchor: [0, -52],
    className: 'map-marker-img-icon map-marker-img-icon--directory',
  })
}

/**
 * Bridge: twin towers + suspended deck + cables (readable at small size).
 */
function bridgeSvg(opts) {
  const {
    stroke = '#c4b5fd',
    tower = '#4338ca',
    deck = '#312e81',
    glow = '#a78bfa',
    dim = false,
    selected = false,
  } = opts
  const op = dim ? 0.5 : 1
  const selRing = selected
    ? `<ellipse cx="26" cy="15" rx="17.5" ry="11.5" fill="none" stroke="${glow}" stroke-width="2" opacity="0.92"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="54" viewBox="0 0 52 54" opacity="${op}">
  <defs>
    <linearGradient id="brTower" x1="26" y1="10" x2="26" y2="36">
      <stop offset="0%" stop-color="${tower}"/>
      <stop offset="100%" stop-color="${deck}"/>
    </linearGradient>
  </defs>
  <ellipse cx="26" cy="50" rx="12" ry="3" fill="#000" opacity="0.18"/>
  ${selRing}
  <rect x="9" y="14" width="5.5" height="22" rx="1.2" fill="url(#brTower)" stroke="${stroke}" stroke-width="1.15"/>
  <rect x="37.5" y="14" width="5.5" height="22" rx="1.2" fill="url(#brTower)" stroke="${stroke}" stroke-width="1.15"/>
  <path d="M6 33h40v6H6z" fill="${deck}" stroke="${stroke}" stroke-width="1.25"/>
  <path d="M11 14 Q26 26 41 14" fill="none" stroke="${stroke}" stroke-width="1.35" stroke-linecap="round" opacity="0.88"/>
  <path d="M11 17 Q26 27 41 17" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="round" opacity="0.5"/>
  <line x1="9" y1="36" x2="43" y2="36" stroke="${stroke}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="2.5 2"/>
  <circle cx="26" cy="46" r="3.5" fill="${deck}" stroke="${stroke}" stroke-width="1.1"/>
</svg>`
}

/**
 * @param {object} p
 * @param {'worse' | 'better' | 'neutral' | 'unk'} p.trendKey
 * @param {boolean} [p.isPick]
 * @param {boolean} [p.isClosed]
 * @param {boolean} [p.selected]
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
      }),
    ),
    iconSize: [52, 54],
    iconAnchor: [26, 52],
    popupAnchor: [0, -46],
    className: 'map-marker-img-icon map-marker-img-icon--bridge',
  })
}

/** Semi-trailer (tractor + van + wheels) inside orange pin — linehaul asset */
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

export function trailerAssetIcon() {
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
