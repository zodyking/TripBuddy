# Map marker raster assets

Leaflet “my location” and trailer top-view markers load PNGs from **`public/`** (base URL–aware in `src/utils/mapMarkers.js`):

| File | Purpose |
|------|---------|
| `truck.png` | Top-down tractor — **your GPS dot** on Directory, Bridges, Trailer map, LoginAck preview |
| `20ft.png` | Top-down **20′** van — trailer location map when size is 20ft |
| `53ft.png` | Top-down **53′** van — when size is 53ft; same number chip as 20′ |

Replace these files with your transparent PNGs (same filenames). Prefer dimensions similar to the current assets so anchors stay reasonable; if you resize a lot, tweak `iconAnchor` in `mapMarkers.js` (`userLocationTruckIcon`, `trailer20ftTopIcon`, `trailer53ftTopIcon`).

Non–20′/53′ trailers use the orange SVG pin (`trailerFallbackPinIcon`).
