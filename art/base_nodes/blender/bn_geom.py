"""Low-level geometry for the base-node holograms: everything is added into ONE shared bmesh.

Each builder returns the list of new faces; `Part` records them with a glow value and whether the hard edges get a
rim (bevel). After the whole node is built, `finish()` bevels the rims, writes the vertex colour channels and
triangulates:

    R = edge rim (1 on bevel faces)     -> bright lines along the hard edges of the hologram
    G = glow (windows, chevrons, outline, fan rings) -> brightest parts
    B = dim (1 on the inner top of the ground plate: fill darkened so only its outline reads)
    A = accent (1 = FICSIT orange instead of the hologram blue: warning lights, safety railings)

Conventions (same as the Command Center): metres, Z up, front = -Y, pivot = footprint centre on the ground.
"""
import math

import bpy  # noqa: F401  (must be imported before bmesh when running from the bpy wheel)
import bmesh
from mathutils import Matrix, Vector

RIM_ANGLE = math.radians(35.0)          # only edges sharper than this get a rim (cylinder segments do not)


class Node:
    """Shared bmesh + face layers for one node mesh."""

    def __init__(self, rim, outline, thin_mul=1.0, mini=False):
        self.bm = bmesh.new()
        self.glow = self.bm.faces.layers.float.new("glow")
        self.edge = self.bm.faces.layers.float.new("edge")
        self.dim = self.bm.faces.layers.float.new("dim")
        self.accent = self.bm.faces.layers.float.new("accent")
        self.parts = []                 # (faces, rim) per part
        self.rim = rim                  # bevel width in metres (model scale)
        self.outline = outline          # width of the glowing plate outline (model scale)
        self.thin_mul = thin_mul        # widen thin parts (masts, poles) for the small multi-mode meshes
        self.mini = mini

    # -- part bookkeeping ---------------------------------------------------------------------------------------
    def part(self, faces, glow=0.0, rim=True, accent=0.0):
        for f in faces:
            f[self.glow] = glow
            f[self.edge] = 0.0
            f[self.dim] = 0.0
            f[self.accent] = accent
        self.parts.append((faces, rim))
        return faces

    # -- primitives ---------------------------------------------------------------------------------------------
    def _ring_faces(self, lo, hi, caps=True):
        bm, out = self.bm, []
        n = len(lo)
        if caps:
            out.append(bm.faces.new(list(reversed(lo))))
            out.append(bm.faces.new(hi))
        for i in range(n):
            j = (i + 1) % n
            out.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
        return out

    def loft(self, poly0, z0, poly1, z1):
        """Two horizontal polygons with the same vertex count -> closed solid (terraces, pylons, prisms)."""
        lo = [self.bm.verts.new((x, y, z0)) for x, y in poly0]
        hi = [self.bm.verts.new((x, y, z1)) for x, y in poly1]
        return self._ring_faces(lo, hi)

    def prism(self, poly, z0, z1):
        return self.loft(poly, z0, poly, z1)

    def extrude2d(self, poly, d0, d1, origin=(0, 0, 0), u=(1, 0, 0), v=(0, 0, 1), w=(0, 1, 0)):
        """2D polygon in (u, v) extruded along w from d0 to d1; world = origin + u*a + v*b + w*d."""
        o, U, V, W = Vector(origin), Vector(u), Vector(v), Vector(w)
        lo = [self.bm.verts.new(o + U * a + V * b + W * d0) for a, b in poly]
        hi = [self.bm.verts.new(o + U * a + V * b + W * d1) for a, b in poly]
        return self._ring_faces(lo, hi)

    def box(self, center, size, yaw=0.0, pitch=0.0):
        """Box (size x, y, z) rotated by pitch about local X, then yaw about Z, around its centre."""
        hx, hy, hz = (s / 2 for s in size)
        R = Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(pitch, 3, "X")
        c = Vector(center)
        pts = [c + R @ Vector((sx * hx, sy * hy, sz * hz)) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        vs = [self.bm.verts.new(p) for p in pts]
        lo = [vs[0], vs[1], vs[3], vs[2]]
        hi = [vs[4], vs[5], vs[7], vs[6]]
        return self._ring_faces(lo, hi)

    def cylinder(self, center, r, h, seg=16, R=None):
        """Cylinder along local Z (R rotates it), centred on `center`."""
        R = R or Matrix.Identity(3)
        c = Vector(center)
        ring = [(r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        lo = [self.bm.verts.new(c + R @ Vector((x, y, -h / 2))) for x, y in ring]
        hi = [self.bm.verts.new(c + R @ Vector((x, y, h / 2))) for x, y in ring]
        return self._ring_faces(lo, hi)

    def annulus(self, center, r_out, r_in, depth, seg=20, R=None):
        """Flat ring (fan rims, emitter rings) along local Z, built from quads (no boolean)."""
        R = R or Matrix.Identity(3)
        c, bm, out = Vector(center), self.bm, []
        ang = [2 * math.pi * i / seg for i in range(seg)]
        P = lambda r, a, z: bm.verts.new(c + R @ Vector((r * math.cos(a), r * math.sin(a), z)))
        oo = [P(r_out, a, -depth / 2) for a in ang]
        oi = [P(r_in, a, -depth / 2) for a in ang]
        to = [P(r_out, a, depth / 2) for a in ang]
        ti = [P(r_in, a, depth / 2) for a in ang]
        for i in range(seg):
            j = (i + 1) % seg
            out += [bm.faces.new((to[i], to[j], ti[j], ti[i])), bm.faces.new((oi[i], oi[j], oo[j], oo[i])),
                    bm.faces.new((oo[i], oo[j], to[j], to[i])), bm.faces.new((ti[i], ti[j], oi[j], oi[i]))]
        return out

    def beam(self, p0, p1, w, h):
        """Box from p0 to p1 (axis), section w (horizontal) x h."""
        p0, p1 = Vector(p0), Vector(p1)
        axis = p1 - p0
        ln = axis.length
        R = axis.to_track_quat("Z", "Y").to_matrix()
        return self.box_r((p0 + p1) / 2, (w, h, ln), R)

    def box_r(self, center, size, R):
        hx, hy, hz = (s / 2 for s in size)
        c = Vector(center)
        pts = [c + R @ Vector((sx * hx, sy * hy, sz * hz)) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        vs = [self.bm.verts.new(p) for p in pts]
        return self._ring_faces([vs[0], vs[1], vs[3], vs[2]], [vs[4], vs[5], vs[7], vs[6]])

    def lathe(self, profile, seg, R, center):
        """Closed (r, z) profile revolved about local Z (dish). Points with r == 0 are welded afterwards."""
        bm, c = self.bm, Vector(center)
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rings.append([bm.verts.new(c + R @ Vector((r * math.cos(a), r * math.sin(a), z))) for r, z in profile])
        out, n = [], len(profile)
        for i in range(seg):
            j = (i + 1) % seg
            for k in range(n):
                q = (rings[i][k], rings[j][k], rings[j][(k + 1) % n], rings[i][(k + 1) % n])
                out.append(bm.faces.new(q))
        return out

    # -- finish -------------------------------------------------------------------------------------------------
    def finish(self):
        bm = self.bm
        # weld lathe poles, drop degenerate faces created by r == 0 profile points
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        for faces, rim in self.parts:
            faces = [f for f in faces if f.is_valid]
            if not faces:
                continue
            bmesh.ops.recalc_face_normals(bm, faces=faces)
            if not (rim and self.rim > 0):
                continue
            edges = {e for f in faces for e in f.edges}
            hard = [e for e in edges if e.is_manifold and e.calc_face_angle(0.0) > RIM_ANGLE]
            if not hard:
                continue
            res = bmesh.ops.bevel(bm, geom=hard, offset=self.rim, offset_type="OFFSET", segments=1, profile=0.5,
                                  affect="EDGES", clamp_overlap=True)
            for f in res["faces"]:
                f[self.edge] = 1.0
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="EAR_CLIP")
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        col = bm.loops.layers.float_color.new("Col")
        for f in bm.faces:
            c = (f[self.edge], f[self.glow], f[self.dim], f[self.accent])
            for loop in f.loops:
                loop[col] = c
        return bm


# ---------------------------------------------------------------------------------------------------------------
# 2D helpers
# ---------------------------------------------------------------------------------------------------------------
def chamfer_rect(hx, hy, c, cx=0.0, cy=0.0):
    c = min(c, hx * 0.99, hy * 0.99)
    pts = [(-hx + c, -hy), (hx - c, -hy), (hx, -hy + c), (hx, hy - c),
           (hx - c, hy), (-hx + c, hy), (-hx, hy - c), (-hx, -hy + c)]
    return [(x + cx, y + cy) for x, y in pts]


def octagon(r, cx=0.0, cy=0.0):
    """Circumradius r, flat faces facing ±X / ±Y (vertices at 22.5° + k·45°)."""
    return [(cx + r * math.cos(math.pi / 8 + i * math.pi / 4), cy + r * math.sin(math.pi / 8 + i * math.pi / 4))
            for i in range(8)]


def cross(core, arm, reach, chamfer):
    """Plate outline: chamfered core square (half size `core`) + four arms (half width `arm`) out to `reach`."""
    c, a, L, k = core, arm, reach, chamfer
    if not arm or reach <= core:
        return chamfer_rect(c, c, k)
    # one quarter (front arm right edge -> front-right corner -> right arm), CCW; rotating it by 90° gives the next
    # quarter, whose first point (L, a) closes the right arm tip
    q = [(a, -L), (a, -c), (c - k, -c), (c, -c + k), (c, -a), (L, -a)]
    out = []
    for i in range(4):
        R = Matrix.Rotation(i * math.pi / 2, 2)
        out += [tuple(R @ Vector(p)) for p in q]
    return _dedupe(out)


def plate_outline(hx, hy, k, arms=None):
    """Rectangular core (half sizes hx, hy, corner chamfer k) with optional centred arms per side:
    arms = {"front": [half_width, reach], "right": [...], "back": [...], "left": [...]} (reach from the centre);
    left / right arms take an optional third value: Y offset of the arm centre (belts off the centre line)."""
    arms = arms or {}
    pts = [(-hx + k, -hy)]
    if "front" in arms:
        a, L = arms["front"]
        pts += [(-a, -hy), (-a, -L), (a, -L), (a, -hy)]
    pts += [(hx - k, -hy), (hx, -hy + k)]
    if "right" in arms:
        a, L, o = (arms["right"] + [0.0])[:3]
        pts += [(hx, o - a), (L, o - a), (L, o + a), (hx, o + a)]
    pts += [(hx, hy - k), (hx - k, hy)]
    if "back" in arms:
        a, L = arms["back"]
        pts += [(a, hy), (a, L), (-a, L), (-a, hy)]
    pts += [(-hx + k, hy), (-hx, hy - k)]
    if "left" in arms:
        a, L, o = (arms["left"] + [0.0])[:3]
        pts += [(-hx, o + a), (-L, o + a), (-L, o - a), (-hx, o - a)]
    pts += [(-hx, -hy + k)]
    return _dedupe(pts)


def plate_poly(m):
    """Outline of a `plate` module: square cross (core, arm, reach) or rectangle + per-side arms (core [hx, hy])."""
    if isinstance(m["core"], list):
        return plate_outline(m["core"][0], m["core"][1], m["chamfer"], m.get("arms"))
    return cross(m["core"], m.get("arm", 0), m.get("reach", 0), m["chamfer"])


def drop(h):
    """Liquid drop glyph, height h, tip up, centred on its round part (2D)."""
    r = h * 0.36
    cy = -h * 0.5 + r
    pts = [(0.0, h * 0.5)]
    a0 = math.radians(40)                                  # tangent point of the tip lines on the circle
    for i in range(15):
        a = a0 - (math.pi + 2 * a0) * i / 14               # from the right tangent clockwise round the bottom
        pts.append((r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _dedupe(pts):
    res = []
    for p in pts:
        if not res or (abs(p[0] - res[-1][0]) > 1e-6 or abs(p[1] - res[-1][1]) > 1e-6):
            res.append(p)
    if abs(res[0][0] - res[-1][0]) < 1e-6 and abs(res[0][1] - res[-1][1]) < 1e-6:
        res.pop()
    return res


def chevron(h, a, t):
    """'>' pointing +u, height h, depth a, stroke t (2D, centred at the origin)."""
    pts = [(0, h / 2), (t, h / 2), (a + t, 0), (t, -h / 2), (0, -h / 2), (a, 0)]
    return [(x - (a + t) / 2, y) for x, y in pts]


def arch_frame(W, H, t, c):
    """Portal U-frame (open at the bottom), outer chamfer c, stroke t."""
    ci = max(c - t * 0.4, 0.05)
    return [(-W / 2, 0), (-W / 2, H - c), (-W / 2 + c, H), (W / 2 - c, H), (W / 2, H - c), (W / 2, 0),
            (W / 2 - t, 0), (W / 2 - t, H - t - ci), (W / 2 - t - ci, H - t), (-W / 2 + t + ci, H - t),
            (-W / 2 + t, H - t - ci), (-W / 2 + t, 0)]


def poly_radius(poly):
    return max(math.hypot(x, y) for x, y in poly)
