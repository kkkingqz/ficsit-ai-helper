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
The interior is built by interior_model.py (stage 4); cc_interior.py is only used by the blockout.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)

from cc_lib import (BASE_H, CEIL, CORNER, D, DOOR_H, DOOR_W, DOOR_X, FLOOR_Z, FRAME_MAJOR, FRAME_MINOR,  # noqa: F401
                    LOUVRE_ANGLE, LOUVRE_PITCH, LOUVRE_SLAT_H, LOUVRE_SLAT_T, ROOF, SHELL_INSET, WALL, W,
                    bevel, boolean, box, chamfer_rect, cylinder, louvre, prism, run, shear_y, shell_volume)
from interior_model import build_interior_v2
import uv_stage5

# personnel door, revised after the turnaround review: 2.0 x 2.8 read as a hatch next to the 6.8 m body.
# 2.4 x 3.2 gives a clear walk-in entrance with headroom for a pioneer with backpack/jetpack (blockout keeps 2.0 x 2.8)
DOOR_W, DOOR_H = 2.4, 3.2

FRONT_CH, SIDE_CH, BACK_CH = 1.4, 1.4, 1.2      # outer top chamfers
IN_FRONT_CH, IN_SIDE_CH, IN_BACK_CH = 1.0, 1.0, 0.9
WIN_Z0, WIN_TOP = 2.15, 5.6                     # window rises under the front chamfer
WIN_X = 5.9
MULLION_X = 2.4
TILT = math.radians(15)                         # glass leans inwards at the top
PYLON = 2.2                                     # corner pylon wraps this much of each face
ARMOR_T = 0.18                                  # pylon skin thickness
CORE = 0.12                                     # plinth core inset behind the module faces
PLINTH_SETBACK = 0.12                           # plinth body stands back from the mounting plate edge
PLATFORM_H = 0.15                               # bolted mounting plate on the foundation (full 16 x 8)
KICK_Z = 0.3                                    # shadow recess between plate and modules
CORNER_WRAP = 1.7                               # corner supports wrap this much of each face
BACK_SECTIONS = ((-5.75, -3.9), (-3.82, -2.42), (0.42, 2.6), (2.68, 5.75))   # back chamfer band (same family)
BACK_SEAT = (-2.34, 0.34)                       # dark seat for the rear light bar, on the door axis
LOUVRE_PYLONS = ((-1, -1), (-1, 1), (1, 1))     # front-right pylon carries the logo instead
# upper front band: separate orange sections (deliberately unequal widths) around a dark visor seat
FRONT_SECTIONS = ((-5.75, -3.6), (-3.52, -2.18), (2.18, 4.1), (4.18, 5.75))
VISOR_SEAT = (-2.1, 2.1)
FRONT_PLATE_T = 0.07
# back wall zones (x ranges; seen from behind they read right-to-left)
BACK_MODULE_X = (-2.95, 0.95)       # rear service module around the door, z 0.15..3.9 (door 2.4 + frames + cheeks)
BACK_COOLING_X = (-5.65, -3.05)     # cooling block with two fans
BACK_CABLE_X = (1.05, 2.2)          # cable entry zone above the plinth power socket
BACK_CABINET_X = (2.3, 5.65)        # power cabinet: two doors + breaker column
BACK_BAND_Z = (4.0, 5.5)            # upper band over the module: hatch | radiator | tech panel
# left side = external utility cluster (y ranges; front is -y)
LEFT_TRENCH_Y = (-1.73, -0.05)      # recessed pipe run between pump block and header
LEFT_TECH_Y = (0.05, 1.73)          # tall vertical tech block
# right side = electrical / comms side
RIGHT_CABINET_Y = (-1.65, 0.15)     # light-grey double-door electrical cabinet
RIGHT_NICHE_Y = (0.3, 0.9)          # vertical cable riser niche (cut into the wall)
RIGHT_IFACE_Y = (1.0, 1.65)         # small interface block + cable entry
COMMS_XY = (5.15, 0.6)              # beacon pedestal on the roof, in line with the riser


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
        n = half - PLINTH_SETBACK - recess - depth / 2
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


BARE_METAL_PARTS = ("PIPE", "CONDUIT", "ANTENNA", "MAST", "WHIP", "POLE", "BOLT", "HINGE", "_PIN", "STRUT", "STEM",
                    "HUB", "SLAT", "GUARD", "HANDLE", "TOGGLE", "LOUVRE", "COVER", "STRIP", "_RIB", "CLAMP", "TRAY")


TREAD_PARTS = ("FLOOR_SERVICE_PLATE", "FLOOR_HOLO_PLATE", "DOOR_THRESHOLD")   # + floor hatches, step treads


def is_tread(name):
    """Floor metal inserts (the 'service area' code of the floor marking) -> diamond tread plate slot."""
    n = name.upper()
    return n in TREAD_PARTS or (n.startswith("FLOOR_HATCH_") and not any(k in n for k in ("_SEAL", "_HINGE", "_HANDLE"))) or \
        (n.startswith("STEPS_") and n.endswith("_TREAD"))


def material_family(name):
    """Which final slot a legacy 'M_MetalLight' part belongs to: painted grey panel or bare metal."""
    n = name.upper()
    if is_tread(name):
        return "M_MetalTread"
    if "LABEL" in n or n.endswith("CABINET_PLATE") or "DECALS_LOGO" in n:
        return "M_Decal"
    if "_PLATE" in n or "SERVICE_COVER" in n or n.endswith("HATCH"):
        return "M_PaintGray"
    if any(k in n for k in BARE_METAL_PARTS):
        return "M_MetalBare"
    return "M_PaintGray"


def apply_material_families(exp, M):
    """Final pass: no part keeps the legacy slot; labels/logo become markings."""
    for ob in exp.objects:
        if ob.type != "MESH":
            continue
        fam = material_family(ob.name)
        mats = ob.data.materials
        for i, m in enumerate(mats):
            if m is not None and (m.name == "M_MetalLight" or (fam == "M_MetalTread" and m.name == "M_MetalBare")):
                mats[i] = M[fam]
        if fam == "M_Decal" and len(mats):
            mats[0] = M["M_Decal"]


