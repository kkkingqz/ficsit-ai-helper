"""Module kit for the base-node holograms. Every module is a dict from nodes.json -> `build(node, module)`.

Side-mounted modules work in a front-local frame: u = along the face (to the right as seen from outside),
d = distance from the node centre along the outward normal, z = up. side: front (-Y), right (+X), back (+Y), left (-X).

Module types
    plate       ground plate: cross / square outline, glowing rim (outline) on top and the plate edge
    mass        battered terrace (loft between two chamfered rectangles); `strips` = glow windows on its faces
    pylons      four battered corner pylons (tier 1) with light dots
    buttresses  four diagonal ridges from the plate corners up to the tower, light dots along the top
    gate        front portal: outer U-frame, inner frame, back panel with >>> chevrons, glow strips, steps
    arm         low wing out to the plate edge with chevrons on top pointing outwards
    shutter     roll-up door panel with slats
    fans        fan box with round fans (glowing rims)
    tanks       vertical tanks with domed tops
    tower       octagonal drum with window bands (+ optional crown)
    railing     posts + rails around a rectangle or an octagon
    dish        satellite dish on a mast
    antennas    masts with collars and glowing tips
    banner      pole with a swallow-tail flag and up-chevrons
    pipes       pipe runs (polyline or quadratic curve)
    crates      plain boxes
    columns     process columns: skirt, ring bands, glowing slits, dome cap, nozzle
    lattice     steel frame with X braces (pipe racks, platforms on legs), optional deck
    stairs      straight stair between two points
    lamps       light masts with glowing heads
    units       boxed units with vent slats (AC, pumps)
    pipes.runs  polylines with rounded corners (loops over columns, racks along the walls)
    profile     hall body: (x, z) outline extruded along Y (cut roof corners), glow strips on its faces
    conveyor    belt on legs with rails, rollers and chevrons pointing out of the building
    stacks      smelter chimneys: base, body, glowing band, wide collar
    roof_fans   fan box lying on a roof, fans facing up
    gate.chevrons.kind = "heat"   wavy heat lines instead of >>> (furnace door)
    gate.u      offset of a portal along its face (side tunnels in front of an off-centre belt)
    robots      assembly robot arms on pedestals (joints glow), two-finger gripper
A module with "detail": true is left out of the small multi-mode mesh (_Mini).
"""
import math

import bmesh
from mathutils import Matrix, Vector

import bn_geom as G

YAW = {"front": 0.0, "right": math.pi / 2, "back": math.pi, "left": -math.pi / 2}


class Frame:
    """front-local (u, d, z) -> world for one side."""

    def __init__(self, side):
        self.yaw = YAW[side]
        self.R = Matrix.Rotation(self.yaw, 3, "Z")
        self.U = self.R @ Vector((1, 0, 0))
        self.N = self.R @ Vector((0, -1, 0))        # outward normal

    def p(self, u, d, z):
        return self.U * u + self.N * d + Vector((0, 0, z))


# ---------------------------------------------------------------------------------------------------------------
def plate(n, m):
    poly = G.plate_poly(m)
    h = m.get("h", 0.3)
    faces = n.prism(_ccw(poly), 0.0, h)
    n.part(faces, glow=0.0, rim=False)
    top = [f for f in faces if len(f.verts) == len(poly) and f.calc_center_median().z > h * 0.5][0]
    side = [f for f in faces if len(f.verts) == 4]
    for f in side:
        f[n.glow] = 1.0
    before = set(n.bm.faces)
    bmesh.ops.inset_region(n.bm, faces=[top], thickness=n.outline, depth=0.0, use_even_offset=True)
    for f in set(n.bm.faces) - before:         # the new ring around the (shrunk) top face = glowing outline
        f[n.glow] = 1.0
        f[n.edge] = 0.0
        f[n.dim] = 0.0
    top[n.glow] = 0.0
    top[n.dim] = 1.0                       # inner top stays dark: the plate reads by its outline


def _ccw(poly):
    a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]))
    return poly if a > 0 else list(reversed(poly))


def mass(n, m, center=(0.0, 0.0), top_offset=(0.0, 0.0)):
    cx, cy = m.get("center", center)
    (bx, by), (tx, ty) = m["base"], m["top"]
    ox, oy = m.get("top_offset", top_offset)
    c0, c1 = m["chamfer"] if isinstance(m["chamfer"], list) else (m["chamfer"], m["chamfer"])
    z0, z1 = m["z"]
    p0 = G.chamfer_rect(bx, by, c0, cx, cy)
    p1 = G.chamfer_rect(tx, ty, c1, cx + ox, cy + oy)
    n.part(n.loft(p0, z0, p1, z1), rim=True)
    for s in m.get("strips", []):
        _slope_box(n, s["side"], (cx, cy), (bx, by), (tx, ty), (ox, oy), (z0, z1), s["u"], s["z"], s["w"], s["h"])


