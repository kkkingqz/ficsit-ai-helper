"""Stage 6: game-ready meshes for UE — cleanup, normals, merge, LODs, UCX collision, clearance.

    python build_stage6.py [--out ../export/ue] [--render ../renders/stage6 --samples 24]

Pipeline (on top of the stage 5 build: UV0 + PaintMask already applied):
  1. cleanup      merge-by-distance 0.1 mm + dissolve degenerate geometry (boolean slivers) per part;
  2. split        hologram parts (every part using M_Holo) -> separate mesh SM_CommandCenter_Holo;
  3. LODs         LOD0 all parts; LOD1 without parts < LOD1_MIN m + planar dissolve 1 deg;
                  LOD2 exterior only (interior parts dropped), parts >= LOD2_MIN m, planar dissolve 5 deg,
                  glass faces -> M_MetalDark (opaque window);
  4. merge        each LOD -> one static mesh, one section per material slot;
  5. normals      smooth + sharp edges by angle 30 deg + weighted normals (keep sharp) -> custom split normals;
                  triangulate (beauty, keep custom normals); FBX exported with tangents;
  6. collision    convex UCX_SM_CommandCenter_NN boxes / prisms: walls with the door opening, floor around the
                  stair pit, steps, roof, console, projector, rails, cabinets, containers;
  7. export       export/ue/SM_CommandCenter.fbx (LOD0 + UCX), _LOD1.fbx, _LOD2.fbx, _Holo.fbx,
                  clearance.json, stage6 report.
The authoring export (export/SM_CommandCenter.fbx, separate parts) stays the source for renders and checks.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401
import bmesh
from mathutils import Vector

import build_model
import cc_lib
import interior_model as im

HERE = os.path.dirname(os.path.abspath(__file__))
MESH = "SM_CommandCenter"
LOD1_MIN, LOD2_MIN = 0.2, 0.4
LOD_COLLAPSE = (1.0, 0.55, 0.3)          # edge-collapse ratio after planar dissolve (LOD0 untouched)
SCREEN_SIZE = (1.0, 0.35, 0.12)          # suggested UE LOD screen sizes
SHARP_ANGLE = math.radians(30)


# ---- 1. cleanup -------------------------------------------------------------------------------------------------------
def slivers(me):
    """Degenerate 'needle' faces left by booleans: height (2 x area / longest edge) under 1 mm. Small but healthy faces
    (corner triangles of 12 mm chamfers, LEDs) are not counted."""
    n = 0
    for p in me.polygons:
        vs = [me.vertices[i].co for i in p.vertices]
        ln = max((vs[i] - vs[(i + 1) % len(vs)]).length for i in range(len(vs)))
        if ln > 1e-6 and 2 * p.area / ln < 1e-3:
            n += 1
    return n


def cleanup(coll):
    before = after = 0
    for ob in coll.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        before += slivers(me)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-3, edges=bm.edges)
        thin = [f for f in bm.faces if f.calc_area() < 1e-6]
        if thin:
            bmesh.ops.delete(bm, geom=thin, context="FACES_ONLY")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        me.update()
        after += slivers(me)
    return before, after


# ---- 2./3. split and LOD sets -----------------------------------------------------------------------------------------
def bbox(ob):
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))),
            Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))


def is_holo(ob):
    return any(m and m.name == "M_Holo" for m in ob.data.materials)


def is_interior(ob):
    lo, hi = bbox(ob)
    return (abs(lo.x) <= im.XW + 0.05 and abs(hi.x) <= im.XW + 0.05 and abs(lo.y) <= im.YW + 0.05
            and abs(hi.y) <= im.YW + 0.05 and lo.z >= im.F - 0.1 and hi.z <= cc_lib.CEIL + 0.3)


def copy_into(objs, coll):
    out = []
    for ob in objs:
        c = ob.copy()
        c.data = ob.data.copy()
        coll.objects.link(c)
        out.append(c)
    return out


# ---- 4./5. merge + normals --------------------------------------------------------------------------------------------
def join(objs, name):
    keep = objs[0]
    with bpy.context.temp_override(active_object=keep, selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    keep.name = name
    keep.data.name = name
    return keep


def remap_material(ob, src, dst_mat):
    me = ob.data
    names = [m.name if m else "" for m in me.materials]
    if src not in names:
        return
    si = names.index(src)
    if dst_mat.name in names:
        di = names.index(dst_mat.name)
    else:
        me.materials.append(dst_mat)
        di = len(me.materials) - 1
    for p in me.polygons:
        if p.material_index == si:
            p.material_index = di
    me.materials.pop(index=si)                 # Blender shifts the face indices above si itself (no manual shift!)


PROTECTED = ("M_Decal", "M_ScreenStatic", "M_ScreenRT", "M_Hazard", "M_LightWarm", "M_Beacon", "M_Holo")


def _keep_faces(ob, keep):
    """Delete the faces whose slot is not accepted by keep(slot_name)."""
    names = [m.name if m else "" for m in ob.data.materials]
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    drop = [f for f in bm.faces if not keep(names[f.material_index] if f.material_index < len(names) else "")]
    if drop:
        bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def protected_reduce(ob, dissolve_deg, ratio):
    """Planar dissolve + edge collapse on the tiling slots only: decals, screens, hazard and emissive faces keep their
    geometry and UVs (neither operation knows atlas cells; both would drag vertices into a neighbouring label / UI)."""
    other = ob.copy()
    other.data = ob.data.copy()
    for c in ob.users_collection:
        c.objects.link(other)
    _keep_faces(ob, lambda n: n not in PROTECTED)
    _keep_faces(other, lambda n: n in PROTECTED)
    if dissolve_deg > 0:
        cc_lib.apply_modifier(ob, "DECIMATE", decimate_type="DISSOLVE", angle_limit=math.radians(dissolve_deg),
                              delimit={"MATERIAL", "SEAM", "SHARP", "UV"})
    if ratio < 1.0:
        cc_lib.apply_modifier(ob, "DECIMATE", decimate_type="COLLAPSE", ratio=ratio, use_collapse_triangulate=True)
    return join([ob, other], ob.name)


def finish_mesh(ob, dissolve_deg=0.0, collapse=1.0):
    if dissolve_deg > 0 or collapse < 1.0:
        ob = protected_reduce(ob, dissolve_deg, collapse)
        hx, hy = cc_lib.W / 2, cc_lib.D / 2             # edge collapse may nudge a vertex past the footprint: clamp
        for v in ob.data.vertices:
            v.co.x = min(max(v.co.x, -hx), hx)
            v.co.y = min(max(v.co.y, -hy), hy)
            v.co.z = max(v.co.z, 0.0)
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=SHARP_ANGLE)
    cc_lib.apply_modifier(ob, "WEIGHTED_NORMAL", mode="FACE_AREA", weight=50, keep_sharp=True)
    cc_lib.apply_modifier(ob, "TRIANGULATE", quad_method="BEAUTY", ngon_method="BEAUTY", keep_custom_normals=True)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---- 6. collision -----------------------------------------------------------------------------------------------------
def collision(coll):
    """Convex UCX parts. The building stays walkable: floor around the stair pit, steps, walls with the door opening."""
    W, D, F = cc_lib.W, cc_lib.D, im.F
    XW, YW, CEIL, ROOF = im.XW, im.YW, cc_lib.CEIL, cc_lib.ROOF
    dx0, dx1 = cc_lib.DOOR_X - build_model.DOOR_W / 2, cc_lib.DOOR_X + build_model.DOOR_W / 2
    px0, px1, py0 = dx0 - 0.1, dx1 + 0.1, YW - 4 * 0.3
    boxes = [
        # floor slab (top = interior floor), split around the stair pit
        ((-XW, -YW, 0.0), (XW, py0, F)), ((-XW, py0, 0.0), (px0, YW, F)), ((px1, py0, 0.0), (XW, YW, F)),
        # steps 0.25 m each (inside the pit, from the door down at ground level up to the floor)
        *[((px0, YW - 0.3 * (i + 1), 0.0), (px1, YW - 0.3 * i, 0.25 * (i + 1))) for i in range(4)],
        # outer walls (full footprint thickness), back wall split around the door
        ((-W / 2, -D / 2, 0.0), (W / 2, -YW, ROOF)),                     # front incl. glazing
        ((-W / 2, -YW, 0.0), (-XW, YW, ROOF)), ((XW, -YW, 0.0), (W / 2, YW, ROOF)),
        ((-W / 2, YW, 0.0), (dx0, D / 2, ROOF)), ((dx1, YW, 0.0), (W / 2, D / 2, ROOF)),
        ((dx0, YW, build_model.DOOR_H), (dx1, D / 2, ROOF)),              # lintel over the door
        # ceiling / roof slab + roof superstructure
        ((-XW, -YW, CEIL), (XW, YW, ROOF)),
        ((-3.7, -1.2, ROOF), (3.7, 2.1, ROOF + 0.8)),
        # console: centre body + wings (rotated boxes) + screens wall behind, tower, drive cabinet
        ("console",),
        # projector pedestal (octagon prism), rails, back service group, left racks, containers, window band
        ("holo",),
        ((px0 - 0.15, py0, F), (px0 + 0.01, YW - 0.2, F + 1.1)), ((px1 - 0.01, py0, F), (px1 + 0.15, YW - 0.2, F + 1.1)),
        ((2.9, YW - 0.65, F), (6.55, YW, F + 2.45)),
        ((-XW, -0.5, F), (-XW + 0.62, 2.7, F + 2.5)),
        ((-6.3, 2.5, F), (-4.3, YW, F + 0.75)),
        ((1.4, YW - 0.45, F), (2.85, YW, F + 2.2)),                      # power group: trunk + distribution board
        ((im.HOLO_XY[0] + 0.1, im.HOLO_XY[1] + 1.3, F), (im.HOLO_XY[0] + 0.8, im.HOLO_XY[1] + 1.72, F + 0.72)),  # energy node
        ((0.4, -YW, F), (6.5, -YW + 0.3, 2.15)),
    ]
    out, k = [], 0

    def add(ob):
        nonlocal k
        ob.name = f"UCX_{MESH}_{k:02d}"
        ob.data.name = ob.name
        out.append(ob)
        k += 1

    for b in boxes:
        if b == ("console",):
            P0 = im._frame(im.CONSOLE_X, im.CONSOLE_Y, 0.0)
            add(cc_lib.box("tmp", (*P0(0, 0), im.F + 0.6), (im.CONSOLE_W, im.CONSOLE_DEPTH + 0.15, 1.2), None, coll))
            for s in (-1, 1):
                inner = (im.CONSOLE_X + s * im.CONSOLE_W / 2, im.CONSOLE_Y)
                cx = inner[0] + s * math.cos(im.WING_ANGLE) * (im.WING_W + 0.7) / 2
                cy = inner[1] + math.sin(im.WING_ANGLE) * (im.WING_W + 0.7) / 2
                add(cc_lib.box("tmp", (cx, cy, im.F + 0.9), (im.WING_W + 0.7, im.CONSOLE_DEPTH + 0.15, 1.8), None, coll,
                               rot_z=s * im.WING_ANGLE))
            add(cc_lib.box("tmp", (im.CONSOLE_X, im.CONSOLE_Y - 0.35, im.F + 2.0), (im.CONSOLE_W, 0.2, 1.6), None, coll))
            continue
        if b == ("holo",):
            add(cc_lib.prism("tmp", cc_lib.octagon(1.4, *im.HOLO_XY), "z", im.F, im.F + 1.0, None, coll))
            continue
        (x0, y0, z0), (x1, y1, z1) = b
        add(cc_lib.box("tmp", ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), None, coll))
    for ob in out:
        ob.display_type = "WIRE"
    return out


# ---- sockets ---------------------------------------------------------------------------------------------------------
def sockets(parent):
    """UE static-mesh sockets: empties named SOCKET_<name> parented to the mesh (imported from FBX)."""
    F = im.F
    pw = bpy.data.objects.get("SOCKET_power")
    if pw:
        pw.name = "REF_socket_power"                   # authoring marker; the exported socket takes the clean name
    spec = {"power": (tuple(pw.location) if pw else (5.0, cc_lib.D / 2, 1.42)),
            "interact": (im.OPERATOR_XY[0], im.OPERATOR_XY[1] + 0.15, F + 1.1),     # E-zone centre at the console
            "ui_camera": (im.OPERATOR_XY[0], im.OPERATOR_XY[1] + 0.15, F + 1.65),  # eye point facing the main screen
            "holo": (im.HOLO_XY[0], im.HOLO_XY[1], F + 2.05),                        # hologram centre (BP spin / hide)
            "door": (cc_lib.DOOR_X, cc_lib.D / 2, 0.0)}                               # outside door threshold
    out = []
    for name, loc in spec.items():
        e = bpy.data.objects.new(f"SOCKET_{name}", None)
        e.empty_display_size = 0.3
        e.location = loc
        if name == "ui_camera":
            e.rotation_euler = (math.radians(90), 0.0, math.radians(180))         # looks towards -y (the main screen)
        for c in parent.users_collection:
            c.objects.link(e)
        e.parent = parent
        out.append(e)
    return out


# ---- LOD atlas integrity -------------------------------------------------------------------------------------------
def atlas_violations(ob):
    """Faces on M_Decal / M_ScreenStatic whose UVs do not all sit in ONE atlas cell (bleeding into a neighbour)."""
    import stage5_layout as L
    rects = {"M_Decal": [L.decal_rect(c) for c in L.DECAL_CELLS],
             "M_ScreenStatic": [L.screen_rect(c) for c in L.SCREEN_CELLS + ["led"]]}
    me = ob.data
    uvl = me.uv_layers.get("UVMap")
    names = [m.name if m else "" for m in me.materials]
    bad = checked = 0
    for p in me.polygons:
        slot = names[p.material_index] if p.material_index < len(names) else ""
        if slot not in rects:
            continue
        checked += 1
        uvs = [uvl.data[li].uv for li in p.loop_indices]
        if not any(all(r[0] - 1e-4 <= u.x <= r[2] + 1e-4 and r[1] - 1e-4 <= u.y <= r[3] + 1e-4 for u in uvs)
                   for r in rects[slot]):
            bad += 1
            if os.environ.get("CC_DEBUG") and bad <= 6:
                print("[atlas]", ob.name, slot, [tuple(round(c, 3) for c in u) for u in uvs],
                      tuple(round(c, 2) for c in p.center))
    return bad, checked


# ---- collision verification ----------------------------------------------------------------------------------------
def _planes(ob):
    mw = ob.matrix_world
    return [((mw.to_3x3() @ p.normal).normalized(), mw @ p.center) for p in ob.data.polygons]


def ucx_ok(ob):
    """Convex (every vertex behind every face plane) and within UE's hull vertex limit."""
    pl = _planes(ob)
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    convex = all((v - c).dot(n) <= 1e-4 for n, c in pl for v in vs)
    return convex and len(vs) <= 256, len(vs)


