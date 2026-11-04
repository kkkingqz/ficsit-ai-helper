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
LOUVRE_PYLONS = ((-1, -1), (-1, 1), (1, 1))     # front-right pylon carries the logo instead
# upper front band: separate orange sections (deliberately unequal widths) around a dark visor seat
FRONT_SECTIONS = ((-5.75, -3.6), (-3.52, -2.18), (2.18, 4.1), (4.18, 5.75))
VISOR_SEAT = (-2.1, 2.1)
FRONT_PLATE_T = 0.07
# back wall zones (x ranges; seen from behind they read right-to-left)
BACK_MODULE_X = (-2.75, 0.75)       # rear service module around the door, z 0.15..3.9
BACK_COOLING_X = (-5.65, -2.85)     # cooling block with two fans
BACK_CABLE_X = (0.85, 2.2)          # cable entry zone above the plinth power socket
BACK_CABINET_X = (2.3, 5.65)        # power cabinet: two doors + breaker column
BACK_BAND_Z = (4.0, 5.5)            # upper band over the module: hatch | radiator | tech panel
# left side = external utility cluster (y ranges; front is -y)
LEFT_TRENCH_Y = (-1.73, -0.05)      # recessed pipe run between pump block and header
LEFT_TECH_Y = (0.05, 1.73)          # tall vertical tech block


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


def face_pt(side, a, inward, z):
    """World point on an outer footprint face: a = coordinate along the face, inward = distance from the edge."""
    if side == "-y":
        return (a, -D / 2 + inward, z)
    if side == "+y":
        return (a, D / 2 - inward, z)
    if side == "-x":
        return (-W / 2 + inward, a, z)
    return (W / 2 - inward, a, z)


def face_size(side, along, thick, height):
    return (along, thick, height) if side[1] == "y" else (thick, along, height)


def plinth_face(side, mods, pilasters, M, exp, ref):
    """One face of the plinth: recessed modules (light / hazard / hatch / socket / plain) + proud pilasters."""
    tag = {"-y": "f", "+y": "b", "-x": "L", "+x": "R"}[side]
    for i, (a0, a1, kind) in enumerate(mods):
        ac = (a0 + a1) / 2
        if kind in ("vent", "power"):
            plinth_bay(side, tag, i, a0, a1, kind, M, exp)
            continue
        if kind == "service":
            plinth_service(side, tag, i, a0, a1, M, exp)
            continue
        if kind == "hazard":
            box(f"DECALS_hazard_{tag}{i}", face_pt(side, ac, CORE + 0.01, 0.62), face_size(side, a1 - a0 - 0.3, 0.04, 0.5),
                M["M_Hazard"], exp)
            face_panels(f"BASE_PANELS_{tag}{i}_top", side, [(a0, a1)], 1.05, 1.84, 0.1, M["M_MetalDark"], exp,
                        recess=0.05)
            for k, h in enumerate((a0 + 0.95, a1 - 0.95) if a1 - a0 > 2.6 else (ac,)):
                bevel(box(f"BASE_hatch_{tag}{i}_{k}", face_pt(side, h, 0.035, 1.45), face_size(side, 0.9, 0.03, 0.42),
                          M["M_MetalLight"], exp), 0.01)
            continue
        blk = face_panels(f"BASE_PANELS_{tag}{i}", side, [(a0, a1)], 0.2, 1.84, CORE + 0.02, M["M_MetalDark"], exp,
                          recess=0.05)[0]
        if kind == "light":
            boolean(blk, box("tmp_niche", face_pt(side, ac, 0.0, 0.75), face_size(side, 1.0, 0.16, 0.34),
                             M["M_MetalLight"], exp))
            # niche floor is 0.08 in from the edge (cutter depth 0.16 centred on the footprint edge)
            box(f"LIGHTS_base_{tag}{i}", face_pt(side, ac, 0.065, 0.75), face_size(side, 0.9, 0.03, 0.26),
                M["M_LightWarm"], exp)
        elif kind == "hatch":
            bevel(box(f"BASE_hatch_{tag}{i}", face_pt(side, ac, 0.03, 0.95), face_size(side, 1.4, 0.04, 1.0),
                      M["M_MetalLight"], exp), 0.02)
            box(f"LIGHTS_base_hatch_{tag}{i}", face_pt(side, ac, 0.02, 1.62), face_size(side, 0.5, 0.03, 0.1),
                M["M_LightWarm"], exp)
        elif kind == "socket":   # power connection point (open question §6.1) lives in this module
            bevel(box("POWER_SOCKET", face_pt(side, ac, 0.1, 1.0), face_size(side, 0.7, 0.2, 0.7), M["M_MetalLight"],
                      exp), 0.02)
            cylinder("POWER_SOCKET_plug", face_pt(side, ac, 0.011, 1.0), 0.16, 0.02, M["M_Rubber"], exp, 12,
                     axis="Y" if side[1] == "y" else "X")
            e = bpy.data.objects.new("SOCKET_power", None)
            e.location = face_pt(side, ac, 0.0, 1.0)
            ref.objects.link(e)
        else:  # plain: small hatch + amber indicator
            bevel(box(f"BASE_hatch_{tag}{i}", face_pt(side, ac, 0.035, 1.25), face_size(side, 0.7, 0.03, 0.5),
                      M["M_MetalLight"], exp), 0.01)
    for k, a_ in enumerate(pilasters):
        face_panels(f"BASE_PILASTER_{tag}{k}", side, [(a_ - 0.2, a_ + 0.2)], 0.15, 1.86, 0.25, M["M_MetalDark"], exp,
                    gap=0.0, bev=0.06)
        box(f"LIGHTS_indicator_{tag}{k}", face_pt(side, a_, 0.0095, 1.6), face_size(side, 0.18, 0.015, 0.06),
            M["M_Beacon"], exp)