def _slope_box(n, side, c, b, t, o, zz, u, z, w, h, depth=0.12, glow=1.0):
    """Glow box lying on a (battered) face of a mass, at height z."""
    (cx, cy), (bx, by), (tx, ty), (ox, oy), (z0, z1) = c, b, t, o, zz
    f = Frame(side)
    # extent of the face from the mass centre along the outward normal, at the bottom (e0) and the top (e1)
    e0 = by if side in ("front", "back") else bx
    e1 = {"front": ty - oy, "back": ty + oy, "right": tx + ox, "left": tx - ox}[side]
    k = (z - z0) / (z1 - z0)
    d = e0 + (e1 - e0) * k
    alpha = math.atan2(e0 - e1, z1 - z0)            # lean of the face from vertical (positive = leans inwards)
    centre = Vector((cx, cy, 0)) + f.p(u, d + depth / 2 * math.cos(alpha) - 0.02, z)
    R = f.R @ Matrix.Rotation(-alpha, 3, "X")
    faces = n.box_r(centre, (w, depth, h), R)
    n.part(faces, glow=glow, rim=False)


def pylons(n, m):
    a, b, t, lean = m["at"], m["base"], m["top"], m["lean"]
    ax, ay = (a, a) if not isinstance(a, list) else a
    for sx in (-1, 1):
        for sy in (-1, 1):
            mm = {"base": [b, b], "top": [t, t], "z": m["z"], "chamfer": m["chamfer"]}
            mass(n, mm, center=(sx * ax, sy * ay), top_offset=(-sx * lean, -sy * lean))
            d = m.get("dots")
            if d and sy < 0:                      # light dots on the front face of the two front pylons
                for z in d["z"]:
                    _slope_box(n, "front", (sx * ax, sy * ay), (b, b), (t, t), (-sx * lean, -sy * lean), m["z"],
                               0.0, z, d["w"], d["h"])


def buttresses(n, m):
    c, to, zt, h0, w = m["corner"], m["to"], m["z_top"], m["h0"], m["w"]
    for sx in (-1, 1):
        for sy in (-1, 1):
            o = Vector((sx * c, sy * c, 0))
            e = Vector((sx * to, sy * to, 0))
            U = (e - o).normalized()
            L = (e - o).length
            W = Vector((0, 0, 1)).cross(U)
            poly = [(0, 0), (0, h0), (L, zt), (L, 0)]
            n.part(n.extrude2d(poly, -w / 2, w / 2, o, U, (0, 0, 1), W), rim=True)
            k = m.get("dots", 0)
            slope = math.atan2(zt - h0, L)
            for i in range(k):
                s = L * (i + 1) / (k + 1) * 0.9
                p = o + U * s + Vector((0, 0, h0 + (zt - h0) * s / L + 0.08))
                d = (U * math.cos(slope) + Vector((0, 0, math.sin(slope)))) * 0.45
                n.part(n.beam(p - d, p + d, w * 0.45, 0.2), glow=1.0, rim=False)


def gate(n, m):
    f = Frame(m["side"])
    W, H, t, c = m["W"], m["H"], m["t"], m["c"]
    b, fr = m["back"], m["front"]
    u0 = m.get("u", 0.0)                                    # offset along the face (side tunnels in front of a belt)
    o = f.U * u0
    n.part(n.extrude2d(G.arch_frame(W, H, t, c), b, fr, o, f.U, (0, 0, 1), f.N), rim=True)
    pd = m.get("panel", (b + fr) / 2)
    n.part(n.box(f.p(u0, pd, (H - t) / 2), (W - 2 * t + 0.1, 0.3, H - t + 0.05), yaw=f.yaw), rim=False)
    i = m.get("inner")
    if i:
        n.part(n.extrude2d(G.arch_frame(i["W"], i["H"], i["t"], c * 0.7), pd + 0.1, fr - 0.45, o, f.U, (0, 0, 1), f.N),
               rim=True)
    ch = m.get("chevrons")
    for k in range(ch["n"] if ch else 0):
        u = u0 + (k - (ch["n"] - 1) / 2) * ch["pitch"]
        if ch.get("kind") == "heat":                         # furnace: wavy heat lines rising (smelter)
            _heat_line(n, f, u, pd + 0.2, ch["z"], ch["h"], ch["h"] * 0.09)
            continue
        org = f.p(u, 0, ch["z"])
        poly = G.chevron(ch["h"], ch["h"] * 0.45, ch["h"] * 0.22)
        n.part(n.extrude2d(poly, pd + 0.15, pd + 0.28, org, f.U, (0, 0, 1), f.N), glow=1.0, rim=False)
    for s in m.get("strips", []):
        n.part(n.box(f.p(u0 + s["u"], fr + 0.05, s["z"]), (s["w"], 0.14, s["h"]), yaw=f.yaw), glow=1.0, rim=False)
    st = m.get("steps")
    if st:
        k = st["n"]
        for j in range(k):
            d0 = fr - 0.2 + st["len"] * j / k
            hz = st["h"] * (k - j) / k
            n.part(n.box(f.p(u0, d0 + st["len"] / k / 2 + 0.1, hz / 2), (st["w"], st["len"] / k + 0.2, hz), yaw=f.yaw),
                   rim=True)
            n.part(n.box(f.p(u0, d0 + 0.12, hz + 0.02), (st["w"] * 0.9, 0.12, 0.05), yaw=f.yaw), glow=0.7, rim=False)


