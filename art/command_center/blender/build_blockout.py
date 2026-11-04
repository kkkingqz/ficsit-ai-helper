"""Command Center (AI Terminal, flagship) — stage 1 procedural blockout (kept for reference).

Run with Blender 5.2 LTS:
    blender -b -P build_blockout.py -- --out ../export [--render ../renders]
or with the `bpy` wheel:
    python build_blockout.py --out ../export [--render ../renders]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)

from cc_lib import *  # noqa: F401,F403  dimensions + helpers
from cc_lib import run
from cc_interior import build_interior


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

    build_interior(M, exp, ref)


if __name__ == "__main__":
    run(build, "SM_CommandCenter_Blockout", "blockout")