_DIRS = [Vector((x, y, z)).normalized() for x in (-1, 0, 1) for y in (-1, 0, 1) for z in (-1, 0, 1) if (x, y, z) != (0, 0, 0)]


def _inside(pl, q):
    return all((q - c).dot(n) <= 0.0 for n, c in pl)


def _sphere_hits(ucx_planes, p, r):
    """Sphere vs convex hulls: the centre or any of 26 surface points inside a hull (no false hits at box corners)."""
    pts = [p] + ([p + d * r for d in _DIRS] if r > 0 else [])
    for pl in ucx_planes:
        if max((p - c).dot(n) for n, c in pl) >= r:          # quick reject: sphere fully outside one plane
            continue
        if any(_inside(pl, q) for q in pts):
            return True
    return False


def walk_check(ucx):
    """Capsule r 0.3 m, body spheres with their bottom from 0.5 m (UE step height 0.45 m) up to 1.8 m, along the
    routes door -> stair -> console -> projector -> service group -> tech wall; walls and glazing must block."""
    F, YW = im.F, im.YW
    planes = [_planes(o) for o in ucx]
    dx = cc_lib.DOOR_X
    route = [((dx, 4.7), 0.0), ((dx, 3.6), 0.0), ((dx, 3.3), 0.25), ((dx, 3.0), 0.5), ((dx, 2.7), 0.75),
             ((dx, 2.4), 1.0), ((dx, 1.6), F), ((-1.0, -0.8), F), ((-3.0, -1.7), F), ((-1.0, -0.8), F),
             ((1.5, -0.9), F), ((1.1, 1.0), F), ((1.6, 2.2), F), ((4.5, 2.25), F), ((0.5, 1.6), F), ((-5.8, 0.8), F),
             ((-5.0, -1.6), F)]
    blocked = []
    for (a, za), (b, zb) in zip(route[:-1], route[1:]):
        n = max(2, int(math.dist(a, b) / 0.1))
        for i in range(n + 1):
            t = i / n
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            z = za if t < 0.5 else zb
            for h in (0.8, 1.15, 1.5):                 # sphere bottoms from 0.5 m: UE step-up 0.45 m
                if _sphere_hits(planes, Vector((x, y, z + h)), 0.3):
                    blocked.append((round(x, 2), round(y, 2), round(z + h, 2)))
                    break
    # containment: rays from the room centre out through each wall / roof must hit collision
    leaks = []
    for name, end in (("front", (0.0, -4.6, F + 1.5)), ("left", (-8.6, 0.0, F + 1.5)), ("right", (8.6, 0.0, F + 1.5)),
                      ("back (beside door)", (3.0, 4.6, F + 1.5)), ("roof", (0.0, 0.0, cc_lib.ROOF + 1.0)),
                      ("window", (4.0, -4.6, 3.5))):
        a, b = Vector((0.0, 0.0, F + 1.5)), Vector(end)
        hit = any(_sphere_hits(planes, a + (b - a) * (i / 200), 0.0) for i in range(201))
        if not hit:
            leaks.append(name)
    # floor coverage: interior floor points (outside the stair pit) must stand on collision
    holes = 0
    px0, px1 = dx - build_model.DOOR_W / 2 - 0.1, dx + build_model.DOOR_W / 2 + 0.1
    for gx in range(-14, 15):
        for gy in range(-6, 7):
            x, y = gx * 0.5, gy * 0.5
            if px0 <= x <= px1 and y >= YW - 1.2:
                continue
            if not _sphere_hits(planes, Vector((x, y, F - 0.05)), 0.0):
                holes += 1
    return blocked, leaks, holes


