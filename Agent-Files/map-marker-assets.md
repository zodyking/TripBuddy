# Map marker raster assets

Truck and trailer top-view markers load PNGs **bundled by Vite** from `src/assets/map-markers/` (`import … ?url` in `src/utils/mapMarkers.js`). That way production builds get stable hashed URLs and renaming files under `public/` cannot break the map.

| File | Purpose |
|------|---------|
| `src/assets/map-markers/truck.png` | Top-down tractor — **your GPS dot** (`L.icon`) |
| `src/assets/map-markers/20ft.png` | Top-down **20′** van — `divIcon` + `<img>` + optional chip |
| `src/assets/map-markers/53ft.png` | Top-down **53′** van — same pattern |

`public/truck.png` is kept as a convenience copy for non-bundled references; **the app reads the copies under `src/assets/map-markers/`**.

Replace those three files to update art. If dimensions change a lot, tweak `iconAnchor` / layout in `mapMarkers.js`.

Non–20′/53′ trailers use the orange SVG pin (`trailerFallbackPinIcon`).
