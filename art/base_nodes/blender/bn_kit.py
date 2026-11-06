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
    poly = G.cross(m["core"], m.get("arm", 0), m.get("reach", 0), m["chamfer"])
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
    for sx in (-1, 1):
        for sy in (-1, 1):
            mm = {"base": [b, b], "top": [t, t], "z": m["z"], "chamfer": m["chamfer"]}
            mass(n, mm, center=(sx * a, sy * a), top_offset=(-sx * lean, -sy * lean))
            d = m.get("dots")
            if d and sy < 0:                      # light dots on the front face of the two front pylons
                for z in d["z"]:
                    _slope_box(n, "front", (sx * a, sy * a), (b, b), (t, t), (-sx * lean, -sy * lean), m["z"],
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
    o = Vector((0, 0, 0))
    n.part(n.extrude2d(G.arch_frame(W, H, t, c), b, fr, o, f.U, (0, 0, 1), f.N), rim=True)
    pd = m["panel"]
    n.part(n.box(f.p(0, pd, (H - t) / 2), (W - 2 * t + 0.1, 0.3, H - t + 0.05), yaw=f.yaw), rim=False)
    i = m["inner"]
    n.part(n.extrude2d(G.arch_frame(i["W"], i["H"], i["t"], c * 0.7), pd + 0.1, fr - 0.45, o, f.U, (0, 0, 1), f.N),
           rim=True)
    ch = m["chevrons"]
    for k in range(ch["n"]):
        u = (k - (ch["n"] - 1) / 2) * ch["pitch"]
        org = f.p(u, 0, ch["z"])
        poly = G.chevron(ch["h"], ch["h"] * 0.45, ch["h"] * 0.22)
        n.part(n.extrude2d(poly, pd + 0.15, pd + 0.28, org, f.U, (0, 0, 1), f.N), glow=1.0, rim=False)
    for s in m.get("strips", []):
        n.part(n.box(f.p(s["u"], fr + 0.05, s["z"]), (s["w"], 0.14, s["h"]), yaw=f.yaw), glow=1.0, rim=False)
    st = m.get("steps")
    if st:
        k = st["n"]
        for j in range(k):
            d0 = fr - 0.2 + st["len"] * j / k
            hz = st["h"] * (k - j) / k
            n.part(n.box(f.p(0, d0 + st["len"] / k / 2 + 0.1, hz / 2), (st["w"], st["len"] / k + 0.2, hz), yaw=f.yaw),
                   rim=True)
            n.part(n.box(f.p(0, d0 + 0.12, hz + 0.02), (st["w"] * 0.9, 0.12, 0.05), yaw=f.yaw), glow=0.7, rim=False)


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
        poly = [(-a, -a), (a, -a), (a, a), (-a, a)]
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
            "antennas": antennas, "banner": banner, "pipes": pipes, "crates": crates, "box": generic_box}


def build(n, module):
    if n.mini and module.get("detail"):
        return
    BUILDERS[module["type"]](n, module)
