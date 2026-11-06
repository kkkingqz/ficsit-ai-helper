"""Stage 5 texture set for SM_CommandCenter (run with the system Python: Pillow + numpy).

    python stage5_textures.py            # writes ../textures/T_CC_*.png

Textures (v1, procedural placeholders with the final layout, so the UVs can be checked and the UE materials built):
  T_CC_DecalAtlas_D   4096x2048  decal atlas (stage5_layout): 8 labels with pictograms, COMMAND CENTER / ENTRY / EXIT
                                 signs, 4 floor stencils, SERVICE / ACCESS / POWER / VENTILATION tags, CC-01 / HP-01 /
                                 CS-3A IDs, numbers 01-04, barcode, HIGH VOLTAGE plate, 9 pictograms (all text English)
  T_CC_ScreenAtlas_E  4096x2048  screen atlas: 12 UIs (16:9: power trend, production queue, site cam, 3 status, assistant
                                 tasks, site map, logistics, maintenance warning, resources, standby) + LED glow strip
  T_CC_Tread_M/_N/_ARW   1024^2  diamond tread plate (floor metal inserts, slot M_MetalTread), 6 cm pitch
  T_CC_Brushed_M/_N      1024^2  brushed metal streaks for M_MetalBare (+ anisotropy in the UE material)
  T_CC_Hazard_D           512^2  yellow-black 45-degree stripes, tiles in U and V (HAZARD_M metres per tile)
  T_CC_MetalDetail_M     1024^2  grey detail / AO multiplier for all tiling metal slots (paint colour comes from the
                                 material parameter = paint-gun colour), tiles (TILE_M metres per tile)
  T_CC_MetalDetail_N     1024^2  matching tangent-space normal map, DirectX convention (green = -Y), as UE expects
  T_CC_MetalDetail_ARW   1024^2  packed, linear: R = ambient occlusion, G = roughness (absolute, painted metal),
                                 B = wear mask (scratches where paint is worn to bare metal)
  T_CC_Macro_M            512^2  very low-frequency variation, linear; sampled at UV / 8 (= 16 m per tile) to break
                                 the 2 m repetition on large panels
  T_CC_UVChecker         1024^2  checker for the UV / texel-density check renders
"""
import os

import numpy as np
from PIL import Image, ImageDraw

import stage5_layout as L
import ui_preview as UP

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "textures")


# ---- decal art (vector-style, drawn at 4x and downsampled; all text English) --------------------------------------
SS = 4
PLATE, EDGE, INK, INK2 = L.rgb("plate_dark"), (78, 86, 98), L.rgb("light_white"), (170, 178, 190)
YEL, ORG, DARK = L.rgb("hazard_yellow"), L.rgb("ficsit_orange"), L.rgb("graphite")


def _canvas(w, h, bg=PLATE):
    im = Image.new("RGB", (w * SS, h * SS), bg)
    return im, ImageDraw.Draw(im)


