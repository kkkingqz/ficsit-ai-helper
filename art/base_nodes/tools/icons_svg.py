#!/usr/bin/env python3
"""Vector node icons (redrawn from the concept "2D иконка" panels): one SVG per node x tier, rasterised to PNG.

    python3 tools/icons_svg.py [--out icons] [--only smelter] [--compare]

Drawing grid: 0..100 (y down). Every icon is ONE colour mask: shapes are added in white and cut in black, the mask is
applied to a vertical gradient (concept icon colours) plus a soft glow copy. Stroke widths come from a small set
(W = 4.5 main frame, w = 3 detail) so the family reads the same at 64 px. Writes
icons/svg/T_Node_<Asset>_T<n>_Icon.svg and icons/T_Node_<Asset>_T<n>_Icon_{512,256,128,64}.png; --compare also writes
icons/_compare.png (concept crop | new icon) and icons/_preview.png. Rasterised by the Playwright Chromium.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
W, w = 4.5, 3.0
TOP, BOTTOM = "#B2F0FF", "#60CEFA"


class Icon:
    def __init__(self):
        self.els = []

    # -- primitives (c = colour placeholder: white = add, black = cut) ------------------------------------------
    def _e(self, s, cut):
        self.els.append(s.replace("{c}", "black" if cut else "white"))

    def rect(self, x0, y0, x1, y1, r=0.0, cut=False):
        self._e(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}" fill="{{c}}"/>', cut)

    def poly(self, pts, cut=False):
        self._e('<polygon points="' + " ".join(f"{x},{y}" for x, y in pts) + '" fill="{c}"/>', cut)

    def line(self, pts, sw=W, cut=False, join="miter", cap="butt"):
        self._e('<polyline points="' + " ".join(f"{x},{y}" for x, y in pts) +
                f'" fill="none" stroke="{{c}}" stroke-width="{sw}" stroke-linejoin="{join}" stroke-linecap="{cap}"'
                ' stroke-miterlimit="6"/>', cut)

    def path(self, d, sw=None, cut=False, fill=False, cap="butt", join="miter"):
        if fill:
            self._e(f'<path d="{d}" fill="{{c}}"/>', cut)
        else:
            self._e(f'<path d="{d}" fill="none" stroke="{{c}}" stroke-width="{sw or W}" stroke-linecap="{cap}" '
                    f'stroke-linejoin="{join}"/>', cut)

    def circle(self, cx, cy, r, cut=False):
        self._e(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{{c}}"/>', cut)

    def ellipse(self, cx, cy, rx, ry, rot=0.0, cut=False):
        self._e(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" transform="rotate({rot} {cx} {cy})" '
                'fill="{c}"/>', cut)

    # -- building blocks shared by the nodes ----------------------------------------------------------------------
    def chevrons(self, x, y, h=8.0, n=3, gap=5.5, sw=w):
        for i in range(n):
            xx = x + i * gap
            self.line([(xx, y - h / 2), (xx + h / 2, y), (xx, y + h / 2)], sw)

    def arch(self, x0, x1, y_top, y_bot, ch=4.0, sw=W, cut=False):
        """Portal arch: two legs and a top with chamfered corners (open at the bottom)."""
        self.line([(x0, y_bot), (x0, y_top + ch), (x0 + ch, y_top), (x1 - ch, y_top), (x1, y_top + ch), (x1, y_bot)],
                  sw, cut)

    def trapeze_arch(self, x0, x1, y_top, y_bot, splay, sw=W):
        """Splayed arch (hub legs): top from x0 to x1, legs spread out by `splay` at the bottom."""
        self.line([(x0 - splay, y_bot), (x0, y_top), (x1, y_top), (x1 + splay, y_bot)], sw)

    def dish(self, cx, cy, rx, ry, rot, stem_to):
        self.ellipse(cx, cy, rx, ry, rot)
        a = math.radians(rot + 90)
        sx, sy = cx + math.cos(a) * ry * 0.6, cy + math.sin(a) * ry * 0.6
        self.line([(sx, sy), stem_to], w)

    def mast(self, x, y0, y1, sw=w, collar=None):
        self.line([(x, y1), (x, y0)], sw)
        if collar:
            self.rect(x - sw * 0.9, collar, x + sw * 0.9, collar + 2.4)

    def drop(self, cx, cy, s, cut=True):
        r = s * 0.36
        self.path(f"M{cx},{cy - s / 2} C{cx + r * 0.4},{cy - s * 0.18} {cx + r * 1.05},{cy} {cx + r},{cy + s * 0.14} "
                  f"A{r},{r} 0 1 1 {cx - r},{cy + s * 0.14} C{cx - r * 1.05},{cy} {cx - r * 0.4},{cy - s * 0.18} "
                  f"{cx},{cy - s / 2} Z", fill=True, cut=cut)

    def heat(self, x, y0, h, a=1.8, sw=2.6, cut=False):
        q = h / 4
        self.path(f"M{x},{y0} q{a},{q / 2} 0,{q} t0,{q} t0,{q} t0,{q}", sw, cut=cut, cap="round", join="round")

    def vessel(self, x0, x1, y0, y1, slits=3):
        """Process column: dome top, body, dark slits."""
        r = (x1 - x0) / 2
        self.path(f"M{x0},{y1} L{x0},{y0 + r * 0.7} Q{x0},{y0} {x0 + r},{y0} Q{x1},{y0} {x1},{y0 + r * 0.7} "
                  f"L{x1},{y1} Z", fill=True)
        for i in range(slits):
            yy = y0 + r * 0.9 + i * (y1 - y0 - r * 1.2) / slits
            self.rect(x0 - 0.5, yy, x0 + r * 0.55, yy + 1.8, cut=True)
            self.rect(x1 - r * 0.55, yy, x1 + 0.5, yy + 1.8, cut=True)

    def tank(self, x0, x1, y0, y1, drop=True):
        r = (x1 - x0) / 2
        self.path(f"M{x0},{y1} L{x0},{y0 + r * 0.45} Q{x0},{y0} {x0 + r * 0.5},{y0} L{x1 - r * 0.5},{y0} "
                  f"Q{x1},{y0} {x1},{y0 + r * 0.45} L{x1},{y1} Z", fill=True)
        if drop:
            self.drop((x0 + x1) / 2, y0 + (y1 - y0) * 0.55, min(r * 0.95, (y1 - y0) * 0.45))

    def robot(self, bx, by, s=1.0, mirror=False):
        """Assembly arm: base, three joints (rings), two links, two-finger gripper."""
        m = -1 if mirror else 1
        X = lambda dx: bx + m * dx * s
        Y = lambda dy: by + dy * s
        self.poly([(X(-9), Y(0)), (X(-6), Y(-8)), (X(6), Y(-8)), (X(9), Y(0))])
        sh, el, wr = (X(0), Y(-12)), (X(10), Y(-26)), (X(22), Y(-20))
        self.line([sh, el], 6 * s)
        self.line([el, wr], 4.6 * s)
        for (cx, cy), r in ((sh, 5.2), (el, 4.2), (wr, 3.4)):
            self.circle(cx, cy, r * s)
            self.circle(cx, cy, r * s * 0.42, cut=True)
        gx, gy = wr[0], wr[1] + 6 * s
        self.line([(gx, wr[1] + 2.5 * s), (gx, gy - 1 * s)], 2.6 * s)
        for sg in (-1, 1):
            self.path(f"M{gx},{gy} q{sg * 4 * s},{0} {sg * 3.5 * s},{5 * s} q{-sg * 0.6 * s},{2 * s} {-sg * 2 * s},{2.2 * s}",
                      2.4 * s)

    # -- svg ---------------------------------------------------------------------------------------------------------
    def svg(self):
        body = "\n    ".join(self.els)
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 106 106" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="{TOP}"/><stop offset="1" stop-color="{BOTTOM}"/>
    </linearGradient>
    <mask id="m" maskUnits="userSpaceOnUse" x="-3" y="-3" width="106" height="106">
    {body}
    </mask>
    <filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6"/></filter>
  </defs>
  <g filter="url(#glow)" opacity="0.45"><rect x="-3" y="-3" width="106" height="106" fill="{BOTTOM}" mask="url(#m)"/></g>
  <rect x="-3" y="-3" width="106" height="106" fill="url(#g)" mask="url(#m)"/>
</svg>
'''


# ---------------------------------------------------------------------------------------------------------------------
# icons (one function per node, tier 1..3)
# ---------------------------------------------------------------------------------------------------------------------
def central_hub(t):
    i = Icon()
    # deck
    i.poly([(22, 44), (26, 39), (74, 39), (78, 44)]) if t > 1 else i.rect(21, 40, 79, 44)
    i.rect(19, 46, 81, 50)
    if t > 1:                                                  # second deck level with windows
        i.rect(24, 51, 76, 58)
        for x in (30, 45, 60):
            i.rect(x, 53, x + 10, 56, cut=True)
    # splayed legs (outer + inner strand) and the portal
    yt = 58 if t > 1 else 52
    i.trapeze_arch(24, 76, yt, 84, 11)
    i.trapeze_arch(30, 70, yt + 5, 84, 8)
    i.arch(34, 66, yt + 9, 86, 3.5)
    i.rect(8, 82, 22, 86)
    i.rect(78, 82, 92, 86)
    if t >= 2:                                                 # outer posts (with serifs on T3)
        for x in (8, 92):
            i.line([(x, 86), (x, 44)], W)
            if t == 3:
                i.rect(x - 4, 42, x + 4, 45)
    if t == 2:
        i.rect(43, 79, 57, 82)
    else:
        i.chevrons(41, 80, 7, 3, 5.5)
    # roof: control box, masts, dish
    if t == 1:
        i.line([(40, 39), (40, 34.5), (55, 34.5), (55, 39)], w)
        i.mast(62, 30, 39)
        i.mast(73, 12, 39, collar=31)
        i.dish(62, 21, 8, 4.6, -40, (61, 33))
    else:
        i.mast(38, 12, 37) ; i.mast(44, 20, 37)
        if t == 3:
            i.mast(50, 16, 37)
        i.rect(33, 31, 56, 36)
        i.dish(70, 20, 10, 6, 35 if t == 2 else -35, (64, 34))
        i.rect(60, 33, 70, 37)
    return i


def fluid_plant(t):
    i = Icon()
    # building: deck + double arch, ground line
    i.rect(8, 53, 68, 57)
    i.arch(8, 68, 59, 90, 5)
    i.arch(16, 60, 66, 90, 4)
    i.chevrons(30, 80, 7, 3, 5.5)
    i.rect(4, 89, 96, 92)
    if t == 1:
        i.line([(12, 52), (12, 44), (36, 44), (36, 52)], w)
        i.rect(17, 46, 31, 50, cut=False)
        i.vessel(44, 62, 18, 48)
        i.line([(53, 18), (53, 9), (74, 9), (74, 58)], W)
    elif t == 2:
        i.vessel(37, 52, 14, 48)
        i.vessel(57, 72, 14, 48)
        i.line([(44.5, 14), (44.5, 4), (64.5, 4), (64.5, 14)], W)
        i.line([(37, 32), (30, 32), (30, 52)], W)
        i.rect(36, 49, 73, 53)
    else:
        i.vessel(36, 50, 20, 48)
        i.vessel(53, 67, 20, 48)
        i.line([(43, 20), (43, 12), (58, 12), (58, 4), (76, 4), (76, 56)], W)
        i.line([(12, 52), (12, 38), (26, 38), (26, 52)], W)
        # lattice tower on the right
        i.line([(80, 52), (80, 28), (94, 28), (94, 52)], w)
        i.line([(80, 28), (94, 52)], 2.2)
        i.line([(94, 28), (80, 52)], 2.2)
        i.vessel(84, 90, 16, 27, 0)
    i.tank(72, 96, 56, 89)
    return i


def logistics_hub(t):
    i = Icon()
    if t < 3:
        i.arch(12, 86, 42, 82, 8, 6)
        i.arch(22, 76, 51, 82, 6)
        i.arch(29, 69, 58, 90, 4.5)
    else:
        i.poly([(16, 41), (20, 36), (84, 36), (88, 41)])
        i.rect(16, 43, 84, 47)
        i.rect(10, 49, 22, 80)
        i.rect(78, 49, 90, 80)
        i.arch(28, 72, 50, 90, 6)
        i.arch(35, 65, 57, 90, 4.5)
    # stepped feet with slots
    for x0, x1 in ((4, 26), (74, 96)):
        i.rect(x0 + 3, 76, x1 - 3, 80)
        i.rect(x0, 81, x1, 90)
        i.rect(x0 + 4, 84, x1 - 4, 86.5, cut=True)
    i.chevrons(40, 74, 7, 3, 5.5)
    # roof box, mast, dish
    if t < 3:
        i.line([(41, 41), (41, 34), (59, 34), (59, 41)], w)
        i.rect(45, 37, 55, 39.5, cut=False)
        i.mast(80, 5, 42, collar=24)
        i.line([(80, 34), (74, 40)], w)
        i.dish(71, 20, 5.5, 9, 25, (78, 27))
    else:
        i.rect(22, 31, 32, 35)
        i.line([(38, 35), (38, 29), (54, 29), (54, 35)], w)
        i.rect(60, 31, 70, 35)
        i.mast(84, 4, 35, collar=22)
        i.dish(74, 17, 5.5, 9, 25, (82, 26))
    return i


def smelter(t):
    i = Icon()
    stacks = {1: [66], 2: [55, 73], 3: [40, 57, 74]}[t]
    for x in stacks:                                            # chimneys: cap, body, base
        i.rect(x - 8, 10, x + 8, 15, 1.2)
        i.rect(x - 6, 15, x + 6, 32 if t > 1 else 34)
        if t == 3:
            i.rect(x - 8, 24, x + 8, 27, cut=True)
        i.rect(x - 8, 32 if t > 1 else 34, x + 8, 37)
    # furnace house (filled) with cut outline and door
    i.path("M14,84 L14,56 L28,40 L72,40 L86,56 L86,84 Z", fill=True)
    if t > 1:
        i.line([(22, 40), (78, 40)], 3)
        i.rect(16, 38, 84, 40, cut=True)
        i.line([(14, 56), (10, 60), (10, 84)], 3)
        i.line([(86, 56), (90, 60), (90, 84)], 3)
    i.line([(24, 84), (24, 60), (34, 49), (66, 49), (76, 60), (76, 84)], 2.6, cut=True)
    i.rect(32, 60, 68, 80, 2, cut=True)
    for x in (42, 50, 58):
        i.heat(x - 0.9, 64, 12)
    # base slab and side feet
    i.path("M6,88 L10,82 L90,82 L94,88 L94,91 L6,91 Z", fill=True)
    if t > 1:
        for x0 in (6, 80):
            i.rect(x0, 74, x0 + 14, 84)
            i.rect(x0 + 3, 77, x0 + 11, 79, cut=True)
    return i


def assembler(t):
    i = Icon()
    x0, x1 = (16, 84) if t < 3 else (10, 90)
    i.line([(x0 + 4, 84), (x0 + 4, 40), (x0 + 12, 31), (x1 - 12, 31), (x1 - 4, 40), (x1 - 4, 84)], 8)
    # roof
    if t == 1:
        i.poly([(30, 26), (32, 21), (48, 21), (50, 26)])
        i.poly([(54, 26), (56, 21), (72, 21), (74, 26)])
    else:
        i.poly([(x0 + 14, 27), (x0 + 17, 19), (x1 - 17, 19), (x1 - 14, 27)])
        for k in range(3 if t == 3 else 2):
            xx = 36 + k * 11 if t == 3 else 37 + k * 13
            i.rect(xx, 21.5, xx + 8, 24.5, cut=True)
        if t == 2:
            i.rect(70, 12, 74, 18, 1)
            i.rect(77, 12, 81, 18, 1)
        else:
            i.rect(85, 8, 89, 30, 1)
            i.rect(93, 12, 97, 30, 1)
            i.line([(x1 - 4, 40), (x1 + 2, 34), (x1 + 2, 84)], 3)
    # feet / base bar
    if t == 1:
        i.poly([(8, 84), (10, 74), (26, 74), (28, 84)])
        i.poly([(72, 84), (74, 74), (90, 74), (92, 84)])
        i.rect(30, 82, 74, 84)
        i.robot(43, 82, 1.0)
    else:
        i.rect(4, 74, 96, 88, 1)
        for xa in (8, 74):
            i.rect(xa, 78, xa + 4, 84, cut=True)
            i.rect(xa + 7, 79, xa + 16, 82, cut=True)
        if t == 2:
            i.rect(50, 78, 66, 82, cut=True)
            i.robot(42, 76, 1.12)
        else:
            i.robot(22, 76, 0.85)
            i.robot(78, 76, 0.85, mirror=True)
    return i


def refinery(t):
    i = Icon()
    stacks = {1: [80], 2: [70, 86], 3: [70, 86]}[t]
    for x in stacks:
        i.rect(x - 5, 9, x + 5, 50, 2)
    i.rect(stacks[0] - 7, 44, stacks[-1] + 7, 58)
    # factory: sloped roof hall with skewed slots, door outline, two window bars
    i.path("M4,90 L4,66 L12,57 L24,52 L28,48 L66,48 L70,52 L70,90 Z", fill=True)
    for k in range(3 if t < 3 else 3):
        xx = 22 + k * 12
        i.poly([(xx, 58), (xx + 8, 58), (xx + 6, 62), (xx - 2, 62)], cut=True)
    i.poly([(14, 91), (14, 70), (18, 66), (56, 66), (60, 70), (60, 91)], cut=True)      # dark door bay
    i.rect(21, 73, 53, 77)                                                             # two light bars in it
    i.rect(21, 81, 53, 85)
    if t == 3:                                                  # roof clutter: small masts + box
        i.rect(26, 40, 46, 47)
        i.rect(30, 42, 42, 45, cut=True)
        for x, h in ((26, 30), (29, 34), (32, 31)):
            i.mast(x, h, 41, 2.2)
    # tanks
    if t < 3:
        i.tank(72, 96, 62, 90, drop=False)
        i.rect(72, 89, 96, 92)
    else:
        i.tank(66, 81, 62, 90, drop=False)
        i.tank(81, 96, 62, 90, drop=False)
        i.line([(73.5, 70), (73.5, 90)], 1.6, cut=True)
        i.line([(88.5, 70), (88.5, 90)], 1.6, cut=True)
    return i


def ore_mine(t):
    i = Icon()
    # left slab, main slab, right slab (leaning crystal peaks)
    i.poly([(8, 82), (18, 62), (28, 38), (33, 33), (38, 46), (30, 60), (20, 82)])
    i.poly([(24, 68), (36, 46), (46, 32), (60, 10), (68, 22), (76, 34), (78, 42), (70, 38), (62, 40), (52, 52), (38, 70)])
    i.poly([(70, 52), (80, 35), (88, 42), (97, 68), (92, 69), (84, 52)])
    i.poly([(60, 18), (61, 30), (66, 26)], cut=True)
    i.poly([(31, 38), (32, 47), (35, 44)], cut=True)
    # rock pile
    rocks = [[(14, 86), (18, 76), (28, 70), (38, 72), (42, 82), (36, 88), (20, 88)],
             [(6, 86), (8, 80), (14, 79), (16, 86)],
             [(40, 88), (42, 82), (48, 82), (50, 88)]]
    if t >= 2:
        rocks.append([(30, 70), (34, 62), (42, 62), (46, 70), (40, 74)])
    if t == 3:
        rocks.append([(4, 78), (8, 70), (14, 72), (14, 78)])
    for r in rocks:
        i.poly(r)
    for r in rocks:                                             # dark seams between the chunks
        i.line(r + [r[0]], 1.6, cut=True)
    # pickaxe: handle + crescent head + binding
    i.line([(54, 92), (78, 62)], 6.5)
    i.path("M54,48 Q80,40 90,84 L85,84 Q74,54 54,53 Z", fill=True)
    i.rect(70, 57, 79, 66, cut=False)
    i.line([(72, 59), (77, 64)], 1.8, cut=True)
    return i


NODES = {"central_hub": central_hub, "fluid_plant": fluid_plant, "logistics_hub": logistics_hub,
         "smelter": smelter, "assembler": assembler, "refinery": refinery, "ore_mine": ore_mine}


# ---------------------------------------------------------------------------------------------------------------------
RASTER_JS = r"""
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const b = await chromium.launch();
  const pg = await b.newPage();
  for (const [svg, out, size] of jobs) {
    await pg.setViewportSize({ width: size, height: size });
    const s = svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);
    await pg.setContent(`<html><body style="margin:0;background:transparent">${s}</body></html>`);
    await pg.locator('svg').screenshot({ path: out, omitBackground: true });
  }
  await b.close();
})();
"""


def rasterise(jobs):
    """jobs: [(svg_text, png_path, size)] -> PNGs with transparency, via the Node Playwright + Chromium."""
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        jp, sp = os.path.join(d, "jobs.json"), os.path.join(d, "raster.js")
        json.dump([[s, os.path.abspath(o), z] for s, o, z in jobs], open(jp, "w"))
        open(sp, "w").write(RASTER_JS)
        subprocess.run(["node", sp, jp], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "icons"))
    ap.add_argument("--only")
    ap.add_argument("--compare", action="store_true")
    a = ap.parse_args()
    spec = json.load(open(os.path.join(ROOT, "nodes.json"), encoding="utf-8"))
    os.makedirs(os.path.join(a.out, "svg"), exist_ok=True)
    jobs, made = [], []
    for key, node in spec["nodes"].items():
        if a.only and key != a.only:
            continue
        for tk in node["tiers"]:
            base = f"T_Node_{node['asset']}_T{tk}_Icon"
            svg = NODES[key](int(tk)).svg()
            open(os.path.join(a.out, "svg", base + ".svg"), "w", encoding="utf-8").write(svg)
            for size in (512, 256, 128, 64):
                jobs.append((svg, os.path.join(a.out, f"{base}_{size}.png"), size))
            made.append((key, node, tk, base))
    rasterise(jobs)
    print(f"[icons] {len(made)} svg, {len(jobs)} png")
    if a.compare:
        compare(made, a.out)


def compare(made, out):
    from PIL import Image, ImageDraw
    sys.path.insert(0, HERE)
    import make_icons
    bg = (8, 22, 34)
    T = 200
    sheet = Image.new("RGB", (len(made) // 3 * (2 * T + 30) + 20, 3 * (T + 20) + 20), bg)
    prev = Image.new("RGB", (len(made) * 140 + 20, 220), bg)
    for k, (key, node, tk, base) in enumerate(made):
        col, row = k // 3, k % 3
        im = Image.open(os.path.join(ROOT, node["concept"][int(tk) - 1])).convert("RGB")
        c = im.crop(make_icons.frame_inner(im)).resize((T, T), Image.LANCZOS)
        ic = Image.open(os.path.join(out, base + "_256.png")).resize((T, T), Image.LANCZOS)
        x, y = 20 + col * (2 * T + 30), 20 + row * (T + 20)
        sheet.paste(c, (x, y))
        sheet.paste(ic, (x + T, y), ic)
        i128 = Image.open(os.path.join(out, base + "_128.png"))
        prev.paste(i128, (20 + k * 140, 10), i128)
        i64 = Image.open(os.path.join(out, base + "_64.png"))
        prev.paste(i64, (20 + k * 140, 150), i64)
    sheet.save(os.path.join(out, "_compare.png"))
    prev.save(os.path.join(out, "_preview.png"))


if __name__ == "__main__":
    main()
