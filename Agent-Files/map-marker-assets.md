# Map marker raster assets

Leaflet “my location” and 20′ trailer markers load PNGs from `src/assets/map-markers/`:

| File | Purpose |
|------|---------|
| `user-location-truck.png` | Top-down tractor cab — **your GPS dot** on Directory, Bridges, Trailer map, LoginAck preview |
| `trailer-20ft-top.png` | Top-down 20′ van — trailer pin when trip card size is **20ft**; trailer number chip is drawn in SVG above the image |

Replace these files with your transparent PNGs (same filenames). Prefer dimensions similar to the placeholders (~96×112 truck, ~72×118 trailer body) so anchors stay reasonable; if you resize a lot, tweak `iconAnchor` in `src/utils/mapMarkers.js` (`userLocationTruckIcon`, `trailer20ftTopIcon`).

Non–20′ trailers still use the orange SVG pin (`trailerFallbackPinIcon`).
