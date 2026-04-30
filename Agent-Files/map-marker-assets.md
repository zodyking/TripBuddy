# Map marker raster assets

Leaflet truck / trailer markers load PNGs from **`public/`**:

| File | Purpose |
|------|---------|
| `truck.png` | Top-down tractor — **your GPS dot** (`L.icon` raster URL, not SVG-wrapped) |
| `20ft.png` | Top-down **20′** van — trailer map (`divIcon` + `<img>` + optional number chip) |
| `53ft.png` | Top-down **53′** van — same chip pattern |

SVG data URLs with embedded `<image href="…png">` often fail to load cross-origin or are blocked for large files; we avoid that for user/trailer rasters.

Replace these files with your transparent PNGs (same filenames). If you resize a lot, tweak anchors in `mapMarkers.js` (`userLocationTruckIcon`, `trailerTopDivIcon` layouts).

Non–20′/53′ trailers use the orange SVG pin (`trailerFallbackPinIcon`).
