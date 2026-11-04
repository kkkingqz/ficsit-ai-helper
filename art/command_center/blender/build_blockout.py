"""Command Center (AI Terminal, flagship) — procedural blockout.

Run with Blender 5.2 LTS:
    blender -b -P build_blockout.py -- --out ../export [--render ../renders]
or with the `bpy` wheel:
    python build_blockout.py --out ../export [--render ../renders]

Conventions (see ../README.md):
    units      metres, Z up, 1 Blender unit = 1 m
    pivot      world origin = centre of footprint at foundation top (Z = 0)
    front      -Y (panoramic window), back +Y (door), left -X (pipes), right +X (vents)
    footprint  16 x 8 m = 2 x 1 Satisfactory foundations
"""

import argparse
import math
import os
import sys

import bpy  # must be imported before bmesh when running from the bpy wheel
import bmesh
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# Key dimensions (single source of truth for the blockout)
# ---------------------------------------------------------------------------
W, D = 16.0, 8.0            # footprint (X, Y)
FLOOR_Z = 1.0               # interior floor (4 recessed steps at the back door, no ladder)
BASE_H = 2.0                # dark plinth band outside (concept: "цоколь 2 м"); sill = floor + 1 m
SHELL_INSET = 0.2           # shell sits inside the plinth outline
WALL = 0.35                 # wall thickness
CEIL = 5.8                  # interior ceiling (clear height 4.8 m)
ROOF = 6.8                  # top of main roof slab (roof box adds 0.7 m)
CORNER = 0.9                # vertical corner chamfer (plan)

WIN_Z0, WIN_Z1 = 2.0, 5.4   # panoramic window band
WIN_X = 5.9                 # half width of the flat part of the window
MULLION_X = 2.4             # vertical mullions; angled ends -> 5 panes in total

DOOR_X, DOOR_W, DOOR_H = -1.0, 2.0, 2.8   # door at ground level, 4 steps inside

COLORS = {
    "M_PaintOrange": (0.93, 0.33, 0.016, 1.0),   # #F79A22 (linear approx.)
    "M_MetalDark":   (0.027, 0.031, 0.039, 1.0), # #2E3238
    "M_MetalLight":  (0.11, 0.13, 0.16, 1.0),    # #5E6770
    "M_Rubber":      (0.011, 0.013, 0.015, 1.0), # #1C1E22
    "M_Hazard":      (1.0, 0.58, 0.0, 1.0),      # #FFD200 (stripes come from texture later)
}
EMISSIVE = {
    "M_LightWarm":   ((1.0, 0.91, 0.70, 1.0), 8.0),   # #FFF4D6
    "M_ScreenRT":    ((0.15, 0.55, 1.0, 1.0), 3.0),   # render-target screen (UV 0-1, 16:9)
    "M_ScreenStatic":((0.10, 0.35, 0.85, 1.0), 2.0),
    "M_Holo":        ((0.10, 0.55, 1.0, 1.0), 4.0),
    "M_Beacon":      ((1.0, 0.45, 0.05, 1.0), 15.0),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def make_materials():
    mats = {}
    for name, col in COLORS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = col
        b.inputs["Roughness"].default_value = 0.55
        b.inputs["Metallic"].default_value = 0.0 if name in ("M_PaintOrange", "M_Hazard", "M_Rubber") else 0.6
        m.diffuse_color = col
        mats[name] = m
    for name, (col, strength) in EMISSIVE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = col
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = strength
        if name == "M_Holo":
            b.inputs["Alpha"].default_value = 0.45
        m.diffuse_color = col
        mats[name] = m
    g = bpy.data.materials.new("M_Glass")
    g.use_nodes = True
    b = g.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.7, 0.8, 1.0)
    b.inputs["Roughness"].default_value = 0.05
    b.inputs["Transmission Weight"].default_value = 0.92
    b.inputs["IOR"].default_value = 1.45
    g.diffuse_color = (0.4, 0.55, 0.65, 0.3)
    mats["M_Glass"] = g
    return mats


def mesh_object(name, bm, mat, coll):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob


