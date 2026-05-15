/**
 * Leaflet + leaflet-rotate: follow-my-location UX (center on user, zoom OK, no pan)
 * and optional touch-rotate policy when compass / follow is active.
 */

import { getUserTruckMarkerTransform } from './useCompassOrientation.js'

/**
 * Apply CSS rotation to the truck div inside a Leaflet marker.
 * @param {import('leaflet').Marker | null} marker
 * @param {import('leaflet').Map | null} map
 * @param {number | null} headingDeg - compass heading when in heading-up mode; null for north-up on map
 */
export function applyUserTruckMarkerDomRotation(marker, map, headingDeg) {
  if (!marker || !map) return
  const outer = marker.getElement()
  if (!outer) return
  const inner = outer.querySelector('.map-marker-raster-root') || outer
  const mapBearing = typeof map.getBearing === 'function' ? map.getBearing() : 0
  const t = getUserTruckMarkerTransform(headingDeg, mapBearing)
  inner.style.transformOrigin = 'center center'
  inner.style.transform = t
}

/**
 * @param {import('leaflet').Map | null} map
 * @param {boolean} follow - true: disable drag + keyboard pan only (zoom / pinch still work)
 */
export function setMapFollowInteraction(map, follow) {
  if (!map) return
  try {
    const drag = map.dragging
    if (follow) {
      if (drag?.enabled?.()) drag.disable()
    } else if (drag && !drag.enabled?.()) {
      drag.enable()
    }
  } catch {
    /* non-fatal */
  }

  try {
    const kb = map.keyboard
    if (kb) {
      if (follow) {
        if (kb.enabled?.()) kb.disable()
      } else if (!kb.enabled?.()) {
        kb.enable()
      }
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * @param {import('leaflet').Map | null} map
 * @param {{ follow: boolean, compass: boolean }} state
 */
export function syncMapNavigationGestures(map, state) {
  if (!map) return
  const { follow, compass } = state
  setMapFollowInteraction(map, follow)
  setMapTouchRotateEnabled(map, !compass && !follow)
}

/**
 * Touch-twist map rotation — disable when compass navigation or follow is on
 * so bearing stays predictable and truck icon math matches the map.
 * @param {import('leaflet').Map | null} map
 * @param {boolean} enabled
 */
export function setMapTouchRotateEnabled(map, enabled) {
  if (!map) return
  try {
    // @ts-ignore leaflet-rotate
    const tr = map.touchRotate
    if (!tr) return
    if (enabled && !tr.enabled?.()) tr.enable()
    else if (!enabled && tr.enabled?.()) tr.disable()
  } catch {
    /* non-fatal */
  }
}

/**
 * Center map on a point without changing zoom (follow camera).
 * @param {import('leaflet').Map | null} map
 * @param {import('leaflet').LatLng} ll
 * @param {{ animate?: boolean }} [opts]
 */
export function centerMapOnLatLng(map, ll, opts = {}) {
  if (!map || !ll) return
  const z = map.getZoom()
  const animate = opts.animate === true
  map.setView(ll, z, { animate })
}
