#!/usr/bin/env python3
"""
Turn exported RGB marker PNGs into RGBA by clearing background pixels connected
to the image border (same luminance as corners within tolerance).

Run from repo root after replacing masters:
  python3 scripts/process-map-marker-pngs.py

Reads/writes:
  src/assets/map-markers/{truck,20ft,53ft}.png
  public/{truck,20ft,53ft}.png (if present)
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FILES = ("truck.png", "20ft.png", "53ft.png")


def corner_avg_rgb(im_rgb: Image.Image) -> tuple[int, int, int]:
    w, h = im_rgb.size
    px = im_rgb.load()
    samples = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    r = sum(p[0] for p in samples) // 4
    g = sum(p[1] for p in samples) // 4
    b = sum(p[2] for p in samples) // 4
    return (r, g, b)


def flood_transparent(rgb_im: Image.Image, tol: int = 42) -> Image.Image:
    w, h = rgb_im.size
    px_in = rgb_im.load()
    bg = corner_avg_rgb(rgb_im)
    out = Image.new("RGBA", (w, h))
    px_out = out.load()

    br, bg_, bb = bg

    def close_bg(c: tuple[int, int, int]) -> bool:
        r, g, b = c
        return max(abs(r - br), abs(g - bg_), abs(b - bb)) <= tol

    for y in range(h):
        for x in range(w):
            px_out[x, y] = (*px_in[x, y], 255)

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def push(x: int, y: int) -> None:
        if x < 0 or x >= w or y < 0 or y >= h:
            return
        if visited[y][x]:
            return
        if not close_bg(px_in[x, y]):
            return
        visited[y][x] = True
        q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        px_out[x, y] = (*px_in[x, y], 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if nx < 0 or nx >= w or ny < 0 or ny >= h:
                continue
            if visited[ny][nx]:
                continue
            if not close_bg(px_in[nx, ny]):
                continue
            visited[ny][nx] = True
            q.append((nx, ny))

    return out


def main() -> None:
    for name in FILES:
        src = ROOT / "src/assets/map-markers" / name
        if not src.is_file():
            print(f"skip missing {src}")
            continue
        im = Image.open(src).convert("RGB")
        rgba = flood_transparent(im)
        rgba.save(src, "PNG", optimize=True)
        pub = ROOT / "public" / name
        if pub.parent.is_dir():
            rgba.save(pub, "PNG", optimize=True)
        flat = list(rgba.get_flattened_data())
        trans = sum(1 for px in flat if px[3] == 0)
        print(f"{name}: {100 * trans / len(flat):.1f}% transparent")


if __name__ == "__main__":
    main()