def prism(name, poly, axis, a0, a1, mat, coll):
    """Extrude a 2D polygon along an axis.
    axis='z': poly is (x, y);  axis='y': poly is (x, z);  axis='x': poly is (y, z)."""
    bm = bmesh.new()

    def v3(p, a):
        if axis == "z":
            return (p[0], p[1], a)
        if axis == "y":
            return (p[0], a, p[1])
        return (a, p[0], p[1])

    lo = [bm.verts.new(v3(p, a0)) for p in poly]
    hi = [bm.verts.new(v3(p, a1)) for p in poly]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    return mesh_object(name, bm, mat, coll)


def box(name, center, size, mat, coll, rot_z=0.0, rot=None):
    """Axis-aligned box rotated about its own centre (rot = Euler XYZ in radians)."""
    from mathutils import Euler
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    r = Euler(rot if rot else (0.0, 0.0, rot_z), "XYZ").to_matrix()
    bmesh.ops.rotate(bm, matrix=r, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, mat, coll)


def cylinder(name, center, radius, height, mat, coll, segments=24, axis="Z"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments,
                          radius1=radius, radius2=radius, depth=height)
    if axis == "X":
        bmesh.ops.rotate(bm, matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    elif axis == "Y":
        bmesh.ops.rotate(bm, matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, mat, coll)


def boolean(target, cutter, op="DIFFERENCE"):
    """Apply a boolean without operator context; removes the cutter."""
    mod = target.modifiers.new("bool", "BOOLEAN")
    mod.operation = op
    mod.solver = "EXACT"
    mod.material_mode = "TRANSFER"   # cut faces take the cutter's material (interior = dark metal)
    mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(target.evaluated_get(dg))
    old = target.data
    target.modifiers.remove(mod)
    target.data = new_me
    bpy.data.meshes.remove(old)
    bpy.data.objects.remove(cutter)
    return target


def chamfer_rect(hx, hy, c):
    return [(-hx + c, -hy), (hx - c, -hy), (hx, -hy + c), (hx, hy - c),
            (hx - c, hy), (-hx + c, hy), (-hx, hy - c), (-hx, -hy + c)]


def octagon(r, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(math.pi / 8 + i * math.pi / 4),
             cy + r * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]


# ---------------------------------------------------------------------------
# Building parts
# ---------------------------------------------------------------------------
def shell_volume(name, inset, z0, mat, coll, ceil_top):
    """Plan ∩ side section ∩ front elevation -> chamfered industrial box."""
    hx, hy = W / 2 - SHELL_INSET - inset, D / 2 - SHELL_INSET - inset
    top = ceil_top
    plan = prism(name, chamfer_rect(hx, hy, CORNER - inset * 0.4), "z", z0, top + 1, mat, coll)
    # side section (y, z): small chamfer at the front-top, larger at the back-top
    sec = [(-hy, z0 - 1), (hy, z0 - 1), (hy, top - 1.2), (hy - 1.2, top),
           (-hy + 0.8, top), (-hy, top - 0.8)]
    s = prism(name + "_sec", sec, "x", -W, W, None, coll)
    boolean(plan, s, "INTERSECT")
    # front elevation (x, z): chamfered top corners
    ele = [(-hx, z0 - 1), (hx, z0 - 1), (hx, top - 1.0), (hx - 1.0, top),
           (-hx + 1.0, top), (-hx, top - 1.0)]
    e = prism(name + "_ele", ele, "y", -D, D, None, coll)
    boolean(plan, e, "INTERSECT")
    return plan


def build(mats, exp, ref):
    M = mats
    fy = -(D / 2 - SHELL_INSET)          # outer front face Y
    by = D / 2 - SHELL_INSET             # outer back face Y

    # --- BASE (plinth) with a recessed step niche at the door --------------
    base = prism("BASE", chamfer_rect(W / 2, D / 2, 1.0), "z", 0.0, BASE_H, M["M_MetalDark"], exp)
    boolean(base, shell_volume("tmp_inner_b", WALL, FLOOR_Z, M["M_MetalDark"], exp, CEIL))
    # stair pit behind the rear door: ground-level door, 4 x 0.25 m steps up to the floor inside
    wall_in = D / 2 - SHELL_INSET - WALL           # inner face of the back wall
    pit_y0 = wall_in - 4 * 0.3
    pit = box("tmp_pit", (DOOR_X, (pit_y0 + D / 2 + 0.5) / 2, FLOOR_Z / 2),
              (DOOR_W + 0.2, D / 2 + 0.5 - pit_y0, FLOOR_Z + 0.06), M["M_MetalDark"], exp)
    boolean(base, pit)
    boolean(base, box("tmp_bdoor", (DOOR_X, D / 2, DOOR_H / 2 - 0.01), (DOOR_W, 1.6, DOOR_H),
                      M["M_MetalDark"], exp))
    for i in range(4):
        h = 0.25 * (i + 1)
        box(f"STEPS_{i}", (DOOR_X, wall_in - 0.3 * i - 0.15, h / 2), (DOOR_W + 0.2, 0.3, h),
            M["M_MetalLight"], exp)
    # bottom trim band + hazard stripe panels on the front
    for x in (-4.6, 0.0, 4.6):
        box(f"DECALS_hazard_{x:+.0f}", (x, -D / 2 - 0.01, 0.35), (2.6, 0.04, 0.35), M["M_Hazard"], exp)
    for x in (-7.0, 7.0):
        box(f"LIGHTS_base_{x:+.0f}", (x, -D / 2 - 0.02, 0.45), (0.8, 0.05, 0.22), M["M_LightWarm"], exp)

    # --- FLOOR ---------------------------------------------------------------
    hx, hy = W / 2 - SHELL_INSET - WALL, D / 2 - SHELL_INSET - WALL
    floor = prism("FLOOR", chamfer_rect(hx, hy, CORNER - WALL * 0.4), "z", FLOOR_Z, FLOOR_Z + 0.02,
                  M["M_MetalLight"], exp)
    boolean(floor, box("tmp_fp", (DOOR_X, (pit_y0 + D / 2) / 2, FLOOR_Z), (DOOR_W + 0.2, D / 2 - pit_y0, 0.2),
                       M["M_MetalLight"], exp))

    # --- MAIN_SHELL -----------------------------------------------------------
    shell = shell_volume("MAIN_SHELL", 0.0, BASE_H, M["M_PaintOrange"], exp, ROOF)
    inner = shell_volume("tmp_inner", WALL, FLOOR_Z - 0.01, M["M_MetalDark"], exp, CEIL)
    boolean(shell, inner)
    # panoramic window: flat front band
    # wide octagon: long top edge, angled lower ends (as on the approved concept)
    win = [(-WIN_X + 0.6, WIN_Z0), (WIN_X - 0.6, WIN_Z0), (WIN_X + 0.6, WIN_Z0 + 1.0),
           (WIN_X + 0.6, WIN_Z1 - 0.5), (WIN_X + 0.1, WIN_Z1), (-WIN_X - 0.1, WIN_Z1),
           (-WIN_X - 0.6, WIN_Z1 - 0.5), (-WIN_X - 0.6, WIN_Z0 + 1.0)]
    boolean(shell, prism("tmp_win", win, "y", fy - 0.5, fy + WALL + 0.3, M["M_MetalDark"], exp))
    boolean(base, prism("tmp_win_b", win, "y", fy - 0.5, fy + WALL + 0.3, M["M_MetalDark"], exp))
    cx = W / 2 - SHELL_INSET - CORNER / 2
    cy = -(D / 2 - SHELL_INSET - CORNER / 2)
    # rear door
    boolean(shell, box("tmp_door", (DOOR_X, by, DOOR_H / 2), (DOOR_W, 1.5, DOOR_H),
                       M["M_MetalDark"], exp))

    # --- WINDOW_FRAMES / WINDOW_GLASS ----------------------------------------
    t = 0.16
    frame = prism("WINDOW_FRAMES", win, "y", fy - 0.06, fy + 0.12, M["M_MetalDark"], exp)
    inset_win = [(x * (WIN_X + 0.6 - t) / (WIN_X + 0.6),
                  WIN_Z0 + (z - WIN_Z0) * (WIN_Z1 - WIN_Z0 - 2 * t) / (WIN_Z1 - WIN_Z0) + t) for x, z in win]
    boolean(frame, prism("tmp_fi", inset_win, "y", fy - 1, fy + 1, None, exp))
    for x in (-MULLION_X, MULLION_X):
        box(f"WINDOW_FRAMES_mullion_{x:+.0f}", (x, fy + 0.03, (WIN_Z0 + WIN_Z1) / 2),
            (0.18, 0.18, WIN_Z1 - WIN_Z0), M["M_MetalDark"], exp)
    # angled mullions lean inwards at the top (concept 00) -> 5 panes in total
    xb, xt, hgt = WIN_X - 0.3, WIN_X - 1.5, WIN_Z1 - WIN_Z0
    ang = math.atan2(xb - xt, hgt)
    for sx in (-1, 1):
        box(f"WINDOW_FRAMES_mullion_angled_{sx:+d}", (sx * (xb + xt) / 2, fy + 0.03, (WIN_Z0 + WIN_Z1) / 2),
            (0.18, 0.18, math.hypot(xb - xt, hgt)), M["M_MetalDark"], exp, rot=(0, -sx * ang, 0))
    prism("WINDOW_GLASS", inset_win, "y", fy + 0.08, fy + 0.11, M["M_Glass"], exp)

    # --- CORNER_ARMOR (orange, the 4 vertical corners) -----------------------
    ahx, ahy = W / 2 - SHELL_INSET + 0.2, D / 2 - SHELL_INSET + 0.2
    for sx in (-1, 1):
        for sy in (-1, 1):
            a = prism(f"CORNER_ARMOR_{sx:+d}{sy:+d}", chamfer_rect(ahx, ahy, CORNER + 0.1), "z",
                      BASE_H - 0.3, ROOF - 1.1, M["M_PaintOrange"], exp)
            keep = box("tmp_q", (sx * (ahx - 0.8), sy * (ahy - 0.8), ROOF / 2), (1.6, 1.6, ROOF * 2), None, exp)
            boolean(a, keep, "INTERSECT")
            boolean(a, shell_volume("tmp_sv", -0.01, BASE_H - 1.0, None, exp, ROOF - 0.5))

    # --- SIDE_PANEL / BACK_PANEL (dark inset panels) -------------------------
    for sx, nm in ((-1, "L"), (1, "R")):
        box(f"SIDE_PANEL_{nm}", (sx * (W / 2 - SHELL_INSET + 0.02), 0.3, BASE_H + 1.7),
            (0.06, 4.4, 3.0), M["M_MetalDark"], exp)
    back = box("BACK_PANEL", (1.5, by + 0.03, BASE_H + 1.6), (10.0, 0.06, 3.0), M["M_MetalDark"], exp)
    boolean(back, box("tmp_bd", (DOOR_X, by, DOOR_H / 2), (DOOR_W, 1.0, DOOR_H), None, exp))
    box("DOOR", (DOOR_X, by - WALL / 2, DOOR_H / 2), (DOOR_W - 0.05, 0.12, DOOR_H - 0.05),
        M["M_MetalLight"], exp)
    box("POWER_SOCKET", (4.5, D / 2 + 0.15, 1.3), (0.7, 0.3, 0.7), M["M_MetalLight"], exp)

    # --- EXHAUST_PIPES (left side, -X) ---------------------------------------
    for i, y in enumerate((-1.6, -0.8)):
        cylinder(f"EXHAUST_PIPES_{i}", (-W / 2 + SHELL_INSET - 0.4, y, 3.4), 0.3, 5.2, M["M_MetalLight"], exp)
        cylinder(f"EXHAUST_PIPES_{i}_elbow", (-W / 2 + SHELL_INSET - 0.2, y, 5.9), 0.3, 0.6,
                 M["M_MetalLight"], exp, axis="X")

    # --- VENTS (right side, +X) ------------------------------------------------
    vx = W / 2 - SHELL_INSET + 0.15
    box("VENTS_housing", (vx, 0.4, 3.9), (0.3, 2.0, 2.2), M["M_MetalDark"], exp)
    for i in range(7):
        box(f"VENTS_slat_{i}", (vx + 0.16, 0.4, 3.0 + i * 0.3), (0.05, 1.8, 0.08), M["M_MetalLight"], exp)

    # --- ROOF superstructure ---------------------------------------------------
    roof = prism("ROOF", chamfer_rect(3.6, 1.6, 0.5), "z", ROOF - 0.05, ROOF + 0.7, M["M_MetalDark"], exp)
    roof.location.y = 0.4
    # sits on the 45° front-top chamfer (from y=fy, z=ROOF-0.8 to y=fy+0.8, z=ROOF)
    box("LIGHTS_front_bar", (0.0, fy + 0.4 - 0.04, ROOF - 0.4 + 0.04), (2.6, 0.08, 0.5), M["M_LightWarm"], exp,
        rot=(math.radians(45), 0, 0))

    # --- BEACON / antenna -----------------------------------------------------
    box("BEACON_housing", (4.6, 1.4, ROOF + 0.8), (0.9, 0.7, 1.6), M["M_PaintOrange"], exp)
    for dx, h in ((-0.2, 1.8), (0.2, 1.2)):
        cylinder(f"BEACON_antenna_{dx:+.1f}", (4.6 + dx, 1.4, ROOF + 1.5 + h / 2), 0.04, h, M["M_MetalLight"], exp, 8)
    cylinder("BEACON_lamp", (4.4, 1.4, ROOF + 3.42), 0.12, 0.25, M["M_Beacon"], exp, 12)

    # --- Interior: ceiling lights ----------------------------------------------
    for x in (-4.0, 0.0, 4.0):
        box(f"LIGHTS_ceiling_{x:+.0f}", (x, -0.6, CEIL - 0.05), (2.2, 0.6, 0.06), M["M_LightWarm"], exp)

    # --- CONSOLE (front-left, under the window) --------------------------------
    f = FLOOR_Z + 0.02
    cy_c = fy + WALL + 0.7
    segs = [(-3.0, 0.0, 3.4), (-5.6, math.radians(-22), 2.0), (-0.4, math.radians(22), 2.0)]
    for i, (x, rz, w) in enumerate(segs):
        y = cy_c + (0.45 if i else 0.0)
        box(f"CONSOLE_BODY_{i}", (x, y, f + 0.45), (w, 0.9, 0.9), M["M_MetalDark"], exp, rot_z=rz)
        box(f"CONTROL_PANELS_{i}", (x, y - 0.05, f + 0.92), (w - 0.1, 0.75, 0.04), M["M_ScreenStatic"], exp,
            rot_z=rz)
    # displays: main = render-target surface (16:9, own material slot)
    mw, mh = 2.4, 2.4 * 9 / 16
    box("DISPLAY_FRAMES_main", (-3.0, cy_c - 0.25, f + 1.25 + mh / 2), (mw + 0.12, 0.08, mh + 0.12),
        M["M_MetalDark"], exp)
    box("DISPLAY_MAIN_RT", (-3.0, cy_c - 0.3, f + 1.25 + mh / 2), (mw, 0.02, mh), M["M_ScreenRT"], exp)
    side = [(-5.75, -22, 1.5), (-0.25, 22, 1.5)]
    for i, (x, rz, w) in enumerate(side):
        h = w * 9 / 16
        y = cy_c + 0.2
        box(f"DISPLAY_FRAMES_{i}", (x, y, f + 1.15 + h / 2), (w + 0.1, 0.07, h + 0.1), M["M_MetalDark"], exp,
            rot_z=math.radians(rz))
        box(f"DISPLAY_PLANES_{i}", (x, y - 0.045, f + 1.15 + h / 2), (w, 0.02, h), M["M_ScreenStatic"], exp,
            rot_z=math.radians(rz))
    box("PROP_CHAIR", (-3.0, cy_c + 1.3, f + 0.5), (0.6, 0.6, 1.0), M["M_Rubber"], exp)

    # --- HOLO table (front-right) ----------------------------------------------
    hcx, hcy = 4.3, -0.4
    prism("HOLO_PEDESTAL", octagon(1.25, hcx, hcy), "z", f, f + 0.85, M["M_MetalDark"], exp)
    prism("HOLO_PEDESTAL_trim", octagon(1.32, hcx, hcy), "z", f + 0.65, f + 0.8, M["M_PaintOrange"], exp)
    cylinder("HOLO_EMITTER", (hcx, hcy, f + 0.9), 1.0, 0.1, M["M_Holo"], exp, 32)
    # stylised "mountain" crystal: two cones base-to-base
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=7, radius1=0.7, radius2=0.0, depth=0.9)
    bmesh.ops.translate(bm, vec=(0, 0, 0.45), verts=bm.verts)
    low = bmesh.ops.create_cone(bm, cap_ends=False, segments=7, radius1=0.0, radius2=0.7, depth=0.35)
    bmesh.ops.translate(bm, vec=(0, 0, -0.175), verts=low["verts"])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.translate(bm, vec=(hcx, hcy, f + 1.45), verts=bm.verts)
    mesh_object("HOLO_PROJECTION", bm, M["M_Holo"], exp)

    # --- Helpers / reference (not exported) -------------------------------------
    use = box("USE_ZONE_console", (-3.0, cy_c + 0.9, f + 1.1), (7.0, 1.4, 2.2), None, ref)
    use.display_type = "WIRE"
    use.hide_render = True
    for i, x in enumerate((-4.0, 4.0)):
        ob = box(f"REF_foundation_{i}", (x, 0, -0.5), (7.98, 7.98, 1.0), M["M_MetalLight"], ref)
    # 1.8 m player capsules for scale: one inside behind the chair, one outside at the front-left
    for nm, pos in (("REF_player_inside", (-1.0, 1.8, f)), ("REF_player_outside", (-9.3, -4.6, 0.0))):
        cylinder(nm, (pos[0], pos[1], pos[2] + 0.9), 0.3, 1.8, M["M_Rubber"], ref, 12)
    # power socket attachment point for the future UFGPowerConnectionComponent
    e = bpy.data.objects.new("SOCKET_power", None)
    e.location = (4.5, D / 2 + 0.3, 1.3)
    ref.objects.link(e)


