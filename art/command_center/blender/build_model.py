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


def face_panels(prefix, side, spans, z0, z1, depth, mat, coll, gap=0.08, recess=0.0, bev=0.025):
    """Row of protruding panels on one outer face. side in {'-y','+y','-x','+x'}; spans along the face.
    recess: how far the outer face stays behind the 16 x 8 footprint (pilasters/corners use 0)."""
    half = {"-y": D / 2, "+y": D / 2, "-x": W / 2, "+x": W / 2}[side]
    out = []
    for i, (a0, a1) in enumerate(spans):
        a0, a1 = a0 + gap / 2, a1 - gap / 2
        c, l = (a0 + a1) / 2, a1 - a0
        n = half - recess - depth / 2
        if side == "-y":
            ctr, size = (c, -n, (z0 + z1) / 2), (l, depth, z1 - z0)
        elif side == "+y":
            ctr, size = (c, n, (z0 + z1) / 2), (l, depth, z1 - z0)
        elif side == "-x":
            ctr, size = (-n, c, (z0 + z1) / 2), (depth, l, z1 - z0)
        else:
            ctr, size = (n, c, (z0 + z1) / 2), (depth, l, z1 - z0)
        out.append(bevel(box(f"{prefix}_{i}", ctr, size, mat, coll), bev))
    return out


def skin(name, region, out_inset, out_top, in_inset, in_top, mat, coll):
    """Layer between two offset shells clipped to `region` (consumed). Used as a cutter for seams/recesses
    (cut faces take `mat`) and as a solid for armour plates."""
    a = outer_shell(name, out_inset, BASE_H - 1.0, out_top, mat, coll)
    boolean(a, region, "INTERSECT")
    boolean(a, outer_shell("tmp_skin_in", in_inset, BASE_H - 1.5, in_top, None, coll))
    return a