def _heat_line(n, f, u, d, z0, h, t, k=10):
    """One wavy vertical stroke (1.5 periods) on a face: chain of short beams along a sine."""
    amp = h * 0.13
    pts = [f.p(u + amp * math.sin(2 * math.pi * 1.5 * i / k), d, z0 + h * i / k) for i in range(k + 1)]
    for a, b in zip(pts[:-1], pts[1:]):
        n.part(n.beam(a, b, t, 0.12), glow=1.0, rim=False)


def arm(n, m):
    f = Frame(m["side"])
    a, b, w, h = m["from"], m["to"], m["w"], m["h"]
    n.part(n.box(f.p(0, (a + b) / 2, h / 2), (w, b - a, h), yaw=f.yaw), rim=True)
    k = m.get("chevrons", 0)
    ch = min(w * 0.55, 2.2)
    for i in range(k):
        d = a + (b - a) * (i + 1) / (k + 1) if k > 1 else (a + b) / 2
        poly = G.chevron(ch, ch * 0.45, ch * 0.22)
        # 2D x -> outward normal, 2D y -> along the face; extruded up from the arm top
        n.part(n.extrude2d(poly, h, h + 0.08, f.p(0, d, 0), f.N, f.U, (0, 0, 1)), glow=1.0, rim=False)


def shutter(n, m):
    f = Frame(m["side"])
    u, pl, w, h, z0 = m["u"], m["plane"], m["w"], m["h"], m["z0"]
    n.part(n.box(f.p(u, pl + 0.12, z0 + h / 2), (w, 0.3, h), yaw=f.yaw), glow=0.15, rim=True)
    if n.mini:
        return
    for k in range(m.get("slats", 0)):
        z = z0 + h * (k + 1) / (m["slats"] + 1)
        n.part(n.box(f.p(u, pl + 0.3, z), (w * 0.86, 0.08, 0.12), yaw=f.yaw), glow=0.5, rim=False)


def fans(n, m):
    f = Frame(m["side"])
    (w, dd, h), z0, u, pl = m["size"], m["z0"], m["u"], m["plane"]
    n.part(n.box(f.p(u, pl + dd / 2, z0 + h / 2), (w, dd, h), yaw=f.yaw), rim=True)
    k, r = m["n"], m["r"]
    Rn = f.R @ Matrix.Rotation(math.pi / 2, 3, "X")       # local Z -> outward normal
    for i in range(k):
        uu = u + (i - (k - 1) / 2) * (w / k)
        c = f.p(uu, pl + dd + 0.06, z0 + h / 2)
        n.part(n.annulus(c, r, r * 0.8, 0.16, 20, Rn), glow=0.8, rim=False)
        n.part(n.cylinder(f.p(uu, pl + dd, z0 + h / 2), r * 0.8, 0.06, 20, Rn), glow=0.0, rim=False)
        for s in (-1, 1):
            Rb = f.R @ Matrix.Rotation(s * math.pi / 4, 3, "Y")
            n.part(n.box_r(f.p(uu, pl + dd + 0.06, z0 + h / 2), (r * 1.6, 0.08, r * 0.22), Rb), glow=0.35, rim=False)
        n.part(n.cylinder(f.p(uu, pl + dd + 0.1, z0 + h / 2), r * 0.18, 0.12, 10, Rn), glow=0.8, rim=False)


def tanks(n, m):
    r, h, z0 = m["r"], m["h"], m["z0"]
    for x, y in m["at"]:
        n.part(n.cylinder((x, y, z0 + h / 2), r, h, 16), rim=True)
        ring0 = [(x + r * math.cos(a), y + r * math.sin(a)) for a in (2 * math.pi * i / 16 for i in range(16))]
        ring1 = [(x + r * 0.55 * math.cos(a), y + r * 0.55 * math.sin(a)) for a in (2 * math.pi * i / 16 for i in range(16))]
        n.part(n.loft(ring0, z0 + h, ring1, z0 + h + r * 0.4), rim=False)
        n.part(n.annulus((x, y, z0 + h * 0.72), r + 0.06, r - 0.05, 0.18, 16), glow=0.8, rim=False)
        if m.get("glyph") == "drop":
            yaw = math.radians(m.get("glyph_yaw", 0.0))          # 0 = glyph faces the front (-Y)
            N = Vector((math.sin(yaw), -math.cos(yaw), 0))
            U = Vector((math.cos(yaw), math.sin(yaw), 0))
            gh = min(h * 0.42, r * 1.1)
            o = Vector((x, y, z0 + h * 0.42))
            n.part(n.extrude2d(G.drop(gh), r - 0.05, r + 0.1, o, U, (0, 0, 1), N), glow=1.0, rim=False)