def plinth_bay(side, tag, i, a0, a1, kind, M, exp):
    """Front side bays: same hazard strip, different function above it (ventilation vs. power)."""
    ac = (a0 + a1) / 2
    box(f"DECALS_hazard_{tag}{i}", face_pt(side, ac, CORE + 0.01, 0.62), face_size(side, a1 - a0 - 0.3, 0.04, 0.5),
        M["M_Hazard"], exp)
    top = face_panels(f"BASE_PANELS_{tag}{i}_top", side, [(a0, a1)], 1.05, 1.84, 0.1, M["M_MetalDark"], exp,
                      recess=0.05)[0]
    if kind == "vent":   # wide louvred intake with a frame
        boolean(top, box("tmp_vg", face_pt(side, ac, 0.05, 1.45), face_size(side, a1 - a0 - 0.6, 0.14, 0.55),
                         M["M_MetalDark"], exp))
        for k in range(5):
            box(f"VENTS_plinth_{tag}{i}_slat_{k}", face_pt(side, ac, 0.1, 1.24 + k * 0.105),
                face_size(side, a1 - a0 - 0.7, 0.03, 0.05), M["M_MetalLight"], exp, rot=(math.radians(-30), 0, 0))
        bevel(box(f"VENTS_plinth_{tag}{i}_filter", face_pt(side, ac, 0.055, 1.82), face_size(side, 1.2, 0.03, 0.06),
                  M["M_MetalLight"], exp), 0.005)
        return
    # power: horizontal conduit, two breaker boxes with warning labels, cable glands, status lights
    # panel face is 0.05 in from the footprint edge; everything below sits proud of it but inside the footprint
    cylinder(f"POWER_conduit_{tag}{i}", face_pt(side, ac, 0.06, 1.74), 0.055, a1 - a0 - 0.5,
             M["M_MetalLight"], exp, 10, axis="X")
    for k, bx_ in enumerate((ac - 0.85, ac + 0.85)):
        bevel(box(f"POWER_breaker_{tag}{i}_{k}", face_pt(side, bx_, 0.035, 1.38), face_size(side, 0.8, 0.06, 0.5),
                  M["M_MetalLight"], exp), 0.015)
        box(f"POWER_breaker_{tag}{i}_{k}_label", face_pt(side, bx_ - 0.22, 0.003, 1.5), face_size(side, 0.2, 0.006, 0.14),
            M["M_Hazard"], exp)
        box(f"POWER_breaker_{tag}{i}_{k}_status", face_pt(side, bx_ + 0.2, 0.003, 1.5), face_size(side, 0.16, 0.006, 0.05),
            M["M_Beacon"], exp)
        for g in (-0.2, 0.0, 0.2):   # cable glands under the breaker box
            cylinder(f"POWER_gland_{tag}{i}_{k}_{g:+.1f}", face_pt(side, bx_ + g, 0.035, 1.09), 0.035, 0.1,
                     M["M_Rubber"], exp, 8)


def plinth_service(side, tag, i, a0, a1, M, exp):
    """Main service block in the middle of the front plinth: proud housing with a recessed bay holding
    a latched service cover, connector panel, status screen and a light strip; hazard edging."""
    ac = (a0 + a1) / 2
    blk = face_panels(f"BASE_SERVICE_{tag}{i}", side, [(a0, a1)], 0.2, 1.84, CORE + 0.12, M["M_MetalDark"], exp,
                      recess=0.0, bev=0.05)[0]
    boolean(blk, box("tmp_sb", face_pt(side, ac, 0.0, 0.98), face_size(side, a1 - a0 - 0.5, 0.16, 1.3),
                     M["M_MetalDark"], exp))   # bay floor 0.08 in from the edge
    cov_x = ac - 0.35
    bevel(box(f"BASE_SERVICE_cover", face_pt(side, cov_x, 0.06, 0.95), face_size(side, 1.3, 0.04, 1.05),
              M["M_MetalLight"], exp), 0.02)
    box("BASE_SERVICE_cover_handle", face_pt(side, cov_x, 0.03, 0.8), face_size(side, 0.45, 0.03, 0.06),
        M["M_MetalDark"], exp)
    for k, dz in enumerate((0.28, -0.28)):   # latches
        bevel(box(f"BASE_SERVICE_latch_{k}", face_pt(side, cov_x + 0.72, 0.045, 0.95 + dz), face_size(side, 0.14, 0.06, 0.18),
                  M["M_MetalDark"], exp), 0.01)
    # connector panel: three ports with amber rings
    bevel(box("BASE_SERVICE_ports", face_pt(side, ac + 0.85, 0.065, 0.95), face_size(side, 0.5, 0.03, 0.95),
              M["M_Rubber"], exp), 0.01)
    for k, dz in enumerate((0.3, 0.0, -0.3)):
        cylinder(f"BASE_SERVICE_port_{k}", face_pt(side, ac + 0.85, 0.045, 0.95 + dz), 0.09, 0.02, M["M_Beacon"],
                 exp, 12, axis="Y")
        cylinder(f"BASE_SERVICE_port_{k}_plug", face_pt(side, ac + 0.85, 0.035, 0.95 + dz), 0.06, 0.02,
                 M["M_MetalDark"], exp, 12, axis="Y")
    box("BASE_SERVICE_screen", face_pt(side, cov_x, 0.075, 1.6), face_size(side, 0.6, 0.01, 0.16), M["M_ScreenStatic"],
        exp)
    box("LIGHTS_base_service", face_pt(side, ac, 0.005, 1.75), face_size(side, a1 - a0 - 0.8, 0.01, 0.05),
        M["M_LightWarm"], exp)
    for k, e in enumerate((a0 + 0.17, a1 - 0.17)):   # hazard edging on the block jambs
        box(f"DECALS_hazard_service_{k}", face_pt(side, e, 0.004, 0.98), face_size(side, 0.12, 0.008, 1.3),
            M["M_Hazard"], exp)


def back_box(name, x0, x1, z0, z1, depth, mat, coll, by, bev_w=0.03):
    """Box standing on the back wall plane (y = by) and protruding `depth` towards +Y."""
    return bevel(box(name, ((x0 + x1) / 2, by + depth / 2, (z0 + z1) / 2), (x1 - x0, depth, z1 - z0), mat, coll),
                 bev_w)


