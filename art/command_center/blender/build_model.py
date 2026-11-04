"""Command Center (AI Terminal, flagship) — stage 3: detailed hull on top of the stage-1 layout.

Run with Blender 5.2 LTS:
    blender -b -P build_model.py -- --out ../export [--render ../renders/stage3]
or with the `bpy` wheel:
    python build_model.py --out ../export [--render ../renders/stage3] [--shots 01_three_quarter,02_front]

Dimensions, axes and pivot are unchanged from the blockout (see ../README.md). What changes:
- larger 45° top chamfers (front/sides 1.4 m) and massive orange corner pylons wrapping 2.2 m of each face;
- window raised under the front chamfer, glass tilted 15° inwards at the top, 5 panes, sill;
- segmented plinth with light niches, hazard bays and a hatch; panelled sides and back;
- double rear door in a frame, pipes with flanges/clamps, louvred vents, stepped roof box with vents,
  front light visor, beacon with antennas; small bevels on all hard edges.
The interior (console, displays, holo table) is still the stage-1 version from cc_interior.py.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)

from cc_lib import (BASE_H, CEIL, CORNER, D, DOOR_H, DOOR_W, DOOR_X, FLOOR_Z, ROOF, SHELL_INSET, WALL, W,
                    bevel, boolean, box, chamfer_rect, cylinder, prism, run, shear_y, shell_volume)
from cc_interior import build_interior

FRONT_CH, SIDE_CH, BACK_CH = 1.4, 1.4, 1.2      # outer top chamfers
IN_FRONT_CH, IN_SIDE_CH, IN_BACK_CH = 1.0, 1.0, 0.9
WIN_Z0, WIN_TOP = 2.15, 5.6                     # window rises under the front chamfer
WIN_X = 5.9
MULLION_X = 2.4
TILT = math.radians(15)                         # glass leans inwards at the top
PYLON = 2.2                                     # corner pylon wraps this much of each face
ARMOR_T = 0.18                                  # pylon skin thickness
CORE = 0.12                                     # plinth core inset; panels bring it back to 16 x 8


def outer_shell(name, inset, z0, top, mat, coll):
    return shell_volume(name, inset, z0, mat, coll, top, FRONT_CH + inset, BACK_CH + inset, SIDE_CH + inset)


def window_outline():
    return [(-WIN_X + 0.6, WIN_Z0), (WIN_X - 0.6, WIN_Z0), (WIN_X + 0.6, WIN_Z0 + 0.9),
            (WIN_X + 0.6, WIN_TOP - 0.5), (WIN_X + 0.1, WIN_TOP), (-WIN_X - 0.1, WIN_TOP),
            (-WIN_X - 0.6, WIN_TOP - 0.5), (-WIN_X - 0.6, WIN_Z0 + 0.9)]


def inset_poly(poly, t):
    """Uniform-ish inset of the window outline (scale about its centre)."""
    cz = (WIN_Z0 + WIN_TOP) / 2
    hx = WIN_X + 0.6
    hz = (WIN_TOP - WIN_Z0) / 2
    return [(x * (hx - t) / hx, cz + (z - cz) * (hz - t) / hz) for x, z in poly]


def face_panels(prefix, side, spans, z0, z1, depth, mat, coll, gap=0.08):
    """Row of protruding panels on one outer face. side in {'-y','+y','-x','+x'}; spans along the face."""
    half = {"-y": D / 2, "+y": D / 2, "-x": W / 2, "+x": W / 2}[side]
    out = []
    for i, (a0, a1) in enumerate(spans):
        a0, a1 = a0 + gap / 2, a1 - gap / 2
        c, l = (a0 + a1) / 2, a1 - a0
        n = half - depth / 2
        if side == "-y":
            ctr, size = (c, -n, (z0 + z1) / 2), (l, depth, z1 - z0)
        elif side == "+y":
            ctr, size = (c, n, (z0 + z1) / 2), (l, depth, z1 - z0)
        elif side == "-x":
            ctr, size = (-n, c, (z0 + z1) / 2), (depth, l, z1 - z0)
        else:
            ctr, size = (n, c, (z0 + z1) / 2), (depth, l, z1 - z0)
        out.append(bevel(box(f"{prefix}_{i}", ctr, size, mat, coll), 0.025))
    return out


def build(mats, exp, ref):
    M = mats
    fy = -(D / 2 - SHELL_INSET)          # outer front face of the shell
    by = D / 2 - SHELL_INSET
    sx_out = W / 2 - SHELL_INSET          # outer side face of the shell
    win = window_outline()
    yb = fy + 0.15                        # glass foot line (recessed into the wall)
    win_depth = (fy - 0.5, fy + 1.7)      # window cutter: through the wall and under the chamfer

    # ===================================================================== PLINTH
    base = prism("BASE", chamfer_rect(W / 2 - CORE, D / 2 - CORE, 1.0), "z", 0.0, BASE_H, M["M_MetalDark"], exp)
    boolean(base, shell_volume("tmp_in", WALL, FLOOR_Z, M["M_MetalDark"], exp, CEIL))
    wall_in = D / 2 - SHELL_INSET - WALL
    pit_y0 = wall_in - 4 * 0.3
    boolean(base, box("tmp_pit", (DOOR_X, (pit_y0 + D / 2 + 0.5) / 2, FLOOR_Z / 2),
                      (DOOR_W + 0.2, D / 2 + 0.5 - pit_y0, FLOOR_Z + 0.06), M["M_MetalDark"], exp))
    boolean(base, box("tmp_door", (DOOR_X, D / 2, DOOR_H / 2 - 0.01), (DOOR_W, 1.6, DOOR_H), M["M_MetalDark"], exp))
    bevel(base, 0.05)
    for i in range(4):
        h = 0.25 * (i + 1)
        bevel(box(f"STEPS_{i}", (DOOR_X, wall_in - 0.3 * i - 0.15, h / 2), (DOOR_W + 0.2, 0.3, h),
                  M["M_MetalLight"], exp), 0.02)
    skirt = prism("BASE_skirt", chamfer_rect(W / 2, D / 2, 1.05), "z", 0.0, 0.15, M["M_MetalLight"], exp)
    boolean(skirt, box("tmp_sd", (DOOR_X, D / 2, 0.1), (DOOR_W, 1.0, 0.4), M["M_MetalLight"], exp))
    bevel(skirt, 0.03)

    # front modules: light block | hazard bay | hatch block | hazard bay | light block
    fx = W / 2 - 1.0 - CORE
    mods = [(-fx, -5.3, "light"), (-5.3, -1.5, "hazard"), (-1.5, 1.5, "hatch"), (1.5, 5.3, "hazard"),
            (5.3, fx, "light")]
    for i, (x0, x1, kind) in enumerate(mods):
        if kind == "hazard":
            box(f"DECALS_hazard_{i}", ((x0 + x1) / 2, -D / 2 + CORE + 0.01, 0.62), (x1 - x0 - 0.3, 0.04, 0.5),
                M["M_Hazard"], exp)
            face_panels(f"BASE_PANELS_f{i}_top", "-y", [(x0, x1)], 1.05, 1.9, 0.1, M["M_MetalDark"], exp)
            continue
        blk = face_panels(f"BASE_PANELS_f{i}", "-y", [(x0, x1)], 0.2, 1.9, CORE + 0.04, M["M_MetalDark"], exp)[0]
        cx = (x0 + x1) / 2
        if kind == "light":
            boolean(blk, box("tmp_niche", (cx, -D / 2, 0.75), (1.0, 0.16, 0.34), M["M_MetalLight"], exp))
            box(f"LIGHTS_base_{i}", (cx, -D / 2 + 0.06, 0.75), (0.9, 0.04, 0.26), M["M_LightWarm"], exp)
        else:
            bevel(box("BASE_hatch", (cx, -D / 2 - 0.0, 0.95), (1.4, 0.06, 1.0), M["M_MetalLight"], exp), 0.02)
            box("LIGHTS_base_hatch", (cx, -D / 2 - 0.02, 1.62), (0.5, 0.04, 0.1), M["M_LightWarm"], exp)
    # back / sides: plain panel rows, the door bay stays open
    sy = D / 2 - 1.0 - CORE
    face_panels("BASE_PANELS_b", "+y", [(-fx, -4.6), (-4.6, DOOR_X - DOOR_W / 2 - 0.25),
                                        (DOOR_X + DOOR_W / 2 + 0.25, 2.2), (2.2, fx)],
                0.2, 1.9, CORE + 0.04, M["M_MetalDark"], exp)
    for side in ("-x", "+x"):
        face_panels(f"BASE_PANELS_{side[1]}{'L' if side[0] == '-' else 'R'}", side,
                    [(-sy, -1.2), (-1.2, 1.2), (1.2, sy)], 0.2, 1.9, CORE + 0.04, M["M_MetalDark"], exp)

    # ===================================================================== FLOOR
    hx, hy = W / 2 - SHELL_INSET - WALL, D / 2 - SHELL_INSET - WALL
    floor = prism("FLOOR", chamfer_rect(hx, hy, CORNER - WALL * 0.4), "z", FLOOR_Z, FLOOR_Z + 0.02,
                  M["M_MetalLight"], exp)
    boolean(floor, box("tmp_fp", (DOOR_X, (pit_y0 + D / 2) / 2, FLOOR_Z), (DOOR_W + 0.2, D / 2 - pit_y0, 0.2),
                       M["M_MetalLight"], exp))

    # ===================================================================== SHELL
    shell = outer_shell("MAIN_SHELL", 0.0, BASE_H, ROOF, M["M_PaintOrange"], exp)
    inner = shell_volume("tmp_inner", WALL, FLOOR_Z - 0.01, M["M_MetalDark"], exp, CEIL,
                         IN_FRONT_CH, IN_BACK_CH, IN_SIDE_CH)
    boolean(shell, inner)
    boolean(shell, prism("tmp_win", win, "y", *win_depth, M["M_MetalDark"], exp))
    boolean(shell, box("tmp_door", (DOOR_X, by, DOOR_H / 2), (DOOR_W, 1.5, DOOR_H), M["M_MetalDark"], exp))
    bevel(shell, 0.05)

    # ===================================================================== WINDOW (tilted 15°)
    t = 0.16
    inner_win = inset_poly(win, t)
    frame = prism("WINDOW_FRAMES", win, "y", yb - 0.09, yb + 0.09, M["M_MetalDark"], exp)
    boolean(frame, prism("tmp_fi", inner_win, "y", yb - 1, yb + 1, None, exp))
    shear_y(frame, WIN_Z0, TILT)
    parts = []
    for x in (-MULLION_X, MULLION_X):
        parts.append(box(f"WINDOW_FRAMES_mullion_{x:+.0f}", (x, yb, (WIN_Z0 + WIN_TOP) / 2),
                         (0.16, 0.16, WIN_TOP - WIN_Z0), M["M_MetalDark"], exp))
    xb, xt, hgt = WIN_X - 0.3, WIN_X - 1.5, WIN_TOP - WIN_Z0
    ang = math.atan2(xb - xt, hgt)
    for s in (-1, 1):
        parts.append(box(f"WINDOW_FRAMES_mullion_angled_{s:+d}", (s * (xb + xt) / 2, yb, (WIN_Z0 + WIN_TOP) / 2),
                         (0.16, 0.16, math.hypot(xb - xt, hgt)), M["M_MetalDark"], exp, rot=(0, -s * ang, 0)))
    parts.append(prism("WINDOW_GLASS", inner_win, "y", yb - 0.015, yb + 0.015, M["M_Glass"], exp))
    for p in parts:
        shear_y(p, WIN_Z0, TILT)
    bevel(box("WINDOW_SILL", (0.0, (fy + yb) / 2 - 0.02, WIN_Z0 - 0.03), (2 * (WIN_X - 0.6), yb - fy + 0.1, 0.08),
              M["M_MetalLight"], exp), 0.02)

    # ===================================================================== CORNER PYLONS
    for s_x in (-1, 1):
        for s_y in (-1, 1):
            a = outer_shell(f"CORNER_ARMOR_{s_x:+d}{s_y:+d}", -ARMOR_T, BASE_H - 0.35, ROOF + ARMOR_T * 0.6,
                            M["M_PaintOrange"], exp)
            q = box("tmp_q", (s_x * (W / 2 - PYLON / 2), s_y * (D / 2 - PYLON / 2), ROOF / 2),
                    (PYLON, PYLON, ROOF * 2), None, exp)
            boolean(a, q, "INTERSECT")
            boolean(a, outer_shell("tmp_sv", 0.0, BASE_H - 1.0, ROOF, None, exp))
            if s_y < 0:
                boolean(a, prism("tmp_wa", inset_poly(win, -0.12), "y", fy - 1.0, fy + 0.6, M["M_MetalDark"], exp))
            bevel(a, 0.05)
    # dark louvred strip on the left pylon (concept 00), FICSIT logo placeholder on the right pylon
    lx = -(sx_out + ARMOR_T)
    bevel(box("VENTS_pylon_L", (lx - 0.01, -2.75, 3.7), (0.04, 1.0, 2.6), M["M_MetalDark"], exp), 0.01)
    for i in range(9):
        box(f"VENTS_pylon_L_slat_{i}", (lx - 0.035, -2.75, 2.6 + i * 0.27), (0.03, 0.85, 0.06),
            M["M_MetalLight"], exp)
    # logo placeholder on the 45° face of the front-right pylon (the front face is taken by the window)
    ax, ay = sx_out + ARMOR_T, D / 2 - SHELL_INSET + ARMOR_T
    ac = CORNER + ARMOR_T * 0.4
    mid = (ax - ac / 2 + 0.004, -(ay - ac / 2) - 0.004)
    box("DECALS_logo", (mid[0], mid[1], 4.3), (1.0, 0.01, 0.28), M["M_MetalLight"], exp, rot_z=math.radians(45))

    # ===================================================================== FRONT VISOR LIGHT (on the 45° chamfer)
    # thin axis must follow the chamfer normal (0, -1, 1)/sqrt(2) -> rotate -45° about X
    c = (fy + FRONT_CH / 2 - 0.05, ROOF - FRONT_CH / 2 + 0.05)
    bevel(box("LIGHTS_visor_housing", (0.0, c[0], c[1]), (3.6, 0.16, 0.9), M["M_MetalDark"], exp,
              rot=(math.radians(-45), 0, 0)), 0.03)
    box("LIGHTS_visor", (0.0, c[0] - 0.07, c[1] + 0.07), (3.2, 0.06, 0.55), M["M_LightWarm"], exp,
        rot=(math.radians(-45), 0, 0))

    # ===================================================================== SIDE / BACK PANELS
    free_y = D / 2 - PYLON - 0.05
    for s_x, nm in ((-1, "L"), (1, "R")):
        for j, (z0, z1) in enumerate(((BASE_H + 0.3, 3.75), (3.85, 5.2))):
            bevel(box(f"SIDE_PANEL_{nm}_{j}", (s_x * (sx_out + 0.025), 0.0, (z0 + z1) / 2),
                      (0.05, 2 * free_y, z1 - z0), M["M_MetalDark"], exp), 0.015)
    free_x = W / 2 - PYLON - 0.05
    spans = [(-free_x, DOOR_X - DOOR_W / 2 - 0.35), (DOOR_X + DOOR_W / 2 + 0.35, 2.2), (2.2, free_x)]
    for j, (x0, x1) in enumerate(spans):
        bevel(box(f"BACK_PANEL_{j}", ((x0 + x1) / 2, by + 0.025, BASE_H + 1.6), (x1 - x0 - 0.08, 0.05, 2.9),
                  M["M_MetalDark"], exp), 0.015)
    # door: frame + two leaves + header light
    dfr = box("DOOR_FRAME", (DOOR_X, D / 2 - 0.12, (DOOR_H + 0.35) / 2), (DOOR_W + 0.5, 0.24, DOOR_H + 0.35),
              M["M_MetalLight"], exp)
    boolean(dfr, box("tmp_df", (DOOR_X, D / 2, DOOR_H / 2 - 0.01), (DOOR_W, 1.0, DOOR_H), None, exp))
    bevel(dfr, 0.03)
    for k, s in enumerate((-1, 1)):
        bevel(box(f"DOOR_leaf_{k}", (DOOR_X + s * DOOR_W / 4, by - WALL / 2, DOOR_H / 2),
                  (DOOR_W / 2 - 0.03, 0.1, DOOR_H - 0.04), M["M_MetalDark"], exp), 0.015)
    box("LIGHTS_door", (DOOR_X, D / 2 + 0.0, DOOR_H + 0.22), (0.8, 0.04, 0.1), M["M_LightWarm"], exp)
    bevel(box("POWER_SOCKET", (4.5, D / 2 - 0.05, 1.3), (0.7, 0.2, 0.7), M["M_MetalLight"], exp), 0.02)
    e = bpy.data.objects.new("SOCKET_power", None)
    e.location = (4.5, D / 2 + 0.06, 1.3)
    ref.objects.link(e)

    # ===================================================================== PIPES (left, embedded in the wall)
    px = -(sx_out - 0.08)                   # centre; r = 0.25 keeps them inside the 16 m footprint
    for i, y in enumerate((-1.05, -0.4)):
        cylinder(f"EXHAUST_PIPES_{i}", (px, y, 3.55), 0.25, 3.3, M["M_MetalLight"], exp, 16)
        cylinder(f"EXHAUST_PIPES_{i}_flange", (px, y, 2.0), 0.3, 0.14, M["M_MetalDark"], exp, 16)
        cylinder(f"EXHAUST_PIPES_{i}_elbow", (px + 0.1, y, 5.2), 0.25, 0.6, M["M_MetalLight"], exp, 16, axis="X")
        for k, z in enumerate((2.7, 3.7, 4.7)):
            cylinder(f"EXHAUST_PIPES_{i}_clamp_{k}", (px, y, z), 0.28, 0.1, M["M_MetalDark"], exp, 16)
    bevel(box("EXHAUST_PIPES_bracket", (-(sx_out + 0.06), -0.72, 4.2), (0.12, 1.3, 0.16), M["M_MetalDark"], exp),
          0.02)

    # ===================================================================== VENTS (right)
    vx = sx_out + 0.07
    vh = box("VENTS_housing", (vx, 0.0, 3.6), (0.14, 2.0, 2.0), M["M_MetalDark"], exp)
    boolean(vh, box("tmp_vh", (vx + 0.1, 0.0, 3.6), (0.14, 1.8, 1.8), M["M_MetalDark"], exp))
    bevel(vh, 0.02)
    for i in range(8):
        box(f"VENTS_slat_{i}", (vx + 0.02, 0.0, 2.8 + i * 0.22), (0.03, 1.78, 0.18), M["M_MetalLight"], exp,
            rot=(0, math.radians(-35), 0))

    # ===================================================================== ROOF BOX (stepped) + vents
    ry = 0.3
    r0 = prism("ROOF", chamfer_rect(4.2, 1.9, 0.6), "z", ROOF - 0.05, ROOF + 0.35, M["M_MetalDark"], exp)
    r1 = prism("ROOF_top", chamfer_rect(3.4, 1.45, 0.7), "z", ROOF + 0.35, ROOF + 0.8, M["M_MetalLight"], exp)
    for r in (r0, r1):
        for v in r.data.vertices:
            v.co.y += ry
        bevel(r, 0.06)
    for k, x in enumerate((-2.0, 2.0)):
        bevel(box(f"ROOF_vent_{k}", (x, ry, ROOF + 0.92), (1.2, 0.9, 0.25), M["M_MetalDark"], exp), 0.03)
        for i in range(5):
            box(f"ROOF_vent_{k}_slat_{i}", (x, ry - 0.32 + i * 0.16, ROOF + 1.05), (1.05, 0.06, 0.03),
                M["M_MetalLight"], exp)

    # ===================================================================== BEACON
    bx, byy = 5.0, 1.5
    housing = [(bx + x, byy + y) for x, y in chamfer_rect(0.45, 0.35, 0.12)]
    bevel(prism("BEACON_housing", housing, "z", ROOF - 0.05, ROOF + 1.6, M["M_PaintOrange"], exp), 0.03)
    box("BEACON_panel", (bx, byy - 0.36, ROOF + 0.9), (0.5, 0.03, 0.7), M["M_MetalDark"], exp)
    box("BEACON_indicator", (bx, byy - 0.38, ROOF + 1.1), (0.3, 0.02, 0.18), M["M_ScreenStatic"], exp)
    for dx, h in ((-0.18, 2.0), (0.18, 1.4)):
        cylinder(f"BEACON_antenna_{dx:+.2f}", (bx + dx, byy, ROOF + 1.6 + h / 2), 0.035, h, M["M_MetalLight"],
                 exp, 8)
        cylinder(f"BEACON_antenna_{dx:+.2f}_base", (bx + dx, byy, ROOF + 1.68), 0.08, 0.16, M["M_MetalDark"],
                 exp, 8)
    cylinder("BEACON_lamp", (bx - 0.18, byy, ROOF + 3.72), 0.1, 0.22, M["M_Beacon"], exp, 12)
    cylinder("BEACON_lamp_cap", (bx - 0.18, byy, ROOF + 3.86), 0.12, 0.05, M["M_MetalDark"], exp, 12)

    build_interior(M, exp, ref)


if __name__ == "__main__":
    run(build, "SM_CommandCenter", "model")
