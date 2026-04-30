# Map marker raster assets

Truck and trailer top-view markers load PNGs **bundled by Vite** from `src/assets/map-markers/` (`import … ?url` in `src/utils/mapMarkers.js`). Production builds get hashed URLs; **always edit the copies under `src/assets/map-markers/`** so the map picks them up.

| File | Purpose |
|------|---------|
| `src/assets/map-markers/truck.png` | Top-down tractor — **your GPS dot** (`divIcon`, transparent PNG) |
| `src/assets/map-markers/20ft.png` | Top-down **20′** van — optional trailer **number chip below** the image |
| `src/assets/map-markers/53ft.png` | Top-down **53′** van — same chip pattern |

The tractor/unit ID chip under the truck comes from **`linehaulTractorBody.tractorNbr`** when available (Bridges, Directory, Login ack map, trailer GPS modal).

`public/original-*.png` are optional backups of the large transparent masters; **`public/truck.png` / `20ft.png` / `53ft.png`** are synced for convenience only — the SPA uses the bundled paths above.

Use **real alpha transparency** in these PNGs (not a checkerboard baked into pixels).

Non–20′/53′ trailers use the orange SVG pin (`trailerFallbackPinIcon`).