def tower(n, m):
    r, (z0, z1) = m["r"], m["z"]
    cx, cy = m.get("center", (0.0, 0.0))
    n.part(n.prism(G.octagon(r, cx, cy), z0, z1), rim=True)
    ap = r * math.cos(math.pi / 8)
    fw = 2 * r * math.sin(math.pi / 8)
    for wdef in m.get("windows", []):
        k = wdef["n"]
        total = fw * wdef["w_frac"]
        gap = 0.3 if k > 1 else 0.0
        ww = (total - gap * (k - 1)) / k
        for i in range(8):
            th = math.pi / 4 + i * math.pi / 4               # face normal angle (vertices at 22.5° + j·45°)
            yaw = th + math.pi / 2
            fr = Frame("front")
            fr.R = Matrix.Rotation(yaw, 3, "Z")
            fr.U, fr.N = fr.R @ Vector((1, 0, 0)), fr.R @ Vector((0, -1, 0))
            for j in range(k):
                u = (j - (k - 1) / 2) * (ww + gap)
                c = Vector((cx, cy, 0)) + fr.p(u, ap + 0.04, wdef["z"])
                n.part(n.box(c, (ww, 0.14, wdef["h"]), yaw=yaw), glow=1.0, rim=False)
    cr = m.get("crown")
    if cr:
        n.part(n.prism(G.octagon(cr["r"], cx, cy), z1, z1 + cr["h"]), rim=True)


def railing(n, m):
    z, h = m["z"], m["h"]
    tp = 0.14 * n.thin_mul
    if "rect" in m:
        a = m["rect"]
        ax, ay = (a, a) if not isinstance(a, list) else a
        poly = [(-ax, -ay), (ax, -ay), (ax, ay), (-ax, ay)]
    elif "box" in m:
        x0, y0, x1, y1 = m["box"]
        poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    else:
        poly = G.octagon(m["octagon"])
    for p0, p1 in zip(poly, poly[1:] + poly[:1]):
        p0, p1 = Vector((*p0, z)), Vector((*p1, z))
        L = (p1 - p0).length
        k = max(1, int(math.ceil(L / 2.4)))
        for i in range(k):
            q = p0 + (p1 - p0) * (i / k)
            n.part(n.box(q + Vector((0, 0, h / 2)), (tp, tp, h)), rim=False)
        for zz in (h, h * 0.5):
            n.part(n.beam(p0 + Vector((0, 0, zz)), p1 + Vector((0, 0, zz)), tp, tp), rim=False)


def dish(n, m):
    x, y, z0 = m["at"]
    R0 = m["R"]
    mh = m["mast_h"]
    mr = 0.32 * n.thin_mul
    n.part(n.cylinder((x, y, z0 + mh / 2), mr, mh, 10), rim=False)
    n.part(n.box((x, y, z0 + 0.25), (1.2, 1.2, 0.5)), rim=True)
    Rd = Matrix.Rotation(math.radians(m["yaw"]), 3, "Z") @ Matrix.Rotation(math.radians(m["tilt"]), 3, "X")
    c = Vector((x, y, z0 + mh + 0.2))
    n.part(n.box_r(c, (0.9, 0.9, 0.6), Rd), rim=True)
    prof = []
    k = 5
    th = max(0.22, R0 * 0.08)
    for i in range(k + 1):
        r = 0.05 + (R0 - 0.05) * i / k
        prof.append((r, 0.3 + R0 * 0.28 * (r / R0) ** 2))
    for i in range(k, -1, -1):
        r = 0.05 + (R0 - 0.05) * i / k
        prof.append((r * 0.96, 0.3 + R0 * 0.28 * (r / R0) ** 2 - th))
    n.part(n.lathe(prof, 18, Rd, c), glow=0.12, rim=True)
    ax = Rd @ Vector((0, 0, 1))
    n.part(n.beam(c + ax * 0.3, c + ax * (0.3 + R0 * 0.75), 0.12 * n.thin_mul, 0.12 * n.thin_mul), rim=False)
    n.part(n.box_r(c + ax * (0.3 + R0 * 0.75), (0.35, 0.35, 0.35), Rd), glow=1.0, rim=False)


def antennas(n, m):
    for x, y, z0, h, r in m["masts"]:
        r *= n.thin_mul
        n.part(n.box((x, y, z0 + h / 2), (2 * r, 2 * r, h)), rim=False)
        n.part(n.box((x, y, z0 + 0.3), (5 * r, 5 * r, 0.6)), rim=True)
        for f in (0.45, 0.75):
            n.part(n.box((x, y, z0 + h * f), (3.2 * r, 3.2 * r, 0.25)), rim=False)
        n.part(n.box((x, y, z0 + h + 0.15), (2.2 * r, 2.2 * r, 0.3)), glow=1.0, rim=False)


