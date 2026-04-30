# Map marker raster assets

Leaflet “my location” and 20′ trailer markers load PNGs from `src/assets/map-markers/`:

| File | Purpose |
|------|---------|
| `user-location-truck.png` | Top-down tractor cab — **your GPS dot** on Directory, Bridges, Trailer map, LoginAck preview |
| `trailer-53ft-top.png` | Top-down **53′** van — when trip size is **53ft**; same number chip as 20′ |

Replace these files with your transparent PNGs (same filenames). Prefer dimensions similar to the placeholders (~96×112 truck, ~72×118 trailer body) so anchors stay reasonable; if you resize a lot, tweak `iconAnchor` in `src/utils/mapMarkers.js` (`userLocationTruckIcon`, `trailer20ftTopIcon`).

Non–20′/53′ trailers use the orange SVG pin (`trailerFallbackPinIcon`).