def _done(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


def _fit(d, txt, size, maxw):
    while size > 10 and d.textlength(txt, font=UP._font(size)) > maxw:
        size -= 4
    return UP._font(size)


def _tri(d, cx, cy, r, fill, outline, wdt):
    pts = [(cx, cy - r), (cx + r * 0.95, cy + r * 0.7), (cx - r * 0.95, cy + r * 0.7)]
    d.polygon(pts, fill=fill)
    d.line(pts + [pts[0]], fill=outline, width=wdt, joint="curve")


def icon(kind, px=256, bg=PLATE):
    im, d = _canvas(px, px, bg)
    c, r = px * SS / 2, px * SS * 0.38
    w = int(px * SS * 0.05)
    if kind == "white":
        return Image.new("RGB", (px, px), (236, 238, 240))
    if kind in ("warn", "electric", "heat"):
        _tri(d, c, c + r * 0.1, r, YEL, DARK, w)
        if kind == "warn":
            d.rectangle((c - w * 0.6, c - r * 0.35, c + w * 0.6, c + r * 0.35), fill=DARK)
            d.ellipse((c - w * 0.8, c + r * 0.48, c + w * 0.8, c + r * 0.48 + w * 1.6), fill=DARK)
        elif kind == "electric":
            d.polygon([(c + r * 0.1, c - r * 0.5), (c - r * 0.3, c + r * 0.1), (c, c + r * 0.1), (c - r * 0.15, c + r * 0.6),
                       (c + r * 0.3, c - r * 0.05), (c, c - r * 0.05)], fill=DARK)
        else:
            for k in (-1, 0, 1):
                x = c + k * r * 0.3
                d.line([(x, c + r * 0.5), (x - r * 0.1, c + r * 0.25), (x + r * 0.1, c), (x - r * 0.05, c - r * 0.25)],
                       fill=DARK, width=int(w * 0.7))
    elif kind == "tools":
        d.line([(c - r * 0.7, c + r * 0.7), (c + r * 0.5, c - r * 0.5)], fill=INK, width=int(w * 1.6))
        d.ellipse((c + r * 0.3, c - r * 0.85, c + r * 0.9, c - r * 0.25), outline=INK, width=int(w * 1.2))
        d.line([(c + r * 0.7, c + r * 0.7), (c - r * 0.3, c - r * 0.3)], fill=ORG, width=int(w * 1.4))
        d.rectangle((c - r * 0.75, c - r * 0.75, c - r * 0.25, c - r * 0.25), fill=ORG)
    elif kind == "fan":
        d.ellipse((c - r, c - r, c + r, c + r), outline=INK, width=w)
        for a in range(3):
            import math as m
            t = a * 2 * m.pi / 3
            d.pieslice((c - r * 0.8, c - r * 0.8, c + r * 0.8, c + r * 0.8), m.degrees(t), m.degrees(t) + 60, fill=ORG)
        d.ellipse((c - r * 0.18, c - r * 0.18, c + r * 0.18, c + r * 0.18), fill=INK)
    elif kind == "data":
        for k in range(3):
            y = c - r * 0.8 + k * r * 0.6
            d.rectangle((c - r * 0.8, y, c + r * 0.8, y + r * 0.45), outline=INK, width=w)
            d.ellipse((c + r * 0.45, y + r * 0.15, c + r * 0.6, y + r * 0.3), fill=L.rgb("ui_blue"))
    elif kind == "chevrons":
        for k in range(3):
            x = c - r * 0.9 + k * r * 0.6
            d.polygon([(x, c - r * 0.6), (x + r * 0.35, c - r * 0.6), (x + r * 0.8, c), (x + r * 0.35, c + r * 0.6),
                       (x, c + r * 0.6), (x + r * 0.45, c)], fill=ORG)
    elif kind == "bracket":
        g = r * 0.35
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = c + sx * r, c + sy * r
                d.line([(x - sx * g, y), (x, y), (x, y - sy * g)], fill=INK, width=w)
        d.line([(c - r * 0.3, c), (c + r * 0.3, c)], fill=INK, width=int(w * 0.6))
        d.line([(c, c - r * 0.3), (c, c + r * 0.3)], fill=INK, width=int(w * 0.6))
    return _done(im, px, px)


def label(lines, kind, w=1024, h=256):
    im, d = _canvas(w, h)
    S = SS
    d.rectangle((6 * S, 6 * S, (w - 6) * S, (h - 6) * S), outline=EDGE, width=6 * S)
    ic = icon(kind, 200, PLATE).resize((200 * S, 200 * S))
    im.paste(ic, (28 * S, 28 * S))
    d.rectangle((244 * S, 34 * S, 254 * S, (h - 34) * S), fill=ORG)
    d.text((280 * S, 40 * S), lines[0], fill=INK, font=_fit(d, lines[0], 84 * S, (w - 320) * S))
    d.text((280 * S, 150 * S), lines[1], fill=INK2, font=_fit(d, lines[1], 58 * S, (w - 320) * S))
    return _done(im, w, h)


def tag(text, w=1024, h=256):
    im, d = _canvas(w, h)
    S = SS
    d.rounded_rectangle((40 * S, 40 * S, (w - 40) * S, (h - 40) * S), radius=24 * S, outline=INK, width=10 * S)
    d.rectangle((70 * S, 80 * S, 90 * S, (h - 80) * S), fill=ORG)
    f = _fit(d, text, 120 * S, (w - 260) * S)
    tw = d.textlength(text, font=f)
    d.text(((w * S - tw) / 2 + 30 * S, 64 * S), text, fill=INK, font=f)
    return _done(im, w, h)


def ident(text, w=1024, h=256):
    im, d = _canvas(w, h)
    S = SS
    d.rectangle((60 * S, 40 * S, (w - 60) * S, (h - 40) * S), outline=ORG, width=12 * S)
    d.polygon([((w - 160) * S, (h - 40) * S), ((w - 60) * S, (h - 140) * S), ((w - 60) * S, (h - 40) * S)], fill=ORG)
    f = _fit(d, text, 150 * S, (w - 300) * S)
    d.text((120 * S, 50 * S), text, fill=INK, font=f)
    return _done(im, w, h)


def number(k, w=1024, h=256):
    im, d = _canvas(w, h)
    S = SS
    txt = f"{k:02d}"
    f = UP._font(170 * S)
    tw = d.textlength(txt, font=f)
    d.text(((w * S - tw) / 2, 20 * S), txt, fill=INK, font=f)
    d.rectangle(((w * S - tw) / 2, 210 * S, (w * S + tw) / 2, 226 * S), fill=ORG)
    return _done(im, w, h)


def barcode(w=1024, h=256, seed=3):
    rng = np.random.default_rng(seed)
    im, d = _canvas(w, h)
    S = SS
    x = 60 * S
    while x < (w - 300) * S:
        bw = int(rng.choice((3, 5, 8))) * S
        d.rectangle((x, 40 * S, x + bw, 190 * S), fill=INK)
        x += bw + int(rng.choice((3, 5, 7))) * S
    d.text((60 * S, 196 * S), "SN 0447-CC01-2287", fill=INK2, font=UP._font(40 * S))
    d.text(((w - 260) * S, 70 * S), "CC-01", fill=INK, font=UP._font(80 * S))
    return _done(im, w, h)


def high_voltage(w=1024, h=256):
    im, d = _canvas(w, h, YEL)
    S = SS
    d.rectangle((10 * S, 10 * S, (w - 10) * S, (h - 10) * S), outline=DARK, width=10 * S)
    ic = icon("electric", 200, YEL).resize((200 * S, 200 * S))
    im.paste(ic, (30 * S, 28 * S))
    d.text((260 * S, 40 * S), "HIGH VOLTAGE", fill=DARK, font=_fit(d, "HIGH VOLTAGE", 100 * S, (w - 300) * S))
    d.text((260 * S, 156 * S), "AUTHORISED PERSONNEL ONLY", fill=DARK, font=_fit(d, "AUTHORISED PERSONNEL ONLY", 48 * S,
                                                                                (w - 300) * S))
    return _done(im, w, h)


def decal_atlas():
    UP.ensure_textures(force=True)
    atlas = Image.new("RGB", (L.DECAL_W, L.DECAL_H), PLATE)
    for cell in L.DECAL_CELLS:
        x0, y0, x1, y1 = L.decal_rect_px(cell)
        w, h = x1 - x0, y1 - y0
        if cell.startswith("label_"):
            lines = L.LABELS[int(cell[6:])]
            img = label(lines[:2], lines[2], w, h)
        elif cell.startswith("tag_"):
            img = tag(cell[4:].upper(), w, h)
        elif cell.startswith("id_"):
            img = ident({"cc01": "CC-01", "hp01": "HP-01", "cs3a": "CS-3A"}[cell[3:]], w, h)
        elif cell.startswith("num_"):
            img = number(int(cell[4:]), w, h)
        elif cell == "barcode":
            img = barcode(w, h)
        elif cell == "high_voltage":
            img = high_voltage(w, h)
        elif cell.startswith("icon_"):
            img = icon(cell[5:], w)
        else:                                                   # signs and floor stencils (ui_preview images)
            img = Image.open(os.path.join(UP.OUT, cell + ".png")).convert("RGB").resize((w, h), Image.LANCZOS)
        atlas.paste(img, (x0, y0))
    atlas.save(os.path.join(OUT, "T_CC_DecalAtlas_D.png"))


def screen_atlas():
    UP.ensure_textures(force=True)
    atlas = Image.new("RGB", (L.SCREEN_W, L.SCREEN_H), (9, 22, 40))
    for cell in L.SCREEN_CELLS:
        x0, y0, x1, y1 = L.screen_rect_px(cell)
        atlas.paste(Image.open(os.path.join(UP.OUT, cell + ".png")).convert("RGB").resize((x1 - x0, y1 - y0), Image.LANCZOS),
                    (x0, y0))
    atlas.paste(L.rgb("ui_blue"), L.LED_RECT_PX)                 # solid glow for LEDs / small indicators
    atlas.save(os.path.join(OUT, "T_CC_ScreenAtlas_E.png"))


def hazard(px=512):
    y, x = np.mgrid[0:px, 0:px]
    band = ((x + y) // (px // 2)) % 2                             # 45-degree stripes, period = half the tile diagonal
    img = np.where(band[..., None] == 0, np.array(L.rgb("hazard_yellow")), np.array(L.rgb("graphite"))).astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(OUT, "T_CC_Hazard_D.png"))


def _periodic_noise(n, beta, rng):
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1.0
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / r ** beta
    spec[0, 0] = 0
    out = np.real(np.fft.ifft2(spec))
    return (out - out.min()) / (out.max() - out.min())


def metal_detail(n=1024, seed=7):
    rng = np.random.default_rng(seed)
    h = 0.6 * _periodic_noise(n, 1.6, rng) + 0.4 * _periodic_noise(n, 0.8, rng)
    # wrapped scratches: draw on a 3x3 canvas, keep the centre tile
    sc = Image.new("L", (3 * n, 3 * n), 0)
    d = ImageDraw.Draw(sc)
    for _ in range(220):                                          # a bit more wear than v1 (concept boards)
        x, y = rng.uniform(0, n, 2)
        a = rng.uniform(0, np.pi)
        ln = rng.uniform(20, 120)
        for ox in (0, n, 2 * n):
            for oy in (0, n, 2 * n):
                d.line((x + ox, y + oy, x + ox + ln * np.cos(a), y + oy + ln * np.sin(a)), fill=int(rng.uniform(60, 140)),
                       width=1)
    s = np.asarray(sc.crop((n, n, 2 * n, 2 * n)), dtype=np.float32) / 255.0
    height = np.clip(h - 0.35 * s, 0, 1)
    detail = 0.82 + 0.18 * height                                 # mostly bright: multiplies the paint colour gently
    Image.fromarray((detail * 255).astype(np.uint8), "L").save(os.path.join(OUT, "T_CC_MetalDetail_M.png"))
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 2.0
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 2.0
    nz = np.ones_like(height)
    nrm = np.stack((-dx, -dy, nz), -1)                            # DirectX convention (green flipped vs OpenGL): UE
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "T_CC_MetalDetail_N.png"))
    # packed ARW: AO from the low-frequency height, roughness variation (smudges), wear = the scratch mask
    low = _periodic_noise(n, 2.2, rng)
    ao = 0.78 + 0.22 * low
    rough = np.clip(0.5 + 0.18 * (_periodic_noise(n, 1.2, rng) - 0.5) * 2 - 0.12 * s, 0.25, 0.8)
    chips = Image.new("L", (3 * n, 3 * n), 0)                     # small paint chips, wrapped like the scratches
    dc = ImageDraw.Draw(chips)
    for _ in range(60):
        x, y = rng.uniform(0, n, 2)
        r_ = rng.uniform(2, 7)
        for ox in (0, n, 2 * n):
            for oy in (0, n, 2 * n):
                dc.ellipse((x + ox - r_, y + oy - r_ * 0.7, x + ox + r_, y + oy + r_ * 0.7), fill=255)
    ch = np.asarray(chips.crop((n, n, 2 * n, 2 * n)), dtype=np.float32) / 255.0
    wear = np.clip(s * 1.6 + ch, 0, 1)
    arw = np.stack((ao, rough, wear), -1)
    Image.fromarray((arw * 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "T_CC_MetalDetail_ARW.png"))