def banner(n, m):
    x, y = m["at"]
    h = m["h"]
    fw, fh, notch = m["flag"]
    f = Frame(m.get("side", "front"))
    tp = 0.36 * n.thin_mul
    n.part(n.box((x, y, h / 2), (tp, tp, h)), rim=False)
    n.part(n.box((x, y, 0.4), (1.2, 1.2, 0.8)), rim=True)
    o = Vector((x, y, 0)) + f.N * 0.3
    n.part(n.box(o + Vector((0, 0, h - 0.1)), (fw + 0.6, 0.25, 0.25), yaw=f.yaw), rim=False)
    poly = [(-fw / 2, 0), (-fw / 2, -fh), (0, -fh + notch), (fw / 2, -fh), (fw / 2, 0)]
    poly = [(a, b + h - 0.25) for a, b in poly]
    n.part(n.extrude2d(poly, -0.08, 0.08, o, f.U, (0, 0, 1), f.N), glow=0.1, rim=True)
    s = fw * 0.5
    for k in range(m.get("chevrons", 0)):
        zc = h - 0.25 - fh * 0.32 - k * s * 0.62
        up = [(-yy, xx) for xx, yy in G.chevron(s, s * 0.45, s * 0.22)]       # rotate '>' by +90° -> '^'
        n.part(n.extrude2d(up, 0.08, 0.16, o + Vector((0, 0, zc)), f.U, (0, 0, 1), f.N), glow=1.0, rim=False)