def face_pt(side, a, inward, z):
    """World point on an outer footprint face: a = coordinate along the face, inward = distance from the edge."""
    inward += PLINTH_SETBACK
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
        if kind in ("vent", "power", "power_socket"):
            plinth_bay(side, tag, i, a0, a1, kind, M, exp, ref)
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
        blk = face_panels(f"BASE_PANELS_{tag}{i}", side, [(a0, a1)], KICK_Z, 1.84, CORE + 0.02, M["M_MetalDark"], exp,
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
        face_panels(f"BASE_PILASTER_{tag}{k}", side, [(a_ - 0.2, a_ + 0.2)], PLATFORM_H, 1.86, 0.25, M["M_MetalDark"], exp,
                    gap=0.0, bev=0.06)
        box(f"LIGHTS_indicator_{tag}{k}", face_pt(side, a_, 0.0095, 1.6), face_size(side, 0.18, 0.015, 0.06),
            M["M_Beacon"], exp)
        for b, da in enumerate((-0.13, 0.13)):   # anchor bolts on the mounting plate ledge
            cylinder(f"BASE_bolt_{tag}{k}_{b}", face_pt(side, a_ + da, -0.06, PLATFORM_H + 0.015), 0.03, 0.03,
                     M["M_MetalLight"], exp, 8)


def plinth_bay(side, tag, i, a0, a1, kind, M, exp, ref=None):
    """Front side bays: same hazard strip, different function above it (ventilation vs. power)."""
    ac = (a0 + a1) / 2
    if kind == "vent":   # marking code: yellow-black only where it means danger (power) -> plain kick panel here
        face_panels(f"BASE_PANELS_{tag}{i}_low", side, [(a0, a1)], KICK_Z, 1.0, CORE + 0.02, M["M_MetalDark"], exp,
                    recess=0.05)
    else:
        box(f"DECALS_hazard_{tag}{i}", face_pt(side, ac, CORE + 0.01, 0.62), face_size(side, a1 - a0 - 0.3, 0.04, 0.5),
            M["M_Hazard"], exp)
    top = face_panels(f"BASE_PANELS_{tag}{i}_top", side, [(a0, a1)], 1.05, 1.84, 0.1, M["M_MetalDark"], exp,
                      recess=0.05)[0]
    if kind == "vent":   # wide louvred intake with a frame
        gw = a1 - a0 - 2 * FRAME_MAJOR
        boolean(top, box("tmp_vg", face_pt(side, ac, 0.05, 1.45), face_size(side, gw, 0.14, 0.55),
                         M["M_MetalDark"], exp))
        pt = face_pt(side, ac, 0.1, 0.0)
        louvre(f"VENTS_plinth_{tag}{i}", side, ac, gw - 0.08, 1.19, 1.71, pt[1] if side[1] == "y" else pt[0], M, exp)
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
    if kind == "power_socket":     # external power connection point (open question §6.1) at the bay end
        sx_ = a1 - 0.7
        bevel(box("POWER_SOCKET", face_pt(side, sx_, 0.035, 1.42), face_size(side, 0.6, 0.06, 0.5), M["M_MetalLight"],
                  exp), 0.015)
        cylinder("POWER_SOCKET_plug", face_pt(side, sx_, 0.0, 1.42), 0.14, 0.02, M["M_Rubber"], exp, 12,
                 axis="Y" if side[1] == "y" else "X")
        cylinder("POWER_SOCKET_ring", face_pt(side, sx_, 0.004, 1.42), 0.17, 0.008, M["M_Beacon"], exp, 12,
                 axis="Y" if side[1] == "y" else "X")
        e = bpy.data.objects.new("SOCKET_power", None)
        e.location = face_pt(side, sx_, -0.01, 1.42)
        ref.objects.link(e)


def plinth_service(side, tag, i, a0, a1, M, exp):
    """Main service block in the middle of the front plinth: proud housing with a recessed bay holding
    a latched service cover, connector panel, status screen and a light strip; hazard edging."""
    ac = (a0 + a1) / 2
    blk = face_panels(f"BASE_SERVICE_{tag}{i}", side, [(a0, a1)], KICK_Z, 1.84, CORE + 0.12, M["M_MetalDark"], exp,
                      recess=0.0, bev=0.05)[0]
    boolean(blk, box("tmp_sb", face_pt(side, ac, 0.0, 0.98), face_size(side, a1 - a0 - 2 * FRAME_MAJOR, 0.16, 1.3),
                     M["M_MetalDark"], exp))   # bay floor 0.08 in from the edge
    cov_x = ac - 0.35
    bevel(box(f"BASE_SERVICE_cover", face_pt(side, cov_x, 0.06, 0.95), face_size(side, 1.3, 0.04, 1.05),
              M["M_MetalLight"], exp), 0.02)
    seal = box("BASE_SERVICE_cover_seal", face_pt(side, cov_x, 0.07, 0.95), face_size(side, 1.36, 0.02, 1.11),
               M["M_Rubber"], exp)
    boolean(seal, box("tmp_scs", face_pt(side, cov_x, 0.07, 0.95), face_size(side, 1.3, 0.2, 1.05), None, exp))
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
    boolean(mod, box("tmp_mo", (DOOR_X, by, (DOOR_H + FRAME_MAJOR) / 2 - 0.01),
                     (DOOR_W + 2 * FRAME_MAJOR, 1.0, DOOR_H + FRAME_MAJOR),
                     M["M_MetalDark"], exp))
    boolean(mod, box("tmp_ml", (DOOR_X, by + 0.16, DOOR_H + 0.42), (1.7, 0.1, 0.12), M["M_MetalDark"], exp))
    bevel(mod, 0.05)
    for k, s in enumerate((-1,)):            # vertical rib on the left cheek (right cheek = access module)
        cx = DOOR_X + s * (DOOR_W / 2 + FRAME_MAJOR + (mx1 - mx0 - DOOR_W - 2 * FRAME_MAJOR) / 4)
        box(f"BACK_SERVICE_MODULE_rib_{k}", (cx, by + 0.175, 1.9), (0.08, 0.03, 3.0), M["M_MetalLight"], exp)
    # light built into the header: recessed slot + light-metal hood
    box("LIGHTS_door", (DOOR_X, by + 0.125, DOOR_H + 0.42), (1.6, 0.02, 0.08), M["M_LightWarm"], exp)
    bevel(box("BACK_SERVICE_MODULE_hood", (DOOR_X, by + 0.18, DOOR_H + 0.51), (1.9, 0.04, 0.06), M["M_MetalLight"], exp),
          0.01)
    # heavy door frame
    dfr = box("DOOR_FRAME", (DOOR_X, by + 0.0, (DOOR_H + FRAME_MAJOR) / 2),
              (DOOR_W + 2 * FRAME_MAJOR, 0.34, DOOR_H + FRAME_MAJOR),
              M["M_PaintOrange"], exp)                       # orange portal frame: the main node of the back side
    boolean(dfr, box("tmp_df", (DOOR_X, by, DOOR_H / 2 - 0.01), (DOOR_W, 1.0, DOOR_H), None, exp))
    bevel(dfr, 0.04)
    for s in (-1, 1):   # hazard only at the jamb foot (as inside)
        box(f"DECALS_hazard_door_{s:+d}", (DOOR_X + s * (DOOR_W / 2 + FRAME_MAJOR / 2), by + 0.172, 0.45),
            (FRAME_MAJOR - 0.06, 0.006, 0.6),
            M["M_Hazard"], exp)
    # access reader on the right cheek: housing, screen, keypad, status LED
    rx = DOOR_X + DOOR_W / 2 + FRAME_MAJOR + 0.27
    bevel(box("DOOR_ACCESS_backplate", (rx, by + 0.17, 1.3), (0.36, 0.02, 1.0), M["M_MetalLight"], exp), 0.01)
    box("DOOR_ACCESS_trim", (rx, by + 0.182, 1.78), (0.36, 0.006, 0.04), M["M_PaintOrange"], exp)
    bevel(box("DOOR_reader", (rx, by + 0.185, 1.5), (0.28, 0.025, 0.34), M["M_MetalDark"], exp), 0.01)   # stays inside y <= 4.0
    box("DOOR_reader_screen", (rx, by + 0.1985, 1.58), (0.22, 0.002, 0.22 * 9 / 16), M["M_ScreenStatic"], exp)
    box("DOOR_reader_keypad", (rx, by + 0.1985, 1.42), (0.18, 0.002, 0.08), M["M_MetalBare"], exp)
    box("DOOR_reader_pad", (rx, by + 0.191, 1.12), (0.14, 0.004, 0.14), M["M_Rubber"], exp)      # card at hand height
    box("DOOR_reader_led", (rx, by + 0.191, 1.24), (0.08, 0.004, 0.03), M["M_Beacon"], exp)
    box("DOOR_ACCESS_label", (rx, by + 0.182, 0.9), (0.28, 0.004, 0.07), M["M_Decal"], exp)
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

    # rubber door seals: perimeter + meeting strip between the leaves
    ds = box("DOOR_seal", (DOOR_X, by - WALL / 2 + 0.065, DOOR_H / 2), (DOOR_W, 0.03, DOOR_H), M["M_Rubber"], exp)
    boolean(ds, box("tmp_ds", (DOOR_X, by - WALL / 2 + 0.065, DOOR_H / 2), (DOOR_W - 0.08, 0.2, DOOR_H - 0.08), None, exp))
    box("DOOR_seal_meeting", (DOOR_X, by - WALL / 2 + 0.06, DOOR_H / 2), (0.04, 0.03, DOOR_H - 0.08), M["M_Rubber"], exp)

    # ---- upper band over the module: three sections at different depths ------------------------
    bz0, bz1 = BACK_BAND_Z
    zc = (bz0 + bz1) / 2
    # serviceable compartment: hatch on hinges
    sx0_, sx1_ = DOOR_X - 0.9, DOOR_X + 0.9            # sign box centred on the door
    hx0, hx1 = mx0, sx0_ - 0.08
    back_box("BACK_BAND_hatch_bay", hx0, hx1, bz0, bz1, 0.1, M["M_MetalDark"], exp, by)
    hc = (hx0 + hx1) / 2
    hw, hh = (hx1 - hx0) / 2 - FRAME_MINOR, (bz1 - bz0) / 2 - FRAME_MINOR
    back_box("BACK_BAND_hatch", hc - hw, hc + hw, zc - hh, zc + hh, 0.13, M["M_MetalLight"], exp, by, 0.02)
    for k, dz in enumerate((-0.35, 0.35)):
        cylinder(f"BACK_BAND_hatch_hinge_{k}", (hc + hw - 0.08, by + 0.13, zc + dz), 0.04, 0.2, M["M_MetalDark"], exp, 8)
    box("BACK_BAND_hatch_handle", (hc - hw + 0.12, by + 0.145, zc), (0.05, 0.03, 0.3), M["M_MetalDark"], exp)
    box("BACK_BAND_hatch_label", (hc, by + 0.132, zc + 0.38), (0.4, 0.004, 0.12), M["M_Hazard"], exp)
    # entry sign light box over the door: dark housing, sign plate (decal slot), light strip on the lower edge
    back_box("BACK_SIGN_housing", sx0_, sx1_, zc - 0.4, zc + 0.4, 0.14, M["M_MetalDark"], exp, by, 0.02)
    box("BACK_SIGN_frame", (DOOR_X, by + 0.142, zc + 0.395), (sx1_ - sx0_, 0.012, 0.03), M["M_PaintOrange"], exp)
    box("DECALS_sign_back", (DOOR_X, by + 0.143, zc + 0.08), (1.6, 0.004, 0.44), M["M_Decal"], exp)
    box("LIGHTS_back_sign", (DOOR_X, by + 0.145, zc - 0.3), (1.5, 0.01, 0.04), M["M_LightWarm"], exp)
    # radiator: deepest section, framed vertical fins
    rx0, rx1 = sx1_ + 0.08, BACK_MODULE_X[1] + 0.02
    rad = box("BACK_BAND_radiator", ((rx0 + rx1) / 2, by + 0.08, zc), (rx1 - rx0, 0.16, bz1 - bz0), M["M_MetalDark"], exp)
    boolean(rad, box("tmp_rr", ((rx0 + rx1) / 2, by + 0.16, zc), (rx1 - rx0 - 2 * FRAME_MINOR, 0.2,
                                                                     bz1 - bz0 - 2 * FRAME_MINOR), M["M_MetalDark"], exp))
    bevel(rad, 0.03)
    louvre("BACK_BAND_radiator", "+y", (rx0 + rx1) / 2, rx1 - rx0 - 2 * FRAME_MINOR - 0.04, bz0 + FRAME_MINOR,
           bz1 - FRAME_MINOR, by + 0.1, M, exp)
    # tech panel: shallow, gauges + toggles
    tx0, tx1 = BACK_CABLE_X[0], 2.2
    back_box("BACK_BAND_techpanel", tx0, tx1, bz0, bz1, 0.06, M["M_MetalDark"], exp, by)
    tc = (tx0 + tx1) / 2
    for k, x in enumerate((tc - 0.3, tc + 0.3)):
        box(f"BACK_BAND_gauge_{k}", (x, by + 0.063, zc + 0.35), (0.48, 0.006, 0.27), M["M_ScreenStatic"], exp)   # 16:9
    for k in range(5):
        box(f"BACK_BAND_toggle_{k}", (tc - 0.48 + k * 0.24, by + 0.075, zc - 0.15), (0.08, 0.03, 0.12),
            M["M_MetalLight"], exp)
    box("BACK_BAND_led", (tc + 0.5, by + 0.063, zc - 0.45), (0.12, 0.006, 0.04), M["M_Beacon"], exp)
    for k in range(3):
        box(f"BACK_BAND_port_{k}", (tc - 0.25 + k * 0.25, by + 0.062, zc - 0.48), (0.18, 0.004, 0.035),
            M["M_Rubber"], exp)

    # ---- cable entry zone above the plinth power socket ---------------------------------------
    cx0, cx1 = BACK_CABLE_X
    back_box("BACK_CABLE_plate", cx0, cx1, BASE_H + 0.1, bz0 - 0.1, 0.06, M["M_MetalDark"], exp, by)
    back_box("BACK_CABLE_entry", cx0 + 0.1, cx1 - 0.1, bz0 - 0.55, bz0 - 0.2, 0.15, M["M_MetalLight"], exp, by, 0.02)
    for k, x in enumerate((cx0 + 0.3, (cx0 + cx1) / 2, cx1 - 0.3)):
        cylinder(f"BACK_CABLE_conduit_{k}", (x, by + 0.12, (1.98 + bz0 - 0.55) / 2), 0.065, bz0 - 0.55 - 1.98,
                 M["M_Rubber"], exp, 10)
        cylinder(f"BACK_CABLE_gland_{k}", (x, by + 0.105, bz0 - 0.58), 0.09, 0.08, M["M_MetalDark"], exp, 10)
        for j, z in enumerate((2.5, 3.1)):
            box(f"BACK_CABLE_clamp_{k}_{j}", (x, by + 0.12, z), (0.2, 0.15, 0.05), M["M_MetalDark"], exp)

    # ---- power cabinet ---------------------------------------------------------------------------
    px0, px1 = BACK_CABINET_X
    pz0, pz1 = BASE_H + 0.1, 5.25
    cab = box("BACK_POWER_CABINET", ((px0 + px1) / 2, by + 0.09, (pz0 + pz1) / 2), (px1 - px0, 0.18, pz1 - pz0),
              M["M_MetalDark"], exp)
    for x in (px0 + 1.1, px0 + 2.2):   # door seams
        boolean(cab, box("tmp_pcs", (x, by + 0.18, (pz0 + pz1) / 2), (0.03, 0.04, pz1 - pz0 - 0.2), M["M_MetalDark"], exp))
    vb = (px0 + FRAME_MAJOR, px0 + 2.2 - FRAME_MINOR)   # louvre bay across the two doors, at the top
    boolean(cab, box("tmp_pcv", ((vb[0] + vb[1]) / 2, by + 0.18, pz1 - 0.28), (vb[1] - vb[0], 0.08, 0.32),
                     M["M_MetalDark"], exp))
    bevel(cab, 0.04)
    louvre("BACK_POWER_CABINET_vent", "+y", (vb[0] + vb[1]) / 2, vb[1] - vb[0] - 0.06, pz1 - 0.43, pz1 - 0.13,
           by + 0.15, M, exp)
    ptz = 3.65                                                   # tier seam: the two doors become 2 x 2 (scale check)
    box("BACK_POWER_CABINET_tier_seam", (px0 + 1.12, by + 0.182, ptz), (2.14, 0.02, 0.03), M["M_Rubber"], exp)
    for k, x in enumerate((px0 + 0.95, px0 + 1.25)):
        for t, z in enumerate((2.85, 4.15)):
            box(f"BACK_POWER_CABINET_handle_{k}{t}", (x, by + 0.19, z), (0.05, 0.02, 0.3), M["M_MetalLight"], exp)
    box("BACK_POWER_CABINET_label", (px0 + 0.55, by + 0.182, 4.4), (0.5, 0.004, 0.34), M["M_Hazard"], exp)
    box("BACK_POWER_CABINET_plate", (px0 + 1.65, by + 0.182, 4.4), (0.6, 0.004, 0.2), M["M_MetalLight"], exp)
    bc = px0 + 2.75                    # breaker column: rows of status lights
    for r in range(4):
        z = 4.5 - r * 0.45
        box(f"BACK_POWER_CABINET_breaker_{r}", (bc, by + 0.1875, z), (0.75, 0.015, 0.26), M["M_MetalLight"], exp)
        box(f"BACK_POWER_CABINET_status_{r}", (bc + 0.25, by + 0.1975, z), (0.1, 0.004, 0.06),
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
    hdr = lbox("LEFT_HEADER", ty0, ty1, 4.5, 5.4, 0.195, M["M_PaintOrange"], 0.06)   # face 5 mm inside the edge
    boolean(hdr, box("tmp_hg", (wx - 0.2, yc, 4.95), (0.12, ty1 - ty0 - 0.3, 0.55), M["M_MetalDark"], exp))
    louvre("LEFT_HEADER", "-x", yc, ty1 - ty0 - 0.35, 4.68, 5.22, wx - 0.16, M, exp)
    box("LEFT_HEADER_label", (wx - 0.197, ty0 + 0.35, 5.3), (0.004, 0.4, 0.06), M["M_MetalLight"], exp)

    # three pipes of different gauge; centres keep the outer surface inside the footprint
    pipes = [  # name, y, r, segmentation style
        ("LEFT_PIPE_main", ty0 + 0.38, 0.22, "flanged"),
        ("LEFT_PIPE_valve", ty0 + 1.0, 0.15, "valve"),
        ("LEFT_PIPE_branch", ty1 - 0.25, 0.08, "insulated"),
    ]
    z0, z1 = 2.75, 4.5
    for name, y, r, style in pipes:
        x = edge + 0.01 + r + 0.05          # flanges are r + 0.05: keep the widest ring inside the footprint
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
    louvre("LEFT_TECHBLOCK_intake", "-x", vc, vy1 - vy0 - 0.36, 4.36, 5.08, face + 0.05, M, exp)
    bevel(box("LEFT_TECHBLOCK_gauges", (face - 0.01, vc, 3.8), (0.02, vy1 - vy0 - 0.3, 0.7), M["M_MetalLight"], exp), 0.01)
    for k, y in enumerate((vc - 0.33, vc + 0.33)):
        box(f"LEFT_TECHBLOCK_screen_{k}", (face - 0.022, y, 3.9), (0.004, 0.5, 0.5 * 9 / 16), M["M_ScreenStatic"], exp)
    cylinder("LEFT_TECHBLOCK_dial", (face - 0.025, vc, 3.58), 0.1, 0.01, M["M_LightWarm"], exp, 16, axis="X")
    bevel(box("LEFT_TECHBLOCK_hatch", (face - 0.01, vc - 0.15, 2.75), (0.02, 0.95, 0.85), M["M_MetalLight"], exp), 0.01)
    for k, dz in enumerate((0.25, -0.25)):
        box(f"LEFT_TECHBLOCK_latch_{k}", (face - 0.014, vc + 0.38, 2.75 + dz), (0.028, 0.1, 0.14), M["M_MetalDark"], exp)
    box("LEFT_TECHBLOCK_label", (face - 0.003, vc + 0.55, 3.3), (0.004, 0.36, 0.12), M["M_Hazard"], exp)
    box("LEFT_TECHBLOCK_led", (face - 0.003, vc + 0.55, 3.1), (0.004, 0.12, 0.05), M["M_Beacon"], exp)
    cylinder("LEFT_TECHBLOCK_inlet", (edge + 0.01 + 0.08 + 0.05, vy0 - 0.02, 3.9), 0.12, 0.06, M["M_MetalDark"], exp, 12,
             axis="Y")
    for k, (z0_, z1_) in enumerate(((2.0, 2.12), (5.22, 5.36))):   # orange caps top / bottom
        lbox(f"LEFT_TECHBLOCK_cap_{k}", vy0 - 0.03, vy1 + 0.03, z0_, z1_, 0.19, M["M_PaintOrange"], 0.02)


def build_right_service(M, exp, sx_out):
    """Right side = electrical / comms side (no pipes): grey double-door cabinet with round exhaust vents,
    a cable riser niche feeding the roof comms node, an interface block with a cable entry below."""
    wx = sx_out
    k = math.sqrt(0.5)

    def rbox(name, y0, y1, z0, z1, depth, mat, bev_w=0.03):
        return bevel(box(name, (wx + depth / 2 - 0.01, (y0 + y1) / 2, (z0 + z1) / 2), (depth + 0.02, y1 - y0, z1 - z0),
                         mat, exp), bev_w)

    # ---- electrical cabinet (light grey to set it apart from the dark left side) --------------
    cy0, cy1 = RIGHT_CABINET_Y
    cz0, cz1 = BASE_H + 0.1, 4.85
    face = wx + 0.16
    cab = box("RIGHT_CABINET", (wx + 0.075, (cy0 + cy1) / 2, (cz0 + cz1) / 2), (0.17, cy1 - cy0, cz1 - cz0),
              M["M_MetalLight"], exp)
    seam = (cy0 + cy1) / 2
    boolean(cab, box("tmp_rcs", (face, seam, (cz0 + cz1) / 2), (0.04, 0.03, cz1 - cz0 - 0.15), M["M_MetalDark"], exp))
    tz = 3.47                                                    # tier seam: 2 x 2 doors of ~1.2 m (scale check)
    for j, (a, b) in enumerate(((cy0 + 0.12, seam - 0.1), (seam + 0.1, cy1 - 0.12))):   # recessed door fields
        for z0_, z1_ in ((cz0 + 0.2, tz - 0.08), (tz + 0.08, cz1 - 0.2)):
            boolean(cab, box("tmp_rcf", (face, (a + b) / 2, (z0_ + z1_) / 2), (0.03, b - a, z1_ - z0_), M["M_MetalLight"], exp))
    bevel(cab, 0.03)
    box("RIGHT_CABINET_tier_seam", (face - 0.005, (cy0 + cy1) / 2, tz), (0.02, cy1 - cy0 - 0.1, 0.03), M["M_Rubber"], exp)
    for j, y in enumerate((cy0 + 0.04, cy1 - 0.04)):                                 # hinges: two per door
        for h, z in enumerate((2.55, 3.15, 3.8, 4.45)):
            cylinder(f"RIGHT_CABINET_hinge_{j}_{h}", (face + 0.0, y, z), 0.035, 0.16, M["M_MetalDark"], exp, 8)
    for j, y in enumerate((seam - 0.12, seam + 0.12)):                               # handles: one per door
        for t, z in enumerate((2.85, 4.1)):
            box(f"RIGHT_CABINET_handle_{j}{t}", (face + 0.02, y, z), (0.03, 0.05, 0.26), M["M_MetalDark"], exp)
    box("RIGHT_CABINET_window", (face + 0.004, (cy0 + seam) / 2, 4.3), (0.006, 0.45, 0.45 * 9 / 16), M["M_ScreenStatic"], exp)
    box("RIGHT_CABINET_window_frame", (face + 0.002, (cy0 + seam) / 2, 4.3), (0.004, 0.55, 0.35), M["M_MetalDark"], exp)
    box("RIGHT_CABINET_hazard", (face + 0.004, (seam + cy1) / 2, 4.3), (0.006, 0.4, 0.4), M["M_Hazard"], exp)
    box("RIGHT_CABINET_plate", (face + 0.004, (seam + cy1) / 2, 2.6), (0.006, 0.5, 0.14), M["M_MetalDark"], exp)
    # ---- round exhaust vents above the cabinet (different shape from the left louvres) --------
    rbox("RIGHT_VENT_band", cy0, cy1, cz1 + 0.08, 5.35, 0.09, M["M_MetalDark"], 0.02)
    for j in range(4):
        y = cy0 + 0.3 + j * (cy1 - cy0 - 0.6) / 3
        zc = (cz1 + 0.08 + 5.35) / 2
        ring = cylinder(f"RIGHT_VENT_ring_{j}", (wx + 0.1, y, zc), 0.16, 0.04, M["M_MetalLight"], exp, 16, axis="X")
        boolean(ring, cylinder("tmp_vr", (wx + 0.1, y, zc), 0.12, 0.2, None, exp, 16, axis="X"))
        cylinder(f"RIGHT_VENT_well_{j}", (wx + 0.085, y, zc), 0.125, 0.01, M["M_Rubber"], exp, 16, axis="X")
        box(f"RIGHT_VENT_bar_{j}", (wx + 0.11, y, zc), (0.01, 0.24, 0.025), M["M_MetalLight"], exp)
    # ---- cable riser niche: tray, three cables, clamps, entry box, cover over the wall top -------
    ny0, ny1 = RIGHT_NICHE_Y
    nyc = (ny0 + ny1) / 2
    back = wx - 0.2
    box("RIGHT_RISER_tray", (back + 0.015, nyc, 3.75), (0.03, ny1 - ny0 - 0.1, 3.05), M["M_MetalLight"], exp)
    for j, dy in enumerate((-0.15, 0.0, 0.15)):
        cylinder(f"RIGHT_RISER_cable_{j}", (back + 0.09, nyc + dy, 3.8), 0.045, 3.1, M["M_Rubber"], exp, 8)
    for j, z in enumerate((2.7, 3.4, 4.1, 4.8)):
        box(f"RIGHT_RISER_clamp_{j}", (back + 0.1, nyc, z), (0.1, ny1 - ny0 - 0.08, 0.05), M["M_MetalDark"], exp)
    rbox("RIGHT_RISER_entry", ny0 - 0.02, ny1 + 0.02, BASE_H + 0.05, BASE_H + 0.45, 0.18, M["M_MetalDark"], 0.02)
    bevel(box("RIGHT_RISER_cap", (wx - 0.02, nyc, 5.38), (0.26, ny1 - ny0 + 0.06, 0.18), M["M_MetalDark"], exp), 0.02)
    mid = (wx - SIDE_CH / 2, nyc, ROOF - SIDE_CH / 2)
    bevel(on_chamfer("RIGHT_RISER_chamfer_cover", mid, "x", 1, (ny1 - ny0 + 0.06, 0.1, SIDE_CH * math.sqrt(2) + 0.05),
                     0.05, M["M_MetalDark"], exp), 0.015)
    on_chamfer("RIGHT_RISER_chamfer_strip", mid, "x", 1, (0.3, 0.01, SIDE_CH * math.sqrt(2) - 0.1), 0.105,
               M["M_MetalLight"], exp)
    # ---- interface block + cable entry -----------------------------------------------------------
    iy0, iy1 = RIGHT_IFACE_Y
    iyc = (iy0 + iy1) / 2
    rbox("RIGHT_IFACE", iy0, iy1, 3.05, 3.95, 0.14, M["M_MetalDark"], 0.03)
    box("RIGHT_IFACE_screen", (wx + 0.133, iyc, 3.68), (0.006, 0.45, 0.45 * 9 / 16), M["M_ScreenStatic"], exp)
    box("RIGHT_IFACE_keypad", (wx + 0.135, iyc, 3.3), (0.01, 0.3, 0.18), M["M_MetalLight"], exp)
    box("RIGHT_IFACE_led", (wx + 0.133, iy1 - 0.08, 3.3), (0.006, 0.05, 0.05), M["M_Beacon"], exp)
    rbox("RIGHT_IFACE_hood", iy0 - 0.03, iy1 + 0.03, 3.97, 4.03, 0.19, M["M_PaintOrange"], 0.01)
    rbox("RIGHT_IFACE_entry", iy0 + 0.08, iy1 - 0.08, 2.2, 2.6, 0.12, M["M_MetalLight"], 0.015)
    for j, dy in enumerate((-0.15, 0.0, 0.15)):
        cylinder(f"RIGHT_IFACE_gland_{j}", (wx + 0.07, iyc + dy, 2.16), 0.04, 0.08, M["M_MetalDark"], exp, 8)
        cylinder(f"RIGHT_IFACE_cable_{j}", (wx + 0.07, iyc + dy, 2.06), 0.03, 0.14, M["M_Rubber"], exp, 8)


def build_final_details(M, exp, sx_out, fy, by):
    """Last exterior pass (review table): small fixings and markings on the front, cable links on the right,
    panel joints at the back, pipe supports on the left, service points on the roof."""
    k = math.sqrt(0.5)
    # ---- front: bolts on the orange band sections + markings -------------------------------------
    mid_y, mid_z = fy + FRONT_CH / 2, ROOF - FRONT_CH / 2
    # a band plate of thickness t sits 3t/sqrt(2) off the 45° chamfer (both the face and the top grow by t)
    on_plate = 3 * FRONT_PLATE_T / math.sqrt(2)
    for i, (x0, x1) in enumerate(FRONT_SECTIONS):
        for j, (bx_, o) in enumerate(((x0 + 0.16, -0.62), (x1 - 0.16, -0.62), (x0 + 0.16, 0.62), (x1 - 0.16, 0.62))):
            on_chamfer(f"FRONT_BAND_{i}_bolt_{j}", (bx_, mid_y + k * o, mid_z + k * o), "y", -1, (0.06, 0.025, 0.06),
                       on_plate + 0.008, M["M_MetalBare"], exp)
    on_chamfer("FRONT_BAND_unit_id_label", (-4.7, mid_y - k * 0.3, mid_z - k * 0.3), "y", -1, (0.9, 0.006, 0.22),
               on_plate + 0.003, M["M_Decal"], exp)
    pf = -D / 2 + PLINTH_SETBACK + 0.05 - 0.002           # plinth bay panel face (front)
    box("VENTS_plinth_intake_label", (-3.5, pf, 1.12), (0.7, 0.004, 0.08), M["M_Decal"], exp)
    box("POWER_bay_label", (3.4, pf, 1.12), (0.7, 0.004, 0.08), M["M_Decal"], exp)
    box("POWER_bay_warning_sign", (4.05, pf, 1.12), (0.1, 0.004, 0.1), M["M_Hazard"], exp, rot=(0, math.radians(45), 0))
    # ---- right: every cable visibly ends in the riser -------------------------------------------
    wx = sx_out
    ny0, ny1 = RIGHT_NICHE_Y
    for name, y0, y1, z in (("cabinet", RIGHT_CABINET_Y[1], ny0 + 0.05, 2.3), ("iface", ny1 - 0.05, RIGHT_IFACE_Y[0], 3.5)):
        cylinder(f"RIGHT_LINK_{name}_conduit", (wx + 0.09, (y0 + y1) / 2, z), 0.05, y1 - y0 + 0.04, M["M_MetalBare"], exp,
                 10, axis="Y")
        for e_ in (y0, y1):
            cylinder(f"RIGHT_LINK_{name}_gland_{e_:+.2f}", (wx + 0.09, e_, z), 0.075, 0.05, M["M_MetalDark"], exp, 10,
                     axis="Y")
    # ---- back: rubber joint strips between the modules -----------------------------------------
    for x, z0, z1 in ((BACK_COOLING_X[1] + 0.05, BASE_H + 0.1, 5.5), (BACK_MODULE_X[1] + 0.05, BASE_H + 0.1, 5.5),
                      (BACK_CABINET_X[0] - 0.05, BASE_H + 0.1, 5.3)):
        box(f"BACK_JOINT_v_{x:+.2f}", (x, by + 0.05, (z0 + z1) / 2), (0.05, 0.06, z1 - z0), M["M_Rubber"], exp)
    box("BACK_JOINT_h_band", ((BACK_MODULE_X[0] + BACK_MODULE_X[1]) / 2, by + 0.05, BACK_BAND_Z[0] - 0.05),
        (BACK_MODULE_X[1] - BACK_MODULE_X[0], 0.06, 0.05), M["M_Rubber"], exp)
    # ---- left: two support rails across the pipe trench with U-bolts and wall plates ----------------
    ty0, ty1 = LEFT_TRENCH_Y
    gauge = ((ty0 + 0.38, 0.22), (ty0 + 1.0, 0.15), (ty1 - 0.25, 0.08))
    for r_i, z in enumerate((3.0, 4.25)):
        bevel(box(f"LEFT_PIPE_support_rail_{r_i}", (-W / 2 + 0.4, (ty0 + ty1) / 2, z), (0.08, ty1 - ty0, 0.1),
                  M["M_MetalLight"], exp), 0.012)   # painted grey so it reads against the dark trench
        for e_, sgn in ((ty0, 1), (ty1, -1)):
            box(f"LEFT_PIPE_support_plate_{r_i}_{sgn:+d}", (-W / 2 + 0.36, e_ + sgn * 0.015, z), (0.22, 0.03, 0.24),
                M["M_MetalLight"], exp)
            cylinder(f"LEFT_PIPE_support_bolt_{r_i}_{sgn:+d}", (-W / 2 + 0.3, e_ + sgn * 0.035, z), 0.025, 0.02,
                     M["M_MetalBare"], exp, 8, axis="Y")
        for p_i, (y, r) in enumerate(gauge):
            if p_i == 2 and z > 3.9:      # the branch already turned into the tech block
                continue
            x = -W / 2 + 0.01 + r + 0.05     # same centre line as the pipes
            cylinder(f"LEFT_PIPE_ubolt_{r_i}_{p_i}", (x, y, z), r + 0.025, 0.05, M["M_MetalBare"], exp, 16)
            for sgn in (-1, 1):
                box(f"LEFT_PIPE_ubolt_{r_i}_{p_i}_nut_{sgn:+d}", (-W / 2 + 0.36, y + sgn * (r + 0.03), z),
                    (0.05, 0.05, 0.05), M["M_MetalBare"], exp)
    # ---- roof: lifting lugs on the module corners + access plates on the fan housings ---------------
    ry = 0.15
    for i, (sx_, sy_) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
        lug = box(f"ROOF_lifting_lug_{i}", (sx_ * 3.7, ry + sy_ * 1.2, ROOF + 0.43), (0.2, 0.05, 0.16), M["M_MetalBare"],
                  exp, rot_z=math.radians(45 * sx_ * sy_))
        boolean(lug, cylinder("tmp_lh", (sx_ * 3.7, ry + sy_ * 1.2, ROOF + 0.45), 0.045, 0.3, None, exp, 10, axis="Y"))
        box(f"ROOF_lifting_lug_{i}_base", (sx_ * 3.7, ry + sy_ * 1.2, ROOF + 0.36), (0.26, 0.14, 0.02), M["M_MetalDark"],
            exp, rot_z=math.radians(45 * sx_ * sy_))
    for f, x in enumerate((-1.3, 1.3)):
        zt = ROOF + 0.75
        box(f"ROOF_fan_{f}_access_plate", (x, ry + 0.05 - 0.505, zt + 0.11), (0.32, 0.02, 0.13), M["M_MetalLight"], exp)
        for dx in (-0.12, 0.12):
            cylinder(f"ROOF_fan_{f}_access_bolt_{dx:+.2f}", (x + dx, ry + 0.05 - 0.517, zt + 0.11), 0.015, 0.01,
                     M["M_MetalBare"], exp, 6, axis="Y")


def build_exterior_panel_life(M, exp, sx_out, by):
    """Constructive life for the large orange pylon faces, DOSED like inside (1-2 elements per face, some faces stay
    plain): back faces of the rear pylons, the 45-degree corner faces of the rear pylons and of the front-left pylon.
    Kinds: recessed frame (rubber groove), inspection cover, service hatch, warning marking."""
    ax, ay = sx_out + ARMOR_T, D / 2 - SHELL_INSET + ARMOR_T     # outer pylon surface
    ac = CORNER + ARMOR_T * 0.4

    def put(name, base, n, t_off, z, d, size, mat):
        t = (-n[1], n[0])
        loc = (base[0] + t[0] * t_off + n[0] * d, base[1] + t[1] * t_off + n[1] * d, z)
        return box(name, loc, size, mat, exp, rot_z=math.atan2(t[1], t[0]))

    def groove(name, base, n, w, z0, z1):
        for k, (to, z, sz) in enumerate(((0.0, z0, (w, 0.006, 0.025)), (0.0, z1, (w, 0.006, 0.025)),
                                         (-w / 2, (z0 + z1) / 2, (0.025, 0.006, z1 - z0)),
                                         (w / 2, (z0 + z1) / 2, (0.025, 0.006, z1 - z0)))):
            put(f"{name}_{k}", base, n, to, z, 0.003, sz, M["M_Rubber"])

    def inspect(name, base, n, t_off, z):
        # thin on purpose: the rear pylon face is only 2 cm inside the footprint edge
        put(f"{name}_seal", base, n, t_off, z, 0.002, (0.36, 0.004, 0.36), M["M_Rubber"])
        bevel(put(name, base, n, t_off, z, 0.008, (0.32, 0.012, 0.32), M["M_MetalLight"]), 0.004)
        put(f"{name}_tab", base, n, t_off, z - 0.1, 0.0135, (0.1, 0.008, 0.03), M["M_MetalDark"])

    def hatch(name, base, n, z, w, h):
        put(f"{name}_seal", base, n, 0.0, z, 0.003, (w + 0.05, 0.006, h + 0.05), M["M_Rubber"])
        bevel(put(name, base, n, 0.0, z, 0.014, (w, 0.025, h), M["M_MetalLight"]), 0.012)
        for k in (-1, 1):
            put(f"{name}_hinge_{k:+d}", base, n, -w / 2 + 0.02, z + k * h * 0.3, 0.03, (0.05, 0.02, 0.14), M["M_MetalBare"])
        put(f"{name}_latch", base, n, w / 2 - 0.08, z, 0.03, (0.05, 0.02, 0.12), M["M_MetalDark"])
        put(f"{name}_label", base, n, 0.0, z + h / 2 - 0.1, 0.028, (0.3, 0.004, 0.07), M["M_Hazard"])

    def warning(name, base, n, t_off, z, w=0.42):
        put(name, base, n, t_off, z, 0.004, (w, 0.006, 0.1), M["M_Hazard"])
        put(f"{name}_text", base, n, t_off, z - 0.13, 0.004, (w * 0.85, 0.006, 0.07), M["M_Decal"])

    k = math.sqrt(0.5)
    # rear pylons, back faces (normal +y): inspection cover by the cooling side, warning by the power side
    inspect("PYLON_back_L_inspect", (-6.4, ay), (0.0, 1.0), 0.0, 3.1)
    warning("PYLON_back_R_warning", (6.4, ay), (0.0, 1.0), 0.0, 3.35)
    # rear pylons, 45-degree faces: recessed frame on both (rhythm), lower field under the 4.35 seam
    for sx_ in (-1, 1):
        mid = (sx_ * (ax - ac / 2), ay - ac / 2)
        groove(f"PYLON_corner_{sx_:+d}+1_frame", mid, (sx_ * k, k), 0.9, 2.35, 4.1)
    # front-left pylon, 45-degree face: one service hatch
    hatch("PYLON_corner_-1-1_hatch", (-(ax - ac / 2), -(ay - ac / 2)), (-k, -k), 3.15, 0.7, 0.9)


def build(mats, exp, ref):
    M = mats
    fy = -(D / 2 - SHELL_INSET)          # outer front face of the shell
    by = D / 2 - SHELL_INSET
    sx_out = W / 2 - SHELL_INSET          # outer side face of the shell
    win = window_outline()
    yb = fy + 0.15                        # glass foot line (recessed into the wall)
    win_depth = (fy - 0.5, fy + 1.7)      # window cutter: through the wall and under the chamfer

    # ===================================================================== PLINTH
    base = prism("BASE", chamfer_rect(W / 2 - CORE - PLINTH_SETBACK, D / 2 - CORE - PLINTH_SETBACK, 1.0), "z", 0.0,
                 BASE_H, M["M_MetalDark"], exp)
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
    # bolted mounting plate: the only part that reaches the 16 x 8 edge, so the plinth reads as set on a platform
    # dark so it separates from the grey foundation; the bevel catches a light edge
    plate = prism("BASE_platform", chamfer_rect(W / 2, D / 2, 1.05), "z", 0.0, PLATFORM_H, M["M_MetalDark"], exp)
    boolean(plate, box("tmp_sd", (DOOR_X, D / 2, 0.1), (DOOR_W, 1.0, 0.4), M["M_MetalLight"], exp))
    for x in (-W / 4, W / 4):              # joints between the plate segments, one per foundation half
        boolean(plate, box("tmp_pj", (x, 0, PLATFORM_H), (0.03, D + 1, 0.04), M["M_MetalDark"], exp))
    boolean(plate, box("tmp_pj", (0, 0, PLATFORM_H), (0.03, D + 1, 0.04), M["M_MetalDark"], exp))
    bevel(plate, 0.04)

    # plinth: one structural rhythm on every face — corner | intermediate | central | intermediate | corner
    cfx, cfy = W / 2 - CORNER_WRAP, D / 2 - CORNER_WRAP      # where the corner supports start
    mx0, mx1 = BACK_MODULE_X
    layout = {
        "-y": ([(-cfx, -1.7, "vent"), (-1.7, 1.7, "service"), (1.7, cfx, "power")], (-1.7, 1.7)),
        # back: the rear service module around the door is the central element
        "+y": ([(-cfx, mx0 - 0.4, "vent"), (mx1 + 0.4, cfx, "power_socket")], (mx0 - 0.2, mx1 + 0.2)),
        "-x": ([(-cfy, -1.2, "vent"), (-1.2, 1.2, "plain"), (1.2, cfy, "vent")], (-1.2, 1.2)),      # technical side
        "+x": ([(-cfy, -1.2, "plain"), (-1.2, 1.2, "plain"), (1.2, cfy, "plain")], (-1.2, 1.2)),    # cleaner side
    }
    for side, (mods, pilasters) in layout.items():
        plinth_face(side, mods, pilasters, M, exp, ref)
    # corner supports: heavy L-blocks wrapping the 45° corners, with a light niche, a seam and anchor bolts
    ox, oy = W / 2 - PLINTH_SETBACK, D / 2 - PLINTH_SETBACK
    for s_x in (-1, 1):
        for s_y in (-1, 1):
            cb = prism(f"BASE_CORNER_{s_x:+d}{s_y:+d}", chamfer_rect(ox, oy, 1.0), "z", PLATFORM_H, 2.05,
                       M["M_MetalDark"], exp)
            boolean(cb, box("tmp_cq", (s_x * (W / 2 - CORNER_WRAP / 2), s_y * (D / 2 - CORNER_WRAP / 2), 1.0),
                            (CORNER_WRAP, CORNER_WRAP, 3.0), None, exp), "INTERSECT")
            boolean(cb, prism("tmp_cc", chamfer_rect(ox - 0.3, oy - 0.3, 0.88), "z", -1, 3, None, exp))
            seam = prism("tmp_cs", chamfer_rect(W / 2 + 0.5, D / 2 + 0.5, 1.0), "z", 1.48, 1.52, M["M_Rubber"], exp)
            boolean(seam, prism("tmp_csi", chamfer_rect(ox - 0.04, oy - 0.04, 1.0), "z", 0, 3, None, exp))
            boolean(cb, seam)
            lx = s_x * (W / 2 - CORNER_WRAP + (CORNER_WRAP - 1.0) / 2 + 0.05)   # middle of the flat front/back part
            boolean(cb, box("tmp_cn", (lx, s_y * oy, 0.9), (0.5, 0.16, 0.32), M["M_MetalLight"], exp))
            bevel(cb, 0.07)
            box(f"LIGHTS_base_corner_{s_x:+d}{s_y:+d}", (lx, s_y * (oy - 0.065), 0.9), (0.42, 0.03, 0.24),
                M["M_LightWarm"], exp)
            for b, (bx_, by_) in enumerate(((lx - 0.25, s_y * (oy + 0.06)), (lx + 0.25, s_y * (oy + 0.06)),
                                           (s_x * (ox + 0.06), s_y * (D / 2 - 1.3)), (s_x * (ox + 0.06), s_y * (D / 2 - 0.85)))):
                cylinder(f"BASE_bolt_corner_{s_x:+d}{s_y:+d}_{b}", (bx_, by_, PLATFORM_H + 0.015), 0.03, 0.03,
                         M["M_MetalLight"], exp, 8)
    # light-metal cap ledge on top of the plinth, open at the door
    cap = prism("BASE_cap", chamfer_rect(W / 2, D / 2, 1.0), "z", 1.86, 1.98, M["M_MetalLight"], exp)
    boolean(cap, prism("tmp_capi", chamfer_rect(W / 2 - 0.4, D / 2 - 0.4, 0.85), "z", 1.0, 3.0, None, exp))
    boolean(cap, box("tmp_capd", (DOOR_X, D / 2, 1.9), (BACK_MODULE_X[1] - BACK_MODULE_X[0], 1.2, 0.5), None, exp))
    joints = {"-y": (cfx, -cfx), "+y": (cfx, -cfx), "-x": (cfy, -cfy), "+x": (cfy, -cfy)}
    for side, (_, pilasters) in layout.items():   # segment joints above every pilaster and corner support
        for a_ in tuple(pilasters) + joints[side]:
            c_ = face_pt(side, a_, 0.0, 1.98)
            boolean(cap, box("tmp_capj", c_, face_size(side, 0.04, 0.9, 0.05), M["M_MetalDark"], exp))
    bevel(cap, 0.02)
    # amber markers on the 45° faces of the plinth corner blocks
    for s_x in (-1, 1):
        for s_y in (-1, 1):
            k = math.sqrt(0.5)
            box(f"LIGHTS_indicator_corner_{s_x:+d}{s_y:+d}", (s_x * (ox - 0.5) + s_x * k * 0.004,
                s_y * (oy - 0.5) + s_y * k * 0.004, 1.75), (0.3, 0.015, 0.07), M["M_Beacon"], exp,
                rot_z=math.atan2(s_x, -s_y))

    # ===================================================================== FLOOR
    hx, hy = W / 2 - SHELL_INSET - WALL, D / 2 - SHELL_INSET - WALL
    floor = prism("FLOOR", chamfer_rect(hx, hy, CORNER - WALL * 0.4), "z", FLOOR_Z, FLOOR_Z + 0.02,
                  M["M_MetalDark"], exp)
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
                 -0.1, ROOF + 0.1, 0.035, ROOF - 0.035, M["M_Rubber"], exp)
        boolean(shell, g)
    # same family on the back chamfer: seams under the gaps of the back band sections
    gaps = sorted({x for sec in BACK_SECTIONS for x in sec} | set(BACK_SEAT))
    gaps = [(a + b) / 2 for a, b in zip(gaps[:-1], gaps[1:]) if 0.02 < b - a < 0.2]
    for x in gaps:
        g = skin("tmp_bs", box("tmp_bsr", (x, 3.3, 6.4), (0.06, 1.6, 2.0), None, exp),
                 -0.1, ROOF + 0.1, 0.035, ROOF - 0.035, M["M_Rubber"], exp)
        boolean(shell, g)
    # panel seams running over front chamfer, roof and back chamfer
    for x in (-3.4, 3.4):
        g = skin("tmp_seam", box("tmp_sr", (x, 0, 6.5), (0.05, D + 2, 1.7), None, exp),
                 -0.1, ROOF + 0.1, 0.035, ROOF - 0.035, M["M_Rubber"], exp)
        boolean(shell, g)
    # recessed dark louvre bays on both side chamfers (concept: dark vents along the top edges)
    # left = the technical side (big bay, more slats, hood), right = secondary and cleaner
    k = math.sqrt(0.5)
    for s, length, slope, n, yc in ((-1, 3.3, 1.15, 7, 0.0), (1, 1.4, 0.8, 4, -0.95)):
        mid = (s * (sx_out - SIDE_CH / 2), yc, ROOF - SIDE_CH / 2)
        reg = on_chamfer("tmp_cr", mid, "x", s, (length, 0.5, slope), 0.0, None, exp)
        boolean(shell, skin("tmp_bay", reg, -0.1, ROOF + 0.1, 0.07, ROOF - 0.07, M["M_MetalDark"], exp))
        n = max(3, int(round((slope - 0.15) / LOUVRE_PITCH)) + 1)      # same slat series as every other intake
        for i in range(n):
            o = (i - (n - 1) / 2) * (slope - 0.15) / (n - 1)
            on_chamfer(f"VENTS_chamfer_{'L' if s < 0 else 'R'}_slat_{i}", (mid[0] - s * k * o, yc, mid[2] + k * o),
                       "x", s, (length - 0.1, LOUVRE_SLAT_T, LOUVRE_SLAT_H), -0.04, M["M_MetalBare"], exp)
        hood_mid = (mid[0] - s * k * (slope / 2 + 0.08), yc, mid[2] + k * (slope / 2 + 0.08))
        bevel(on_chamfer(f"VENTS_chamfer_{'L' if s < 0 else 'R'}_hood", hood_mid, "x", s, (length + 0.2, 0.14, 0.16),
                         0.03, M["M_PaintOrange"], exp), 0.02)
    # utility trench on the left wall for the pipe run (0.26 deep, wall stays 0.09 thick)
    boolean(shell, box("tmp_trench", (-sx_out, (LEFT_TRENCH_Y[0] + LEFT_TRENCH_Y[1]) / 2, (2.75 + 4.5) / 2),
                       (0.52, LEFT_TRENCH_Y[1] - LEFT_TRENCH_Y[0], 1.75), M["M_MetalDark"], exp))
    # vertical cable niche on the right wall (riser to the comms node on the roof)
    ny0, ny1 = RIGHT_NICHE_Y
    boolean(shell, box("tmp_niche_r", (sx_out, (ny0 + ny1) / 2, 3.75), (0.4, ny1 - ny0, 3.1), M["M_MetalDark"], exp))
    bevel(shell, 0.05)

    # ===================================================================== WINDOW (tilted 15°)
    # heavy stepped frame: deep reveal (0.17) + a protruding dark bezel ring standing in it
    bez = prism("WINDOW_BEZEL", inset_poly(win, -FRAME_MINOR), "y", fy + 0.0, fy + 0.17, M["M_MetalDark"], exp)
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
    gasket = prism("WINDOW_GASKET_seal", inset_poly(win, t - 0.03), "y", yb - 0.03, yb + 0.03, M["M_Rubber"], exp)
    boolean(gasket, prism("tmp_gs", inset_poly(win, t + 0.03), "y", yb - 1, yb + 1, None, exp))
    parts.append(gasket)
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
                            M["M_Rubber"], exp))
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
        louvre(f"VENTS_pylon_{s_x:+d}{s_y:+d}", "-x" if s_x < 0 else "+x", s_y * 2.85, 0.82, 2.45, 5.15, lx, M, exp)
    # FICSIT logo placeholder inside the dark panel (texture/decal later)
    box("DECALS_logo", (logo_at[0], logo_at[1], 3.85), (0.95, 0.01, 0.26), M["M_MetalLight"], exp,
        rot_z=math.radians(45))

    # ===================================================================== FRONT VISOR LIGHT (on the 45° chamfer)
    # thin axis must follow the chamfer normal (0, -1, 1)/sqrt(2) -> rotate -45° about X
    # separate orange sections over the front chamfer and roof edge + dark recessed seat for the visor
    def band_plate(name, x0, x1, thick, mat, back=False):
        if back:   # back chamfer only (the rear roof zone stays free for the hatch and the cooler)
            reg = box("tmp_bpr", ((x0 + x1) / 2, 3.79, 6.6), (x1 - x0, 2.4, 2.1), None, exp)
        else:      # front chamfer + roof edge, cut around the window
            reg = box("tmp_bpr", ((x0 + x1) / 2, -3.3, 6.75), (x1 - x0, 3.4, 2.3), None, exp)
        p = skin(name, reg, -thick, ROOF + thick, 0.0, ROOF, mat, exp)
        if not back:
            boolean(p, prism("tmp_bpw", inset_poly(win, -FRAME_MAJOR), "y", fy - 1.0, fy + 1.7, None, exp))
        return bevel(p, 0.025)
    for i, (x0, x1) in enumerate(FRONT_SECTIONS):
        band_plate(f"FRONT_BAND_{i}", x0, x1, FRONT_PLATE_T, M["M_PaintOrange"])
    band_plate("FRONT_BAND_visor_seat", *VISOR_SEAT, 0.045, M["M_MetalDark"])
    for i, (x0, x1) in enumerate(BACK_SECTIONS):       # 7.1: related (not identical) panels at the back
        band_plate(f"BACK_BAND_section_{i}", x0, x1, FRONT_PLATE_T, M["M_PaintOrange"], back=True)
    band_plate("BACK_BAND_light_seat", *BACK_SEAT, 0.045, M["M_MetalDark"], back=True)
    for i, x in enumerate((-2.15, 2.15)):   # light-metal clamps holding the visor housing
        on_chamfer(f"LIGHTS_visor_clamp_{i}", (x, fy + FRONT_CH / 2, ROOF - FRONT_CH / 2), "y", -1,
                   (0.12, 0.16, 0.8), 0.1, M["M_MetalLight"], exp)
    # raised orange housing with a dark bezel, as on the concept
    c = (0.0, fy + FRONT_CH / 2, ROOF - FRONT_CH / 2)
    bevel(on_chamfer("LIGHTS_visor_housing", c, "y", -1, (3.9, 0.4, 1.15), 0.08, M["M_PaintOrange"], exp), 0.06)
    bevel(on_chamfer("LIGHTS_visor_bezel", c, "y", -1, (3.3, 0.08, 0.7), 0.26, M["M_MetalDark"], exp), 0.02)
    # the bezel holds a SIGN (decal slot) instead of a flat white plate; light = a strip along the lower bezel edge
    k45 = math.sqrt(0.5)
    on_chamfer("DECALS_sign_front", (c[0], c[1] + 0.03 * k45, c[2] + 0.03 * k45), "y", -1, (3.0, 0.02, 0.42), 0.29,
               M["M_Decal"], exp)
    on_chamfer("LIGHTS_visor", (c[0], c[1] - 0.3 * k45, c[2] - 0.3 * k45), "y", -1, (3.0, 0.04, 0.05), 0.3,
               M["M_LightWarm"], exp)
    # rear light bar on the back chamfer
    cb = (DOOR_X, by - BACK_CH / 2, ROOF - BACK_CH / 2)
    bevel(on_chamfer("LIGHTS_back_housing", cb, "y", 1, (2.6, 0.14, 0.62), 0.04, M["M_MetalDark"], exp), 0.02)
    # flood light for the entry: a strip along the lower housing edge (was a flat white plate)
    on_chamfer("LIGHTS_back", (cb[0], cb[1] + 0.24 * math.sqrt(0.5), cb[2] - 0.24 * math.sqrt(0.5)), "y", 1,
               (2.2, 0.04, 0.06), 0.12, M["M_LightWarm"], exp)

    build_back(M, exp, by)

    build_left_utility(M, exp, sx_out)

    build_right_service(M, exp, sx_out)

    build_exterior_panel_life(M, exp, sx_out, by)

    # ===================================================================== ROOF: four zones, five elements
    # front zone (over the glass) stays clean: orange band sections + visor only.
    # 1) central tech module: low plinth -> middle tier -> two round fan modules (highest point)
    ry = 0.15
    r0 = prism("ROOF", [(x, y + ry) for x, y in chamfer_rect(4.0, 1.5, 0.5)], "z", ROOF - 0.05, ROOF + 0.35,
               M["M_MetalDark"], exp)
    r1 = prism("ROOF_top", [(x, y + ry + 0.05) for x, y in chamfer_rect(2.6, 1.15, 0.6)], "z", ROOF + 0.35,
               ROOF + 0.75, M["M_MetalLight"], exp)
    # recessed seat for the service hatch on the left shoulder (cut before the bevel)
    sh = (-3.3, ry, 0.9, 1.3)                       # x, y, width, length of the hatch lid
    boolean(r0, box("tmp_shr", (sh[0], sh[1], ROOF + 0.35), (sh[2] + 2 * FRAME_MINOR, sh[3] + 2 * FRAME_MINOR, 0.08),
                    M["M_MetalDark"], exp))
    bevel(r0, 0.06)
    bevel(r1, 0.06)
    # low rim around the fan tier (structural edge; keeps the roof silhouette)
    rim = prism("ROOF_top_rim", [(x, y + ry + 0.05) for x, y in chamfer_rect(2.6, 1.15, 0.6)], "z", ROOF + 0.75,
                ROOF + 0.85, M["M_MetalDark"], exp)
    boolean(rim, prism("tmp_rimi", [(x, y + ry + 0.05) for x, y in chamfer_rect(2.5, 1.05, 0.55)], "z", ROOF, ROOF + 2,
                       None, exp))
    bevel(rim, 0.012)
    for k, x in enumerate((-1.6, 1.6)):     # intake grilles on the front face of the plinth
        bevel(box(f"ROOF_grille_{k}", (x, ry - 1.5 - 0.01, ROOF + 0.15), (1.5, 0.03, 0.26), M["M_MetalDark"], exp), 0.0)
        louvre(f"ROOF_grille_{k}", "-y", x, 1.4, ROOF + 0.04, ROOF + 0.28, ry - 1.53, M, exp)
    # service hatch in the recessed seat: lid, rubber seal, two hinges, two latches, warning sign
    zl = ROOF + 0.31 + 0.025
    bevel(box("ROOF_service_hatch", (sh[0], sh[1], zl), (sh[2], sh[3], 0.05), M["M_MetalLight"], exp), 0.012)
    seal = box("ROOF_service_hatch_seal", (sh[0], sh[1], zl - 0.015), (sh[2] + 0.04, sh[3] + 0.04, 0.02), M["M_Rubber"], exp)
    boolean(seal, box("tmp_shs", (sh[0], sh[1], zl), (sh[2], sh[3], 0.2), None, exp))
    for k, dy in enumerate((-0.38, 0.38)):          # hinges on the outer (-x) edge
        cylinder(f"ROOF_service_hatch_hinge_{k}", (sh[0] - sh[2] / 2 - 0.02, sh[1] + dy, zl + 0.02), 0.03, 0.22,
                 M["M_MetalBare"], exp, 8, axis="Y")
    for k, dy in enumerate((-0.4, 0.4)):            # latches on the inner edge
        bevel(box(f"ROOF_service_hatch_latch_{k}", (sh[0] + sh[2] / 2 - 0.06, sh[1] + dy, zl + 0.035),
                  (0.08, 0.14, 0.03), M["M_MetalDark"], exp), 0.012)
    box("ROOF_service_hatch_handle", (sh[0] + 0.2, sh[1], zl + 0.035), (0.05, 0.4, 0.025), M["M_MetalBare"], exp)
    box("ROOF_service_hatch_sign", (sh[0] - 0.12, sh[1] + 0.35, zl + 0.027), (0.28, 0.28, 0.004), M["M_Hazard"], exp,
        rot_z=math.radians(45))
    box("ROOF_service_hatch_label", (sh[0] - 0.12, sh[1] - 0.3, zl + 0.027), (0.3, 0.12, 0.004), M["M_Decal"], exp)
    for f, x in enumerate((-1.3, 1.3)):
        zt = ROOF + 0.75
        bevel(cylinder(f"ROOF_fan_{f}_housing", (x, ry + 0.05, zt + 0.11), 0.5, 0.22, M["M_MetalDark"], exp, 24), 0.02)
        ring = cylinder(f"ROOF_fan_{f}_ring", (x, ry + 0.05, zt + 0.235), 0.5, 0.03, M["M_MetalLight"], exp, 24)
        boolean(ring, cylinder("tmp_rfr", (x, ry + 0.05, zt + 0.235), 0.42, 0.2, None, exp, 24))
        cylinder(f"ROOF_fan_{f}_well", (x, ry + 0.05, zt + 0.222), 0.43, 0.004, M["M_Rubber"], exp, 24)
        cylinder(f"ROOF_fan_{f}_hub", (x, ry + 0.05, zt + 0.235), 0.1, 0.03, M["M_MetalLight"], exp, 12)
        for b in range(5):
            a = math.radians(b * 72 + (20 if f else 50))
            box(f"ROOF_fan_{f}_blade_{b}", (x + 0.26 * math.cos(a), ry + 0.05 + 0.26 * math.sin(a), zt + 0.228),
                (0.3, 0.11, 0.012), M["M_MetalDark"], exp, rot=(math.radians(12), 0, a))
        # protective grille: parallel bars + cross bar resting on the ring
        for g in (-0.32, -0.16, 0.0, 0.16, 0.32):
            ln = 2 * math.sqrt(max(0.0, 0.46 ** 2 - g ** 2))
            box(f"ROOF_fan_{f}_guard_{g:+.2f}", (x, ry + 0.05 + g, zt + 0.255), (ln, 0.02, 0.012), M["M_MetalBare"], exp)
        box(f"ROOF_fan_{f}_guard_cross", (x, ry + 0.05, zt + 0.265), (0.03, 0.92, 0.012), M["M_MetalBare"], exp)
        # mounting feet with bolts at four points around the housing
        for q in range(4):
            a = math.radians(45 + q * 90)
            fx_, fy_ = x + 0.56 * math.cos(a), ry + 0.05 + 0.56 * math.sin(a)
            bevel(box(f"ROOF_fan_{f}_foot_{q}", (fx_, fy_, zt + 0.04), (0.2, 0.12, 0.08), M["M_MetalDark"], exp,
                      rot_z=a), 0.012)
            cylinder(f"ROOF_fan_{f}_bolt_{q}", (x + 0.6 * math.cos(a), ry + 0.05 + 0.6 * math.sin(a), zt + 0.09), 0.025,
                     0.03, M["M_MetalBare"], exp, 8)
    # 2) back service zone: maintenance hatch on the door axis
    hy_ = 2.2
    bevel(box("ROOF_hatch_frame", (DOOR_X, hy_, ROOF + 0.03), (1.3, 0.75, 0.06), M["M_MetalDark"], exp), 0.015)
    bevel(box("ROOF_hatch", (DOOR_X, hy_, ROOF + 0.08), (1.3 - 2 * FRAME_MINOR, 0.75 - 2 * FRAME_MINOR, 0.05),
              M["M_MetalLight"], exp), 0.01)
    seal = box("ROOF_hatch_seal", (DOOR_X, hy_, ROOF + 0.062), (1.3 - 2 * FRAME_MINOR + 0.04, 0.75 - 2 * FRAME_MINOR + 0.04,
                                                                 0.02), M["M_Rubber"], exp)
    boolean(seal, box("tmp_rhs", (DOOR_X, hy_, ROOF + 0.062), (1.3 - 2 * FRAME_MINOR, 0.75 - 2 * FRAME_MINOR, 0.1),
                      None, exp))
    box("ROOF_hatch_handle", (DOOR_X, hy_ - 0.18, ROOF + 0.12), (0.4, 0.05, 0.04), M["M_MetalDark"], exp)
    for k, dx in enumerate((-0.35, 0.35)):
        cylinder(f"ROOF_hatch_hinge_{k}", (DOOR_X + dx, hy_ + 0.3, ROOF + 0.09), 0.03, 0.16, M["M_MetalDark"], exp, 8,
                 axis="X")
    for k, dy in enumerate((-0.35, 0.35)):
        box(f"DECALS_hazard_roof_hatch_{k}", (DOOR_X, hy_ + dy, ROOF + 0.062), (1.25, 0.05, 0.004), M["M_Hazard"], exp)
    # 3) back service zone: low cooling unit right above the cooling block on the back wall
    cx_ = (BACK_COOLING_X[0] + BACK_COOLING_X[1]) / 2
    bevel(box("ROOF_cooler", (cx_, 2.2, ROOF + 0.21), (1.9, 0.7, 0.42), M["M_MetalDark"], exp), 0.03)
    bevel(box("ROOF_cooler_lid", (cx_, 2.2, ROOF + 0.445), (1.96, 0.76, 0.05), M["M_MetalLight"], exp), 0.015)
    box("ROOF_cooler_well", (cx_, 2.552, ROOF + 0.21), (1.7, 0.01, 0.32), M["M_MetalDark"], exp)
    louvre("ROOF_cooler", "+y", cx_, 1.66, ROOF + 0.06, ROOF + 0.38, 2.565, M, exp)
    box("ROOF_cooler_led", (cx_ + 0.8, 1.845, ROOF + 0.32), (0.1, 0.01, 0.04), M["M_Beacon"], exp)
    # 4) thin cable channel along the back of the module: cooler -> comms node
    c0, c1 = cx_ + 0.95, COMMS_XY[0] - 0.45
    bevel(box("ROOF_cable_channel", ((c0 + c1) / 2, ry + 1.58, ROOF + 0.04), (c1 - c0, 0.14, 0.08), M["M_MetalDark"],
              exp), 0.01)
    box("ROOF_cable_channel_cover", ((c0 + c1) / 2, ry + 1.58, ROOF + 0.083), (c1 - c0 - 0.1, 0.09, 0.006),
        M["M_MetalLight"], exp)
    # 5) antenna node (below) is fed from the module by a conduit
    cylinder("ROOF_conduit", ((4.0 + COMMS_XY[0] - 0.65) / 2, COMMS_XY[1], ROOF + 0.12), 0.07,
             COMMS_XY[0] - 0.65 - 4.0 + 0.1, M["M_MetalLight"], exp, 10, axis="X")

    # ===================================================================== BEACON / COMMS NODE
    bx, byy = COMMS_XY
    pz = 0.22                                  # pedestal height
    ped = prism("BEACON_pedestal", [(bx + x, byy + y) for x, y in chamfer_rect(0.65, 0.5, 0.15)], "z",
                ROOF - 0.05, ROOF + pz, M["M_MetalDark"], exp)
    bevel(ped, 0.03)
    for sx_, sy_ in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
        cylinder(f"BEACON_pedestal_bolt_{sx_:+d}{sy_:+d}", (bx + sx_ * 0.5, byy + sy_ * 0.36, ROOF + pz + 0.02), 0.04,
                 0.05, M["M_MetalLight"], exp, 8)
    housing = [(bx + x, byy + y) for x, y in chamfer_rect(0.45, 0.35, 0.12)]
    bevel(prism("BEACON_housing", housing, "z", ROOF + pz, ROOF + pz + 1.6, M["M_PaintOrange"], exp), 0.03)
    bevel(box("BEACON_frame", (bx, byy - 0.36, ROOF + pz + 0.85), (0.62, 0.04, 1.1), M["M_MetalDark"], exp), 0.015)
    box("BEACON_window", (bx, byy - 0.385, ROOF + pz + 1.05), (0.34, 0.02, 0.36), M["M_LightWarm"], exp)
    box("BEACON_indicator", (bx, byy - 0.385, ROOF + pz + 0.55), (0.3, 0.02, 0.14), M["M_ScreenStatic"], exp)
    bevel(box("BEACON_cap", (bx, byy, ROOF + pz + 1.65), (0.75, 0.55, 0.1), M["M_MetalDark"], exp), 0.02)
    # centre mast carries the lamp, two thinner antennas flank it
    z0 = ROOF + pz
    cylinder("BEACON_mast", (bx, byy, z0 + 2.5), 0.06, 1.7, M["M_MetalLight"], exp, 10)
    cylinder("BEACON_mast_collar", (bx, byy, z0 + 1.85), 0.1, 0.25, M["M_MetalDark"], exp, 10)
    cylinder("BEACON_lamp", (bx, byy, z0 + 3.48), 0.11, 0.26, M["M_Beacon"], exp, 12)
    cylinder("BEACON_lamp_cap", (bx, byy, z0 + 3.64), 0.13, 0.06, M["M_MetalDark"], exp, 12)
    cylinder("BEACON_lamp_base", (bx, byy, z0 + 3.33), 0.13, 0.05, M["M_MetalDark"], exp, 12)
    for dx, h in ((-0.27, 1.9), (0.27, 1.5)):
        cylinder(f"BEACON_antenna_{dx:+.2f}", (bx + dx, byy, z0 + 1.7 + h / 2), 0.03, h, M["M_MetalLight"], exp, 8)
        cylinder(f"BEACON_antenna_{dx:+.2f}_base", (bx + dx, byy, z0 + 1.8), 0.07, 0.2, M["M_MetalDark"], exp, 8)
        cylinder(f"BEACON_antenna_{dx:+.2f}_ring", (bx + dx, byy, z0 + 1.7 + h * 0.6), 0.05, 0.05,
                 M["M_MetalDark"], exp, 8)
    # comms tech box beside the mast: dark body, orange lid, panel antenna + whip, link to the pedestal
    cbx, cby = bx, byy + 0.95
    bevel(box("COMMS_box", (cbx, cby, ROOF + 0.27), (0.9, 0.6, 0.6), M["M_MetalDark"], exp), 0.03)
    bevel(box("COMMS_box_lid", (cbx, cby, ROOF + 0.6), (0.96, 0.66, 0.06), M["M_PaintOrange"], exp), 0.015)
    louvre("COMMS_box_vent", "+x", cby, 0.4, ROOF + 0.12, ROOF + 0.48, cbx + 0.46, M, exp)
    box("COMMS_box_led", (cbx - 0.2, cby - 0.305, ROOF + 0.45), (0.1, 0.01, 0.04), M["M_Beacon"], exp)
    box("COMMS_box_label", (cbx + 0.12, cby - 0.305, ROOF + 0.3), (0.35, 0.01, 0.12), M["M_MetalLight"], exp)
    cylinder("COMMS_panel_pole", (cbx + 0.25, cby + 0.1, ROOF + 0.98), 0.03, 0.7, M["M_MetalLight"], exp, 8)
    bevel(box("COMMS_panel_antenna", (cbx + 0.25, cby + 0.1, ROOF + 1.45), (0.07, 0.28, 0.5), M["M_MetalLight"], exp,
              rot_z=math.radians(-25)), 0.01)
    cylinder("COMMS_whip", (cbx - 0.3, cby + 0.15, ROOF + 1.15), 0.015, 1.1, M["M_MetalDark"], exp, 6)
    cylinder("COMMS_link", (cbx, (byy + 0.5 + cby - 0.3) / 2, ROOF + 0.15), 0.06, cby - 0.3 - byy - 0.5 + 0.1,
             M["M_MetalLight"], exp, 10, axis="Y")
    # cable tray from the right chamfer to the pedestal (continues the wall riser)
    tx0, tx1 = bx + 0.65, sx_out - SIDE_CH
    bevel(box("ROOF_cable_tray", ((tx0 + tx1) / 2, byy, ROOF + 0.06), (tx1 - tx0 + 0.04, 0.5, 0.12), M["M_MetalDark"],
              exp), 0.015)
    box("ROOF_cable_tray_cover", ((tx0 + tx1) / 2, byy, ROOF + 0.125), (tx1 - tx0, 0.36, 0.01), M["M_MetalLight"], exp)

    build_final_details(M, exp, sx_out, fy, by)
    build_interior_v2(M, exp, ref, (DOOR_X, DOOR_W, DOOR_H))
    apply_material_families(exp, M)
    # stage 5: UV0 by material slot (tiling / trim atlases / screens) + paint mask colour attribute
    uv_stage5.apply_uvs(exp)
    uv_stage5.apply_paint_mask(exp)


if __name__ == "__main__":
    run(build, "SM_CommandCenter", "model")