def build_back(M, exp, by):
    """Rear technical side: everything stays inside y <= D/2 (footprint edge = by + 0.2)."""
    edge = D / 2
    # dark background skin so no orange shows between the modules
    back_box("BACK_PANEL_bg", -(W / 2 - PYLON - 0.05), W / 2 - PYLON - 0.05, BASE_H + 0.1, ROOF - BACK_CH - 0.1, 0.04,
             M["M_MetalDark"], exp, by, 0.01)

    # ---- rear service module around the door ------------------------------------------------------
    mx0, mx1 = BACK_MODULE_X
    mz0, mz1 = 0.15, BACK_BAND_Z[0] - 0.1
    mod = box("BACK_SERVICE_MODULE", ((mx0 + mx1) / 2, by + 0.08, (mz0 + mz1) / 2), (mx1 - mx0, 0.16, mz1 - mz0),
              M["M_MetalDark"], exp)
    boolean(mod, box("tmp_mo", (DOOR_X, by, (DOOR_H + 0.3) / 2 - 0.01), (DOOR_W + 0.6, 1.0, DOOR_H + 0.3),
                     M["M_MetalDark"], exp))
    boolean(mod, box("tmp_ml", (DOOR_X, by + 0.16, DOOR_H + 0.62), (1.7, 0.1, 0.12), M["M_MetalDark"], exp))
    bevel(mod, 0.05)
    for k, s in enumerate((-1, 1)):          # vertical ribs on the module cheeks
        cx = DOOR_X + s * (DOOR_W / 2 + 0.3 + (mx1 - mx0 - DOOR_W - 0.6) / 4)
        box(f"BACK_SERVICE_MODULE_rib_{k}", (cx, by + 0.175, 1.9), (0.08, 0.03, 3.0), M["M_MetalLight"], exp)
    # light built into the header: recessed slot + light-metal hood
    box("LIGHTS_door", (DOOR_X, by + 0.125, DOOR_H + 0.62), (1.6, 0.02, 0.08), M["M_LightWarm"], exp)
    bevel(box("BACK_SERVICE_MODULE_hood", (DOOR_X, by + 0.18, DOOR_H + 0.71), (1.9, 0.04, 0.06), M["M_MetalLight"], exp),
          0.01)
    # heavy door frame
    dfr = box("DOOR_FRAME", (DOOR_X, by + 0.0, (DOOR_H + 0.3) / 2), (DOOR_W + 0.6, 0.34, DOOR_H + 0.3),
              M["M_MetalLight"], exp)
    boolean(dfr, box("tmp_df", (DOOR_X, by, DOOR_H / 2 - 0.01), (DOOR_W, 1.0, DOOR_H), None, exp))
    bevel(dfr, 0.04)
    for s in (-1, 1):   # hazard strips on the jambs
        box(f"DECALS_hazard_door_{s:+d}", (DOOR_X + s * (DOOR_W / 2 + 0.15), by + 0.172, 1.1), (0.2, 0.006, 1.6),
            M["M_Hazard"], exp)
    # access reader on the right cheek: housing, screen, keypad, status LED
    rx = DOOR_X + DOOR_W / 2 + 0.3 + 0.22
    bevel(box("DOOR_reader", (rx, by + 0.1775, 1.45), (0.24, 0.035, 0.38), M["M_MetalLight"], exp), 0.01)
    box("DOOR_reader_screen", (rx, by + 0.197, 1.55), (0.16, 0.004, 0.1), M["M_ScreenStatic"], exp)
    box("DOOR_reader_keypad", (rx, by + 0.197, 1.4), (0.16, 0.004, 0.1), M["M_MetalDark"], exp)
    box("DOOR_reader_led", (rx, by + 0.197, 1.3), (0.06, 0.004, 0.03), M["M_Beacon"], exp)
    # door leaves deep in the wall: louvres + handles
    for k, s in enumerate((-1, 1)):
        lx_ = DOOR_X + s * DOOR_W / 4
        bevel(box(f"DOOR_leaf_{k}", (lx_, by - WALL / 2, DOOR_H / 2), (DOOR_W / 2 - 0.03, 0.1, DOOR_H - 0.04),
                  M["M_MetalDark"], exp), 0.015)
        for i in range(6):
            box(f"DOOR_leaf_{k}_louvre_{i}", (lx_, by - WALL / 2 + 0.055, 1.35 + i * 0.16),
                (DOOR_W / 2 - 0.35, 0.02, 0.05), M["M_MetalLight"], exp)
        box(f"DOOR_leaf_{k}_handle", (DOOR_X + s * 0.15, by - WALL / 2 + 0.07, 1.1), (0.05, 0.04, 0.35),
            M["M_MetalLight"], exp)

    # ---- upper band over the module: three sections at different depths ------------------------
    bz0, bz1 = BACK_BAND_Z
    zc = (bz0 + bz1) / 2
    # serviceable compartment: hatch on hinges
    hx0, hx1 = mx0, -1.3
    back_box("BACK_BAND_hatch_bay", hx0, hx1, bz0, bz1, 0.1, M["M_MetalDark"], exp, by)
    hc = (hx0 + hx1) / 2
    back_box("BACK_BAND_hatch", hc - 0.55, hc + 0.55, zc - 0.55, zc + 0.55, 0.13, M["M_MetalLight"], exp, by, 0.02)
    for k, dz in enumerate((-0.35, 0.35)):
        cylinder(f"BACK_BAND_hatch_hinge_{k}", (hc + 0.6, by + 0.13, zc + dz), 0.04, 0.2, M["M_MetalDark"], exp, 8)
    box("BACK_BAND_hatch_handle", (hc - 0.4, by + 0.145, zc), (0.05, 0.03, 0.3), M["M_MetalDark"], exp)
    box("BACK_BAND_hatch_label", (hc, by + 0.132, zc + 0.38), (0.4, 0.004, 0.12), M["M_Hazard"], exp)
    # radiator: deepest section, framed vertical fins
    rx0, rx1 = -1.22, 0.72
    rad = box("BACK_BAND_radiator", ((rx0 + rx1) / 2, by + 0.08, zc), (rx1 - rx0, 0.16, bz1 - bz0), M["M_MetalDark"], exp)
    boolean(rad, box("tmp_rr", ((rx0 + rx1) / 2, by + 0.16, zc), (rx1 - rx0 - 0.24, 0.2, bz1 - bz0 - 0.24),
                     M["M_MetalDark"], exp))
    bevel(rad, 0.03)
    n = 13
    for i in range(n):
        x = rx0 + 0.15 + (rx1 - rx0 - 0.3) * i / (n - 1)
        box(f"BACK_BAND_radiator_fin_{i}", (x, by + 0.1, zc), (0.025, 0.1, bz1 - bz0 - 0.26), M["M_MetalLight"], exp)
    # tech panel: shallow, gauges + toggles
    tx0, tx1 = 0.8, 2.2
    back_box("BACK_BAND_techpanel", tx0, tx1, bz0, bz1, 0.06, M["M_MetalDark"], exp, by)
    tc = (tx0 + tx1) / 2
    for k, x in enumerate((tc - 0.3, tc + 0.3)):
        box(f"BACK_BAND_gauge_{k}", (x, by + 0.063, zc + 0.35), (0.48, 0.006, 0.28), M["M_ScreenStatic"], exp)
    for k in range(5):
        box(f"BACK_BAND_toggle_{k}", (tc - 0.48 + k * 0.24, by + 0.075, zc - 0.15), (0.08, 0.03, 0.12),
            M["M_MetalLight"], exp)
    box("BACK_BAND_led", (tc + 0.5, by + 0.063, zc - 0.45), (0.12, 0.006, 0.04), M["M_Beacon"], exp)
    for k in range(3):
        box(f"BACK_BAND_slot_{k}", (tc - 0.25 + k * 0.25, by + 0.062, zc - 0.48), (0.18, 0.004, 0.035),
            M["M_Rubber"], exp)

    # ---- cable entry zone above the plinth power socket ---------------------------------------
    cx0, cx1 = BACK_CABLE_X
    back_box("BACK_CABLE_plate", cx0, cx1, BASE_H + 0.1, bz0 - 0.1, 0.06, M["M_MetalDark"], exp, by)
    back_box("BACK_CABLE_entry", cx0 + 0.1, cx1 - 0.1, bz0 - 0.55, bz0 - 0.2, 0.15, M["M_MetalLight"], exp, by, 0.02)
    for k, x in enumerate((cx0 + 0.3, (cx0 + cx1) / 2, cx1 - 0.3)):
        cylinder(f"BACK_CABLE_conduit_{k}", (x, by + 0.12, (1.98 + bz0 - 0.55) / 2), 0.065, bz0 - 0.55 - 1.98,
                 M["M_Rubber"], exp, 10)
        cylinder(f"BACK_CABLE_gland_{k}", (x, by + 0.12, bz0 - 0.58), 0.09, 0.08, M["M_MetalDark"], exp, 10)
        for j, z in enumerate((2.5, 3.1)):
            box(f"BACK_CABLE_clamp_{k}_{j}", (x, by + 0.12, z), (0.2, 0.15, 0.05), M["M_MetalDark"], exp)

    # ---- power cabinet ---------------------------------------------------------------------------
    px0, px1 = BACK_CABINET_X
    pz0, pz1 = BASE_H + 0.1, 5.25
    cab = box("BACK_POWER_CABINET", ((px0 + px1) / 2, by + 0.09, (pz0 + pz1) / 2), (px1 - px0, 0.18, pz1 - pz0),
              M["M_MetalDark"], exp)
    for x in (px0 + 1.1, px0 + 2.2):   # door seams
        boolean(cab, box("tmp_pcs", (x, by + 0.18, (pz0 + pz1) / 2), (0.03, 0.04, pz1 - pz0 - 0.2), M["M_MetalDark"], exp))
    for k in range(4):                 # vent slots at the top
        boolean(cab, box("tmp_pcv", (px0 + 0.55 + k * 0.55, by + 0.18, pz1 - 0.25), (0.4, 0.06, 0.05),
                         M["M_Rubber"], exp))
    bevel(cab, 0.04)
    for k, x in enumerate((px0 + 0.95, px0 + 1.25)):
        box(f"BACK_POWER_CABINET_handle_{k}", (x, by + 0.19, 3.7), (0.05, 0.03, 0.45), M["M_MetalLight"], exp)
    box("BACK_POWER_CABINET_label", (px0 + 0.55, by + 0.182, 4.4), (0.5, 0.004, 0.34), M["M_Hazard"], exp)
    box("BACK_POWER_CABINET_plate", (px0 + 1.65, by + 0.182, 4.4), (0.6, 0.004, 0.2), M["M_MetalLight"], exp)
    bc = px0 + 2.75                    # breaker column: rows of status lights
    for r in range(4):
        z = 4.5 - r * 0.45
        box(f"BACK_POWER_CABINET_breaker_{r}", (bc, by + 0.19, z), (0.75, 0.03, 0.26), M["M_MetalLight"], exp)
        box(f"BACK_POWER_CABINET_status_{r}", (bc + 0.25, by + 0.197, z), (0.1, 0.006, 0.06),
            M["M_Beacon"] if r % 2 else M["M_ScreenStatic"], exp)
    bevel(box("BACK_POWER_CABINET_cap", ((px0 + px1) / 2, by + 0.1, pz1 + 0.05), (px1 - px0 + 0.1, 0.2, 0.1),
              M["M_PaintOrange"], exp), 0.02)

    # ---- cooling block with two fans --------------------------------------------------------------
    qx0, qx1 = BACK_COOLING_X
    qz0, qz1 = BASE_H + 0.15, 5.35
    back_box("BACK_COOLING", qx0, qx1, qz0, qz1, 0.17, M["M_MetalDark"], exp, by, 0.05)
    fx_ = (qx0 + qx1) / 2
    for f, zf in enumerate((qz0 + 0.85, qz1 - 0.85)):
        ring = cylinder(f"BACK_COOLING_fan_{f}_shroud", (fx_, by + 0.185, zf), 0.64, 0.03, M["M_MetalLight"], exp, 24,
                        axis="Y")
        boolean(ring, cylinder("tmp_fr", (fx_, by + 0.185, zf), 0.56, 0.2, None, exp, 24, axis="Y"))
        cylinder(f"BACK_COOLING_fan_{f}_well", (fx_, by + 0.172, zf), 0.57, 0.004, M["M_Rubber"], exp, 24, axis="Y")
        cylinder(f"BACK_COOLING_fan_{f}_hub", (fx_, by + 0.18, zf), 0.13, 0.03, M["M_MetalLight"], exp, 12, axis="Y")
        for b in range(5):
            a = math.radians(b * 72 + 15)
            r_ = 0.34
            box(f"BACK_COOLING_fan_{f}_blade_{b}", (fx_ + r_ * math.cos(a), by + 0.178, zf + r_ * math.sin(a)),
                (0.38, 0.012, 0.13), M["M_MetalDark"], exp, rot=(math.radians(12), -a, 0))
        for g in (-0.3, 0.0, 0.3):   # guard bars
            box(f"BACK_COOLING_fan_{f}_guard_{g:+.1f}", (fx_, by + 0.195, zf + g), (1.2, 0.008, 0.025),
                M["M_MetalDark"], exp)
    box("BACK_COOLING_label", (fx_, by + 0.172, (qz0 + qz1) / 2), (0.8, 0.004, 0.14), M["M_Hazard"], exp)


