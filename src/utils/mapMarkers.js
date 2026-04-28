/**
 * Shared `L.icon` assets for maps — raster Leaflet icons anchor correctly at zoom (no HTML drift).
 */
import L from 'leaflet'

/** @param {string} svg */
function svgDataUrl(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`
}

/** Purple office / directory pin — tip at bottom center of viewBox 0 0 36 48 */
function directoryBuildingSvg(selected) {
  const ring = selected
    ? '<circle cx="18" cy="15" r="13" fill="none" stroke="#faf5ff" stroke-width="2" opacity="0.95"/>'
    : ''
  const body = selected ? '#a78bfa' : '#7b4db5'
  const roof = selected ? '#ddd6fe' : '#c4b5fd'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
${ring}
<path d="M18 2L4 12v14c0 8 14 20 14 20s14-12 14-20V12L18 2z" fill="${body}" stroke="#faf5ff" stroke-width="1.2"/>
<rect x="10" y="16" width="16" height="10" rx="1" fill="${roof}" opacity="0.95"/>
<rect x="12" y="19" width="3" height="3" rx="0.4" fill="${body}"/>
<rect x="16.5" y="19" width="3" height="3" rx="0.4" fill="${body}"/>
<rect x="21" y="19" width="3" height="3" rx="0.4" fill="${body}"/>
</svg>`
}

/**
 * @param {boolean} selected
 */
export function directoryBuildingIcon(selected) {
  return L.icon({
    iconUrl: svgDataUrl(directoryBuildingSvg(selected)),
    iconSize: [36, 48],
    iconAnchor: [18, 48],
    popupAnchor: [0, -46],
    className: 'map-marker-img-icon',
  })
}

/** Bridge silhouette — viewBox 0 0 40 44, anchor bottom ~center */
function bridgeSvg(opts) {
  const {
    stroke = '#c4b5fd',
    fill = '#2e1065',
    glow = '#a78bfa',
    dim = false,
    selected = false,
  } = opts
  const op = dim ? 0.55 : 1
  const selRing = selected
    ? `<ellipse cx="20" cy="14" rx="17" ry="11" fill="none" stroke="${glow}" stroke-width="2" opacity="0.95"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="44" viewBox="0 0 40 44" opacity="${op}">
${selRing}
<path d="M4 28c6-10 26-10 32 0v6H4v-6z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
<path d="M8 28c5-7 19-7 24 0" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/>
<path d="M12 22v10M20 18v14M28 22v10" stroke="${stroke}" stroke-width="1.2" stroke-linecap="round" opacity="0.85"/>
<circle cx="20" cy="38" r="3" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
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
  let stroke = '#a78bfa'
  let fill = '#3b0764'
  let glow = '#c4b5fd'
  if (p.isClosed) {
    stroke = '#64748b'
    fill = '#1e293b'
    glow = '#94a3b8'
  } else if (p.isPick) {
    stroke = '#6ee7b7'
    fill = '#064e3b'
    glow = '#34d399'
  } else if (tk === 'worse') {
    stroke = '#fca5a5'
    fill = '#450a0a'
    glow = '#f87171'
  } else if (tk === 'better') {
    stroke = '#86efac'
    fill = '#052e16'
    glow = '#34d399'
  } else if (tk === 'neutral') {
    stroke = '#fde68a'
    fill = '#422006'
    glow = '#fbbf24'
  }

  return L.icon({
    iconUrl: svgDataUrl(
      bridgeSvg({
        stroke,
        fill,
        glow,
        dim: !!p.isClosed,
        selected: !!p.selected,
      }),
    ),
    iconSize: [40, 44],
    iconAnchor: [20, 44],
    popupAnchor: [0, -40],
    className: 'map-marker-img-icon',
  })
}

/** Orange trailer / asset pin for TrailerLocationMap */
export function trailerAssetIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
<path d="M18 2L4 12v14c0 8 14 20 14 20s14-12 14-20V12L18 2z" fill="#ea580c" stroke="#fff7ed" stroke-width="1.2"/>
<rect x="8" y="14" width="20" height="12" rx="1.5" fill="#fff7ed" opacity="0.95"/>
<circle cx="13" cy="30" r="3.5" fill="#1e293b" stroke="#fff" stroke-width="1"/>
<circle cx="23" cy="30" r="3.5" fill="#1e293b" stroke="#fff" stroke-width="1"/>
<rect x="10" y="16" width="8" height="6" rx="0.5" fill="#c2410c"/>
</svg>`
  return L.icon({
    iconUrl: svgDataUrl(svg),
    iconSize: [36, 48],
    iconAnchor: [18, 48],
    popupAnchor: [0, -44],
    className: 'map-marker-img-icon',
  })
}

/** Modal / preview — compact purple dot replacement */
export function mapPinPreviewIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
<path d="M14 1L3 9v11c0 6 11 15 11 15s11-9 11-15V9L14 1z" fill="#7b4db5" stroke="#ddd6fe" stroke-width="1.2"/>
<circle cx="14" cy="12" r="4" fill="#ddd6fe"/>
</svg>`
  return L.icon({
    iconUrl: svgDataUrl(svg),
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -34],
    className: 'map-marker-img-icon',
  })
}