def _save_normal(height, name, strength=2.0):
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    nrm = np.stack((-dx, -dy, np.ones_like(height)), -1)          # DirectX convention
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8), "RGB").save(os.path.join(OUT, name))


def tread(n=1024, seed=5):
    """Diamond tread plate for the floor metal inserts (service areas): raised lozenges in a staggered grid.
    32 lozenges per 1024 px = per 2 m -> 6 cm pitch, the usual tread-plate scale."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    pitch = n / 32
    ci, cj = np.floor(x / pitch), np.floor(y / pitch)
    u, v = x / pitch - ci - 0.5, y / pitch - cj - 0.5             # local cell coordinates -0.5..0.5
    ang = np.where((ci + cj) % 2 == 0, 1.0, -1.0)                 # neighbouring lozenges cross (+-45 degrees)
    a = (u + ang * v) / 1.414
    b = (u - ang * v) / 1.414
    h = np.clip(1 - (np.abs(a) / 0.4) ** 2 - (np.abs(b) / 0.1) ** 2, 0, 1)
    h = 0.8 * h + 0.2 * _periodic_noise(n, 1.2, rng)
    Image.fromarray(((0.7 + 0.3 * h) * 255).astype(np.uint8), "L").save(os.path.join(OUT, "T_CC_Tread_M.png"))
    _save_normal(h, "T_CC_Tread_N.png", 3.0)
    ao = 0.7 + 0.3 * h
    rough = np.clip(0.55 - 0.25 * h, 0.2, 0.7)                    # raised tops polished by boots
    wear = np.clip(h * 0.8, 0, 1)
    Image.fromarray((np.stack((ao, rough, wear), -1) * 255).astype(np.uint8), "RGB").save(
        os.path.join(OUT, "T_CC_Tread_ARW.png"))


def brushed(n=1024, seed=9):
    """Brushed metal for M_MetalBare (rings, edges, slats): fine horizontal streaks (+ anisotropy in UE)."""
    rng = np.random.default_rng(seed)
    streak = rng.normal(size=(n, 1)).astype(np.float32)
    streak = np.repeat(streak, n, 1)
    k = np.ones(64) / 64
    fine = np.apply_along_axis(lambda r: np.convolve(np.concatenate((r[-32:], r, r[:31])), k, "valid"), 1,
                               rng.normal(size=(n, n)).astype(np.float32))
    h = 0.6 * (streak - streak.min()) / (np.ptp(streak) + 1e-6) + 0.4 * (fine - fine.min()) / (np.ptp(fine) + 1e-6)
    Image.fromarray(((0.86 + 0.14 * h) * 255).astype(np.uint8), "L").save(os.path.join(OUT, "T_CC_Brushed_M.png"))
    _save_normal(h, "T_CC_Brushed_N.png", 0.8)


def macro(n=512, seed=11):
    rng = np.random.default_rng(seed)
    m = 0.86 + 0.14 * _periodic_noise(n, 2.6, rng)
    Image.fromarray((m * 255).astype(np.uint8), "L").save(os.path.join(OUT, "T_CC_Macro_M.png"))


def checker(n=1024, cells=8):
    img = Image.new("RGB", (n, n))
    d = ImageDraw.Draw(img)
    c = n // cells
    for i in range(cells):
        for j in range(cells):
            col = (230, 230, 230) if (i + j) % 2 == 0 else (60, 60, 70)
            d.rectangle((i * c, j * c, (i + 1) * c, (j + 1) * c), fill=col)
    d.rectangle((0, 0, c // 2, c // 2), fill=(230, 60, 40))            # orientation marker: top-left = red
    d.rectangle((n - c // 2, n - c // 2, n, n), fill=(40, 120, 230))   # bottom-right = blue
    img.save(os.path.join(OUT, "T_CC_UVChecker.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    decal_atlas()
    screen_atlas()
    hazard()
    metal_detail()
    tread()
    brushed()
    macro()
    checker()
    print("written", sorted(f for f in os.listdir(OUT) if f.startswith("T_CC_")))
