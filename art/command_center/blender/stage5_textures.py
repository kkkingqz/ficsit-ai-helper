"""Stage 5 texture set for SM_CommandCenter (run with the system Python: Pillow + numpy).

    python stage5_textures.py            # writes ../textures/T_CC_*.png

Textures (v1, procedural placeholders with the final layout, so the UVs can be checked and the UE materials built):
  T_CC_DecalAtlas_D      2048^2  decal atlas: 8 labels, 3 signs, 4 floor stencils, 1 white cell (stage5_layout)
  T_CC_ScreenAtlas_E     2048^2  screen atlas: 6 UIs (16:9) + LED glow strip
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


def decal_atlas():
    UP.ensure_textures()
    atlas = Image.new("RGB", (L.ATLAS_PX, L.ATLAS_PX), (38, 42, 50))
    src = {f"label_{k}": f"label_{k}" for k in range(len(L.LABELS))}
    src.update({"sign_cc": "sign_cc", "sign_entry": "sign_entry", "sign_exit": "sign_exit",
                "floor_operator": "floor_operator", "floor_service": "floor_service", "floor_holo": "floor_holo",
                "floor_tech": "floor_tech"})
    for cell in L.DECAL_CELLS:
        x0, y0, x1, y1 = L.decal_rect_px(cell)
        if cell == "white":
            atlas.paste((235, 235, 230), (x0, y0, x1, y1))
            continue
        img = Image.open(os.path.join(UP.OUT, src[cell] + ".png")).convert("RGB").resize((x1 - x0, y1 - y0))
        atlas.paste(img, (x0, y0))
    atlas.save(os.path.join(OUT, "T_CC_DecalAtlas_D.png"))


def screen_atlas():
    UP.ensure_textures()
    atlas = Image.new("RGB", (L.ATLAS_PX, L.ATLAS_PX), (9, 22, 40))
    for cell in L.SCREEN_CELLS:
        x0, y0, x1, y1 = L.screen_rect_px(cell)
        atlas.paste(Image.open(os.path.join(UP.OUT, cell + ".png")).convert("RGB").resize((x1 - x0, y1 - y0)), (x0, y0))
    atlas.paste((40, 140, 255), L.LED_RECT_PX)                   # solid glow for LEDs / small indicators
    atlas.save(os.path.join(OUT, "T_CC_ScreenAtlas_E.png"))


def hazard(px=512):
    y, x = np.mgrid[0:px, 0:px]
    band = ((x + y) // (px // 2)) % 2                             # 45-degree stripes, period = half the tile diagonal
    img = np.where(band[..., None] == 0, np.array([235, 180, 20]), np.array([22, 22, 24])).astype(np.uint8)
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
    for _ in range(140):
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
    wear = np.clip(s * 1.6, 0, 1)
    arw = np.stack((ao, rough, wear), -1)
    Image.fromarray((arw * 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "T_CC_MetalDetail_ARW.png"))


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
    macro()
    checker()
    print("written", sorted(f for f in os.listdir(OUT) if f.startswith("T_CC_")))
