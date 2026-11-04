"""Interior of the Command Center: ceiling lights, console with displays, holo table, reference helpers.

Shared by the blockout and the detailed model until stage 4 replaces it.
"""
import math

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)
import bmesh

from cc_lib import (CEIL, D, FLOOR_Z, SHELL_INSET, WALL, box, cylinder, mesh_object, octagon, prism)

CONSOLE_SETBACK = 0.2   # extra distance from the front wall (room for the 15° tilted glass)


def build_interior(M, exp, ref):
    fy = -(D / 2 - SHELL_INSET)
    # --- Interior: ceiling lights ----------------------------------------------
    for x in (-4.0, 0.0, 4.0):
        box(f"LIGHTS_ceiling_{x:+.0f}", (x, -0.6, CEIL - 0.05), (2.2, 0.6, 0.06), M["M_LightWarm"], exp)

    # --- CONSOLE (front-left, under the window) --------------------------------
    f = FLOOR_Z + 0.02
    cy_c = fy + WALL + 0.7 + CONSOLE_SETBACK
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
        ob = box(f"REF_foundation_{i}", (x, 0, -0.5), (7.98, 7.98, 1.0), M["REF_Foundation"], ref)
    # 1.8 m player capsules for scale: one inside behind the chair, one outside at the front-left
    for nm, pos in (("REF_player_inside", (-1.0, 1.8, f)), ("REF_player_outside", (-9.3, -4.6, 0.0))):
        cylinder(nm, (pos[0], pos[1], pos[2] + 0.9), 0.3, 1.8, M["M_Rubber"], ref, 12)
    # power socket attachment point for the future UFGPowerConnectionComponent
    e = bpy.data.objects.new("SOCKET_power", None)
    e.location = (4.5, D / 2 + 0.3, 1.3)
    ref.objects.link(e)
