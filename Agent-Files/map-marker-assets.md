# Map marker raster assets

Truck and trailer top-view markers load PNGs **bundled by Vite** from `src/assets/map-markers/` (`import … ?url` in `src/utils/mapMarkers.js`). Production builds get hashed URLs; **always edit the copies under `src/assets/map-markers/`** so the map picks them up.

| File | Purpose |
|------|---------|
| `src/assets/map-markers/truck.png` | Top-down tractor — **your GPS dot** (`divIcon`, transparent PNG) |
| `src/assets/map-markers/20ft.png` | Top-down **20′** van — optional trailer **number chip below** the image |
| `src/assets/map-markers/53ft.png` | Top-down **53′** van — same chip pattern |

The tractor/unit ID chip under the truck comes from **`linehaulTractorBody.tractorNbr`** when available (Bridges, Directory, Login ack map, trailer GPS modal).

`public/original-*.png` are optional backups of the large transparent masters; **`public/truck.png` / `20ft.png` / `53ft.png`** are synced for convenience only — the SPA uses the bundled paths above.

### Fixing a solid white / gray “plate” behind the art

If exports are **RGB** (no alpha), the browser cannot see through them — you get a big rectangle on the map.

**Best:** Re-export from your editor as **PNG with transparency** (alpha channel), then replace the three files under `src/assets/map-markers/` (and run `npm run build`).

**Quick fix in-repo:** We ship processed PNGs where border-connected background pixels are made transparent via flood-fill from the edges (`scripts/process-map-marker-pngs.py`). After swapping new masters, run:

```bash
python3 scripts/process-map-marker-pngs.py
```

Tune tolerance inside the script if a thin halo remains.

Non–20′/53′ trailers use the orange SVG pin (`trailerFallbackPinIcon`).