def pipes(n, m):
    r = m["r"]
    for path in m["paths"]:
        pts = [Vector(p) for p in path["points"]]
        if path.get("curve") and len(pts) == 3:
            a, b, c = pts
            pts = [(1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c for t in (i / 6 for i in range(7))]
        if path.get("tail"):
            pts.append(Vector(path["tail"]))
        for p0, p1 in zip(pts[:-1], pts[1:]):
            ax = p1 - p0
            Rr = ax.to_track_quat("Z", "Y").to_matrix()
            n.part(n.cylinder((p0 + p1) / 2, r, ax.length + r * 0.6, 8, Rr), rim=False)
        for p in (pts[0], pts[-1]):
            n.part(n.box(p, (r * 3, r * 3, r * 3)), rim=True)
    for path in m.get("runs", []):                          # polylines with rounded corners (pipe racks, loops)
        pts = _rounded([Vector(p) for p in path], m.get("bend", r * 3))
        for p0, p1 in zip(pts[:-1], pts[1:]):
            ax = p1 - p0
            if ax.length < 1e-4:
                continue
            Rr = ax.to_track_quat("Z", "Y").to_matrix()
            n.part(n.cylinder((p0 + p1) / 2, r, ax.length + r * 0.3, 8, Rr), rim=False)
        for p in (pts[0], pts[-1]):
            n.part(n.cylinder(p, r * 1.45, r * 1.2, 8, ((pts[1] - pts[0]) if p is pts[0] else (pts[-1] - pts[-2]))
                              .to_track_quat("Z", "Y").to_matrix()), glow=0.0, rim=True)


def _rounded(pts, bend, k=4):
    """Replace every interior corner of a polyline by a quadratic curve of radius ~bend."""
    out = [pts[0]]
    for a, b, c in zip(pts[:-2], pts[1:-1], pts[2:]):
        d0 = min(bend, (b - a).length / 2)
        d1 = min(bend, (c - b).length / 2)
        p0 = b + (a - b).normalized() * d0
        p1 = b + (c - b).normalized() * d1
        out.append(p0)
        for i in range(1, k):
            t = i / k
            out.append((1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p1)
        out.append(p1)
    out.append(pts[-1])
    return out


def columns(n, m):
    """Process columns (vertical vessels): skirt, body, ring bands, glowing slits, dome cap, top nozzle."""
    seg = 16
    for c in m["at"]:
        x, y = c[0], c[1]
        r, z0, z1 = m["r"], m["z"][0], m["z"][1]
        if len(c) > 2:
            z1 = z0 + c[2]
        n.part(n.cylinder((x, y, z0 + 0.4), r * 1.18, 0.8, seg), rim=True)
        n.part(n.cylinder((x, y, (z0 + z1) / 2), r, z1 - z0, seg), rim=True)
        ring0 = [(x + r * math.cos(a), y + r * math.sin(a)) for a in (2 * math.pi * i / seg for i in range(seg))]
        ring1 = [(x + r * 0.62 * math.cos(a), y + r * 0.62 * math.sin(a)) for a in (2 * math.pi * i / seg for i in range(seg))]
        ring2 = [(x + r * 0.3 * math.cos(a), y + r * 0.3 * math.sin(a)) for a in (2 * math.pi * i / seg for i in range(seg))]
        n.part(n.loft(ring0, z1, ring1, z1 + r * 0.45), rim=False)
        n.part(n.loft(ring1, z1 + r * 0.45, ring2, z1 + r * 0.62), rim=False)
        n.part(n.cylinder((x, y, z1 + r * 0.62 + 0.35), r * 0.32, 0.7, 10), rim=True)
        for f in m.get("bands", (0.18, 0.82)):
            n.part(n.annulus((x, y, z0 + (z1 - z0) * f), r + 0.12, r - 0.05, 0.3, seg), rim=False)
        yaw = math.radians(m.get("slit_yaw", 0.0))
        N = Vector((math.sin(yaw), -math.cos(yaw), 0))
        U = Vector((math.cos(yaw), math.sin(yaw), 0))
        k = m.get("slits", 3)
        zc = z0 + (z1 - z0) * 0.55
        for i in range(k):
            zz = zc + (i - (k - 1) / 2) * 0.75
            n.part(n.extrude2d([(-r * 0.55, -0.2), (r * 0.55, -0.2), (r * 0.55, 0.2), (-r * 0.55, 0.2)],
                               r - 0.12, r + 0.12, Vector((x, y, zz)), U, (0, 0, 1), N), glow=1.0, rim=False)


def lattice(n, m):
    """Steel frame: corner posts, top / bottom beams, X braces on the listed sides, optional deck on top."""
    (x0, y0, z0), (x1, y1, z1) = m["min"], m["max"]
    t = m.get("t", 0.35) * (n.thin_mul if n.mini else 1.0)
    P = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for x, y in P:
        n.part(n.box((x, y, (z0 + z1) / 2), (t, t, z1 - z0)), rim=False)
    levels = m.get("levels", 1)
    for li in range(levels + 1):
        z = z0 + (z1 - z0) * li / levels
        for (ax, ay), (bx, by) in zip(P, P[1:] + P[:1]):
            n.part(n.beam((ax, ay, z), (bx, by, z), t, t), rim=False)
    sides = {"front": (P[0], P[1]), "right": (P[1], P[2]), "back": (P[2], P[3]), "left": (P[3], P[0])}
    for sd in m.get("x", ["front", "right", "back", "left"]):
        (ax, ay), (bx, by) = sides[sd]
        for li in range(levels):
            za = z0 + (z1 - z0) * li / levels
            zb = z0 + (z1 - z0) * (li + 1) / levels
            n.part(n.beam((ax, ay, za), (bx, by, zb), t * 0.8, t * 0.8), rim=False)
            n.part(n.beam((bx, by, za), (ax, ay, zb), t * 0.8, t * 0.8), rim=False)
    if m.get("deck"):
        n.part(n.box(((x0 + x1) / 2, (y0 + y1) / 2, z1 + 0.2), (x1 - x0 + 0.6, y1 - y0 + 0.6, 0.4)), rim=True)


def stairs(n, m):
    """Straight stair from p0 (bottom) to p1 (top): stringers + treads, width w."""
    p0, p1 = Vector(m["from"]), Vector(m["to"])
    w = m.get("w", 1.4)
    run = p1 - p0
    hor = Vector((run.x, run.y, 0)).normalized()
    side = Vector((0, 0, 1)).cross(hor) * (w / 2)
    t = 0.25 * (n.thin_mul if n.mini else 1.0)
    for sgn in (-1, 1):
        n.part(n.beam(p0 + side * sgn, p1 + side * sgn, t, t * 1.6), rim=False)
    if n.mini:
        return
    k = max(2, int(run.z / 0.6))
    for i in range(1, k):
        q = p0 + run * (i / k)
        n.part(n.box_r(q, (w, 0.5, 0.1), hor.to_track_quat("Y", "Z").to_matrix()), glow=0.35, rim=False)


def lamps(n, m):
    """Light masts: pole + lamp head (glowing)."""
    h = m.get("h", 6.0)
    z0 = m.get("z0", 0.0)
    tp = 0.3 * n.thin_mul
    for x, y in m["at"]:
        n.part(n.box((x, y, z0 + h / 2), (tp, tp, h)), rim=False)
        n.part(n.box((x, y, z0 + 0.3), (0.9, 0.9, 0.6)), rim=True)
        n.part(n.box((x, y, z0 + h + 0.35), (0.9, 0.9, 0.7)), glow=1.0, rim=False)
        n.part(n.box((x, y, z0 + h + 0.8), (1.1, 1.1, 0.15)), rim=False)


def units(n, m):
    """Boxed units (AC / pumps / control cabinets) with vent slats on the face towards `face` yaw (deg)."""
    for b in m["boxes"]:
        x, y, z0, w, d, h = b[:6]
        yaw = math.radians(b[6]) if len(b) > 6 else 0.0
        n.part(n.box((x, y, z0 + h / 2), (w, d, h), yaw=yaw), rim=True)
        if n.mini:
            continue
        N = Vector((math.sin(yaw), -math.cos(yaw), 0))
        k = max(2, int(h / 0.45))
        for i in range(k):
            z = z0 + h * (i + 0.6) / (k + 0.2)
            c = Vector((x, y, z)) + N * (d / 2 + 0.03)
            n.part(n.box(c, (w * 0.8, 0.08, 0.1), yaw=yaw), glow=0.45, rim=False)


def profile(n, m):
    """Hall body: 2D outline in (x, z) (e.g. a box with cut roof corners) extruded along Y from y0 to y1.
    strips: glow boxes on its vertical faces (side front/back/left/right, u along the face, z)."""
    poly = [tuple(p) for p in m["poly"]]
    y0, y1 = m["y"]
    cx = m.get("x", 0.0)
    n.part(n.extrude2d(poly, y0, y1, (cx, 0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0)), rim=True)
    xs = [p[0] for p in poly]
    dist = {"front": -y0, "back": y1, "right": cx + max(xs), "left": -(cx + min(xs))}
    for st in m.get("strips", []):
        f = Frame(st["side"])
        n.part(n.box(f.p(st["u"], dist[st["side"]] + 0.05, st["z"]), (st["w"], 0.14, st["h"]), yaw=f.yaw),
               glow=1.0, rim=False)


def conveyor(n, m):
    """Belt conveyor on legs from `from` to `to` (horizontal): bed, side rails, end rollers, leg pairs every `legs` m,
    glowing chevrons on the belt pointing away from the building (`hidden`: [a, b] range along the belt inside it)."""
    p0, p1 = Vector(m["from"]), Vector(m["to"])
    w = m.get("w", 2.4)
    axis = p1 - p0
    L = axis.length
    A = axis.normalized()
    S = Vector((0, 0, 1)).cross(A)                         # across the belt
    R = A.to_track_quat("Y", "Z").to_matrix()              # local Y along the belt, Z up
    z = p0.z
    lo, hi = m.get("hidden", [L, L])                       # distances from p0 hidden inside the building
    bed = 0.4
    n.part(n.box_r((p0 + p1) / 2 + Vector((0, 0, -bed / 2)), (w, L, bed), R), rim=True)
    n.part(n.box_r((p0 + p1) / 2 + Vector((0, 0, 0.02)), (w * 0.8, L - 0.4, 0.06), R), glow=0.12, rim=False)
    tr = 0.18 * (n.thin_mul if n.mini else 1.0)
    for sg in (-1, 1):
        n.part(n.beam(p0 + S * sg * (w / 2 - tr / 2) + Vector((0, 0, 0.12)),
                      p1 + S * sg * (w / 2 - tr / 2) + Vector((0, 0, 0.12)), tr, 0.3), rim=False)
    for p in (p0, p1):
        n.part(n.cylinder(p + Vector((0, 0, -bed / 2)), bed * 0.7, w * 1.02, 10,
                          S.to_track_quat("Z", "Y").to_matrix()), glow=0.0, rim=True)
    step = m.get("legs", 3.0)
    lt = 0.28 * (n.thin_mul if n.mini else 1.0)
    d = 0.6
    while d < L - 0.3:
        if not (lo - 0.5 < d < hi + 0.5):
            q = p0 + A * d
            for sg in (-1, 1):
                n.part(n.box(q + S * sg * (w / 2 - 0.25) + Vector((0, 0, (z - bed) / 2)), (lt, lt, z - bed)), rim=False)
            n.part(n.beam(q - S * (w / 2 - 0.25) + Vector((0, 0, 0.5)), q + S * (w / 2 - 0.25) + Vector((0, 0, 0.5)),
                          lt, lt), rim=False)
            n.part(n.box(q + Vector((0, 0, 0.1)), (w * 0.9, 0.5, 0.2), yaw=math.atan2(A.y, A.x) + math.pi / 2),
                   rim=False)
        d += step
    k = m.get("chevrons", 3)
    ch = min(w * 0.5, 1.2)
    centre = (lo + hi) / 2 if hi < L else L / 2
    for seg0, seg1, sgn in ((0.0, lo, -1), (hi, L, 1)):
        if seg1 - seg0 < 1.0:
            continue
        for i in range(k):
            dd = seg0 + (seg1 - seg0) * (i + 0.5) / k
            sgn_i = sgn if hi < L else (1 if dd > centre else -1)
            poly = G.chevron(ch, ch * 0.45, ch * 0.22)
            org = p0 + A * dd + Vector((0, 0, 0.05))
            n.part(n.extrude2d(poly, 0.0, 0.08, org, A * sgn_i, S * sgn_i, (0, 0, 1)), glow=1.0, rim=False)


def stacks(n, m):
    """Smelter chimneys: base block, body, glowing band, wide top collar (open look: dark inner disc)."""
    r, z0, h = m["r"], m["z0"], m["h"]
    for x, y in m["at"]:
        n.part(n.box((x, y, z0 + 0.3), (r * 2.6, r * 2.6, 0.6)), rim=True)
        n.part(n.cylinder((x, y, z0 + h / 2), r, h, 16), rim=True)
        n.part(n.annulus((x, y, z0 + h * 0.62), r + 0.08, r - 0.05, 0.3, 16), glow=0.8, rim=False)
        n.part(n.annulus((x, y, z0 + h + 0.2), r * 1.3, r * 0.72, 0.5, 16), rim=True)
        n.part(n.cylinder((x, y, z0 + h + 0.05), r * 0.74, 0.1, 16), glow=0.0, rim=False)


def roof_fans(n, m):
    """Fan box lying on a roof: fans face up (rings glow), n fans along X."""
    x, y, z0 = m["at"]
    w, d, h = m["size"]
    k, r = m["n"], m["r"]
    n.part(n.box((x, y, z0 + h / 2), (w, d, h)), rim=True)
    for i in range(k):
        c = Vector((x + (i - (k - 1) / 2) * (w / k), y, z0 + h + 0.06))
        n.part(n.annulus(c, r, r * 0.8, 0.14, 20), glow=0.8, rim=False)
        n.part(n.cylinder(c - Vector((0, 0, 0.04)), r * 0.8, 0.05, 20), rim=False)
        for sg in (-1, 1):
            n.part(n.box(c, (r * 1.6, 0.08 + 0.0, 0.08), yaw=sg * math.pi / 4), glow=0.35, rim=False)
        n.part(n.cylinder(c + Vector((0, 0, 0.05)), r * 0.18, 0.1, 10), glow=0.8, rim=False)


def robots(n, m):
    """Assembly robot arms on pedestals: base, turret, shoulder / elbow / wrist joints (glowing), two-finger gripper.
    at: [[x, y, z0, scale, yaw_deg], ...]; yaw 0 = reaching to the front (-Y)."""
    k = n.thin_mul if n.mini else 1.0
    for x, y, z0, sc, yaw in m["at"]:
        a = math.radians(yaw)
        F = Vector((math.sin(a), -math.cos(a), 0))             # forward
        Sd = Vector((math.cos(a), math.sin(a), 0))              # side
        U = Vector((0, 0, 1))
        b = Vector((x, y, z0))
        n.part(n.box(b + U * 0.15 * sc, (1.1 * sc, 1.1 * sc, 0.3 * sc), yaw=a), rim=True)
        n.part(n.cylinder(b + U * 0.45 * sc, 0.38 * sc, 0.3 * sc, 14), rim=True)
        sh = b + U * 0.8 * sc
        el = sh + (F * 0.3 + U * 1.0) * sc
        wr = el + (F * 0.95 - U * 0.3) * sc
        n.part(n.box(sh - U * 0.1 * sc, (0.5 * sc, 0.5 * sc, 0.4 * sc), yaw=a), rim=True)
        Rj = Sd.to_track_quat("Z", "Y").to_matrix()             # joint axis across the arm
        for j, r in ((sh, 0.2), (el, 0.17), (wr, 0.13)):
            n.part(n.cylinder(j, r * sc * k, 0.36 * sc * k, 12, Rj), glow=1.0, rim=False)
        n.part(n.beam(sh, el, 0.26 * sc * k, 0.26 * sc * k), glow=0.4, rim=False)
        n.part(n.beam(el, wr, 0.21 * sc * k, 0.21 * sc * k), glow=0.4, rim=False)
        g0 = wr - U * 0.12 * sc
        n.part(n.box(g0, (0.36 * sc * k, 0.16 * sc * k, 0.12 * sc * k), yaw=a), rim=False)
        for sg in (-1, 1):
            tip = g0 + Sd * sg * 0.13 * sc
            n.part(n.beam(tip, tip - U * 0.32 * sc + Sd * sg * 0.04 * sc, 0.07 * sc * k, 0.07 * sc * k), glow=0.6, rim=False)


def crates(n, m):
    for x, y, z0, w, d, h, yaw in m["boxes"]:
        n.part(n.box((x, y, z0 + h / 2), (w, d, h), yaw=math.radians(yaw)), rim=True)


def generic_box(n, m):
    for b in m["boxes"]:
        x, y, z, sx, sy, sz = b[:6]
        yaw = math.radians(b[6]) if len(b) > 6 else 0.0
        n.part(n.box((x, y, z), (sx, sy, sz), yaw=yaw), glow=m.get("glow", 0.0), rim=m.get("rim", True))


BUILDERS = {"plate": plate, "mass": mass, "pylons": pylons, "buttresses": buttresses, "gate": gate, "arm": arm,
            "shutter": shutter, "fans": fans, "tanks": tanks, "tower": tower, "railing": railing, "dish": dish,
            "antennas": antennas, "banner": banner, "pipes": pipes, "crates": crates, "box": generic_box,
            "columns": columns, "lattice": lattice, "stairs": stairs, "lamps": lamps, "units": units,
            "profile": profile, "conveyor": conveyor, "stacks": stacks, "roof_fans": roof_fans,
            "robots": robots}


def build(n, module):
    if n.mini and module.get("detail"):
        return
    BUILDERS[module["type"]](n, module)