# ---------------------------------------------------------------------------
# Export & render
# ---------------------------------------------------------------------------
def select_only(coll):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in coll.objects:
        ob.select_set(True)


def export(exp, out):
    os.makedirs(out, exist_ok=True)
    select_only(exp)
    bpy.ops.export_scene.fbx(filepath=os.path.join(out, "SM_CommandCenter_Blockout.fbx"),
                             use_selection=True, object_types={"MESH"}, mesh_smooth_type="FACE",
                             apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y")
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "SM_CommandCenter_Blockout.glb"),
                              export_format="GLB", use_selection=True)


def setup_render(res=(1600, 900), samples=48):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.render.resolution_x, s.render.resolution_y = res
    s.render.film_transparent = False
    s.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("World")
    s.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.45, 0.6, 1.0)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.5
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("Sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    s.collection.objects.link(so)


def camera(name, loc, target, ortho=None, lens=35):
    cam = bpy.data.cameras.new(name)
    if ortho:
        cam.type = "ORTHO"
        cam.ortho_scale = ortho
    else:
        cam.lens = lens
    cam.clip_end = 500
    ob = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def render_all(out):
    os.makedirs(out, exist_ok=True)
    s = bpy.context.scene
    zc = 4.0
    shots = {
        "01_three_quarter": ((-17.0, -21.0, 7.5), (0.0, 0.0, 3.0), None, 35),
        "02_front": ((0, -40, zc), (0, 0, zc), 19.0, 0),
        "03_left": ((-40, 0, zc), (0, 0, zc), 19.0, 0),
        "04_back": ((0, 40, zc), (0, 0, zc), 19.0, 0),
        "05_right": ((40, 0, zc), (0, 0, zc), 19.0, 0),
        "06_top": ((0, 0, 40), (0, 0.0001, 0), 19.0, 0),
        "07_interior": ((6.8, 2.6, 2.8), (-3.0, -3.0, 2.6), None, 18),
    }
    for name, (loc, tgt, ortho, lens) in shots.items():
        s.camera = camera("CAM_" + name, loc, tgt, ortho, lens or 35)
        s.render.filepath = os.path.join(out, name + ".png")
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "export"))
    ap.add_argument("--render", default=None)
    ap.add_argument("--blend", action="store_true", help="also save the .blend next to the exports")
    ap.add_argument("--samples", type=int, default=48)
    a = ap.parse_args(argv)

    reset_scene()
    mats = make_materials()
    exp = collection("EXPORT")
    ref = collection("REF_NOT_EXPORTED")
    build(mats, exp, ref)
    export(exp, a.out)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, "CommandCenter_Blockout.blend"))
    if a.render:
        setup_render(samples=a.samples)
        render_all(a.render)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in exp.objects)
    print(f"[blockout] objects={len(exp.objects)} tris={tris}")


if __name__ == "__main__":
    main()
