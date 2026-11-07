"""Links between base nodes on the projector: one glowing ribbon per connection (direction + rate).

Reference implementation in plain Python (no bpy): the C++ UFAIHHoloNodeDisplayComponent::SetLinks mirrors it, and the
preview renders and the 2D screen mock-up use it directly. Units: metres on the hologram (socket space, X right,
Y back, Z up), node slots and plate outlines as in nodes.json -> display.

    route_multi(links, slots, outlines, scales, cfg)  -> [Path]   2-5 nodes on the projector
    route_single(links, node, outline, scale, cfg)    -> [Path]   one node: short stubs to the platform edge

A link is {"from": node_id, "to": node_id, "rate": items per minute, "label": text}; several resources between the same
two nodes are ONE link (the label lists them, the rate is the sum). A Path has the sampled centre line `pts`
(x, y), cumulative distance `dist`, ribbon `width`, dash `speed` and the label anchor `label_at`.
"""
import math


# ---------------------------------------------------------------------------------------------------------------------
# small 2D helpers
# ---------------------------------------------------------------------------------------------------------------------
def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def mul(a, k):
    return (a[0] * k, a[1] * k)


def length(a):
    return math.hypot(a[0], a[1])


def norm(a):
    n = length(a)
    return (a[0] / n, a[1] / n) if n > 1e-9 else (1.0, 0.0)


def left(a):
    return (-a[1], a[0])


def rot(p, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


def seg_dist(p, a, b):
    ab = sub(b, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / max(1e-9, ab[0] ** 2 + ab[1] ** 2)))
    return length(sub(p, add(a, mul(ab, t))))


def ray_exit(outline, d):
    """Distance from the plate centre (0, 0) to the outline along direction d (outline is star-shaped about 0)."""
    best = None
    for p, q in zip(outline, outline[1:] + outline[:1]):
        e = sub(q, p)
        den = d[0] * e[1] - d[1] * e[0]
        if abs(den) < 1e-12:
            continue
        t = (p[0] * e[1] - p[1] * e[0]) / den               # along the ray
        u = (p[0] * d[1] - p[1] * d[0]) / den               # along the edge
        if t > 0 and -1e-6 <= u <= 1 + 1e-6 and (best is None or t < best):
            best = t
    return best or 0.0


def rate_t(rate, cfg):
    lo, hi = cfg["rate_range"]
    return max(0.0, min(1.0, math.log(max(rate, lo) / lo) / math.log(hi / lo)))


def lerp(a, b, t):
    return a + (b - a) * t


class Path:
    def __init__(self, pts, width, speed, label_at, link):
        self.pts, self.width, self.speed, self.label_at, self.link = pts, width, speed, label_at, link
        self.dist = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.dist.append(self.dist[-1] + length(sub(b, a)))


def _style(link, cfg):
    t = rate_t(link["rate"], cfg)
    return lerp(*cfg["width_mm"], t) / 1000.0, lerp(*cfg["speed_mm_s"], t) / 1000.0


def _bezier(p0, c, p1, n):
    return [add(add(mul(p0, (1 - t) ** 2), mul(c, 2 * (1 - t) * t)), mul(p1, t * t)) for t in (i / n for i in range(n + 1))]


def anchor(centre, outline, scale, towards, gap):
    """Point on the plate edge of a node at `centre` (outline in model metres, hologram scale) facing `towards`."""
    d = norm(sub(towards, centre))
    return add(centre, mul(d, ray_exit(outline, d) * scale + gap))


# ---------------------------------------------------------------------------------------------------------------------
def route_multi(links, slots, outlines, scales, cfg):
    """slots: node_id -> (x, y) on the projector; outlines: node_id -> plate outline (model metres, after tier yaw);
    scales: node_id -> hologram scale of that node's mesh."""
    paths = []
    pairs = {(l["from"], l["to"]) for l in links}
    r_obs = cfg["obstacle_radius"]
    for l in links:
        a, b = l["from"], l["to"]
        if a not in slots or b not in slots or a == b:
            continue
        A, B = slots[a], slots[b]
        width, speed = _style(l, cfg)
        mid = mul(add(A, B), 0.5)
        ctrl = mid
        for k, C in slots.items():                         # bend around a node standing in the way
            if k in (a, b):
                continue
            if seg_dist(C, A, B) < r_obs + width:
                n = sub(mid, C)
                n = norm(n) if length(n) > 1e-6 else norm(left(sub(B, A)))
                through = add(C, mul(n, r_obs * 1.15))      # the curve's middle passes here
                ctrl = sub(mul(through, 2.0), mul(add(A, B), 0.5))
        gap = cfg["gap_mm"] / 1000.0
        p0 = anchor(A, outlines[a], scales[a], ctrl, gap)
        p1 = anchor(B, outlines[b], scales[b], ctrl, gap)
        if (b, a) in pairs:                                 # two directions: each keeps to its right-hand lane
            off = mul(norm(left(sub(p1, p0))), -cfg["lane_mm"] / 1000.0)
            p0, p1, ctrl = add(p0, off), add(p1, off), add(ctrl, off)
        pts = _bezier(p0, ctrl, p1, cfg["samples"])
        # a two-way pair: each label sits before the middle of its own lane, so the two do not cover each other
        at = pts[int(len(pts) * 0.32)] if (b, a) in pairs else pts[len(pts) // 2]
        paths.append(Path(pts, width, speed, at, l))
    return paths


def route_single(links, node, outline, scale, cfg):
    """One node fills the platform: every link becomes a stub from the plate edge out to the platform edge.
    Incoming links come from the left (-X), outgoing go to the right (+X), spread over +-`spread` degrees."""
    paths = []
    ins = [l for l in links if l["to"] == node and l["from"] != node]
    outs = [l for l in links if l["from"] == node and l["to"] != node]
    R = cfg["single_edge"]
    gap = cfg["gap_mm"] / 1000.0
    for group, base in ((ins, 180.0), (outs, 0.0)):
        n = len(group)
        for i, l in enumerate(group):
            ang = base + (0.0 if n == 1 else lerp(-cfg["spread"], cfg["spread"], i / (n - 1)) * (1 if base == 0 else -1))
            d = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
            inner = mul(d, ray_exit(outline, d) * scale + gap)
            outer = mul(d, R)
            width, speed = _style(l, cfg)
            p0, p1 = (outer, inner) if l["to"] == node else (inner, outer)
            pts = [add(p0, mul(sub(p1, p0), k / 6)) for k in range(7)]
            paths.append(Path(pts, width, speed, outer, l))
    return paths


def ribbon(path, z):
    """Triangle strip of a path: verts [(x, y, z)], uvs [(dist, v)], faces [(i, j, k, l)] - v 0 = left edge."""
    verts, uvs, faces = [], [], []
    pts = path.pts
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        nrm = norm(left(sub(b, a)))
        for v, sg in ((0.0, 1.0), (1.0, -1.0)):
            q = add(p, mul(nrm, sg * path.width / 2))
            verts.append((q[0], q[1], z))
            uvs.append((path.dist[i], v))
    for i in range(len(pts) - 1):
        faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    return verts, uvs, faces