def on_chamfer(name, mid, normal_axis, sign, size, offset, mat, coll):
    """Box lying on a 45° chamfer. normal_axis 'x' (side chamfers, sign -1 = left) or 'y' (front -1 / back +1);
    size = (along-edge length, thickness along the normal, length along the slope); offset along the normal."""
    k = math.sqrt(0.5)
    if normal_axis == "y":
        n = (0.0, sign * k, k)
        ctr = (mid[0], mid[1] + n[1] * offset, mid[2] + n[2] * offset)
        return box(name, ctr, (size[0], size[1], size[2]), mat, coll, rot=(math.radians(45 * sign), 0, 0))
    n = (sign * k, 0.0, k)
    ctr = (mid[0] + n[0] * offset, mid[1], mid[2] + n[2] * offset)
    return box(name, ctr, (size[1], size[0], size[2]), mat, coll, rot=(0, math.radians(-45 * sign), 0))


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
            face_panels(f"BASE_PANELS_f{i}_top", "-y", [(x0, x1)], 1.05, 1.84, 0.1, M["M_MetalDark"], exp,
                        recess=0.05)
            for k, hx_ in enumerate((x0 + 0.95, x1 - 0.95)):
                bevel(box(f"BASE_hatch_f{i}_{k}", (hx_, -D / 2 + 0.05 - 0.015, 1.45), (0.9, 0.03, 0.42),
                          M["M_MetalLight"], exp), 0.01)
            continue
        blk = face_panels(f"BASE_PANELS_f{i}", "-y", [(x0, x1)], 0.2, 1.84, CORE + 0.02, M["M_MetalDark"], exp,
                          recess=0.05)[0]
        cx = (x0 + x1) / 2
        if kind == "light":
            boolean(blk, box("tmp_niche", (cx, -D / 2, 0.75), (1.0, 0.16, 0.34), M["M_MetalLight"], exp))
            # niche floor is at -D/2 + 0.08 (cutter depth 0.16 centred on the footprint edge)
            box(f"LIGHTS_base_{i}", (cx, -D / 2 + 0.065, 0.75), (0.9, 0.03, 0.26), M["M_LightWarm"], exp)
        else:
            bevel(box("BASE_hatch", (cx, -D / 2 + 0.05 - 0.02, 0.95), (1.4, 0.04, 1.0), M["M_MetalLight"], exp), 0.02)
            box("LIGHTS_base_hatch", (cx, -D / 2 + 0.05 - 0.03, 1.62), (0.5, 0.03, 0.1), M["M_LightWarm"], exp)
    # pilasters between the front modules (stand proud to the footprint edge) with amber indicators
    for k, x in enumerate((-5.3, -1.5, 1.5, 5.3)):
        face_panels(f"BASE_PILASTER_f{k}", "-y", [(x - 0.2, x + 0.2)], 0.15, 1.86, 0.25, M["M_MetalDark"], exp,
                    gap=0.0, bev=0.06)
        box(f"LIGHTS_indicator_f{k}", (x, -D / 2 + 0.0075 + 0.002, 1.6), (0.18, 0.015, 0.06), M["M_Beacon"], exp)
    # back / sides: plain panel rows, the door bay stays open
    sy = D / 2 - 1.0 - CORE
    face_panels("BASE_PANELS_b", "+y", [(-fx, -4.6), (-4.6, DOOR_X - DOOR_W / 2 - 0.25),
                                        (DOOR_X + DOOR_W / 2 + 0.25, 2.2), (2.2, fx)],
                0.2, 1.84, CORE + 0.02, M["M_MetalDark"], exp, recess=0.05)
    for k, x in enumerate((-4.6, 2.2)):
        face_panels(f"BASE_PILASTER_b{k}", "+y", [(x - 0.2, x + 0.2)], 0.15, 1.86, 0.25, M["M_MetalDark"], exp,
                    gap=0.0, bev=0.06)
    for side in ("-x", "+x"):
        nm = f"{'L' if side[0] == '-' else 'R'}"
        face_panels(f"BASE_PANELS_{nm}", side, [(-sy, -1.2), (-1.2, 1.2), (1.2, sy)], 0.2, 1.84, CORE + 0.02,
                    M["M_MetalDark"], exp, recess=0.05)
        for k, y in enumerate((-1.2, 1.2)):
            face_panels(f"BASE_PILASTER_{nm}{k}", side, [(y - 0.2, y + 0.2)], 0.15, 1.86, 0.25, M["M_MetalDark"],
                        exp, gap=0.0, bev=0.06)
    # chunky corner blocks wrapping the 45° plinth corners
    for s_x in (-1, 1):
        for s_y in (-1, 1):
            cb = prism(f"BASE_CORNER_{s_x:+d}{s_y:+d}", chamfer_rect(W / 2, D / 2, 1.0), "z", 0.15, 1.86,
                       M["M_MetalDark"], exp)
            boolean(cb, box("tmp_cq", (s_x * (W / 2 - 0.75), s_y * (D / 2 - 0.75), 1.0), (1.5, 1.5, 3.0), None, exp),
                    "INTERSECT")
            boolean(cb, prism("tmp_cc", chamfer_rect(W / 2 - 0.22, D / 2 - 0.22, 0.95), "z", -1, 3, None, exp))
            bevel(cb, 0.06)
    # light-metal cap ledge on top of the plinth, open at the door
    cap = prism("BASE_cap", chamfer_rect(W / 2, D / 2, 1.0), "z", 1.86, 1.98, M["M_MetalLight"], exp)
    boolean(cap, prism("tmp_capi", chamfer_rect(W / 2 - 0.4, D / 2 - 0.4, 0.85), "z", 1.0, 3.0, None, exp))
    boolean(cap, box("tmp_capd", (DOOR_X, D / 2, 1.9), (DOOR_W + 0.5, 1.2, 0.5), None, exp))
    for x in (-5.3, -1.5, 1.5, 5.3):  # segment joints
        boolean(cap, box("tmp_capj", (x, -D / 2, 1.98), (0.04, 0.9, 0.05), M["M_MetalDark"], exp))
    bevel(cap, 0.02)

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
    # dark stepped reveal around the window opening
    boolean(shell, prism("tmp_reveal", inset_poly(win, -0.24), "y", fy - 0.5, fy + 0.09, M["M_MetalDark"], exp))
    # panel seams running over front chamfer, roof and back chamfer
    for x in (-3.4, 3.4):
        g = skin("tmp_seam", box("tmp_sr", (x, 0, 6.5), (0.05, D + 2, 1.7), None, exp),
                 -0.1, ROOF + 0.1, 0.035, ROOF - 0.035, M["M_MetalDark"], exp)
        boolean(shell, g)
    # recessed dark louvre bays on both side chamfers (concept: dark vents along the top edges)
    k = math.sqrt(0.5)
    for s in (-1, 1):
        mid = (s * (sx_out - SIDE_CH / 2), 0.0, ROOF - SIDE_CH / 2)
        reg = on_chamfer("tmp_cr", mid, "x", s, (2.8, 0.5, 1.0), 0.0, None, exp)
        boolean(shell, skin("tmp_bay", reg, -0.1, ROOF + 0.1, 0.07, ROOF - 0.07, M["M_MetalDark"], exp))
        for i in range(5):
            on_chamfer(f"VENTS_chamfer_{'L' if s < 0 else 'R'}_slat_{i}",
                       (mid[0] - s * k * (i - 2) * 0.17, 0.0, mid[2] + k * (i - 2) * 0.17), "x", s,
                       (2.7, 0.03, 0.07), -0.04, M["M_MetalLight"], exp)
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
    xs = [-5.75, -3.5, -1.15, 1.15, 3.5, 5.75]
    for i in range(len(xs) - 1):  # segmented light-metal sill between the pylons
        bevel(box(f"WINDOW_SILL_{i}", ((xs[i] + xs[i + 1]) / 2, (fy - 0.16 + yb + 0.02) / 2, 2.07),
                  (xs[i + 1] - xs[i] - 0.05, yb + 0.02 - fy + 0.16, 0.18), M["M_MetalLight"], exp), 0.02)

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
                boolean(a, prism("tmp_wa", inset_poly(win, -0.24), "y", fy - 1.0, fy + 0.6, M["M_MetalDark"], exp))
            pa = (-ARMOR_T - 0.1, ROOF + 0.3, -ARMOR_T + 0.04, ROOF + ARMOR_T * 0.6 - 0.04)
            boolean(a, skin("tmp_ps", box("tmp_pr", (0, 0, 4.35), (W + 2, D + 2, 0.05), None, exp), *pa,
                            M["M_MetalDark"], exp))
            if s_x < 0 and s_y < 0:   # tall recessed louvre on the left side of the front-left pylon
                reg = box("tmp_lv", (-W / 2, -2.85, 3.8), (1.0, 0.9, 2.9), None, exp)
                boolean(a, skin("tmp_lvs", reg, -ARMOR_T - 0.1, ROOF + 0.3, -ARMOR_T + 0.12, ROOF, M["M_MetalDark"], exp))
            if s_x > 0 and s_y < 0:   # dark logo panel + two slots on the 45° face of the front-right pylon
                ax, ay = sx_out + ARMOR_T, D / 2 - SHELL_INSET + ARMOR_T
                ac = CORNER + ARMOR_T * 0.4
                mid = (ax - ac / 2, -(ay - ac / 2))
                reg = box("tmp_lg", (mid[0], mid[1], 3.35), (1.2, 0.8, 2.1), None, exp, rot_z=math.radians(45))
                boolean(a, skin("tmp_lgs", reg, -ARMOR_T - 0.1, ROOF + 0.3, -ARMOR_T + 0.06, ROOF, M["M_MetalDark"], exp))
                for j, dz in enumerate((0.0, 0.32)):
                    reg = box("tmp_sl", (mid[0], mid[1], 4.85 + dz), (0.9, 0.8, 0.07), None, exp, rot_z=math.radians(45))
                    boolean(a, skin("tmp_sls", reg, -ARMOR_T - 0.1, ROOF + 0.3, -ARMOR_T + 0.08, ROOF,
                                    M["M_MetalDark"], exp))
                logo_at = (mid[0] - 0.05, mid[1] + 0.05)
            bevel(a, 0.05)
    lx = -(sx_out + ARMOR_T) + 0.1          # slats sit inside the left pylon recess
    for i in range(10):
        box(f"VENTS_pylon_L_slat_{i}", (lx, -2.85, 2.55 + i * 0.27), (0.03, 0.82, 0.07), M["M_MetalLight"], exp)
    # FICSIT logo placeholder inside the dark panel (texture/decal later)
    box("DECALS_logo", (logo_at[0], logo_at[1], 3.85), (0.95, 0.01, 0.26), M["M_MetalLight"], exp,
        rot_z=math.radians(45))

    # ===================================================================== FRONT VISOR LIGHT (on the 45° chamfer)
    # thin axis must follow the chamfer normal (0, -1, 1)/sqrt(2) -> rotate -45° about X
    # raised orange housing with a dark bezel, as on the concept
    c = (0.0, fy + FRONT_CH / 2, ROOF - FRONT_CH / 2)
    bevel(on_chamfer("LIGHTS_visor_housing", c, "y", -1, (3.9, 0.4, 1.15), 0.08, M["M_PaintOrange"], exp), 0.06)
    bevel(on_chamfer("LIGHTS_visor_bezel", c, "y", -1, (3.3, 0.08, 0.7), 0.26, M["M_MetalDark"], exp), 0.02)
    on_chamfer("LIGHTS_visor", c, "y", -1, (3.0, 0.04, 0.46), 0.29, M["M_LightWarm"], exp)
    # rear light bar on the back chamfer
    cb = (1.5, by - BACK_CH / 2, ROOF - BACK_CH / 2)
    bevel(on_chamfer("LIGHTS_back_housing", cb, "y", 1, (2.6, 0.14, 0.62), 0.04, M["M_MetalDark"], exp), 0.02)
    on_chamfer("LIGHTS_back", cb, "y", 1, (2.2, 0.04, 0.36), 0.12, M["M_LightWarm"], exp)

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
        n = max(1, int((x1 - x0) / 1.1))
        for r in range(1, n):   # vertical stiffener ribs
            box(f"BACK_PANEL_{j}_rib_{r}", (x0 + (x1 - x0) * r / n, by + 0.07, BASE_H + 1.6), (0.08, 0.04, 2.7),
                M["M_MetalLight"], exp)
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
    # orange side module up top; the pipes rise from the plinth into its underside (concept 00)
    sm = box("SIDE_MODULE_L", (-(sx_out + 0.09), -0.6, 5.0), (0.18, 2.3, 0.95), M["M_PaintOrange"], exp)
    bevel(sm, 0.06)
    bevel(box("SIDE_MODULE_L_grille", (-(sx_out + 0.185), -0.6, 5.0), (0.01, 1.7, 0.5), M["M_MetalDark"], exp), 0.0)
    for i in range(5):
        box(f"SIDE_MODULE_L_slat_{i}", (-(sx_out + 0.19), -0.6, 4.8 + i * 0.1), (0.008, 1.6, 0.035),
            M["M_MetalLight"], exp)
    px = -(sx_out - 0.08)                   # centre; r = 0.25 keeps them inside the 16 m footprint
    for i, y in enumerate((-1.05, -0.4)):
        cylinder(f"EXHAUST_PIPES_{i}", (px, y, 3.27), 0.25, 2.55, M["M_MetalLight"], exp, 16)
        for k, z in enumerate((2.0, 4.5)):
            cylinder(f"EXHAUST_PIPES_{i}_flange_{k}", (px, y, z), 0.3, 0.12, M["M_MetalDark"], exp, 16)
        for k, z in enumerate((2.7, 3.6)):
            cylinder(f"EXHAUST_PIPES_{i}_clamp_{k}", (px, y, z), 0.28, 0.1, M["M_PaintOrange"], exp, 16)
    bevel(box("EXHAUST_PIPES_bracket", (-(sx_out + 0.06), -0.72, 3.15), (0.12, 1.3, 0.16), M["M_MetalDark"], exp),
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
    for k, x in enumerate((-1.6, 1.6)):     # grilles on the front face of the lower roof tier
        bevel(box(f"ROOF_grille_{k}", (x, ry - 1.9 - 0.01, ROOF + 0.15), (1.5, 0.03, 0.26), M["M_MetalDark"], exp),
              0.0)
        for i in range(3):
            box(f"ROOF_grille_{k}_slat_{i}", (x, ry - 1.93, ROOF + 0.07 + i * 0.08), (1.4, 0.02, 0.03),
                M["M_MetalLight"], exp)
    bevel(box("ROOF_hatch", (0.0, ry, ROOF + 0.84), (1.0, 0.8, 0.08), M["M_MetalDark"], exp), 0.02)
    box("ROOF_hatch_handle", (0.0, ry - 0.25, ROOF + 0.9), (0.4, 0.05, 0.05), M["M_MetalLight"], exp)
    cylinder("ROOF_conduit", (4.38, 1.5, ROOF + 0.2), 0.08, 0.4, M["M_MetalLight"], exp, 10, axis="X")
    for k, x in enumerate((-2.0, 2.0)):
        bevel(box(f"ROOF_vent_{k}", (x, ry, ROOF + 0.92), (1.2, 0.9, 0.25), M["M_MetalDark"], exp), 0.03)
        for i in range(5):
            box(f"ROOF_vent_{k}_slat_{i}", (x, ry - 0.32 + i * 0.16, ROOF + 1.05), (1.05, 0.06, 0.03),
                M["M_MetalLight"], exp)

    # ===================================================================== BEACON
    bx, byy = 5.0, 1.5
    housing = [(bx + x, byy + y) for x, y in chamfer_rect(0.45, 0.35, 0.12)]
    bevel(prism("BEACON_housing", housing, "z", ROOF - 0.05, ROOF + 1.6, M["M_PaintOrange"], exp), 0.03)
    bevel(box("BEACON_frame", (bx, byy - 0.36, ROOF + 0.85), (0.62, 0.04, 1.1), M["M_MetalDark"], exp), 0.015)
    box("BEACON_window", (bx, byy - 0.385, ROOF + 1.05), (0.34, 0.02, 0.36), M["M_LightWarm"], exp)
    box("BEACON_indicator", (bx, byy - 0.385, ROOF + 0.55), (0.3, 0.02, 0.14), M["M_ScreenStatic"], exp)
    bevel(box("BEACON_cap", (bx, byy, ROOF + 1.65), (0.75, 0.55, 0.1), M["M_MetalDark"], exp), 0.02)
    # centre mast carries the lamp, two thinner antennas flank it
    cylinder("BEACON_mast", (bx, byy, ROOF + 2.5), 0.06, 1.7, M["M_MetalLight"], exp, 10)
    cylinder("BEACON_mast_collar", (bx, byy, ROOF + 1.85), 0.1, 0.25, M["M_MetalDark"], exp, 10)
    cylinder("BEACON_lamp", (bx, byy, ROOF + 3.48), 0.11, 0.26, M["M_Beacon"], exp, 12)
    cylinder("BEACON_lamp_cap", (bx, byy, ROOF + 3.64), 0.13, 0.06, M["M_MetalDark"], exp, 12)
    cylinder("BEACON_lamp_base", (bx, byy, ROOF + 3.33), 0.13, 0.05, M["M_MetalDark"], exp, 12)
    for dx, h in ((-0.27, 1.9), (0.27, 1.5)):
        cylinder(f"BEACON_antenna_{dx:+.2f}", (bx + dx, byy, ROOF + 1.7 + h / 2), 0.03, h, M["M_MetalLight"],
                 exp, 8)
        cylinder(f"BEACON_antenna_{dx:+.2f}_base", (bx + dx, byy, ROOF + 1.8), 0.07, 0.2, M["M_MetalDark"], exp, 8)
        cylinder(f"BEACON_antenna_{dx:+.2f}_ring", (bx + dx, byy, ROOF + 1.7 + h * 0.6), 0.05, 0.05,
                 M["M_MetalDark"], exp, 8)

    build_interior(M, exp, ref)


if __name__ == "__main__":
    run(build, "SM_CommandCenter", "model")
