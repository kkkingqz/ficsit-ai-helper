#!/usr/bin/env python3
"""Node icons from the concept sheets ("2D иконка (UI / карта)" panel): the cyan pictogram is cut out of the orange
selection frame, cleaned (threshold on an upscaled copy -> smooth anti-aliased edges), recoloured flat and written as
transparent PNGs. The orange frame and the tier bars are UI state, not part of the icon: the widget draws them.

    python3 tools/make_icons.py [--out icons]

Writes per tier: T_Node_<Asset>_T<n>_Icon_{512,256,128,64}.png and a contact sheet icons/_preview.png.
Needs Pillow + numpy.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
FRAME_INNER = (1284, 206, 1490, 402)     # inside the orange frame on the 1536 x 1024 concept sheets
UP = 4                                   # supersampling before the threshold
TOP, BOTTOM = (178, 240, 255), (96, 206, 250)   # flat fill with a slight vertical gradient (concept icon colours)


def pictogram_mask(sheet):
    im = Image.open(sheet).convert("RGB").crop(FRAME_INNER)
    im = im.resize((im.width * UP, im.height * UP), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # pictogram = light cyan (G and B high); the navy background (G, B < 40) and the orange frame (R > B) drop out
    cyan = np.clip((np.minimum(g, b) - 90) / 70.0, 0, 1) * (b > r + 10)
    m = Image.fromarray((cyan * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(UP * 0.6))
    m = np.asarray(m).astype(np.float32) / 255.0
    m = np.clip((m - 0.42) / 0.16, 0, 1)                       # smoothstep-ish threshold -> clean edges
    keep = _largest_parts(m > 0.5)
    m = m * keep
    return Image.fromarray((m * 255).astype(np.uint8))


def _largest_parts(binary, min_frac=0.0015):
    """Drop specks (glow noise) smaller than min_frac of the area; keep every real stroke."""
    from collections import deque
    h, w = binary.shape
    seen = np.zeros_like(binary, dtype=bool)
    keep = np.zeros_like(binary, dtype=np.float32)
    limit = min_frac * h * w
    for y0 in range(0, h, 2):
        for x0 in range(0, w, 2):
            if not binary[y0, x0] or seen[y0, x0]:
                continue
            q, comp = deque([(y0, x0)]), []
            seen[y0, x0] = True
            while q:
                y, x = q.popleft()
                comp.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and binary[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True
                        q.append((yy, xx))
            if len(comp) >= limit:
                ys, xs = zip(*comp)
                keep[list(ys), list(xs)] = 1.0
    # re-grow by a few pixels so the anti-aliased fringe of kept strokes survives
    k = Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * UP + 1))
    return np.asarray(k).astype(np.float32) / 255.0


def icon(mask, size, pad=0.08):
    bbox = mask.getbbox()
    m = mask.crop(bbox)
    inner = int(size * (1 - 2 * pad))
    s = inner / max(m.width, m.height)
    m = m.resize((max(1, int(m.width * s)), max(1, int(m.height * s))), Image.LANCZOS)
    grad = Image.new("RGB", m.size)
    d = ImageDraw.Draw(grad)
    for y in range(m.height):
        t = y / max(1, m.height - 1)
        d.line([(0, y), (m.width, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x0, y0 = (size - m.width) // 2, (size - m.height) // 2 + int(size * 0.02)
    # soft glow under the pictogram (alpha only, same hue) - reads on dark screens, invisible on light ones
    glow = Image.new("L", (size, size), 0)
    glow.paste(m, (x0, y0))
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, size * 0.02))).point(lambda v: int(v * 0.45))
    out.paste(Image.new("RGBA", (size, size), (*BOTTOM, 255)), (0, 0), glow)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(grad, (x0, y0), m)
    return Image.alpha_composite(out, layer)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "icons"))
    a = ap.parse_args()
    spec = json.load(open(os.path.join(ROOT, "nodes.json"), encoding="utf-8"))
    os.makedirs(a.out, exist_ok=True)
    sheet_tiles = []
    for key, node in spec["nodes"].items():
        for i, tk in enumerate(node["tiers"]):
            mask = pictogram_mask(os.path.join(ROOT, node["concept"][i]))
            for size in (512, 256, 128, 64):
                p = os.path.join(a.out, f"T_Node_{node['asset']}_T{tk}_Icon_{size}.png")
                icon(mask, size).save(p)
            sheet_tiles.append(os.path.join(a.out, f"T_Node_{node['asset']}_T{tk}_Icon_256.png"))
            print("[icons]", node["asset"], "tier", tk)
    # contact sheet on the terminal background + at small sizes
    bg = (8, 22, 34)
    sheet = Image.new("RGB", (len(sheet_tiles) * 276 + 20, 276 + 100), bg)
    for i, p in enumerate(sheet_tiles):
        im = Image.open(p)
        sheet.paste(im, (20 + i * 276, 20), im)
        for j, s in enumerate((64, 32)):
            sm = im.resize((s, s), Image.LANCZOS)
            sheet.paste(sm, (20 + i * 276 + j * 80, 290), sm)
    sheet.save(os.path.join(a.out, "_preview.png"))


if __name__ == "__main__":
    main()