def clearance():
    return {"mesh": MESH, "units": "m, pivot = footprint centre on the foundation top (z = 0)",
            "boxes": [{"name": "main", "min": [-cc_lib.W / 2, -cc_lib.D / 2, 0.0], "max": [cc_lib.W / 2, cc_lib.D / 2,
                                                                                       cc_lib.ROOF + 0.8]}],
            "note": "antenna/beacon above the roof box are excluded (thin, no snapping conflicts); "
                    "2 x 1 foundations, see check_fit.py"}


# ---- 7. export / report -----------------------------------------------------------------------------------------------
def export_fbx(objs, path):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH", "EMPTY"}, mesh_smooth_type="OFF",
                             use_tspace=True, apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y",
                             use_mesh_modifiers=False)


def fit(ob):
    lo, hi = bbox(ob)
    ok = abs(lo.x) <= cc_lib.W / 2 + 1e-3 and hi.x <= cc_lib.W / 2 + 1e-3 and abs(lo.y) <= cc_lib.D / 2 + 1e-3 \
        and hi.y <= cc_lib.D / 2 + 1e-3 and lo.z >= -1e-3
    return ok, lo, hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "export", "ue"))
    ap.add_argument("--render", default=None)
    ap.add_argument("--samples", type=int, default=24)
    a = ap.parse_args(sys.argv[1:])
    cc_lib.reset_scene()
    mats = cc_lib.make_materials()
    exp = cc_lib.collection("EXPORT")
    ref = cc_lib.collection("REF_NOT_EXPORTED")
    build_model.build(mats, exp, ref)
    parts = len([o for o in exp.objects if o.type == "MESH"])
    sl_before, sl_after = cleanup(exp)

    meshes = [o for o in exp.objects if o.type == "MESH" and o.data.polygons]
    holo = [o for o in meshes if is_holo(o)]
    body = [o for o in meshes if not is_holo(o)]
    inner = {o.name for o in body if is_interior(o)}
    dims = {o.name: max(o.dimensions) for o in body}
    # exterior (shell + everything outside the room) and interior (room contents) are separate static meshes:
    # UE occlusion-culls the interior component behind the walls; the interior has no LOD2 (cull distance instead)
    plan = {("ext", 0): [o for o in body if o.name not in inner],
            ("ext", 1): [o for o in body if o.name not in inner and dims[o.name] >= LOD1_MIN],
            ("ext", 2): [o for o in body if o.name not in inner and dims[o.name] >= LOD2_MIN],
            ("int", 0): [o for o in body if o.name in inner],
            ("int", 1): [o for o in body if o.name in inner and dims[o.name] >= LOD1_MIN]}
    names = {"ext": MESH, "int": f"{MESH}_Interior"}
    result = {}
    for (part, lod), objs in plan.items():
        coll = cc_lib.collection(f"UE_{part}_LOD{lod}")
        ob = join(copy_into(objs, coll), names[part] if lod == 0 else f"{names[part]}_LOD{lod}")
        if lod == 2:
            remap_material(ob, "M_Glass", mats["M_MetalDark"])
        finish_mesh(ob, (0.0, 2.0, 5.0)[lod], LOD_COLLAPSE[lod])
        result[(part, lod)] = (ob, len(objs))
    hcoll = cc_lib.collection("UE_HOLO")
    hob = finish_mesh(join(copy_into(holo, hcoll), f"{MESH}_Holo"))
    ucoll = cc_lib.collection("UE_UCX")
    ucx = collision(ucoll)
    socks = sockets(result[("ext", 0)][0])
    for o in exp.objects:
        o.hide_render = True
        o.hide_set(True)

    os.makedirs(a.out, exist_ok=True)
    files = {}
    for (part, lod), (ob, _) in result.items():
        files[(part, lod)] = f"{ob.name}.fbx"
        export_fbx([ob] + (ucx + socks if (part, lod) == ("ext", 0) else []), os.path.join(a.out, files[(part, lod)]))
    export_fbx([hob], os.path.join(a.out, f"{MESH}_Holo.fbx"))
    with open(os.path.join(a.out, "clearance.json"), "w", encoding="utf-8") as f:
        json.dump(clearance(), f, indent=2, ensure_ascii=False)

    # ---- checks -------------------------------------------------------------------------------------------------
    rows = []
    for (part, lod), (ob, n) in result.items():
        ok, _, _ = fit(ob)
        has = bool(ob.data.uv_layers.get("UVMap")) and bool(ob.data.color_attributes.get("PaintMask"))
        bad, chk = atlas_violations(ob)
        rows.append((ob.name, f"LOD{lod}", n, tris(ob), len(ob.data.materials), SCREEN_SIZE[lod], ok, has,
                     ob.data.has_custom_normals, f"{chk - bad}/{chk}" if chk else "—", bad == 0))
    hok, _, _ = fit(hob)
    rows.append((hob.name, "—", len(holo), tris(hob), len(hob.data.materials), "—", hok,
                 bool(hob.data.uv_layers.get("UVMap")), hob.data.has_custom_normals, "—", True))
    sections = {}
    for part in ("ext", "int"):
        base = [m.name for m in result[(part, 0)][0].data.materials]
        for lod in (1, 2):
            if (part, lod) in result:
                extra = [m.name for m in result[(part, lod)][0].data.materials if m.name not in base]
                sections[(part, lod)] = (len(result[(part, lod)][0].data.materials), extra)
    ucx_bad = [o.name for o in ucx if not ucx_ok(o)[0]]
    blocked, leaks, holes = walk_check(ucx)

    lines = ["# Этап 6 — игровые меши SM_CommandCenter", "",
             f"Собрано `blender/build_stage6.py` из {parts} деталей авторской сборки. Экспорт: `export/ue/`.", "",
             "| Меш | LOD | Деталей | Треугольников | Секций | Screen size | В габарите | UV0 + PaintMask | Свои нормали | "
             "Атлас: грани в одной ячейке |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| `{r[0]}` | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {'✅' if r[6] else '⚠️'} | "
                     f"{'✅' if r[7] else '⚠️'} | {'✅' if r[8] else '⚠️'} | {r[9]} {'✅' if r[10] else '⚠️'} |")
    lines += ["", "## Проверки", "",
              f"- **Секции между LOD**: имена слотов LOD1/LOD2 — подмножество LOD0 своего меша "
              + ("✅" if all(not e for _, e in sections.values()) else "⚠️ " + str(sections))
              + "; при импорте LOD сопоставляются с секциями LOD0 по имени материала (у LOD2 экстерьера нет стекла и "
                "мелких слотов — это нормально).",
              f"- **Упрощение LOD1/LOD2 не трогает** декали, экраны, полосы и эмиссив (защищённые слоты {', '.join(PROTECTED)}): "
              "схлопывание рёбер только на тайлинговых слотах, UV атласов не уезжают в соседние ячейки.",
              f"- **Коллизия**: {len(ucx)} выпуклых частей, все выпуклые и ≤ 256 вершин "
              + ("✅" if not ucx_bad else "⚠️ " + ", ".join(ucx_bad)) + ".",
              f"- **Проходимость** (капсула r 0,3 м, тело от 0,5 до 1,8 м над поверхностью, шаг ступени UE 0,45 м; маршрут "
              f"дверь → лестница → пульт → проектор → группа обслуживания → техстена): "
              + ("свободно ✅" if not blocked else f"⚠️ упирается в {len(blocked)} точках, первые: {blocked[:5]}") + ".",
              "- **Герметичность**: лучи из центра комнаты наружу сквозь переднюю стену, стекло, боковые стены, заднюю стену "
              "рядом с дверью и крышу — " + ("все упираются в коллизию ✅" if not leaks else f"⚠️ проходят: {leaks}") + ".",
              f"- **Пол**: точек пола без коллизии (сетка 0,5 м, кроме лестничного приямка) — {holes} "
              + ("✅" if holes == 0 else "⚠️") + ".",
              f"- **Сокеты** в `{MESH}.fbx`: " + ", ".join(f"`{o.name}`" for o in socks) + ".",
              f"- Вырожденные грани-иглы после булевых операций (высота < 1 мм): **{sl_before} → {sl_after}**.",
              "- Clearance: `clearance.json` (16 × 8 × " f"{cc_lib.ROOF + 0.8:.1f} м, без антенны).",
              f"- Нормали: жёсткие рёбра по углу {math.degrees(SHARP_ANGLE):.0f}°, взвешенные нормали (по площади, "
              "keep sharp), триангуляция с сохранением нормалей, касательные в FBX."]
    with open(os.path.join(HERE, "..", "stage6_report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))

    if a.render:
        render(a, result, hob, ucx, exp)

def render(a, result, hob, ucx, exp):
    import ui_preview
    ui_preview.apply_preview_ui()
    cc_lib.setup_render(samples=a.samples)
    s = bpy.context.scene
    os.makedirs(a.render, exist_ok=True)
    green = bpy.data.materials.new("UCX_view")
    green.use_nodes = True
    b = green.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.1, 0.9, 0.3, 1.0)
    b.inputs["Emission Color"].default_value = (0.1, 0.9, 0.3, 1.0)
    b.inputs["Emission Strength"].default_value = 0.3
    b.inputs["Alpha"].default_value = 0.35
    for o in ucx:
        o.data.materials.append(green)

    def show(objs):
        for o in s.objects:
            if o.type == "MESH":
                o.hide_render = o not in objs
    shots = {"01": ((-17.0, -21.0, 7.5), (0.0, 0.0, 3.0), None, 35), "09": ((14.0, 17.0, 5.5), (0.0, 1.0, 3.0), None, 35),
             "far": ((-34.0, -42.0, 15.0), (0.0, 0.0, 3.0), None, 35)}
    for lod in (0, 1, 2):
        objs = [result[("ext", lod)][0]] + ([result[("int", lod)][0], hob] if lod < 2 else [])
        show(objs)
        for k, (loc, tgt, ortho, lens) in shots.items():
            s.camera = cc_lib.camera(f"CAM_{lod}{k}", loc, tgt, ortho, lens)
            s.render.filepath = os.path.join(a.render, f"LOD{lod}_{k}.png")
            bpy.ops.render.render(write_still=True)
    show([result[("ext", 0)][0], result[("int", 0)][0], hob])
    for k, (loc, tgt, ortho, lens) in {"close": ((2.5, 11.0, 2.4), (-0.8, 3.9, 2.0), None, 26),
                                       "interior": ((6.3, 2.45, 3.1), (-2.5, -2.6, 2.3), None, 18)}.items():
        s.camera = cc_lib.camera(f"CAM_n{k}", loc, tgt, ortho, lens)
        s.render.filepath = os.path.join(a.render, f"normals_{k}.png")
        bpy.ops.render.render(write_still=True)
    show(ucx)
    for k, (loc, tgt, ortho, lens) in {"ucx_01": ((-17.0, -21.0, 7.5), (0.0, 0.0, 3.0), None, 35),
                                       "ucx_09": ((14.0, 17.0, 5.5), (0.0, 1.0, 3.0), None, 35),
                                       "ucx_top": ((0.0, -0.001, 40.0), (0.0, 0.0, 0.0), 17.5, 0)}.items():
        s.camera = cc_lib.camera(f"CAM_{k}", loc, tgt, ortho, lens, 40.0 - im.F - 2.0 if k == "ucx_top" else None)
        s.render.filepath = os.path.join(a.render, f"{k}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