def build_left_utility(M, exp, sx_out):
    """Left side = the engineering side: pump/power block -> three pipes in a trench -> radiator header,
    the thin line branches into a tall tech block. Everything stays inside x >= -W/2."""
    wx = -sx_out                         # wall plane
    back = wx + 0.26                     # trench back wall
    edge = -W / 2

    def lbox(name, y0, y1, z0, z1, depth, mat, bev_w=0.04):
        return bevel(box(name, (wx - depth / 2 + 0.01, (y0 + y1) / 2, (z0 + z1) / 2), (depth + 0.02, y1 - y0, z1 - z0),
                         mat, exp), bev_w)

    ty0, ty1 = LEFT_TRENCH_Y
    yc = (ty0 + ty1) / 2
    # pump / power block on the plinth cap: source of the pipes
    pump = lbox("LEFT_PUMP", ty0, ty1, 2.0, 2.75, 0.19, M["M_MetalDark"])
    bevel(box("LEFT_PUMP_hatch", (wx - 0.19, yc + 0.35, 2.37), (0.02, 0.7, 0.45), M["M_MetalLight"], exp), 0.01)
    box("LEFT_PUMP_label", (wx - 0.192, yc - 0.45, 2.5), (0.006, 0.4, 0.14), M["M_Hazard"], exp)
    box("LEFT_PUMP_led", (wx - 0.192, yc - 0.45, 2.3), (0.006, 0.12, 0.05), M["M_Beacon"], exp)
    # radiator header (orange) on top with a louvred face
    hdr = lbox("LEFT_HEADER", ty0, ty1, 4.5, 5.4, 0.2, M["M_PaintOrange"], 0.06)
    boolean(hdr, box("tmp_hg", (wx - 0.2, yc, 4.95), (0.12, ty1 - ty0 - 0.3, 0.55), M["M_MetalDark"], exp))
    for i in range(6):
        box(f"LEFT_HEADER_slat_{i}", (wx - 0.16, yc, 4.72 + i * 0.09), (0.03, ty1 - ty0 - 0.35, 0.035),
            M["M_MetalLight"], exp, rot=(0, math.radians(30), 0))   # -x face: tilt about Y
    box("LEFT_HEADER_label", (wx - 0.201, ty0 + 0.35, 5.3), (0.004, 0.4, 0.06), M["M_MetalLight"], exp)

    # three pipes of different gauge; centres keep the outer surface inside the footprint
    pipes = [  # name, y, r, segmentation style
        ("LEFT_PIPE_main", ty0 + 0.38, 0.22, "flanged"),
        ("LEFT_PIPE_valve", ty0 + 1.0, 0.15, "valve"),
        ("LEFT_PIPE_branch", ty1 - 0.25, 0.08, "insulated"),
    ]
    z0, z1 = 2.75, 4.5
    for name, y, r, style in pipes:
        x = edge + 0.01 + r
        top = z1 if style != "insulated" else 3.9
        cylinder(name, (x, y, (z0 + top) / 2), r, top - z0, M["M_MetalLight"], exp, 16)
        for k, z in enumerate((z0 + 0.04, z1 - 0.04) if style != "insulated" else (z0 + 0.04,)):
            cylinder(f"{name}_flange_{k}", (x, y, z), r + 0.05, 0.08, M["M_MetalDark"], exp, 16)
        if style == "flanged":   # segment flanges + orange clamps
            cylinder(f"{name}_flange_mid", (x, y, 3.62), r + 0.05, 0.08, M["M_MetalDark"], exp, 16)
            clamps = (3.2, 4.05)
            for k, z in enumerate(clamps):
                cylinder(f"{name}_clamp_{k}", (x, y, z), r + 0.03, 0.1, M["M_PaintOrange"], exp, 16)
        elif style == "valve":   # gate valve with hand wheel facing forward
            cylinder(f"{name}_valve_body", (x, y, 3.55), r + 0.0, 0.32, M["M_MetalDark"], exp, 12)
            cylinder(f"{name}_valve_stem", (x, y - r - 0.06, 3.55), 0.025, 0.14, M["M_MetalLight"], exp, 8, axis="Y")
            cylinder(f"{name}_valve_wheel", (x, y - r - 0.14, 3.55), 0.14, 0.03, M["M_PaintOrange"], exp, 16, axis="Y")
            clamps = (3.05, 4.1)
            for k, z in enumerate(clamps):
                cylinder(f"{name}_clamp_{k}", (x, y, z), r + 0.03, 0.08, M["M_MetalDark"], exp, 16)
        else:                    # insulated branch turning into the tech block
            for k, z in enumerate((3.1, 3.45)):
                cylinder(f"{name}_insulation_{k}", (x, y, z), r + 0.025, 0.14, M["M_Rubber"], exp, 12)
            cylinder(f"{name}_elbow", (x, y, 3.9), r + 0.03, 0.2, M["M_MetalDark"], exp, 12)
            run = LEFT_TECH_Y[0] - y
            cylinder(f"{name}_run", (x, y + run / 2, 3.9), r, run, M["M_MetalLight"], exp, 12, axis="Y")
            clamps = (3.3,)
        for k, z in enumerate(clamps):   # bracket from the trench back + wall plate
            blen = (x + r * 0.0) - back
            box(f"{name}_bracket_{k}", ((x + back) / 2, y, z), (abs(blen), 0.08, 0.06), M["M_MetalDark"], exp)
            box(f"{name}_bracket_{k}_plate", (back - 0.015, y, z), (0.03, 0.22, 0.18), M["M_MetalLight"], exp)

    # tall vertical tech block
    vy0, vy1 = LEFT_TECH_Y
    vc = (vy0 + vy1) / 2
    face = wx - 0.17
    tb = lbox("LEFT_TECHBLOCK", vy0, vy1, 2.05, 5.3, 0.17, M["M_MetalDark"], 0.05)
    boolean(tb, box("tmp_ti", (face, vc, 4.72), (0.16, vy1 - vy0 - 0.3, 0.75), M["M_MetalDark"], exp))  # intake
    for i in range(7):
        box(f"LEFT_TECHBLOCK_intake_slat_{i}", (face + 0.05, vc, 4.4 + i * 0.105), (0.03, vy1 - vy0 - 0.36, 0.05),
            M["M_MetalLight"], exp, rot=(0, math.radians(30), 0))
    bevel(box("LEFT_TECHBLOCK_gauges", (face - 0.01, vc, 3.8), (0.02, vy1 - vy0 - 0.3, 0.7), M["M_MetalLight"], exp), 0.01)
    for k, y in enumerate((vc - 0.33, vc + 0.33)):
        box(f"LEFT_TECHBLOCK_screen_{k}", (face - 0.022, y, 3.9), (0.004, 0.5, 0.28), M["M_ScreenStatic"], exp)
    cylinder("LEFT_TECHBLOCK_dial", (face - 0.025, vc, 3.58), 0.1, 0.01, M["M_LightWarm"], exp, 16, axis="X")
    bevel(box("LEFT_TECHBLOCK_hatch", (face - 0.01, vc - 0.15, 2.75), (0.02, 0.95, 0.85), M["M_MetalLight"], exp), 0.01)
    for k, dz in enumerate((0.25, -0.25)):
        box(f"LEFT_TECHBLOCK_latch_{k}", (face - 0.025, vc + 0.38, 2.75 + dz), (0.03, 0.1, 0.14), M["M_MetalDark"], exp)
    box("LEFT_TECHBLOCK_label", (face - 0.003, vc + 0.55, 3.3), (0.004, 0.36, 0.12), M["M_Hazard"], exp)
    box("LEFT_TECHBLOCK_led", (face - 0.003, vc + 0.55, 3.1), (0.004, 0.12, 0.05), M["M_Beacon"], exp)
    cylinder("LEFT_TECHBLOCK_inlet", (edge + 0.01 + 0.08, vy0 - 0.02, 3.9), 0.12, 0.06, M["M_MetalDark"], exp, 12,
             axis="Y")
    for k, (z0_, z1_) in enumerate(((2.0, 2.12), (5.22, 5.36))):   # orange caps top / bottom
        lbox(f"LEFT_TECHBLOCK_cap_{k}", vy0 - 0.03, vy1 + 0.03, z0_, z1_, 0.19, M["M_PaintOrange"], 0.02)


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

    # plinth modules on all four faces (concept: same rhythm front and back, hazard bay in the middle of the sides)
    fx = W / 2 - 1.0 - CORE
    sy = D / 2 - 1.0 - CORE
    dl, dr = DOOR_X - DOOR_W / 2 - 0.25, DOOR_X + DOOR_W / 2 + 0.25          # door bay in the back
    layout = {
        "-y": ([(-fx, -5.3, "light"), (-5.3, -1.7, "vent"), (-1.7, 1.7, "service"), (1.7, 5.3, "power"),
                (5.3, fx, "light")], (-5.3, -1.7, 1.7, 5.3)),
        # back: the rear service module (BACK_MODULE_X) replaces the plinth in the door span
        "+y": ([(-fx, -5.3, "light"), (-5.3, BACK_MODULE_X[0] - 0.4, "hazard"), (BACK_MODULE_X[1] + 0.4, 2.6, "socket"),
                (2.6, 5.3, "hazard"), (5.3, fx, "light")],
               (-5.3, BACK_MODULE_X[0] - 0.2, BACK_MODULE_X[1] + 0.2, 2.6, 5.3)),
        "-x": ([(-sy, -1.2, "plain"), (-1.2, 1.2, "hazard"), (1.2, sy, "plain")], (-1.2, 1.2)),
        "+x": ([(-sy, -1.2, "plain"), (-1.2, 1.2, "hazard"), (1.2, sy, "plain")], (-1.2, 1.2)),
    }
    for side, (mods, pilasters) in layout.items():
        plinth_face(side, mods, pilasters, M, exp, ref)
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
    boolean(cap, box("tmp_capd", (DOOR_X, D / 2, 1.9), (BACK_MODULE_X[1] - BACK_MODULE_X[0], 1.2, 0.5), None, exp))
    for side, (_, pilasters) in layout.items():   # segment joints above every pilaster
        for a_ in pilasters:
            c_ = face_pt(side, a_, 0.0, 1.98)
            boolean(cap, box("tmp_capj", c_, face_size(side, 0.04, 0.9, 0.05), M["M_MetalDark"], exp))
    bevel(cap, 0.02)
    # amber markers on the 45° faces of the plinth corner blocks
    for s_x in (-1, 1):
        for s_y in (-1, 1):
            k = math.sqrt(0.5)
            box(f"LIGHTS_indicator_corner_{s_x:+d}{s_y:+d}", (s_x * (W / 2 - 0.5) - s_x * k * 0.005,
                s_y * (D / 2 - 0.5) - s_y * k * 0.005, 1.6), (0.3, 0.015, 0.07), M["M_Beacon"], exp,
                rot_z=math.atan2(s_x, -s_y))

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
    boolean(shell, prism("tmp_reveal", inset_poly(win, -0.24), "y", fy - 0.5, fy + 0.17, M["M_MetalDark"], exp))
    # dark seams in the shell under the gaps between the front band sections
    gaps = sorted({x for sec in FRONT_SECTIONS for x in sec} | set(VISOR_SEAT))
    gaps = [(a + b) / 2 for a, b in zip(gaps[:-1], gaps[1:]) if 0.02 < b - a < 0.2]
    for x in gaps:
        g = skin("tmp_fs", box("tmp_fsr", (x, -3.3, 6.4), (0.06, 3.4, 2.0), None, exp),
                 -0.1, ROOF + 0.1, 0.035, ROOF - 0.035, M["M_MetalDark"], exp)
        boolean(shell, g)
    # panel seams running over front chamfer, roof and back chamfer
    for x in (-3.4, 3.4):
        g = skin("tmp_seam", box("tmp_sr", (x, 0, 6.5), (0.05, D + 2, 1.7), None, exp),
                 -0.1, ROOF + 0.1, 0.035, ROOF - 0.035, M["M_MetalDark"], exp)
        boolean(shell, g)
    # recessed dark louvre bays on both side chamfers (concept: dark vents along the top edges)
    # left = the technical side (big bay, more slats, hood), right = secondary and cleaner
    k = math.sqrt(0.5)
    for s, length, slope, n in ((-1, 3.3, 1.15, 7), (1, 2.0, 0.8, 4)):
        mid = (s * (sx_out - SIDE_CH / 2), 0.0, ROOF - SIDE_CH / 2)
        reg = on_chamfer("tmp_cr", mid, "x", s, (length, 0.5, slope), 0.0, None, exp)
        boolean(shell, skin("tmp_bay", reg, -0.1, ROOF + 0.1, 0.07, ROOF - 0.07, M["M_MetalDark"], exp))
        for i in range(n):
            o = (i - (n - 1) / 2) * (slope - 0.15) / (n - 1)
            on_chamfer(f"VENTS_chamfer_{'L' if s < 0 else 'R'}_slat_{i}", (mid[0] - s * k * o, 0.0, mid[2] + k * o),
                       "x", s, (length - 0.1, 0.03, 0.07), -0.04, M["M_MetalLight"], exp)
    hood_mid = (-(sx_out - SIDE_CH / 2) + k * 0.66, 0.0, ROOF - SIDE_CH / 2 + k * 0.66)
    bevel(on_chamfer("VENTS_chamfer_L_hood", hood_mid, "x", -1, (3.5, 0.14, 0.16), 0.03, M["M_PaintOrange"], exp), 0.02)
    # utility trench on the left wall for the pipe run (0.26 deep, wall stays 0.09 thick)
    boolean(shell, box("tmp_trench", (-sx_out, (LEFT_TRENCH_Y[0] + LEFT_TRENCH_Y[1]) / 2, (2.75 + 4.5) / 2),
                       (0.52, LEFT_TRENCH_Y[1] - LEFT_TRENCH_Y[0], 1.75), M["M_MetalDark"], exp))
    bevel(shell, 0.05)

    # ===================================================================== WINDOW (tilted 15°)
    # heavy stepped frame: deep reveal (0.17) + a protruding dark bezel ring standing in it
    bez = prism("WINDOW_BEZEL", inset_poly(win, -0.15), "y", fy + 0.0, fy + 0.17, M["M_MetalDark"], exp)
    boolean(bez, prism("tmp_bz", win, "y", fy - 1, fy + 1, None, exp))
    bevel(bez, 0.03)
    t = 0.16
    inner_win = inset_poly(win, t)
    frame = prism("WINDOW_FRAMES", win, "y", yb - 0.09, yb + 0.09, M["M_MetalDark"], exp)
    boolean(frame, prism("tmp_fi", inner_win, "y", yb - 1, yb + 1, None, exp))
    shear_y(frame, WIN_Z0, TILT)
    parts = []
    for x in (-MULLION_X, MULLION_X):
        parts.append(box(f"WINDOW_FRAMES_mullion_{x:+.0f}", (x, yb, (WIN_Z0 + WIN_TOP) / 2),
                         (0.2, 0.2, WIN_TOP - WIN_Z0), M["M_MetalDark"], exp))
    xb, xt, hgt = WIN_X - 0.3, WIN_X - 1.5, WIN_TOP - WIN_Z0
    ang = math.atan2(xb - xt, hgt)
    for s in (-1, 1):
        parts.append(box(f"WINDOW_FRAMES_mullion_angled_{s:+d}", (s * (xb + xt) / 2, yb, (WIN_Z0 + WIN_TOP) / 2),
                         (0.2, 0.2, math.hypot(xb - xt, hgt)), M["M_MetalDark"], exp, rot=(0, -s * ang, 0)))
    parts.append(prism("WINDOW_GLASS", inner_win, "y", yb - 0.015, yb + 0.015, M["M_Glass"], exp))
    # joint plates where the mullions meet the frame (bolted nodes)
    zb, zt = WIN_Z0 + t + 0.08, WIN_TOP - t - 0.08
    nodes = [(x, z) for x in (-MULLION_X, MULLION_X) for z in (zb, zt)]
    nodes += [(s * xb, zb) for s in (-1, 1)] + [(s * xt, zt) for s in (-1, 1)]
    for i, (x, z) in enumerate(nodes):
        parts.append(box(f"WINDOW_FRAMES_node_{i}", (x, yb - 0.12, z), (0.36, 0.06, 0.26), M["M_MetalLight"], exp))
        for dx in (-0.11, 0.11):
            parts.append(cylinder(f"WINDOW_FRAMES_node_{i}_bolt_{dx:+.2f}", (x + dx, yb - 0.16, z), 0.03, 0.03,
                                  M["M_MetalDark"], exp, 8, axis="Y"))
    for p in parts:
        shear_y(p, WIN_Z0, TILT)
    xs = [-5.75, -3.5, -1.15, 1.15, 3.5, 5.75]
    for i in range(len(xs) - 1):  # segmented light-metal sill between the pylons
        bevel(box(f"WINDOW_SILL_{i}", ((xs[i] + xs[i + 1]) / 2, (fy - 0.16 + yb + 0.02) / 2, 2.07),
                  (xs[i + 1] - xs[i] - 0.05, yb + 0.02 - fy + 0.16, 0.18), M["M_MetalLight"], exp), 0.02)
    # thin mechanical mounts under the lower glass edge: bracket + diagonal strut + pin
    for i, x in enumerate((-4.7, -3.0, -1.2, 1.2, 3.0, 4.7)):
        bevel(box(f"WINDOW_MOUNT_{i}", (x, fy + 0.0, 2.25), (0.14, 0.16, 0.14), M["M_MetalDark"], exp), 0.01)
        box(f"WINDOW_MOUNT_{i}_strut", (x, fy - 0.03, 2.19), (0.05, 0.05, 0.2), M["M_MetalLight"], exp,
            rot=(math.radians(-35), 0, 0))
        cylinder(f"WINDOW_MOUNT_{i}_pin", (x, fy - 0.0, 2.25), 0.025, 0.2, M["M_MetalLight"], exp, 8, axis="X")

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
            if (s_x, s_y) in LOUVRE_PYLONS:   # tall recessed louvre on the side face of the pylon
                reg = box("tmp_lv", (s_x * W / 2, s_y * 2.85, 3.8), (1.0, 0.9, 2.9), None, exp)
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
    for s_x, s_y in LOUVRE_PYLONS:          # slats sit inside the recesses
        lx = s_x * (sx_out + ARMOR_T - 0.1)
        for i in range(10):
            box(f"VENTS_pylon_{s_x:+d}{s_y:+d}_slat_{i}", (lx, s_y * 2.85, 2.55 + i * 0.27), (0.03, 0.82, 0.07),
                M["M_MetalLight"], exp)
    # FICSIT logo placeholder inside the dark panel (texture/decal later)
    box("DECALS_logo", (logo_at[0], logo_at[1], 3.85), (0.95, 0.01, 0.26), M["M_MetalLight"], exp,
        rot_z=math.radians(45))

    # ===================================================================== FRONT VISOR LIGHT (on the 45° chamfer)
    # thin axis must follow the chamfer normal (0, -1, 1)/sqrt(2) -> rotate -45° about X
    # separate orange sections over the front chamfer and roof edge + dark recessed seat for the visor
    def band_plate(name, x0, x1, thick, mat):
        reg = box("tmp_bpr", ((x0 + x1) / 2, -3.3, 6.75), (x1 - x0, 3.4, 2.3), None, exp)
        p = skin(name, reg, -thick, ROOF + thick, 0.0, ROOF, mat, exp)
        boolean(p, prism("tmp_bpw", inset_poly(win, -0.24), "y", fy - 1.0, fy + 1.7, None, exp))
        return bevel(p, 0.025)
    for i, (x0, x1) in enumerate(FRONT_SECTIONS):
        band_plate(f"FRONT_BAND_{i}", x0, x1, FRONT_PLATE_T, M["M_PaintOrange"])
    band_plate("FRONT_BAND_visor_seat", *VISOR_SEAT, 0.045, M["M_MetalDark"])
    for i, x in enumerate((-2.15, 2.15)):   # light-metal clamps holding the visor housing
        on_chamfer(f"LIGHTS_visor_clamp_{i}", (x, fy + FRONT_CH / 2, ROOF - FRONT_CH / 2), "y", -1,
                   (0.12, 0.16, 0.8), 0.1, M["M_MetalLight"], exp)
    # raised orange housing with a dark bezel, as on the concept
    c = (0.0, fy + FRONT_CH / 2, ROOF - FRONT_CH / 2)
    bevel(on_chamfer("LIGHTS_visor_housing", c, "y", -1, (3.9, 0.4, 1.15), 0.08, M["M_PaintOrange"], exp), 0.06)
    bevel(on_chamfer("LIGHTS_visor_bezel", c, "y", -1, (3.3, 0.08, 0.7), 0.26, M["M_MetalDark"], exp), 0.02)
    on_chamfer("LIGHTS_visor", c, "y", -1, (3.0, 0.04, 0.46), 0.29, M["M_LightWarm"], exp)
    # rear light bar on the back chamfer
    cb = (DOOR_X, by - BACK_CH / 2, ROOF - BACK_CH / 2)
    bevel(on_chamfer("LIGHTS_back_housing", cb, "y", 1, (2.6, 0.14, 0.62), 0.04, M["M_MetalDark"], exp), 0.02)
    on_chamfer("LIGHTS_back", cb, "y", 1, (2.2, 0.04, 0.36), 0.12, M["M_LightWarm"], exp)

    # ===================================================================== SIDE / BACK PANELS
    free_y = D / 2 - PYLON - 0.05
    for s_x, nm in ((1, "R"),):   # the left side is the utility cluster (build_left_utility)
        for j, (z0, z1) in enumerate(((BASE_H + 0.3, 3.75), (3.85, 5.2))):
            bevel(box(f"SIDE_PANEL_{nm}_{j}", (s_x * (sx_out + 0.025), 0.0, (z0 + z1) / 2),
                      (0.05, 2 * free_y, z1 - z0), M["M_MetalDark"], exp), 0.015)
    build_back(M, exp, by)

    build_left_utility(M, exp, sx_out)

    # ===================================================================== EQUIPMENT CABINET (right)
    cx0 = sx_out + 0.09
    cab = box("SIDE_CABINET_R", (cx0, -0.15, 3.55), (0.18, 2.6, 2.3), M["M_MetalDark"], exp)
    boolean(cab, box("tmp_cg", (sx_out + 0.2, 0.55, 3.55), (0.14, 0.8, 1.9), M["M_MetalDark"], exp))   # louvre bay
    boolean(cab, box("tmp_cs", (sx_out + 0.18, -0.2, 3.55), (0.03, 0.03, 2.1), M["M_MetalDark"], exp))   # door seam
    bevel(cab, 0.04)
    for i in range(8):
        box(f"VENTS_slat_{i}", (sx_out + 0.12, 0.55, 2.75 + i * 0.23), (0.03, 0.74, 0.17), M["M_MetalLight"], exp,
            rot=(0, math.radians(-35), 0))
    box("SIDE_CABINET_R_handle", (sx_out + 0.2, -0.4, 3.6), (0.04, 0.06, 0.4), M["M_MetalLight"], exp)
    box("SIDE_CABINET_R_label", (sx_out + 0.185, -0.85, 4.3), (0.01, 0.5, 0.18), M["M_ScreenStatic"], exp)
    bevel(box("SIDE_CABINET_R_cap", (sx_out + 0.1, -0.15, 4.75), (0.2, 2.7, 0.1), M["M_PaintOrange"], exp), 0.02)

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
