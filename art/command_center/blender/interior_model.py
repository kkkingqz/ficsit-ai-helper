"""Command Center — stage 4 interior (replaces the stage-1 interior of cc_interior.py in build_model.py).

Reference: interior concept sheet (main / alternative view, plan, console layout, section, interior modules).
The room size comes from the approved exterior (14.9 x 6.9 m, 4.8 m clear), not from the sheet's
approximate numbers; the sheet drives composition, modules and materials.

Layout (world coordinates, front = -Y = panoramic window):
    operator console  front-left under the window, curved: centre + two angled wings, 5 displays;
                      STANDING operator (no chair): desk 1.05 m, main screen centre ~1.96 m above the floor
    holo platform     centre of the right half, ceiling projector above it, beam between them
    rear wall         door with the stair pit (guard rails), FICSIT logo panel, service cabinets, crates
    right wall        cable duct (continues the exterior riser) -> ceiling tray -> holo projector
    left wall         standing terminal; wall panels with dado vents all round
    floor             1 x 1 m panel seams, orange perimeter line, dashed walkway, two floor grilles
    ceiling           four transverse beams, recessed light panels, projector, cable tray
"""
import math

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)
import bmesh

from cc_lib import (CEIL, D, DOOR_X, FLOOR_Z, FRAME_MINOR, LOUVRE_ANGLE, SHELL_INSET, WALL, W, bevel, boolean, box, cylinder,
                    louvre,
                    mesh_object, octagon, prism)

XW = W / 2 - SHELL_INSET - WALL          # inner face of the side walls (7.45)
YW = D / 2 - SHELL_INSET - WALL          # inner face of front/back walls (3.45)
F = FLOOR_Z + 0.02                       # floor surface
CORNER_IN = 0.76                         # inner 45° corner chamfer
WALL_TOP = 4.75                          # where the inner ceiling chamfers start (lowest of the three)

CONSOLE_X = -3.0                         # console centre (front-left)
CONSOLE_Y = -2.75                        # centre line of the centre segment (clear of the tilted glass)
CONSOLE_W, CONSOLE_DEPTH = 3.2, 0.8
# standing operator (pioneer ~1.8 m, eyes ~1.65 m): standing desk height, panel tilted towards a standing user
DESK_H = 1.05
PANEL_TILT = math.radians(20)
RISER_H = 0.2
SCREEN_Z0 = 1.28                         # bottom of the main / wing screens above the floor
WING_W, WING_ANGLE = 1.8, math.radians(25)
HOLO_XY = (3.2, 0.0)                     # holo platform centre (under the ceiling projector bay)
OPERATOR_XY = (CONSOLE_X, -1.85)          # where the standing operator stands (mat, interaction zone)
BEAMS_X = (-4.8, -1.6, 1.6, 4.8)         # ceiling beams (bays between them carry lights / projector)
# back wall composition (entry wall), x ranges along the wall
PORTAL_X = (DOOR_X - 2.3, DOOR_X + 2.3)    # door portal = main node, centred on the door
POWER_X = (PORTAL_X[1] + 0.03, 2.85)       # power / cable group, on the axis of the exterior cable entry (x 1.05..2.2)
SERVICE_X = (2.9, 6.55)                   # one service group: service console + three cabinets under one canopy


# ---------------------------------------------------------------------------------------------------------
def _seg(name, p0, p1, width, z, h, mat, exp):
    """Thin strip on the floor from p0 to p1 (xy), used for seams and markings."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = math.hypot(dx, dy)
    return box(name, ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z), (ln, width, h), mat, exp, rot_z=math.atan2(dy, dx))


def _pt_in_room(x, y):
    """Inside the chamfered room outline (with a small margin)."""
    ax, ay = abs(x), abs(y)
    return ax <= XW - 0.02 and ay <= YW - 0.02 and ax + ay <= XW + YW - CORNER_IN - 0.03


def build_floor(M, exp, pit):
    """Floor system: seams on the 1 x 1 m panel grid, five tile types, one marking code for the functional zones."""
    px0, px1, py0 = pit
    z = F + 0.002

    def clipped(xa, ya, xb, yb, n=200):
        """Split a straight line into runs inside the room and outside the stair pit."""
        runs, cur = [], None
        for i in range(n + 1):
            t = i / n
            x, y = xa + (xb - xa) * t, ya + (yb - ya) * t
            ok = _pt_in_room(x, y) and not (px0 - 0.02 <= x <= px1 + 0.02 and y >= py0 - 0.02)
            if ok and cur is None:
                cur = (x, y)
            if not ok and cur is not None:
                runs.append((cur, prev))
                cur = None
            prev = (x, y)
        if cur is not None:
            runs.append((cur, prev))
        return [r for r in runs if math.dist(r[0], r[1]) > 0.05]

    k = 0
    for x in range(-7, 8):
        for a, b in clipped(x, -YW, x, YW):
            _seg(f"FLOOR_seam_{k}", a, b, 0.018, z, 0.004, M["M_Rubber"], exp)
            k += 1
    for y in range(-3, 4):
        for a, b in clipped(-XW, y, XW, y):
            _seg(f"FLOOR_seam_{k}", a, b, 0.018, z, 0.004, M["M_Rubber"], exp)
            k += 1
    # ---- floor system (stage 4 v2): five tile types and one marking code ----------------------------------------
    #   orange solid outline  = functional zone (operator / projector / technical)
    #   yellow-black          = danger or keep-clear (stair, service clearance in front of cabinets, projector edge)
    #   grey ribbed tiles + white chevrons = main walkway (stair -> operator zone, branch -> projector)
    zt = z + 0.002

    def outline(name, x0, y0, x1, y1, width, mat):
        for k, (a, b) in enumerate((((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0)))):
            _seg(f"{name}_{k}", a, b, width, zt, 0.004, mat, exp)

    def label(name, x, y, w=0.7, rot=0.0):
        box(f"FLOOR_label_{name}", (x, y, zt), (w, 0.16, 0.004), M["M_Decal"], exp, rot_z=rot)

    def tile_path(cx, cy):                                  # tile type 2: grey anti-slip walkway tile
        bevel(box(f"FLOOR_path_tile_{cx:+.1f}_{cy:+.1f}", (cx, cy, F + 0.006), (0.96, 0.96, 0.012), M["M_MetalLight"], exp),
              0.012)
        for r in range(5):
            box(f"FLOOR_path_tile_{cx:+.1f}_{cy:+.1f}_rib_{r}", (cx, cy - 0.36 + r * 0.18, F + 0.014), (0.86, 0.03, 0.006),
                M["M_MetalBare"], exp)

    def tile_hatch(name, cx, cy, size=0.9):                 # tile type 3: technical floor hatch
        bevel(box(f"FLOOR_hatch_{name}", (cx, cy, F + 0.006), (size, size, 0.012), M["M_MetalLight"], exp), 0.012)
        box(f"FLOOR_hatch_{name}_seal", (cx, cy, F + 0.003), (size + 0.04, size + 0.04, 0.006), M["M_Rubber"], exp)
        for s in (-1, 1):
            box(f"FLOOR_hatch_{name}_hinge_{s:+d}", (cx + s * size * 0.3, cy + size / 2 - 0.04, F + 0.016), (0.14, 0.04, 0.012),
                M["M_MetalBare"], exp)
        box(f"FLOOR_hatch_{name}_handle", (cx, cy - size / 2 + 0.1, F + 0.016), (0.28, 0.05, 0.01), M["M_MetalDark"], exp)
        box(f"FLOOR_hatch_{name}_corner", (cx + size / 2 - 0.12, cy - size / 2 + 0.12, F + 0.0135), (0.16, 0.16, 0.003),
            M["M_Hazard"], exp)

    def tile_grille(name, cx, cy, w=1.2, d=0.6):            # tile type 4: floor vent grille
        bevel(box(f"FLOOR_grille_{name}_frame", (cx, cy, F + 0.006), (w, d, 0.012), M["M_MetalDark"], exp), 0.012)
        n = int((w - 0.15) / 0.1)
        for i in range(n):
            box(f"FLOOR_grille_{name}_bar_{i}", (cx - (w - 0.2) / 2 + i * (w - 0.2) / (n - 1), cy, F + 0.014), (0.025, d - 0.1, 0.008),
                M["M_MetalBare"], exp)

    # main walkway: 2 m wide strip of tiles from the stair landing to the operator zone, branch to the projector
    walk = [(x, y) for x in (-1.5, -0.5) for y in (1.5, 0.5, -0.5)] + [(0.5, -0.5), (0.5, 0.5)]
    for cx, cy in walk:
        tile_path(cx, cy)
    for k, (cx, cy) in enumerate(((-1.0, 1.0), (-1.0, -0.05))):     # "v" chevrons pointing to the console (-y)
        for s in (-1, 1):
            box(f"FLOOR_marking_chevron_{k}_{s:+d}", (cx + s * 0.18, cy, zt + 0.012), (0.42, 0.07, 0.004), M["M_Decal"], exp,
                rot_z=math.radians(35 * s))
    for s in (-1, 1):                                                 # ">" chevron on the branch, pointing to the projector
        box(f"FLOOR_marking_chevron_branch_{s:+d}", (0.5, s * 0.12, zt + 0.012), (0.42, 0.07, 0.004), M["M_Decal"], exp,
            rot_z=math.radians(-35 * s))
    # operator zone at the console: orange outline around the standing mat + label
    ox0, ox1, oy0, oy1 = CONSOLE_X - 1.6, CONSOLE_X + 1.6, -2.25, -1.1
    outline("FLOOR_marking_operator", ox0, oy0, ox1, oy1, 0.08, M["M_PaintOrange"])
    label("operator", ox1 - 0.5, oy1 - 0.12)
    # technical zone along the left wall: outline, two floor hatches, rack exhaust grille, cable channel
    outline("FLOOR_marking_tech", -6.85, -1.25, -5.75, 2.65, 0.08, M["M_PaintOrange"])
    label("tech", -6.3, -1.1, w=0.6)
    tile_hatch("tech_0", -6.35, 0.55, 0.8)
    tile_hatch("tech_1", -6.35, 1.55, 0.8)
    tile_grille("tech_rack", -6.35, -0.45, 0.8, 0.6)
    for k, (a, b) in enumerate((((-6.85, -0.9), (-6.2, -0.9)), ((-6.2, -0.9), (-6.2, -1.45)))):
        _seg(f"FLOOR_cable_channel_tech_{k}", a, b, 0.26, F + 0.012, 0.024, M["M_MetalLight"], exp)
    # service zone: keep-clear frame in front of the back cabinets + an underfloor access hatch at the logo wall
    outline("FLOOR_marking_service", 3.5, 2.15, 6.4, 2.9, 0.1, M["M_Hazard"])
    label("service", 4.95, 2.02, w=0.8)
    tile_hatch("service", 1.5, 2.5)
    # supply-air grilles under the window (right of the console)
    vents = [(a0 + a1) / 2 for a0, a1, kind in WINDOW_BAND if kind == "vent"]
    for k, x in enumerate(vents):                     # right under the louvre sections of the window band
        tile_grille(f"window_{k}", x, -3.05, w=BAND_PITCH - 0.1)
    # projector zone: dark plate with an orange octagon edge, yellow-black keep-out marks, label
    hx, hy = HOLO_XY
    prism("FLOOR_holo_plate", octagon(1.9, hx, hy), "z", F, F + 0.012, M["M_MetalDark"], exp)
    ring = prism("FLOOR_marking_holo_ring", octagon(1.95, hx, hy), "z", F + 0.012, F + 0.016, M["M_PaintOrange"], exp)
    boolean(ring, prism("tmp_hr", octagon(1.83, hx, hy), "z", F, F + 0.1, None, exp))
    for i in range(8):
        a = i * math.pi / 4 + math.pi / 4
        r = 1.6 * math.cos(math.pi / 8)
        box(f"FLOOR_marking_holo_keepout_{i}", (hx + r * math.cos(a), hy + r * math.sin(a), F + 0.016), (0.08, 0.5, 0.004),
            M["M_Hazard"], exp, rot_z=a)
    label("holo", hx - 1.2, hy - 1.55, w=0.6, rot=math.radians(45))


# ---------------------------------------------------------------------------------------------------------
def _wp(wall, a, d, z):
    """Point on a wall: a = coordinate along the wall, d = distance into the room, z = height."""
    return {"L": (-XW + d, a, z), "R": (XW - d, a, z), "B": (a, YW - d, z), "F": (a, -YW + d, z)}[wall]


def _ws(wall, along, depth, h):
    return (depth, along, h) if wall in "LR" else (along, depth, h)


FACING = {"L": "+x", "R": "-x", "B": "-y", "F": "+y"}


def _plane(wall, d):
    return {"L": -XW + d, "R": XW - d, "B": YW - d, "F": -YW + d}[wall]


def build_walls(M, exp, door):
    """Wall lining with functional zoning (stage 4 v2):
       left  = TECHNICAL zone: full-height vent section, open cable ladder, two equipment racks, air-handling unit
               feeding the ceiling duct (the exterior left side is the engineering side as well);
       right = CLEAN background: large plain panels, one light line, only the cable duct to the projector;
       back  = ENTRY and SERVICE: door, access terminal + door control, logo panel, service cabinets, access hatches;
       front = under-window dado with intake louvres right of the console."""
    door_x0, door_x1, door_h = door
    dz1 = F + 0.9                       # dado top
    uz0, uz1 = dz1 + 0.06, WALL_TOP - 0.15

    def upper(name, wall, a0, a1, z0=uz0, stripe=True):
        ac, ln = (a0 + a1) / 2, a1 - a0
        bevel(box(f"{name}_upper", _wp(wall, ac, 0.025, (z0 + uz1) / 2), _ws(wall, ln, 0.05, uz1 - z0), M["M_PaintOrange"],
                  exp), 0.03)
        if stripe:
            bevel(box(f"{name}_upper_stripe", _wp(wall, ac, 0.035, z0 + 0.55), _ws(wall, ln, 0.07, 0.18), M["M_MetalDark"],
                      exp), 0.012)

    def dado(name, wall, a0, a1, d=0.06):
        bevel(box(f"{name}_dado", _wp(wall, (a0 + a1) / 2, d / 2, (F + dz1) / 2), _ws(wall, a1 - a0, d, dz1 - F),
                  M["M_MetalDark"], exp), 0.012)

    def zone(wall, kind, a0, a1, i):
        a0, a1 = a0 + 0.03, a1 - 0.03
        ac, ln = (a0 + a1) / 2, a1 - a0
        name = f"WALL_{wall}_{i}_{kind}"
        if kind == "clean":                       # plain panel pair, no vents
            dado(name, wall, a0, a1)
            upper(name, wall, a0, a1, stripe=False)
        elif kind == "access":                    # service access hatch in the dado
            dado(name, wall, a0, a1)
            bevel(box(f"{name}_hatch", _wp(wall, ac, 0.07, (F + dz1) / 2), _ws(wall, ln - 0.3, 0.02, dz1 - F - 0.2),
                      M["M_MetalLight"], exp), 0.012)
            for s in (-1, 1):
                box(f"{name}_hatch_latch_{s:+d}", _wp(wall, ac + s * (ln / 2 - 0.25), 0.085, dz1 - 0.2),
                    _ws(wall, 0.06, 0.02, 0.08), M["M_MetalDark"], exp)
            box(f"{name}_hatch_label", _wp(wall, ac, 0.082, F + 0.3), _ws(wall, 0.3, 0.004, 0.1), M["M_Hazard"], exp)
            upper(name, wall, a0, a1)
        elif kind == "vent":                      # full-height vent section in an orange frame
            bevel(box(f"{name}_panel", _wp(wall, ac, 0.05, (F + uz1) / 2), _ws(wall, ln, 0.1, uz1 - F), M["M_MetalDark"],
                      exp), 0.012)
            for s in (-1, 1):
                box(f"{name}_frame_{s:+d}", _wp(wall, ac + s * (ln / 2 - 0.05), 0.11, (F + uz1) / 2),
                    _ws(wall, 0.1, 0.04, uz1 - F), M["M_PaintOrange"], exp)
            for g, (z0, z1) in enumerate(((F + 0.3, F + 1.5), (F + 1.9, uz1 - 0.3))):
                box(f"{name}_well_{g}", _wp(wall, ac, 0.102, (z0 + z1) / 2), _ws(wall, ln - 0.3, 0.004, z1 - z0 + 0.06),
                    M["M_Rubber"], exp)
                louvre(f"{name}_louvre_{g}", FACING[wall], ac, ln - 0.34, z0, z1, _plane(wall, 0.12), M, exp)
        elif kind == "cable":                     # open cable ladder floor-to-cornice
            bevel(box(f"{name}_back", _wp(wall, ac, 0.02, (F + uz1) / 2), _ws(wall, ln, 0.04, uz1 - F), M["M_MetalDark"],
                      exp), 0.012)
            for s in (-1, 1):
                box(f"{name}_rail_{s:+d}", _wp(wall, ac + s * (ln / 2 - 0.08), 0.1, (F + WALL_TOP) / 2),
                    _ws(wall, 0.05, 0.12, WALL_TOP - F), M["M_MetalBare"], exp)
            for r in range(int((WALL_TOP - F) / 0.35)):
                box(f"{name}_rung_{r}", _wp(wall, ac, 0.07, F + 0.2 + r * 0.35), _ws(wall, ln - 0.16, 0.04, 0.03),
                    M["M_MetalBare"], exp)
            for c, da in enumerate((-0.18, -0.06, 0.06, 0.18)):
                cylinder(f"{name}_cable_{c}", _wp(wall, ac + da, 0.12, (F + WALL_TOP) / 2), 0.035, WALL_TOP - F,
                         M["M_Rubber"], exp, 8)
            for r, z in enumerate((F + 0.9, F + 2.1, F + 3.2)):
                box(f"{name}_clamp_{r}", _wp(wall, ac, 0.15, z), _ws(wall, ln - 0.12, 0.03, 0.06), M["M_PaintOrange"], exp)
            bevel(box(f"{name}_floor_box", _wp(wall, ac, 0.2, F + 0.12), _ws(wall, ln, 0.4, 0.24), M["M_MetalDark"], exp),
                  0.012)
        elif kind == "rack":                      # equipment rack behind a glazed door
            dpt, h = 0.6, 2.3
            bevel(box(f"{name}_body", _wp(wall, ac, dpt / 2, F + h / 2), _ws(wall, ln - 0.04, dpt, h), M["M_MetalDark"],
                      exp), 0.03)
            bevel(box(f"{name}_door", _wp(wall, ac, dpt + 0.01, F + 1.15), _ws(wall, ln - 0.14, 0.02, 1.9),
                      M["M_MetalDark"], exp), 0.012)
            box(f"{name}_glass", _wp(wall, ac, dpt + 0.022, F + 1.25), _ws(wall, ln - 0.3, 0.006, 1.5), M["M_Glass"], exp)
            for c, da in enumerate((-0.12, 0.12)):    # two indicator strips behind the glass (not a grid of dots)
                box(f"{name}_led_strip_{c}", _wp(wall, ac + da, dpt - 0.02, F + 1.25), _ws(wall, 0.03, 0.01, 1.3),
                    M["M_ScreenStatic"], exp)
            box(f"{name}_led_status", _wp(wall, ac, dpt - 0.02, F + 1.95), _ws(wall, 0.08, 0.01, 0.04), M["M_Beacon"], exp)
            box(f"{name}_label", _wp(wall, ac, dpt + 0.022, F + 2.08), _ws(wall, 0.34, 0.004, 0.08), M["M_Decal"], exp)
            louvre(f"{name}_vent", FACING[wall], ac, ln - 0.3, F + 0.12, F + 0.36, _plane(wall, dpt + 0.02), M, exp)
            bevel(box(f"{name}_cap", _wp(wall, ac, dpt / 2, F + h + 0.03), _ws(wall, ln, dpt + 0.04, 0.06),
                      M["M_PaintOrange"], exp), 0.012)
            upper(name, wall, a0, a1, z0=F + h + 0.12, stripe=False)
        elif kind == "hvac":                      # air-handling unit + riser up to the ceiling duct
            dpt, h = 0.6, 2.5
            bevel(box(f"{name}_body", _wp(wall, ac, dpt / 2, F + h / 2), _ws(wall, ln - 0.04, dpt, h), M["M_MetalLight"],
                      exp), 0.03)
            fz = F + 1.7
            ax = "X" if wall in "LR" else "Y"
            ring = cylinder(f"{name}_fan_ring", _wp(wall, ac, dpt + 0.015, fz), 0.42, 0.03, M["M_MetalBare"], exp, 24, axis=ax)
            boolean(ring, cylinder("tmp_hr", _wp(wall, ac, dpt + 0.015, fz), 0.35, 0.2, None, exp, 24, axis=ax))
            cylinder(f"{name}_fan_well", _wp(wall, ac, dpt + 0.004, fz), 0.36, 0.006, M["M_Rubber"], exp, 24, axis=ax)
            cylinder(f"{name}_fan_hub", _wp(wall, ac, dpt + 0.012, fz), 0.08, 0.02, M["M_MetalBare"], exp, 12, axis=ax)
            for g in (-0.2, 0.0, 0.2):
                box(f"{name}_fan_guard_{g:+.1f}", _wp(wall, ac + g, dpt + 0.03, fz), _ws(wall, 0.02, 0.01, 0.78),
                    M["M_MetalDark"], exp)
            box(f"{name}_well", _wp(wall, ac, dpt + 0.004, F + 0.75), _ws(wall, ln - 0.3, 0.006, 0.8), M["M_Rubber"], exp)
            louvre(f"{name}_intake", FACING[wall], ac, ln - 0.34, F + 0.38, F + 1.12, _plane(wall, dpt + 0.02), M, exp)
            box(f"{name}_label", _wp(wall, ac - 0.25, dpt + 0.005, F + 2.3), _ws(wall, 0.36, 0.004, 0.1), M["M_Hazard"], exp)
            for k in range(3):
                box(f"{name}_led_{k}", _wp(wall, ac + 0.25 + k * 0.07, dpt + 0.005, F + 2.3), _ws(wall, 0.04, 0.004, 0.03),
                    M["M_Beacon"] if k == 0 else M["M_ScreenStatic"], exp)
            rz0, rz1 = F + h, 5.25
            bevel(box(f"{name}_riser", _wp(wall, ac, 0.3, (rz0 + rz1) / 2), _ws(wall, 0.5, 0.42, rz1 - rz0),
                      M["M_MetalLight"], exp), 0.012)
            box(f"{name}_riser_flange", _wp(wall, ac, 0.3, rz0 + 0.6), _ws(wall, 0.56, 0.48, 0.05), M["M_MetalDark"], exp)
            bevel(box(f"{name}_elbow", _wp(wall, ac, 0.55, 5.4), _ws(wall, 0.5, 0.6, 0.36), M["M_MetalLight"], exp), 0.012)
        elif kind == "behind":                    # wall behind free-standing cabinets: upper panel only
            dado(name, wall, a0, a1, d=0.04)
            upper(name, wall, a0, a1, z0=F + 2.45, stripe=False)
        elif kind == "terminal":                  # zone of the access terminal next to the door
            dado(name, wall, a0, a1)
            upper(name, wall, a0, a1)
        # cornice piece over every zone
        box(f"{name}_cornice", _wp(wall, ac, 0.05, WALL_TOP - 0.08), _ws(wall, a1 - a0 + 0.06, 0.1, 0.1), M["M_MetalDark"],
            exp)

    left = [("vent", -2.65, -1.35), ("cable", -1.35, -0.45), ("rack", -0.45, 0.5), ("rack", 0.5, 1.45),
            ("hvac", 1.45, 2.65)]
    right = [("clean", -2.65, 0.37), ("clean", 0.83, 2.65)]          # the cable duct runs in the gap at y 0.6
    # back wall = ENTRY composition (see build_back_wall): calm panels + 2 containers | door portal with access
    # control | power / cable group | one service-cabinet group
    back = [("clean", -6.65, -4.95), ("clean", -4.95, PORTAL_X[0] - 0.03),
            ("behind", SERVICE_X[0], 4.75), ("behind", 4.75, 6.65)]
    for wall, zones in (("L", left), ("R", right), ("B", back)):
        for i, (kind, a0, a1) in enumerate(zones):
            zone(wall, kind, a0, a1, i)
    # clean wall: one continuous light line
    box("LIGHTS_wall_R", _wp("R", 0.0, 0.06, F + 2.6), _ws("R", 5.1, 0.02, 0.05), M["M_LightWarm"], exp)   # proud of the 5 cm panels
    # the lower band under the window is built by build_window_band()
    # orange structural columns: window ends + back corners
    for i, (x, y) in enumerate(((-6.75, -YW + 0.17), (6.75, -YW + 0.17), (-6.75, YW - 0.17), (6.75, YW - 0.17))):
        bevel(box(f"WALL_column_{i}", (x, y, (F + WALL_TOP) / 2), (0.32, 0.34, WALL_TOP - F), M["M_PaintOrange"], exp),
              0.03)
        box(f"WALL_column_{i}_stripe", (x, y - math.copysign(0.172, y), F + 0.5), (0.24, 0.004, 0.5), M["M_Hazard"], exp)



# ---------------------------------------------------------------------------------------------------------
# ---------------------------------------------------------------------------------------------------------
# Operator console v2 — the most detailed element of the interior.
# Segment profile (heights above the floor, local depth ly: + towards the operator):
#   body 0..0.94 with kick recess | rubber arm pad + orange trim 0.90..1.02 at the front
#   inclined control deck 1.0 -> 1.18 (PANEL_TILT) | back shelf 1.19 | screen rail 1.20..1.26 | screens from 1.28
BODY_H, DECK_FRONT_LY, DECK_LEN = 0.94, 0.34, 0.48


def _frame(cx, cy, rot):
    ca, sa = math.cos(rot), math.sin(rot)
    return lambda lx, ly: (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca)


def _deck(P, rot):
    """Point on the control deck: u along the segment, v up the slope from the front edge, hoff off the surface."""
    t = PANEL_TILT

    def pt(u, v, hoff=0.0):
        ly = DECK_FRONT_LY - v * math.cos(t) + hoff * math.sin(t)
        h = 1.025 + v * math.sin(t) + hoff * math.cos(t)
        return (*P(u, ly), F + h)
    return pt, (-t, 0.0, rot)


def _deck_controls(name, kind, w, pt, drot, M, exp):
    """Separate control groups on the deck: keypads / toggles with guards / indicators / knobs / touch screen."""
    def plate(tag, u, v, gw, gv):
        bevel(box(f"CONTROL_PANELS_{name}_{tag}", pt(u, v, 0.006), (gw, gv, 0.012), M["M_MetalLight"], exp, rot=drot), 0.012)

    def keys(tag, u0, v0, cols, rows, pitch, mats):
        for c in range(cols):
            for r in range(rows):
                m = mats[(c + r) % len(mats)]
                box(f"CONTROL_PANELS_{name}_{tag}_key_{c}_{r}", pt(u0 + (c - (cols - 1) / 2) * pitch,
                    v0 + (r - (rows - 1) / 2) * pitch, 0.022), (pitch * 0.7, pitch * 0.7, 0.02), m, exp, rot=drot)

    def leds(tag, u0, v0, n, pitch):
        for i in range(n):
            m = M["M_Beacon"] if i % 3 == 0 else M["M_ScreenStatic"]
            box(f"CONTROL_PANELS_{name}_{tag}_led_{i}", pt(u0 + (i - (n - 1) / 2) * pitch, v0, 0.014), (0.025, 0.025, 0.006),
                m, exp, rot=drot)

    if kind == "centre":
        plate("touch_frame", 0.0, 0.26, 1.0, 0.34)
        box(f"CONTROL_PANELS_{name}_touch", pt(0.0, 0.26, 0.014), (0.9, 0.28, 0.004), M["M_ScreenStatic"], exp, rot=drot)
        for s in (-1, 1):
            plate(f"keypad_{s:+d}", s * 1.0, 0.24, 0.8, 0.36)
            keys(f"keypad_{s:+d}", s * 1.0, 0.24, 7, 3, 0.1, (M["M_MetalBare"], M["M_MetalBare"], M["M_ScreenStatic"]))
        plate("leds", 0.0, 0.45, w - 0.3, 0.05)
        leds("leds", 0.0, 0.45, 22, 0.13)
    elif kind == "toggles":
        plate("toggles", 0.0, 0.2, w - 0.35, 0.3)
        for i in range(8):
            u = (i - 3.5) * 0.17
            box(f"CONTROL_PANELS_{name}_toggle_{i}", pt(u, 0.2, 0.05), (0.025, 0.025, 0.07), M["M_MetalBare"], exp,
                rot=(drot[0] + math.radians(25), 0, drot[2]))
            for s in (-1, 1):   # guard frame around each toggle
                box(f"CONTROL_PANELS_{name}_toggle_{i}_guard_{s:+d}", pt(u + s * 0.05, 0.2, 0.03), (0.012, 0.11, 0.05),
                    M["M_Hazard"], exp, rot=drot)
        plate("indicators", 0.0, 0.42, w - 0.35, 0.08)
        leds("indicators", 0.0, 0.42, 8, 0.17)
    else:  # knobs: rotary knobs, numeric display, two big push buttons
        plate("knobs", -0.25, 0.22, 1.0, 0.3)
        for i in range(5):
            box(f"CONTROL_PANELS_{name}_knob_{i}", pt(-0.65 + i * 0.2, 0.22, 0.035), (0.075, 0.075, 0.05), M["M_Rubber"], exp,
                rot=(drot[0], 0, drot[2] + math.radians(45)))
            box(f"CONTROL_PANELS_{name}_knob_{i}_mark", pt(-0.65 + i * 0.2, 0.25, 0.062), (0.012, 0.03, 0.004),
                M["M_Decal"], exp, rot=drot)
        plate("display", 0.55, 0.3, 0.45, 0.16)
        box(f"CONTROL_PANELS_{name}_display", pt(0.55, 0.3, 0.014), (0.4, 0.11, 0.004), M["M_ScreenStatic"], exp, rot=drot)
        for i, u in enumerate((0.42, 0.68)):
            box(f"CONTROL_PANELS_{name}_button_{i}", pt(u, 0.1, 0.03), (0.1, 0.1, 0.04),
                M["M_Beacon"] if i == 0 else M["M_ScreenStatic"], exp, rot=drot)


def _lower_modules(name, P, w, rot, mods, M, exp):
    """Service sections at the operator side of the body, separated by proud pilasters."""
    d = CONSOLE_DEPTH
    fy = d / 2
    total = sum(f for f, _ in mods)
    x = -w / 2
    edges = []
    for i, (frac, kind) in enumerate(mods):
        mw = w * frac / total
        u = x + mw / 2
        x += mw
        edges.append(x)
        tag = f"{name}_{i}"
        if kind == "hatch":            # service hatch: cover, two latches, handle, label
            bevel(box(f"CONSOLE_hatch_{tag}", (*P(u, fy + 0.01), F + 0.5), (mw - 0.14, 0.02, 0.62), M["M_MetalLight"], exp,
                      rot_z=rot), 0.012)
            for s in (-1, 1):
                box(f"CONSOLE_hatch_{tag}_latch_{s:+d}", (*P(u + s * (mw / 2 - 0.13), fy + 0.025), F + 0.68),
                    (0.05, 0.02, 0.08), M["M_MetalDark"], exp, rot_z=rot)
            box(f"CONSOLE_hatch_{tag}_handle", (*P(u, fy + 0.03), F + 0.36), (0.3, 0.02, 0.035), M["M_MetalBare"], exp,
                rot_z=rot)
            box(f"CONSOLE_hatch_{tag}_label", (*P(u, fy + 0.022), F + 0.7), (0.24, 0.004, 0.07), M["M_Hazard"], exp,
                rot_z=rot)
        elif kind == "server":         # built-in tech block: dark well, louvre, LED rack
            box(f"CONSOLE_server_{tag}_well", (*P(u - 0.1, fy + 0.004), F + 0.5), (mw - 0.4, 0.01, 0.6), M["M_MetalDark"],
                exp, rot_z=rot)
            for k in range(5):
                box(f"CONSOLE_server_{tag}_slat_{k}", (*P(u - 0.1, fy + 0.02), F + 0.26 + k * 0.12), (mw - 0.5, 0.03, 0.06),
                    M["M_MetalBare"], exp, rot=(LOUVRE_ANGLE, 0, rot))
            for k in range(6):
                box(f"CONSOLE_server_{tag}_led_{k}", (*P(u + mw / 2 - 0.15, fy + 0.008), F + 0.25 + k * 0.09),
                    (0.04, 0.006, 0.03), M["M_Beacon"] if k % 2 else M["M_ScreenStatic"], exp, rot_z=rot)
        elif kind == "cable":          # cable / terminal module: dark plate with square sockets
            bevel(box(f"CONSOLE_cable_{tag}", (*P(u, fy + 0.01), F + 0.5), (mw - 0.14, 0.02, 0.6), M["M_MetalDark"], exp,
                      rot_z=rot), 0.012)
            for k in range(4):
                box(f"CONSOLE_cable_{tag}_port_{k}", (*P(u + (k - 1.5) * 0.12, fy + 0.025), F + 0.62), (0.07, 0.012, 0.07),
                    M["M_Rubber"], exp, rot_z=rot)
                box(f"CONSOLE_cable_{tag}_port_{k}_ring", (*P(u + (k - 1.5) * 0.12, fy + 0.022), F + 0.62),
                    (0.09, 0.006, 0.09), M["M_Beacon"], exp, rot_z=rot)
            box(f"CONSOLE_cable_{tag}_label", (*P(u, fy + 0.022), F + 0.4), (0.3, 0.004, 0.07), M["M_Decal"], exp,
                rot_z=rot)
        else:                          # vent module
            box(f"CONSOLE_vent_{tag}_well", (*P(u, fy + 0.004), F + 0.5), (mw - 0.14, 0.01, 0.6), M["M_MetalDark"], exp,
                rot_z=rot)
            for k in range(5):
                box(f"CONSOLE_vent_{tag}_slat_{k}", (*P(u, fy + 0.02), F + 0.26 + k * 0.12), (mw - 0.24, 0.03, 0.06),
                    M["M_MetalBare"], exp, rot=(LOUVRE_ANGLE, 0, rot))
    for i, e in enumerate(edges[:-1]):   # proud pilasters between the modules
        bevel(box(f"CONSOLE_pilaster_{name}_{i}", (*P(e, fy + 0.02), F + 0.48), (0.06, 0.04, 0.76), M["M_MetalDark"], exp,
                  rot_z=rot), 0.012)
    box(f"CONSOLE_hazard_{name}", (*P(0, fy + 0.006), F + 0.12 + 0.04), (w - 0.2, 0.01, 0.06), M["M_Hazard"], exp,
        rot_z=rot)


def _console_segment(name, cx, cy, w, rot, deck_kind, mods, M, exp):
    """One console segment with the stepped desk silhouette; returns the local->world frame."""
    P = _frame(cx, cy, rot)
    d = CONSOLE_DEPTH
    body = box(f"CONSOLE_BODY_{name}", (*P(0, 0), F + BODY_H / 2), (w, d, BODY_H), M["M_MetalDark"], exp, rot_z=rot)
    boolean(body, box("tmp_kick", (*P(0, d / 2), F + 0.05), (w + 0.1, 0.2, 0.1), M["M_Rubber"], exp, rot_z=rot))
    bevel(body, 0.03)
    # front: orange trim + rubber arm pad (the soft operator edge)
    box(f"CONSOLE_EDGE_{name}", (*P(0, d / 2 + 0.02), F + 0.92), (w, 0.06, 0.04), M["M_PaintOrange"], exp, rot_z=rot)
    bevel(box(f"CONSOLE_armpad_{name}", (*P(0, d / 2 + 0.01), F + 0.98), (w, 0.12, 0.08), M["M_Rubber"], exp, rot_z=rot),
          0.03)
    box(f"LIGHTS_console_{name}", (*P(0, d / 2 + 0.055), F + 0.885), (w - 0.1, 0.01, 0.02), M["M_LightWarm"], exp,
        rot_z=rot)
    # inclined control deck + its support, back shelf, screen rail
    t = PANEL_TILT
    ly_c = DECK_FRONT_LY - DECK_LEN / 2
    h_c = 1.0 + DECK_LEN / 2 * math.tan(t)
    bevel(box(f"CONTROL_DECK_{name}", (*P(0, ly_c), F + h_c), (w - 0.04, DECK_LEN / math.cos(t), 0.05), M["M_MetalDark"],
              exp, rot=(-t, 0, rot)), 0.012)
    box(f"CONSOLE_deck_support_{name}", (*P(0, (DECK_FRONT_LY - DECK_LEN - 0.4) / 2 + 0.0), F + (BODY_H + 1.16) / 2),
        (w - 0.02, 0.4 + DECK_LEN - DECK_FRONT_LY + 0.06, 1.16 - BODY_H), M["M_MetalDark"], exp, rot_z=rot)
    bevel(box(f"CONSOLE_shelf_{name}", (*P(0, -0.3), F + 1.19), (w, 0.22, 0.03), M["M_MetalLight"], exp, rot_z=rot), 0.012)
    bevel(box(f"CONSOLE_RISER_{name}", (*P(0, -0.37), F + 1.23), (w, 0.08, 0.06), M["M_MetalDark"], exp, rot_z=rot), 0.012)
    pt, drot = _deck(P, rot)
    _deck_controls(name, deck_kind, w, pt, drot, M, exp)
    _lower_modules(name, P, w, rot, mods, M, exp)
    return P


def _monitor(name, P, lx, ly, z0, w, h, rot, screen_mat, M, exp, tilt=0.0):
    """Bezel + back housing + screen plane facing the operator; tilt > 0 leans the top towards the operator."""
    zc = z0 + h / 2
    r = (-tilt, 0.0, rot)
    bevel(box(f"DISPLAY_FRAMES_{name}", (*P(lx, ly), zc), (w + 0.12, 0.05, h + 0.12), M["M_MetalDark"], exp, rot=r), 0.012)
    bevel(box(f"DISPLAY_FRAMES_{name}_housing", (*P(lx, ly - 0.05), zc), (w * 0.8, 0.06, h * 0.8), M["M_MetalDark"], exp,
              rot=r), 0.012)
    box(f"DISPLAY_{name}" if name == "MAIN_RT" else f"DISPLAY_PLANES_{name}", (*P(lx, ly + 0.027), zc), (w, 0.006, h),
        screen_mat, exp, rot=r)


def _tower(name, P, lx, rot, M, exp):
    """Built-in tech tower at a wing end: louvre, LED column, status screen, cable glands, orange cap."""
    d = CONSOLE_DEPTH + 0.1
    hgt = 1.75
    bevel(box(f"CONSOLE_TOWER_{name}", (*P(lx, 0.0), F + hgt / 2), (0.6, d, hgt), M["M_MetalDark"], exp, rot_z=rot), 0.03)
    fy = d / 2
    box(f"CONSOLE_TOWER_{name}_well", (*P(lx, fy + 0.004), F + 1.2), (0.44, 0.01, 0.6), M["M_MetalDark"], exp, rot_z=rot)
    for k in range(5):
        box(f"CONSOLE_TOWER_{name}_slat_{k}", (*P(lx, fy + 0.02), F + 0.96 + k * 0.12), (0.4, 0.03, 0.06), M["M_MetalBare"],
            exp, rot=(LOUVRE_ANGLE, 0, rot))
    box(f"CONSOLE_TOWER_{name}_screen", (*P(lx, fy + 0.006), F + 1.6), (0.36, 0.006, 0.16), M["M_ScreenStatic"], exp,
        rot_z=rot)
    for k in range(6):
        box(f"CONSOLE_TOWER_{name}_led_{k}", (*P(lx - 0.22, fy + 0.006), F + 0.3 + k * 0.08), (0.03, 0.006, 0.03),
            M["M_Beacon"] if k % 2 else M["M_ScreenStatic"], exp, rot_z=rot)
    bevel(box(f"CONSOLE_TOWER_{name}_hatch", (*P(lx + 0.06, fy + 0.01), F + 0.5), (0.36, 0.02, 0.6), M["M_MetalLight"],
              exp, rot_z=rot), 0.012)
    for k in range(3):
        box(f"CONSOLE_TOWER_{name}_gland_{k}", (*P(lx - 0.15 + k * 0.15, fy + 0.02), F + 0.12), (0.07, 0.04, 0.07),
            M["M_Rubber"], exp, rot_z=rot)
    bevel(box(f"CONSOLE_TOWER_{name}_cap", (*P(lx, 0.0), F + hgt + 0.03), (0.64, d + 0.04, 0.06), M["M_PaintOrange"], exp,
              rot_z=rot), 0.012)
    box(f"CONSOLE_TOWER_{name}_stripe", (*P(lx, fy + 0.005), F + hgt - 0.08), (0.56, 0.008, 0.06), M["M_Hazard"], exp,
        rot_z=rot)


def build_console(M, exp, ref):
    """Curved operator console: centre + two wings, joint pillars, end towers, 1 large + 4 medium + 2 narrow screens."""
    P0 = _console_segment("centre", CONSOLE_X, CONSOLE_Y, CONSOLE_W, 0.0, "centre",
                          [(0.9, "hatch"), (1.4, "server"), (0.9, "hatch")], M, exp)
    wings = []
    for s, nm in ((-1, "left"), (1, "right")):
        inner = (CONSOLE_X + s * CONSOLE_W / 2, CONSOLE_Y)
        cx = inner[0] + s * math.cos(WING_ANGLE) * WING_W / 2
        cy = inner[1] + math.sin(WING_ANGLE) * WING_W / 2
        rot = s * WING_ANGLE
        mods = [(1.0, "vent"), (1.0, "cable")] if s < 0 else [(1.0, "cable"), (1.0, "vent")]
        P = _console_segment(nm, cx, cy, WING_W, rot, "toggles" if s < 0 else "knobs", mods, M, exp)
        wings.append((nm, P, s, rot))
        # joint pillar at the seam with the centre segment (hides the wedge gap, marks the module split)
        jp = _frame(*inner, rot / 2)
        bevel(box(f"CONSOLE_JOINT_{nm}", (*jp(0, 0.0), F + 0.62), (0.16, CONSOLE_DEPTH + 0.14, 1.24), M["M_MetalDark"], exp,
                  rot_z=rot / 2), 0.03)
        box(f"CONSOLE_JOINT_{nm}_cap", (*jp(0, 0.0), F + 1.26), (0.17, CONSOLE_DEPTH + 0.15, 0.04), M["M_PaintOrange"], exp,
            rot_z=rot / 2)
        box(f"LIGHTS_console_joint_{nm}", (*jp(0, CONSOLE_DEPTH / 2 + 0.071), F + 0.55), (0.03, 0.006, 0.8),
            M["M_LightWarm"], exp, rot_z=rot / 2)
        _tower(nm, P, s * (WING_W / 2 + 0.3), rot, M, exp)
    z0 = F + SCREEN_Z0
    # 1 large: render-target screen (16:9, own slot); 2 narrow verticals flanking it
    _monitor("MAIN_RT", P0, 0.0, -0.32, z0, 2.4, 2.4 * 9 / 16, 0.0, M["M_ScreenRT"], M, exp)
    for i, lx in enumerate((-1.44, 1.44)):
        _monitor(f"narrow_{i}", P0, lx, -0.32, z0, 0.28, 1.05, 0.0, M["M_ScreenStatic"], M, exp)
    # support beam + posts behind the centre screens
    bevel(box("CONSOLE_screen_beam", (*P0(0, -0.42), z0 + 0.72), (3.3, 0.08, 0.14), M["M_MetalDark"], exp), 0.012)
    for i, lx in enumerate((-0.9, 0.9)):
        box(f"CONSOLE_screen_post_{i}", (*P0(lx, -0.42), F + 1.2 + (z0 - F - 1.2 + 1.5) / 2), (0.08, 0.06,
            z0 - F - 1.2 + 1.5), M["M_MetalDark"], exp)
    # 4 medium: per wing a lower 16:9 screen and an upper one leaning towards the operator
    for nm, P, s, rot in wings:
        _monitor(f"wing_{nm}", P, 0.0, -0.32, z0, 1.45, 1.45 * 9 / 16, rot, M["M_ScreenStatic"], M, exp)
        _monitor(f"wing_{nm}_upper", P, 0.0, -0.3, z0 + 0.94, 1.0, 0.56, rot, M["M_ScreenStatic"], M, exp,
                 tilt=math.radians(12))
        box(f"CONSOLE_arm_{nm}", (*P(0, -0.38), z0 + 0.88), (0.1, 0.06, 0.2), M["M_MetalBare"], exp, rot_z=rot)
    # interaction zone for E (reference only, not exported)
    use = box("USE_ZONE_console", (CONSOLE_X, OPERATOR_XY[1], F + 1.1), (6.0, 1.3, 2.2), None, ref)
    use.display_type = "WIRE"
    use.hide_render = True
    return [("centre", P0, CONSOLE_W, 0.0, 0)] + [(nm, P, WING_W, rot, s) for nm, P, s, rot in wings]


def build_operator_mat(M, exp):
    """Anti-fatigue rubber mat where the operator stands (replaces the chair)."""
    x, y = OPERATOR_XY
    bevel(box("PROP_MAT_operator", (x, y + 0.15, F + 0.008), (2.6, 0.9, 0.016), M["M_Rubber"], exp), 0.012)
    for s_ in (-1, 1):
        box(f"PROP_MAT_operator_edge_{s_:+d}", (x, y + 0.15 + s_ * 0.44, F + 0.012), (2.6, 0.03, 0.01), M["M_Hazard"], exp)


def build_service_console(M, exp):
    """Wall-mounted service console for the three service cabinets (replaces the free-standing kiosk, which duplicated
    the door control and broke up the entrance). Sits on the back wall between the logo panel and the cabinets."""
    x, yw = 3.22, YW
    bevel(box("SERVICE_CONSOLE_backplate", (x, yw - 0.015, F + 1.3), (0.56, 0.03, 1.3), M["M_MetalDark"], exp), 0.012)
    bevel(box("SERVICE_CONSOLE_housing", (x, yw - 0.12, F + 1.5), (0.5, 0.2, 0.42), M["M_MetalDark"], exp,
              rot=(math.radians(-20), 0, 0)), 0.03)
    box("SERVICE_CONSOLE_screen", (x, yw - 0.222, F + 1.52), (0.42, 0.01, 0.3), M["M_ScreenStatic"], exp,
        rot=(math.radians(-20), 0, 0))
    box("SERVICE_CONSOLE_trim", (x, yw - 0.2, F + 1.27), (0.5, 0.02, 0.03), M["M_PaintOrange"], exp)
    bevel(box("SERVICE_CONSOLE_shelf", (x, yw - 0.15, F + 1.18), (0.5, 0.24, 0.04), M["M_MetalLight"], exp,
              rot=(math.radians(15), 0, 0)), 0.012)
    for r in range(2):
        for c in range(5):
            box(f"SERVICE_CONSOLE_key_{r}_{c}", (x - 0.16 + c * 0.08, yw - 0.12 - r * 0.08, F + 1.21 - r * 0.02), (0.05, 0.05, 0.02),
                M["M_Beacon"] if (r, c) == (0, 4) else M["M_MetalBare"], exp, rot=(math.radians(15), 0, 0))
    box("SERVICE_CONSOLE_label", (x - 0.06, yw - 0.032, F + 1.85), (0.32, 0.004, 0.08), M["M_Decal"], exp)
    box("SERVICE_CONSOLE_led", (x + 0.19, yw - 0.032, F + 1.85), (0.05, 0.004, 0.03), M["M_Beacon"], exp)
    # conduits: down into the floor and across to the first service cabinet
    cylinder("SERVICE_CONSOLE_conduit_down", (x + 0.18, yw - 0.07, F + 0.33), 0.035, 0.66, M["M_Rubber"], exp, 8)
    cylinder("SERVICE_CONSOLE_conduit_gland", (x + 0.18, yw - 0.07, F + 0.03), 0.05, 0.06, M["M_MetalBare"], exp, 8)
    cylinder("SERVICE_CONSOLE_conduit_cabinet", (x + 0.3, yw - 0.08, F + 1.75), 0.035, 0.12, M["M_MetalBare"], exp, 8, axis="X")


def _facet_frame(hx, hy, i, r):
    """Centre point, outward angle of facet i of an octagon(r) built by cc_lib.octagon (vertices at pi/8 + k*pi/4)."""
    a = i * math.pi / 4 + math.pi / 4          # facet normal sits halfway between two vertices
    rf = r * math.cos(math.pi / 8)
    return (hx + rf * math.cos(a), hy + rf * math.sin(a)), a


def build_holo(M, exp):
    """Holo platform v2 — a technical node: segmented pedestal with service / vent / light facets, energy node and
    floor cable channel; mechanical ceiling emitter on a bolted frame; systemic hologram (object, rings, beams, UI)."""
    hx, hy = HOLO_XY
    # ---- pedestal: plinth, core, 8 separate facet panels with corner ribs, top ring --------------------------------
    bevel(prism("HOLO_PEDESTAL", octagon(1.35, hx, hy), "z", F, F + 0.2, M["M_MetalDark"], exp), 0.03)
    prism("HOLO_PEDESTAL_core", octagon(1.1, hx, hy), "z", F + 0.2, F + 0.8, M["M_MetalDark"], exp)
    side = 2 * 1.18 * math.sin(math.pi / 8)                      # facet width of octagon(1.18)
    kinds = ("service", "vent", "light", "vent") * 2
    for i, kind in enumerate(kinds):
        (px, py), a = _facet_frame(hx, hy, i, 1.18)
        P = lambda u, n, a=a, px=px, py=py: (px + n * math.cos(a) - u * math.sin(a), py + n * math.sin(a) + u * math.cos(a))  # noqa: E731
        rz = a - math.pi / 2                                       # box local x along the facet
        bevel(box(f"HOLO_PEDESTAL_panel_{i}", (*P(0, -0.03), F + 0.5), (side - 0.06, 0.06, 0.56), M["M_MetalDark"], exp,
                  rot_z=rz), 0.012)
        if kind == "service":
            bevel(box(f"HOLO_PEDESTAL_hatch_{i}", (*P(0, 0.006), F + 0.5), (side - 0.2, 0.02, 0.42), M["M_MetalLight"], exp,
                      rot_z=rz), 0.012)
            for s in (-1, 1):
                box(f"HOLO_PEDESTAL_hatch_{i}_screw_{s:+d}", (*P(s * (side / 2 - 0.16), 0.02), F + 0.66), (0.025, 0.01, 0.025),
                    M["M_MetalBare"], exp, rot_z=rz)
            box(f"HOLO_PEDESTAL_hatch_{i}_label", (*P(0, 0.019), F + 0.35), (0.2, 0.004, 0.05), M["M_Decal"], exp, rot_z=rz)
        elif kind == "vent":
            box(f"HOLO_PEDESTAL_vent_{i}_well", (*P(0, 0.002), F + 0.5), (side - 0.18, 0.01, 0.42), M["M_Rubber"], exp,
                rot_z=rz)
            for k in range(3):
                box(f"HOLO_PEDESTAL_vent_{i}_slat_{k}", (*P(0, 0.015), F + 0.36 + k * 0.12), (side - 0.24, 0.03, 0.06),
                    M["M_MetalBare"], exp, rot=(LOUVRE_ANGLE, 0, rz))
        else:
            box(f"HOLO_PEDESTAL_light_{i}", (*P(0, 0.004), F + 0.5), (side - 0.2, 0.01, 0.07), M["M_LightWarm"], exp,
                rot_z=rz)
            box(f"HOLO_PEDESTAL_light_{i}_hazard", (*P(0, 0.004), F + 0.33), (side - 0.2, 0.01, 0.06), M["M_Hazard"], exp,
                rot_z=rz)
    for i in range(8):                                             # corner ribs = segmentation
        a = math.pi / 8 + i * math.pi / 4
        box(f"HOLO_PEDESTAL_rib_{i}", (hx + 1.19 * math.cos(a), hy + 1.19 * math.sin(a), F + 0.5), (0.07, 0.07, 0.6),
            M["M_MetalDark"], exp, rot_z=a)
    prism("HOLO_PEDESTAL_band", octagon(1.26, hx, hy), "z", F + 0.8, F + 0.88, M["M_PaintOrange"], exp)
    bevel(prism("HOLO_PEDESTAL_top", octagon(1.24, hx, hy), "z", F + 0.88, F + 0.94, M["M_MetalLight"], exp), 0.012)
    # ---- energy node at the back + floor cable channel to the back-wall cabinets ------------------------------------
    ex, ey = hx + 0.45, hy + 1.32
    bevel(box("HOLO_ENERGY_node", (ex, ey + 0.18, F + 0.35), (0.7, 0.36, 0.7), M["M_MetalDark"], exp), 0.03)
    bevel(box("HOLO_ENERGY_node_cover", (ex, ey + 0.365, F + 0.4), (0.56, 0.02, 0.44), M["M_MetalLight"], exp), 0.012)
    box("HOLO_ENERGY_node_label", (ex - 0.1, ey + 0.378, F + 0.55), (0.24, 0.004, 0.08), M["M_Hazard"], exp)
    box("HOLO_ENERGY_node_led", (ex + 0.17, ey + 0.378, F + 0.55), (0.06, 0.004, 0.03), M["M_Beacon"], exp)
    for k, dx in enumerate((-0.2, 0.0, 0.2)):                      # thick feed cables from the node into the floor channel
        cylinder(f"HOLO_ENERGY_cable_{k}", (ex + dx, ey + 0.42, F + 0.09), 0.05, 0.16, M["M_Rubber"], exp, 10)
        cylinder(f"HOLO_ENERGY_gland_{k}", (ex + dx, ey + 0.42, F + 0.18), 0.07, 0.04, M["M_MetalBare"], exp, 10)
    route = [(ex, ey + 0.42), (ex, 2.35), (4.95, 2.35), (4.95, YW - 0.55)]
    for k, (a, b) in enumerate(zip(route[:-1], route[1:])):
        _seg(f"FLOOR_cable_channel_{k}", a, b, 0.34, F + 0.012, 0.024, M["M_MetalLight"], exp)
        for s in (-1, 1):                                          # hazard edges of the channel cover
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            nx, ny = -dy / ln * 0.18 * s, dx / ln * 0.18 * s
            _seg(f"FLOOR_cable_channel_{k}_edge_{s:+d}", (a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), 0.03, F + 0.026,
                 0.004, M["M_Hazard"], exp)
    # ---- emitter: disc, lens rings, four emitter nodes ---------------------------------------------------------------
    cylinder("HOLO_EMITTER", (hx, hy, F + 0.96), 0.9, 0.03, M["M_Holo"], exp, 32)
    for i, (r0, r1) in enumerate(((1.1, 0.98), (0.62, 0.56))):
        ring = cylinder(f"HOLO_EMITTER_ring_{i}", (hx, hy, F + 0.97), r0, 0.05, M["M_MetalBare"], exp, 32)
        boolean(ring, cylinder("tmp_er", (hx, hy, F + 0.97), r1, 0.2, None, exp, 32))
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        nx_, ny_ = hx + 1.04 * math.cos(a), hy + 1.04 * math.sin(a)
        bevel(box(f"HOLO_EMITTER_node_{i}", (nx_, ny_, F + 1.0), (0.14, 0.14, 0.1), M["M_MetalDark"], exp, rot_z=a), 0.012)
        cylinder(f"HOLO_EMITTER_node_{i}_lens", (nx_, ny_, F + 1.055), 0.04, 0.01, M["M_Holo"], exp, 10)
    # ---- hologram: central object + two rings + thin vertical beams + scale ring + floating UI panels --------------
    bm = bmesh.new()
    top = bmesh.ops.create_cone(bm, cap_ends=False, segments=9, radius1=0.7, radius2=0.0, depth=0.8)
    bmesh.ops.translate(bm, vec=(0, 0, 0.4), verts=top["verts"])
    for v in top["verts"]:
        if v.co.z > 0.01:
            v.co.x *= 1.0 + 0.25 * math.sin(v.co.y * 9)
    low = bmesh.ops.create_cone(bm, cap_ends=False, segments=9, radius1=0.0, radius2=0.7, depth=0.4)
    bmesh.ops.translate(bm, vec=(0, 0, -0.2), verts=low["verts"])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.translate(bm, vec=(hx, hy, F + 2.05), verts=bm.verts)
    mesh_object("HOLO_PROJECTION", bm, M["M_Holo"], exp)
    for i, (r, z) in enumerate(((1.05, F + 1.9), (0.8, F + 2.45))):
        rr = cylinder(f"HOLO_PROJECTION_ring_{i}", (hx, hy, z), r, 0.015, M["M_Holo"], exp, 48)
        boolean(rr, cylinder("tmp_pr", (hx, hy, z), r - 0.03, 0.2, None, exp, 48))
    scale = cylinder("HOLO_PROJECTION_scale", (hx, hy, F + 1.08), 1.2, 0.006, M["M_Holo"], exp, 48)
    boolean(scale, cylinder("tmp_sc", (hx, hy, F + 1.08), 1.17, 0.2, None, exp, 48))
    for i in range(8):                                           # eight major scale ticks
        a = i * math.pi / 4
        box(f"HOLO_PROJECTION_tick_{i}", (hx + 1.23 * math.cos(a), hy + 1.23 * math.sin(a), F + 1.08),
            (0.12, 0.008, 0.006), M["M_Holo"], exp, rot_z=a)
    bz0, bz1 = F + 1.06, CEIL - 0.42
    for i in range(4):                                           # beams from the emitter nodes up to the ceiling emitter
        a = math.pi / 4 + i * math.pi / 2
        box(f"HOLO_BEAM_{i}", (hx + 1.04 * math.cos(a), hy + 1.04 * math.sin(a), (bz0 + bz1) / 2), (0.012, 0.012, bz1 - bz0),
            M["M_Holo"], exp)
    for i in range(8):                                           # thin inner light lines
        a = i * math.pi / 4 + math.pi / 8
        box(f"HOLO_BEAM_inner_{i}", (hx + 0.72 * math.cos(a), hy + 0.72 * math.sin(a), (F + 1.0 + F + 2.9) / 2),
            (0.006, 0.03, 1.9), M["M_Holo"], exp, rot_z=a)
    for i, a in enumerate((math.radians(200), math.radians(270), math.radians(340))):   # UI cards facing outwards
        cx_, cy_ = hx + 1.55 * math.cos(a), hy + 1.55 * math.sin(a)
        box(f"HOLO_UI_card_{i}", (cx_, cy_, F + 2.1), (0.5, 0.006, 0.32), M["M_Holo"], exp, rot_z=a + math.pi / 2)
        for k in range(3):
            box(f"HOLO_UI_card_{i}_bar_{k}", (cx_ + 0.01 * math.cos(a), cy_ + 0.01 * math.sin(a), F + 2.18 - k * 0.07),
                (0.36 - k * 0.08, 0.004, 0.025), M["M_Holo"], exp, rot_z=a + math.pi / 2)
    # ---- ceiling emitter: bolted frame, hangers, stacked mechanical housing, segmented lens, actuators -------------
    zc = CEIL
    # carrier frame: square ring girder filling the projector cell, bolted to the two transverse and the two
    # longitudinal ceiling beams -> the emitter visibly HANGS from the ceiling structure
    ch, gw, gz0, gz1 = 1.45, 0.18, zc - 0.22, zc - 0.02
    for k, (cx_, cy_, sx_, sy_) in enumerate(((hx - ch + gw / 2, hy, gw, 2 * ch), (hx + ch - gw / 2, hy, gw, 2 * ch),
                                               (hx, hy - ch + gw / 2, 2 * ch - 2 * gw, gw), (hx, hy + ch - gw / 2, 2 * ch - 2 * gw, gw))):
        bevel(box(f"HOLO_MOUNT_girder_{k}", (cx_, cy_, (gz0 + gz1) / 2), (sx_, sy_, gz1 - gz0), M["M_MetalLight"], exp), 0.012)
    for sx in (-1, 1):                                           # corner gussets (stiffen the ring girder)
        for sy in (-1, 1):
            box(f"HOLO_MOUNT_gusset_{sx:+d}{sy:+d}", (hx + sx * (ch - 0.3), hy + sy * (ch - 0.3), gz1 - 0.05),
                (0.55, 0.14, 0.08), M["M_MetalLight"], exp, rot_z=math.radians(-45 * sx * sy))
    for i in range(4):                                           # 4 suspension nodes: clevis plate, strut, pin, arm
        a = i * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        rs = ch - gw / 2
        box(f"HOLO_MOUNT_hanger_{i}_plate", (hx + rs * ca, hy + rs * sa, gz0 - 0.02), (0.3, 0.3, 0.04), M["M_MetalBare"], exp,
            rot_z=a)
        bevel(box(f"HOLO_MOUNT_hanger_{i}_strut", (hx + rs * ca, hy + rs * sa, gz0 - 0.13), (0.11, 0.14, 0.2),
                  M["M_MetalDark"], exp, rot_z=a), 0.012)
        cylinder(f"HOLO_MOUNT_hanger_{i}_pin", (hx + rs * ca, hy + rs * sa, gz0 - 0.1), 0.035, 0.2, M["M_MetalBare"], exp, 10,
                 axis="Y" if i % 2 == 0 else "X")
        r0, r1 = 1.06, rs + 0.05
        bevel(box(f"HOLO_MOUNT_hanger_{i}_arm", (hx + (r0 + r1) / 2 * ca, hy + (r0 + r1) / 2 * sa, zc - 0.4),
                  (r1 - r0, 0.14, 0.1), M["M_MetalDark"], exp, rot_z=a), 0.012)
    bevel(cylinder("HOLO_PROJECTOR", (hx, hy, zc - 0.17), 1.05, 0.2, M["M_MetalDark"], exp, 32), 0.03)   # upper drum
    for i in range(8):                                           # radial ribs on the drum
        a = i * math.pi / 4
        box(f"HOLO_PROJECTOR_rib_{i}", (hx + 1.07 * math.cos(a), hy + 1.07 * math.sin(a), zc - 0.17), (0.08, 0.05, 0.2),
            M["M_MetalDark"], exp, rot_z=a)
    bevel(cylinder("HOLO_PROJECTOR_band", (hx, hy, zc - 0.31), 1.25, 0.08, M["M_PaintOrange"], exp, 32), 0.012)
    for i in range(12):                                          # vent slots in the band
        a = i * math.pi / 6
        box(f"HOLO_PROJECTOR_slot_{i}", (hx + 1.252 * math.cos(a), hy + 1.252 * math.sin(a), zc - 0.31), (0.01, 0.14, 0.03),
            M["M_Rubber"], exp, rot_z=a)
    bevel(cylinder("HOLO_PROJECTOR_lower", (hx, hy, zc - 0.4), 1.12, 0.1, M["M_MetalDark"], exp, 32), 0.012)
    for i in range(8):                                           # segmented lens
        a = i * math.pi / 4 + math.pi / 8
        # ring of 8 separate lens segments between the core and the light ring (gaps keep them from reading as blades)
        box(f"HOLO_PROJECTOR_lens_{i}", (hx + 0.64 * math.cos(a), hy + 0.64 * math.sin(a), zc - 0.455), (0.32, 0.34, 0.01),
            M["M_Holo"], exp, rot_z=a)
    cylinder("HOLO_PROJECTOR_lens_core", (hx, hy, zc - 0.46), 0.22, 0.02, M["M_LightWarm"], exp, 16)
    r2 = cylinder("HOLO_PROJECTOR_ring", (hx, hy, zc - 0.455), 1.04, 0.012, M["M_LightWarm"], exp, 32)
    boolean(r2, cylinder("tmp_pjr", (hx, hy, zc - 0.455), 0.98, 0.2, None, exp, 32))
    for i in range(4):                                           # actuators: block + piston down to the lens ring
        a = math.pi / 4 + i * math.pi / 2
        axx, ayy = hx + 1.0 * math.cos(a), hy + 1.0 * math.sin(a)
        bevel(box(f"HOLO_PROJECTOR_actuator_{i}", (axx, ayy, zc - 0.5), (0.16, 0.16, 0.12), M["M_MetalLight"], exp, rot_z=a),
              0.012)
        cylinder(f"HOLO_PROJECTOR_actuator_{i}_piston", (axx, ayy, zc - 0.6), 0.03, 0.12, M["M_MetalBare"], exp, 8)
        cylinder(f"HOLO_PROJECTOR_actuator_{i}_lens", (axx, ayy, zc - 0.665), 0.045, 0.01, M["M_Holo"], exp, 10)
    # ---- three service feeds, one per side of the carrier, each a different kind of object ---------------------------
    # POWER (+x): the ceiling cable tray ends at the carrier; junction box under the girder, two thick cables into the
    # lower housing
    jx0, jx1 = hx + 1.16, hx + ch - 0.01
    bevel(box("HOLO_FEED_power_junction", ((jx0 + jx1) / 2, 0.6, gz0 - 0.13), (jx1 - jx0, 0.36, 0.26), M["M_MetalDark"], exp),
          0.012)
    box("HOLO_FEED_power_hazard", (jx0 - 0.003, 0.6, gz0 - 0.1), (0.004, 0.2, 0.14), M["M_Hazard"], exp)
    box("HOLO_FEED_power_led", (jx0 - 0.003, 0.6, gz0 - 0.21), (0.004, 0.06, 0.03), M["M_Beacon"], exp)
    for k, y in enumerate((0.5, 0.7)):
        cylinder(f"HOLO_FEED_power_cable_{k}", ((hx + 0.85 + jx0) / 2, y, zc - 0.4), 0.04, jx0 - hx - 0.85, M["M_Rubber"],
                 exp, 10, axis="X")
    # COOLING (back-left corner): flexible air hose from the end of the HVAC duct to a cooler unit hung in the corner of
    # the carrier, round fan facing down, two coolant lines into the housing
    clx, cly, cs = hx - ch + 0.4, hy + ch - 0.3, 0.44
    cz0, cz1 = zc - 0.56, zc - 0.24
    bevel(box("HOLO_FEED_cooler", (clx, cly, (cz0 + cz1) / 2), (cs, cs, cz1 - cz0), M["M_MetalLight"], exp), 0.03)
    ring = cylinder("HOLO_FEED_cooler_fan_ring", (clx, cly, cz0 - 0.01), 0.17, 0.02, M["M_MetalBare"], exp, 20)
    boolean(ring, cylinder("tmp_cfr", (clx, cly, cz0 - 0.01), 0.14, 0.2, None, exp, 20))
    cylinder("HOLO_FEED_cooler_fan_well", (clx, cly, cz0 - 0.002), 0.145, 0.004, M["M_Rubber"], exp, 20)
    for g in (-0.06, 0.06):
        box(f"HOLO_FEED_cooler_fan_guard_{g:+.2f}", (clx + g, cly, cz0 - 0.02), (0.015, 0.3, 0.01), M["M_MetalDark"], exp)
    box("HOLO_FEED_cooler_label", (clx, cly - cs / 2 - 0.003, cz1 - 0.08), (0.26, 0.004, 0.07), M["M_Decal"], exp)
    hz, hr, hy0, hx_end = zc - 0.37, 0.08, 2.1, 1.34              # hose runs under the beams (their bottoms zc-0.2/-0.26)
    cylinder("HOLO_FEED_cool_hose_x", ((hx_end + clx) / 2, hy0, hz), hr, clx - hx_end, M["M_MetalBare"], exp, 14, axis="X")
    cylinder("HOLO_FEED_cool_hose_elbow", (clx, hy0, hz), hr, 2 * hr, M["M_MetalBare"], exp, 14)
    cylinder("HOLO_FEED_cool_hose_y", (clx, (hy0 + cly + cs / 2) / 2, hz), hr, hy0 - cly - cs / 2, M["M_MetalBare"], exp, 14,
             axis="Y")
    for k, (px_, py_, ax_) in enumerate(((hx_end + 0.12, hy0, "X"), ((hx_end + clx) / 2, hy0, "X"), (clx, cly + cs / 2 + 0.12, "Y"))):
        cylinder(f"HOLO_FEED_cool_hose_clamp_{k}", (px_, py_, hz), hr + 0.015, 0.05, M["M_PaintOrange"], exp, 14, axis=ax_)
    for k, o in enumerate((-0.05, 0.05)):                        # coolant lines: cooler -> lower housing (diagonal)
        mx, my = clx + 0.31 + o * 0.707, cly - 0.31 + o * 0.707
        box(f"HOLO_FEED_cool_line_{k}", (mx, my, zc - 0.4), (0.4, 0.05, 0.05), M["M_MetalBare"], exp, rot_z=math.radians(-45))
    # CONTROL (-x, towards the console): control module under the girder with a status strip, slim data conduit along
    # the underside of the front longitudinal beam back to the window header above the console
    kx0, kx1 = hx - ch + 0.03, hx - 1.22
    bevel(box("HOLO_FEED_control", ((kx0 + kx1) / 2, -0.6, gz0 - 0.12), (kx1 - kx0, 0.5, 0.24), M["M_MetalDark"], exp), 0.012)
    box("HOLO_FEED_control_screen", (kx0 - 0.003, -0.6, gz0 - 0.1), (0.004, 0.36, 0.1), M["M_ScreenStatic"], exp)
    for k in range(3):
        box(f"HOLO_FEED_control_led_{k}", (kx0 - 0.003, -0.74 + k * 0.14, gz0 - 0.2), (0.004, 0.05, 0.025),
            M["M_Beacon"] if k == 0 else M["M_ScreenStatic"], exp)
    dz_ = zc - 0.295
    box("HOLO_FEED_data_drop", ((kx0 + kx1) / 2, (-0.85 + LONG_Y[0]) / 2, dz_), (0.1, -0.85 - LONG_Y[0], 0.05), M["M_MetalDark"], exp)
    box("HOLO_FEED_data_run", ((CONSOLE_X + (kx0 + kx1) / 2) / 2, LONG_Y[0], dz_), ((kx0 + kx1) / 2 - CONSOLE_X, 0.1, 0.05),
        M["M_MetalDark"], exp)
    box("HOLO_FEED_data_to_header", (CONSOLE_X, (LONG_Y[0] - 2.15) / 2, dz_), (0.1, 2.15 + LONG_Y[0], 0.05), M["M_MetalDark"],
        exp)



LONG_Y = (-1.6, 1.6)                     # longitudinal ceiling beams
CEIL_FLAT_X, CEIL_FLAT_Y = (-6.45, 6.45), (-2.45, 2.55)   # flat part of the ceiling (inside the inner chamfers)


def _preview_light(name, x, y, z, sx, sy, energy):
    """Area light for the Blender preview only (not a mesh, never exported)."""
    L = bpy.data.lights.new(name, "AREA")
    L.energy, L.shape, L.size, L.size_y = energy, "RECTANGLE", sx, sy
    ob = bpy.data.objects.new(name, L)
    ob.location = (x, y, z)
    bpy.context.scene.collection.objects.link(ob)


def _light_panel(name, x, y, w, d, M, exp, zc, energy=180.0):
    bevel(box(f"CEILING_{name}_frame", (x, y, zc - 0.035), (w + 0.12, d + 0.12, 0.07), M["M_MetalDark"], exp), 0.012)
    box(f"LIGHTS_ceiling_{name}", (x, y, zc - 0.075), (w, d, 0.02), M["M_LightWarm"], exp)
    _preview_light(f"PREVIEW_{name}", x, y, zc - 0.12, w, d, energy)


def build_ceiling(M, exp):
    """Engineering ceiling module: transverse + longitudinal beams, window header, chamfer ribs, ceiling panels,
    light panels of several sizes, strip and round downlights, HVAC duct with diffusers, ceiling diffusers, service
    hatch, cable tray down the right chamfer, a dedicated cell for the holo projector."""
    zc = CEIL
    k = math.sqrt(0.5)
    bays = [CEIL_FLAT_X[0]] + list(BEAMS_X) + [CEIL_FLAT_X[1]]
    span_x = CEIL_FLAT_X[1] - CEIL_FLAT_X[0]
    # ---- structure ------------------------------------------------------------------------------------------------
    for i, x in enumerate(BEAMS_X):                                    # transverse beams (secondary)
        bevel(box(f"CEILING_beam_{i}", (x, 0.05, zc - 0.1), (0.26, 4.9, 0.2), M["M_MetalDark"], exp), 0.012)
    for i, y in enumerate(LONG_Y):                                     # longitudinal beams (primary, deeper)
        bevel(box(f"CEILING_long_beam_{i}", (0.0, y, zc - 0.13), (span_x, 0.3, 0.26), M["M_MetalDark"], exp), 0.03)
        box(f"CEILING_long_beam_{i}_accent", (0.0, y, zc - 0.262), (span_x - 0.2, 0.06, 0.006), M["M_PaintOrange"], exp)
    bevel(box("CEILING_header_beam", (0.0, -2.33, zc - 0.12), (span_x, 0.36, 0.24), M["M_MetalDark"], exp), 0.03)
    box("LIGHTS_ceiling_cove", (0.0, -2.2, zc - 0.245), (span_x - 0.5, 0.06, 0.02), M["M_LightWarm"], exp)
    _preview_light("PREVIEW_cove", 0.0, -2.1, zc - 0.3, span_x - 0.5, 0.1, 120.0)
    for i, x in enumerate(BEAMS_X):                                    # ribs down the back chamfer
        box(f"CEILING_rib_back_{i}", (x, 3.0 - 0.06 * k, 5.35 - 0.06 * k), (0.14, 0.12, 1.27), M["M_MetalDark"], exp,
            rot=(math.radians(45), 0, 0))
    for s in (-1, 1):                                                  # ribs down the side chamfers (end of long beams)
        for j, y in enumerate(LONG_Y):
            box(f"CEILING_rib_side_{'L' if s < 0 else 'R'}_{j}", (s * (6.95 - 0.06 * k), y, 5.3 - 0.06 * k),
                (0.12, 0.3, 1.41), M["M_MetalDark"], exp, rot=(0, math.radians(-45 * s), 0))
    # ---- front band (over the console): strip lights per bay -----------------------------------------------------------
    for i, (x0, x1) in enumerate(zip(bays[:-1], bays[1:])):
        if i == 3:
            continue
        _light_panel(f"strip_{i}", (x0 + x1) / 2, -1.97, x1 - x0 - 0.5, 0.14, M, exp, zc, 60.0)
    # ---- middle band: ceiling panels, light panels, diffusers, service hatch -----------------------------------------
    for i, (x0, x1) in enumerate(zip(bays[:-1], bays[1:])):
        xc, bw = (x0 + x1) / 2, x1 - x0
        if i == 3:     # holo projector cell: dark coffer plate; the carrier frame is built by build_holo
            bevel(box("CEILING_projector_cell", (xc, 0.0, zc - 0.01), (bw - 0.32, 2.9, 0.02), M["M_MetalDark"], exp), 0.012)
            continue
        bevel(box(f"CEILING_panel_{i}", (xc, 0.0, zc - 0.015), (bw - 0.32, 2.9, 0.03), M["M_MetalLight"], exp), 0.012)
        box(f"CEILING_panel_{i}_seam", (xc, 0.15, zc - 0.032), (bw - 0.4, 0.02, 0.004), M["M_Rubber"], exp)
        if i in (1, 2):                                                # large light panels + square diffusers
            _light_panel(f"large_{i}", xc, -0.55, 2.4, 0.9, M, exp, zc, 220.0)
            dx, dy = xc, 0.85
            bevel(box(f"CEILING_diffuser_{i}", (dx, dy, zc - 0.045), (0.72, 0.72, 0.03), M["M_MetalLight"], exp), 0.012)
            box(f"CEILING_diffuser_{i}_well", (dx, dy, zc - 0.062), (0.56, 0.56, 0.004), M["M_Rubber"], exp)
            for q in range(5):
                box(f"CEILING_diffuser_{i}_slat_{q}", (dx, dy - 0.22 + q * 0.11, zc - 0.07), (0.54, 0.04, 0.012),
                    M["M_MetalBare"], exp, rot=(math.radians(30), 0, 0))
        else:                                                          # small light panels
            _light_panel(f"small_{i}", xc, -0.6, 1.1, 0.5, M, exp, zc, 110.0)
        if i == 0:                                                     # ceiling service hatch
            bevel(box("CEILING_service_hatch", (xc, 0.8, zc - 0.045), (1.0, 0.8, 0.03), M["M_MetalLight"], exp), 0.012)
            for s in (-1, 1):
                cylinder(f"CEILING_service_hatch_hinge_{s:+d}", (xc + s * 0.3, 1.21, zc - 0.05), 0.025, 0.16, M["M_MetalBare"],
                         exp, 8, axis="X")
            box("CEILING_service_hatch_latch", (xc, 0.41, zc - 0.065), (0.14, 0.04, 0.02), M["M_MetalDark"], exp)
            box("CEILING_service_hatch_label", (xc, 0.8, zc - 0.062), (0.3, 0.3, 0.004), M["M_Hazard"], exp,
                rot_z=math.radians(45))
    # ---- back band: HVAC duct from the left (engineering) wall + round downlights over the holo side ----------------
    dy, dz, dh = 2.1, zc - 0.3, 0.32
    x0, x1 = -6.75, 1.3
    bevel(box("CEILING_duct", ((x0 + x1) / 2, dy, dz), (x1 - x0, 0.5, dh), M["M_MetalLight"], exp), 0.012)
    bevel(box("CEILING_duct_end", (x1 + 0.02, dy, dz), (0.04, 0.56, dh + 0.06), M["M_MetalDark"], exp), 0.012)
    n = int((x1 - x0) / 1.25)
    for j in range(1, n + 1):
        fx = x0 + j * (x1 - x0) / (n + 1)
        box(f"CEILING_duct_flange_{j}", (fx, dy, dz), (0.05, 0.56, dh + 0.06), M["M_MetalDark"], exp)
        for s in (-1, 1):
            box(f"CEILING_duct_hanger_{j}_{s:+d}", (fx, dy + s * 0.3, zc - 0.07), (0.03, 0.03, 0.14), M["M_MetalBare"], exp)
    for j, fx in enumerate((-5.0, -2.6, -0.2)):
        box(f"CEILING_duct_grille_{j}", (fx, dy, dz - dh / 2 - 0.006), (0.6, 0.36, 0.012), M["M_MetalDark"], exp)
        for q in range(4):
            box(f"CEILING_duct_grille_{j}_slat_{q}", (fx, dy - 0.12 + q * 0.08, dz - dh / 2 - 0.016), (0.56, 0.03, 0.01),
                M["M_MetalBare"], exp, rot=(math.radians(30), 0, 0))
    for j, fx in enumerate((2.4, 4.0, 5.6)):
        cylinder(f"CEILING_downlight_{j}_ring", (fx, dy, zc - 0.025), 0.17, 0.05, M["M_MetalDark"], exp, 16)
        cylinder(f"LIGHTS_ceiling_downlight_{j}", (fx, dy, zc - 0.055), 0.12, 0.012, M["M_LightWarm"], exp, 16)
        _preview_light(f"PREVIEW_downlight_{j}", fx, dy, zc - 0.1, 0.24, 0.24, 40.0)
    # ---- cable tray: projector junction -> along the ceiling -> down the right chamfer to the wall duct ---------------
    tx0, tx1 = HOLO_XY[0] + 1.45, CEIL_FLAT_X[1]
    bevel(box("CEILING_cable_tray", ((tx0 + tx1) / 2, 0.6, zc - 0.07), (tx1 - tx0, 0.3, 0.1), M["M_MetalDark"], exp), 0.012)
    box("CEILING_cable_tray_cover", ((tx0 + tx1) / 2, 0.6, zc - 0.125), (tx1 - tx0 - 0.06, 0.24, 0.01), M["M_MetalLight"], exp)
    bevel(box("CEILING_cable_tray_slope", (6.95 - 0.08 * k, 0.6, 5.3 - 0.08 * k), (0.1, 0.3, 1.45), M["M_MetalDark"], exp,
              rot=(0, math.radians(-45), 0)), 0.012)


def build_services(M, exp):
    """Right-wall cable duct (inside continuation of the exterior riser), service cabinets, crates."""
    # vertical cable duct on the right wall, black with orange clamps (concept module "cable duct")
    dx = XW - 0.12
    bevel(box("INT_CABLE_DUCT", (dx, 0.6, (F + WALL_TOP) / 2), (0.22, 0.36, WALL_TOP - F), M["M_MetalDark"], exp), 0.012)
    for j, dy in enumerate((-0.09, 0.0, 0.09)):
        cylinder(f"INT_CABLE_DUCT_cable_{j}", (dx - 0.13, 0.6 + dy, (F + WALL_TOP) / 2), 0.035, WALL_TOP - F - 0.1,
                 M["M_Rubber"], exp, 8)
    for j, z in enumerate((F + 0.6, F + 1.5, F + 2.4, F + 3.3)):
        box(f"INT_CABLE_DUCT_clamp_{j}", (dx - 0.13, 0.6, z), (0.06, 0.38, 0.08), M["M_PaintOrange"], exp)
    # service cabinets: three at the back wall (service zone); the right wall stays clean
    cabs = [((4.0, YW - 0.27), (0.9, 0.5), 0.0), ((4.95, YW - 0.27), (0.9, 0.5), 0.0), ((5.9, YW - 0.27), (0.9, 0.5), 0.0)]
    for i, ((x, y), (sx, sy), rz) in enumerate(cabs):
        h = 2.2
        bevel(box(f"INT_CABINET_{i}", (x, y, F + h / 2), (sx, sy, h), M["M_MetalDark"], exp), 0.03)
        if rz:                        # door faces -x
            fx, fy, size = x - sx / 2 - 0.005, y, (0.01, sy - 0.12, h - 0.5)
            side = "-x"
        else:                         # door faces -y
            fx, fy, size = x, y - sy / 2 - 0.005, (sx - 0.12, 0.01, h - 0.5)
            side = "-y"
        bevel(box(f"INT_CABINET_{i}_door", (fx, fy, F + 1.2), size, M["M_MetalLight"], exp), 0.012)
        louvre(f"INT_CABINET_{i}_vent", side, fy if rz else fx, (sy if rz else sx) - 0.3, F + 1.75, F + 2.05,
               fx - (0.012 if rz else 0) if rz else fy - 0.012, M, exp)
        box(f"INT_CABINET_{i}_label", (fx - (0.006 if rz else 0), fy - (0 if rz else 0.006), F + 1.55),
            (0.004, 0.3, 0.1) if rz else (0.3, 0.004, 0.1), M["M_Decal"], exp)
        box(f"INT_CABINET_{i}_led", (fx - (0.006 if rz else 0), fy - (0 if rz else 0.006), F + 1.4),
            (0.004, 0.06, 0.03) if rz else (0.06, 0.004, 0.03), M["M_Beacon"], exp)
        bevel(box(f"INT_CABINET_{i}_cap", (x, y, F + h + 0.03), (sx + 0.04, sy + 0.04, 0.06), M["M_PaintOrange"], exp),
              0.012)
    # two compact FICSIT service containers in the back-left corner (no warehouse stack): spare-parts / tool case
    # and a smaller power-cell case; both on the floor, side by side
    _service_container("PROP_CONTAINER_parts", (-5.75, 2.88), (1.0, 0.62, 0.62), M, exp, kind="parts")
    _service_container("PROP_CONTAINER_cells", (-4.7, 2.95), (0.62, 0.48, 0.48), M, exp, kind="cells")


def _service_container(name, xy, size, M, exp, kind):
    """FICSIT-style service container: ribbed dark body, orange corner protectors, latches, side handles,
    stacking feet, top grip recesses, markings; the power-cell case adds a charge indicator and a hazard label."""
    x, y = xy
    sx, sy, sz = size
    z0 = F + 0.04                                                    # on stacking feet
    zc = z0 + sz / 2
    bevel(box(name, (x, y, zc), (sx, sy, sz), M["M_MetalDark"], exp), 0.03)
    bevel(box(f"{name}_lid", (x, y, z0 + sz + 0.025), (sx + 0.02, sy + 0.02, 0.05), M["M_MetalLight"], exp), 0.012)
    for s in (-1, 1):                                                # top grip recesses
        box(f"{name}_lid_grip_{s:+d}", (x + s * sx * 0.25, y, z0 + sz + 0.052), (sx * 0.22, 0.08, 0.006), M["M_Rubber"], exp)
    for k in range(int(sx / 0.16)):                                  # vertical ribs on the long faces
        rx = x - sx / 2 + 0.14 + k * (sx - 0.28) / max(1, int(sx / 0.16) - 1)
        for s in (-1, 1):
            box(f"{name}_rib_{k}_{s:+d}", (rx, y + s * (sy / 2 + 0.008), zc - 0.05), (0.03, 0.016, sz - 0.24), M["M_MetalDark"], exp)
    for a in (-1, 1):                                                # orange corner protectors (8)
        for b in (-1, 1):
            for c in (-1, 1):
                bevel(box(f"{name}_corner_{a:+d}{b:+d}{c:+d}", (x + a * (sx / 2 - 0.05), y + b * (sy / 2 - 0.05),
                          (z0 + 0.06) if c < 0 else (z0 + sz - 0.03)), (0.12, 0.12, 0.13 if c < 0 else 0.1), M["M_PaintOrange"], exp),
                      0.012)
                if c < 0:
                    box(f"{name}_foot_{a:+d}{b:+d}", (x + a * (sx / 2 - 0.08), y + b * (sy / 2 - 0.08), F + 0.02),
                        (0.1, 0.1, 0.04), M["M_Rubber"], exp)
    for s in (-1, 1):                                                # latches on the front face, handles on the ends
        box(f"{name}_latch_{s:+d}", (x + s * sx * 0.28, y - sy / 2 - 0.015, z0 + sz - 0.08), (0.08, 0.03, 0.1), M["M_MetalBare"], exp)
        box(f"{name}_handle_{s:+d}", (x + s * (sx / 2 + 0.02), y, zc + 0.06), (0.04, sy * 0.4, 0.05), M["M_MetalBare"], exp)
    box(f"{name}_label", (x - sx * 0.12, y - sy / 2 - 0.018, zc), (sx * 0.38, 0.004, 0.12), M["M_Decal"], exp)
    if kind == "cells":
        box(f"{name}_hazard", (x + sx * 0.22, y - sy / 2 - 0.018, zc), (0.16, 0.004, 0.16), M["M_Hazard"], exp)
        for k in range(4):                                           # charge indicator
            box(f"{name}_charge_{k}", (x - sx * 0.12 - 0.09 + k * 0.06, y - sy / 2 - 0.018, zc - 0.12), (0.04, 0.004, 0.03),
                M["M_Beacon"] if k == 3 else M["M_ScreenStatic"], exp)
    else:
        box(f"{name}_stripe", (x, y - sy / 2 - 0.016, z0 + 0.14), (sx - 0.3, 0.004, 0.05), M["M_PaintOrange"], exp)


def build_entrance(M, exp, door, pit):
    """Entrance zone (back wall): layered door frame with light and access status, door control + card reader,
    warning markings, technical threshold and step treads with riser lights, industrial integrated guard rails."""
    door_x0, door_x1, door_h = door
    px0, px1, py0 = pit
    dx = (door_x0 + door_x1) / 2
    cw = 0.42                                                    # casing width
    # ---- layered frame: dark casing -> orange inner frame ------------------------------------------------------------
    for s, (x0, x1) in ((-1, (door_x0 - cw, door_x0)), (1, (door_x1, door_x1 + cw))):
        xc = (x0 + x1) / 2
        bevel(box(f"DOOR_IN_casing_{s:+d}", (xc, YW - 0.1, (door_h + 0.05) / 2), (cw, 0.2, door_h + 0.05), M["M_MetalDark"],
                  exp), 0.03)
        xi = door_x0 - 0.06 if s < 0 else door_x1 + 0.06
        bevel(box(f"DOOR_IN_frame_{s:+d}", (xi, YW - 0.225, door_h / 2), (0.12, 0.05, door_h), M["M_PaintOrange"], exp),
              0.012)
        box(f"LIGHTS_door_jamb_{s:+d}", (xc + s * 0.02, YW - 0.203, door_h / 2 + 0.1), (0.03, 0.01, door_h - 0.6),
            M["M_LightWarm"], exp)
        box(f"DECALS_hazard_door_in_{s:+d}", (xc + s * 0.11, YW - 0.203, 0.85), (0.16, 0.008, 1.3), M["M_Hazard"], exp)
    hw = door_x1 - door_x0 + 2 * cw
    bevel(box("DOOR_IN_header", (dx, YW - 0.1, door_h + 0.3), (hw, 0.2, 0.5), M["M_MetalDark"], exp), 0.03)
    bevel(box("DOOR_IN_frame_top", (dx, YW - 0.225, door_h + 0.06), (door_x1 - door_x0 + 0.24, 0.05, 0.12),
              M["M_PaintOrange"], exp), 0.012)
    box("LIGHTS_door_inside", (dx, YW - 0.205, door_h + 0.2), (1.4, 0.01, 0.06), M["M_LightWarm"], exp)
    # access status module + exit sign in the header
    bevel(box("DOOR_IN_status", (dx + 0.95, YW - 0.21, door_h + 0.36), (0.42, 0.04, 0.16), M["M_MetalLight"], exp), 0.012)
    for k in range(3):
        box(f"DOOR_IN_status_led_{k}", (dx + 0.82 + k * 0.13, YW - 0.232, door_h + 0.36), (0.07, 0.006, 0.07),
            M["M_Beacon"] if k == 1 else M["M_ScreenStatic"], exp)
    box("DOOR_IN_sign_label", (dx - 0.8, YW - 0.205, door_h + 0.36), (0.6, 0.006, 0.14), M["M_Decal"], exp)
    # ---- threshold in the door opening: grated plate, hazard edge, door track ------------------------------------------
    tw = door_x1 - door_x0
    bevel(box("DOOR_threshold", (dx, YW + 0.15, 0.015), (tw, 0.42, 0.03), M["M_MetalLight"], exp), 0.012)
    for k in range(9):
        box(f"DOOR_threshold_slot_{k}", (dx - tw / 2 + 0.2 + k * (tw - 0.4) / 8, YW + 0.2, 0.031), (0.03, 0.26, 0.004),
            M["M_Rubber"], exp)
    box("DECALS_hazard_threshold", (dx, YW - 0.03, 0.032), (tw, 0.06, 0.004), M["M_Hazard"], exp)
    box("DOOR_track", (dx, YW + 0.175, 0.04), (tw + 0.3, 0.04, 0.02), M["M_MetalDark"], exp)
    # ---- step treads (grated), riser lights, nosings, landing edge -------------------------------------------------------
    for i in range(4):
        h = 0.25 * (i + 1)
        y_hi = YW - 0.3 * i                               # +y edge of step i (towards the door)
        box(f"STEPS_{i}_tread", ((px0 + px1) / 2, y_hi - 0.15, h + 0.006), (px1 - px0 - 0.12, 0.26, 0.012), M["M_MetalBare"],
            exp)
        box(f"DECALS_hazard_step_{i}", ((px0 + px1) / 2, y_hi - 0.03, h + 0.014), (px1 - px0 - 0.12, 0.06, 0.006),
            M["M_Hazard"], exp)
        if i:
            box(f"LIGHTS_step_riser_{i}", ((px0 + px1) / 2, y_hi + 0.004, h - 0.08), (px1 - px0 - 0.4, 0.008, 0.03),
                M["M_LightWarm"], exp)
    box("DECALS_hazard_pit_edge", ((px0 + px1) / 2, py0 - 0.05, F + 0.003), (px1 - px0, 0.1, 0.006), M["M_Hazard"], exp)
    box("LIGHTS_landing_edge", ((px0 + px1) / 2, py0 + 0.004, F - 0.06), (px1 - px0 - 0.2, 0.008, 0.03), M["M_LightWarm"],
        exp)
    # one solid warning band in front of the stair (small rotated chevrons read as scattered chips) + a label beside
    # the walkway, not on it
    box("DECALS_hazard_landing", ((px0 + px1) / 2, py0 - 0.3, F + 0.004), (px1 - px0 + 0.3, 0.22, 0.004), M["M_Hazard"], exp)
    box("DECALS_landing_label", (px1 + 0.75, py0 - 0.3, F + 0.004), (0.8, 0.16, 0.004), M["M_Decal"], exp)
    # ---- industrial guard rails along both pit edges, tied into the door casing -------------------------------------------
    ln = YW - 0.2 - py0
    yc = py0 + ln / 2
    for s, x in (("L", px0 - 0.07), ("R", px1 + 0.07)):
        bevel(box(f"PIT_RAIL_{s}_curb", (x, yc, F + 0.075), (0.14, ln, 0.15), M["M_MetalDark"], exp), 0.012)
        box(f"PIT_RAIL_{s}_curb_hazard", (x + (0.072 if s == "L" else -0.072), yc, F + 0.075), (0.006, ln, 0.1),
            M["M_Hazard"], exp)
        box(f"PIT_RAIL_{s}_panel", (x, yc, F + 0.34), (0.02, ln - 0.1, 0.38), M["M_MetalDark"], exp)
        for j, y in enumerate((py0 + 0.05, yc, YW - 0.25)):
            bevel(box(f"PIT_RAIL_{s}_post_{j}", (x, y, F + 0.55), (0.08, 0.08, 1.1), M["M_MetalDark"], exp), 0.012)
            box(f"PIT_RAIL_{s}_post_{j}_plate", (x, y, F + 0.158), (0.18, 0.18, 0.016), M["M_MetalBare"], exp)
            for b in (-1, 1):
                box(f"PIT_RAIL_{s}_post_{j}_bolt_{b:+d}", (x + b * 0.065, y + b * 0.065, F + 0.172), (0.025, 0.025, 0.012),
                    M["M_MetalBare"], exp)
        box(f"PIT_RAIL_{s}_rail_top", (x, yc, F + 1.08), (0.09, ln + 0.06, 0.07), M["M_PaintOrange"], exp)
        box(f"PIT_RAIL_{s}_rail_mid", (x, yc, F + 0.6), (0.05, ln, 0.05), M["M_PaintOrange"], exp)
        box(f"PIT_RAIL_{s}_post_0_band", (x, py0 + 0.05, F + 0.85), (0.084, 0.084, 0.12), M["M_Hazard"], exp)
        box(f"LIGHTS_rail_marker_{s}", (x, py0 + 0.05, F + 1.125), (0.06, 0.06, 0.02), M["M_Beacon"], exp)


def build_back_wall(M, exp, door):
    """Entry wall as ONE composition with a clear hierarchy (stage 4, back-wall pass):
       1. door portal (main node): dark surround around the door casing, heavy orange frame, FICSIT logo in the head;
       2. access control right beside the door, in the portal: one module (door control + card reader);
       3. power / cable group: closed vertical cable trunk (floor box -> cornice) + power distribution board,
          on the axis of the exterior cable entry;
       4. one service group: service console + three cabinets under a shared canopy with a work light;
       5. the two service containers stay in the calm left corner (build_services)."""
    door_x0, door_x1, door_h = door
    dx = (door_x0 + door_x1) / 2
    cw = 0.42                                        # door casing width (build_entrance)
    p0, p1 = PORTAL_X
    uz1 = WALL_TOP - 0.15
    head_z0 = door_h + 0.55                          # top of the door header
    fw = 0.16                                        # portal frame = FRAME_MAJOR-class member
    # ---- 1. portal: surround panels (around the casing) + orange frame + logo head -------------------------------------
    for s, (x0, x1) in ((-1, (p0, door_x0 - cw)), (1, (door_x1 + cw, p1))):
        bevel(box(f"PORTAL_surround_{s:+d}", ((x0 + x1) / 2, YW - 0.04, (F + uz1) / 2), (x1 - x0, 0.08, uz1 - F),
                  M["M_MetalDark"], exp), 0.012)
        fx = x0 + fw / 2 if s < 0 else x1 - fw / 2
        bevel(box(f"PORTAL_frame_{s:+d}", (fx, YW - 0.09, (F + uz1) / 2), (fw, 0.18, uz1 - F), M["M_PaintOrange"], exp),
              0.03)
        box(f"PORTAL_frame_{s:+d}_hazard", (fx, YW - 0.182, F + 0.35), (fw - 0.04, 0.006, 0.5), M["M_Hazard"], exp)
    hx0, hx1 = door_x0 - cw, door_x1 + cw
    bevel(box("PORTAL_head", (dx, YW - 0.04, (head_z0 + uz1) / 2), (hx1 - hx0, 0.08, uz1 - head_z0), M["M_MetalDark"], exp),
          0.012)
    bevel(box("PORTAL_frame_top", (dx, YW - 0.09, uz1 - fw / 2), (p1 - p0, 0.18, fw), M["M_PaintOrange"], exp), 0.03)
    box("DECALS_logo_inside", (dx, YW - 0.082, (head_z0 + uz1 - fw) / 2), (1.6, 0.006, 0.42), M["M_Decal"], exp)
    box("LIGHTS_portal_head", (dx, YW - 0.182, uz1 - fw - 0.03), (p1 - p0 - 2 * fw - 0.2, 0.01, 0.04), M["M_LightWarm"],
        exp)
    # cornice continues over portal + power group (the zones carry their own pieces)
    box("PORTAL_cornice", ((p0 + POWER_X[1]) / 2, YW - 0.05, WALL_TOP - 0.08), (POWER_X[1] - p0 + 0.06, 0.1, 0.1),
        M["M_MetalDark"], exp)
    # ---- 2. access control module in the left surround: door control above, card reader below --------------------------
    ax = (p0 + fw + door_x0 - cw) / 2
    az = F + 1.1
    bevel(box("ACCESS_backplate", (ax, YW - 0.095, az), (0.4, 0.03, 1.05), M["M_MetalLight"], exp), 0.012)
    box("ACCESS_trim", (ax, YW - 0.112, az + 0.5), (0.4, 0.006, 0.04), M["M_PaintOrange"], exp)
    bevel(box("DOOR_IN_control", (ax, YW - 0.15, az + 0.22), (0.3, 0.08, 0.42), M["M_MetalDark"], exp), 0.012)
    box("DOOR_IN_control_screen", (ax, YW - 0.192, az + 0.33), (0.22, 0.004, 0.14), M["M_ScreenStatic"], exp)
    for r in range(2):
        for c in range(3):
            box(f"DOOR_IN_control_key_{r}_{c}", (ax - 0.07 + c * 0.07, YW - 0.196, az + 0.17 - r * 0.06), (0.05, 0.01, 0.04),
                M["M_MetalBare"], exp)
    box("DOOR_IN_control_button", (ax, YW - 0.2, az + 0.05), (0.12, 0.02, 0.05), M["M_Beacon"], exp)
    bevel(box("DOOR_IN_reader", (ax, YW - 0.13, az - 0.3), (0.18, 0.04, 0.26), M["M_MetalDark"], exp), 0.012)
    box("DOOR_IN_reader_led", (ax, YW - 0.152, az - 0.22), (0.08, 0.004, 0.03), M["M_Beacon"], exp)
    box("DOOR_IN_reader_pad", (ax, YW - 0.152, az - 0.33), (0.12, 0.004, 0.12), M["M_Rubber"], exp)
    box("ACCESS_label", (ax, YW - 0.112, az - 0.47), (0.3, 0.004, 0.06), M["M_Decal"], exp)
    # ---- 3. power / cable group ------------------------------------------------------------------------------------------
    q0, q1 = POWER_X
    bevel(box("POWER_backplate", ((q0 + q1) / 2, YW - 0.03, (F + uz1) / 2), (q1 - q0, 0.06, uz1 - F), M["M_MetalDark"], exp),
          0.012)
    tx, tw, td = q0 + 0.3, 0.36, 0.18                # closed cable trunk floor -> cornice
    bevel(box("POWER_trunk", (tx, YW - 0.06 - td / 2, (F + WALL_TOP) / 2), (tw, td, WALL_TOP - F), M["M_MetalLight"], exp),
          0.012)
    box("POWER_trunk_seam", (tx, YW - 0.06 - td - 0.002, (F + WALL_TOP) / 2), (0.02, 0.006, WALL_TOP - F - 0.1),
        M["M_Rubber"], exp)
    for k, z in enumerate((F + 0.8, F + 2.0, F + 3.2)):    # rhythm: three clamps, same pitch as the left cable ladder
        box(f"POWER_trunk_clamp_{k}", (tx, YW - 0.06 - td / 2, z), (tw + 0.06, td + 0.04, 0.08), M["M_PaintOrange"], exp)
    bevel(box("POWER_trunk_floor_box", (tx, YW - 0.25, F + 0.13), (tw + 0.14, 0.38, 0.26), M["M_MetalDark"], exp), 0.012)
    box("POWER_trunk_floor_box_hazard", (tx, YW - 0.442, F + 0.13), (tw + 0.04, 0.006, 0.1), M["M_Hazard"], exp)
    bx, bw, bh, bz = (tx + tw / 2 + q1) / 2, 0.7, 1.1, F + 1.55      # power distribution board
    bevel(box("POWER_board", (bx, YW - 0.06 - 0.11, bz), (bw, 0.22, bh), M["M_MetalDark"], exp), 0.03)
    bevel(box("POWER_board_door", (bx, YW - 0.29, bz - 0.05), (bw - 0.1, 0.02, bh - 0.22), M["M_MetalLight"], exp), 0.012)
    box("POWER_board_handle", (bx + bw / 2 - 0.11, YW - 0.31, bz - 0.05), (0.03, 0.03, 0.22), M["M_MetalBare"], exp)
    box("POWER_board_hazard", (bx - 0.08, YW - 0.302, bz + 0.2), (0.22, 0.004, 0.22), M["M_Hazard"], exp)
    box("POWER_board_label", (bx - 0.08, YW - 0.302, bz - 0.12), (0.34, 0.004, 0.08), M["M_Decal"], exp)
    box("POWER_board_led", (bx, YW - 0.282, bz + bh / 2 - 0.06), (0.08, 0.006, 0.03), M["M_Beacon"], exp)
    # feeds: trunk -> board (top), board -> service group canopy
    cylinder("POWER_feed_trunk", ((tx + bx - bw / 2) / 2, YW - 0.14, bz + bh / 2 - 0.14), 0.04,
             bx - bw / 2 - tx, M["M_Rubber"], exp, 8, axis="X")
    # ---- 4. service group: one canopy over console + cabinets, work light, one label ---------------------------------
    s0, s1 = SERVICE_X
    cz0, cz1, cd = F + 2.3, F + 2.45, 0.62
    bevel(box("SERVICE_canopy", ((s0 + s1) / 2, YW - cd / 2, (cz0 + cz1) / 2), (s1 - s0, cd, cz1 - cz0), M["M_MetalDark"],
              exp), 0.012)
    box("SERVICE_canopy_edge", ((s0 + s1) / 2, YW - cd - 0.01, (cz0 + cz1) / 2), (s1 - s0, 0.02, cz1 - cz0),
        M["M_PaintOrange"], exp)
    box("LIGHTS_service_canopy", ((s0 + s1) / 2, YW - cd + 0.08, cz0 - 0.005), (s1 - s0 - 0.4, 0.06, 0.01), M["M_LightWarm"],
        exp)
    box("SERVICE_canopy_label", (s0 + 0.9, YW - cd - 0.022, (cz0 + cz1) / 2), (0.6, 0.004, 0.08), M["M_Decal"], exp)
    cylinder("POWER_feed_service", ((bx + bw / 2 + s0) / 2 + 0.02, YW - 0.14, cz0 - 0.1), 0.04, s0 - bx - bw / 2 + 0.1,
             M["M_Rubber"], exp, 8, axis="X")
    cylinder("POWER_feed_service_riser", (bx + bw / 2 - 0.02, YW - 0.14, (bz + bh / 2 + cz0 - 0.1) / 2), 0.04,
             cz0 - 0.1 - bz - bh / 2 + 0.04, M["M_Rubber"], exp, 8)


def build_ref(M, ref, door_x):
    """Reference objects (not exported): foundations and player capsules."""
    for i, x in enumerate((-4.0, 4.0)):
        box(f"REF_foundation_{i}", (x, 0, -0.5), (7.98, 7.98, 1.0), M["REF_Foundation"], ref)
    for nm, pos in (("REF_player_inside", (OPERATOR_XY[0] + 0.5, OPERATOR_XY[1], F)),
                    ("REF_player_outside", (-9.3, -4.6, 0.0))):
        cap = cylinder(nm, (pos[0], pos[1], pos[2] + 0.9), 0.3, 1.8, M["REF_Foundation"], ref, 12)   # 1.8 m pioneer
        cap.hide_render = nm.endswith("inside")   # scale check in the viewport; read as a stray column in renders


# ---------------------------------------------------------------------------------------------------------
# Small-detail helpers (kept for the few places that still need fixings)
SCREW = (0.03, 0.012, 0.03)              # screw / bolt head (along, proud, height) on a vertical face


def _screws(prefix, pts, M, exp, rot_z=0.0, size=SCREW):
    for k, p in enumerate(pts):
        box(f"{prefix}_screw_{k}", p, size, M["M_MetalBare"], exp, rot_z=rot_z)


def _slots(prefix, centre_fn, n, pitch, size, M, exp, rot_z=0.0):
    """Row of dark vent slots; centre_fn(offset) -> world point."""
    for k in range(n):
        box(f"{prefix}_slot_{k}", centre_fn((k - (n - 1) / 2) * pitch), size, M["M_Rubber"], exp, rot_z=rot_z)


# ---------------------------------------------------------------------------------------------------------
# Surface break-up, CALMED (detail rule): every element is either a FUNCTIONAL object or part of a RHYTHM
# (a repeated module). Pure "so it is not empty" filler — screws, small slot rows, gussets, frame lines — is not added:
# Satisfactory reads details large and functional, not as fine hard-surface noise.


def _detail_console(M, exp, segs):
    """Rear service panels (access from the window side) with one seam; seams between the control groups on the deck;
    a service cover on the outer side of each end tower."""
    d = CONSOLE_DEPTH
    for name, P, w, rot, s in segs:
        ry = -d / 2 - 0.011
        for j, u in enumerate((-w / 4, w / 4)):
            bevel(box(f"CONSOLE_rear_{name}_{j}", (*P(u, ry), F + 0.5), (w / 2 - 0.14, 0.02, 0.66), M["M_MetalLight"], exp,
                      rot_z=rot), 0.012)
        box(f"CONSOLE_rear_{name}_seam", (*P(0, ry - 0.002), F + 0.5), (0.02, 0.006, 0.8), M["M_Rubber"], exp, rot_z=rot)
        pt, drot = _deck(P, rot)
        for u in ((-0.55, 0.55) if name == "centre" else (0.0,)):
            box(f"CONTROL_DECK_{name}_seam_{u:+.2f}", pt(u, DECK_LEN / 2, 0.003), (0.012, DECK_LEN * 0.92, 0.004), M["M_Rubber"],
                exp, rot=drot)
        if name == "centre":
            continue
        side_lx = s * (WING_W / 2 + 0.3) + s * 0.301
        bevel(box(f"CONSOLE_TOWER_{name}_side_cover", (*P(side_lx + s * 0.01, 0.0), F + 0.9), (0.02, 0.7, 1.2),
                  M["M_MetalLight"], exp, rot_z=rot), 0.012)


def _detail_door_walls(M, exp, door):
    """Kick plates on the door casing (function)."""
    door_x0, door_x1, door_h = door
    uz0, uz1 = F + 0.96, WALL_TOP - 0.15
    cw = 0.42
    for s, xc in ((-1, door_x0 - cw / 2), (1, door_x1 + cw / 2)):
        bevel(box(f"DOOR_IN_kick_{s:+d}", (xc, YW - 0.206, 0.18), (cw - 0.06, 0.012, 0.3), M["M_MetalBare"], exp), 0.012)


def _detail_ceiling(M, exp):
    """Splice plates where the beams cross (structure) and joints of the window header segments (rhythm)."""
    zc = CEIL
    for i, x in enumerate(BEAMS_X):
        for j, y in enumerate(LONG_Y):
            bevel(box(f"CEILING_splice_{i}_{j}", (x, y, zc - 0.272), (0.5, 0.5, 0.02), M["M_MetalLight"], exp), 0.012)
    span = CEIL_FLAT_X[1] - CEIL_FLAT_X[0]
    for k in range(1, 6):
        x = CEIL_FLAT_X[0] + k * span / 6
        box(f"CEILING_header_beam_seam_{k}", (x, -2.33, zc - 0.242), (0.02, 0.37, 0.006), M["M_Rubber"], exp)


def _detail_window_band(M, exp):
    """Interior window ledge on brackets along the glazing (brackets on the band module grid)."""
    x0, x1 = WINDOW_BAND[0][0], WINDOW_BAND[-1][1]
    bevel(box("WALL_F_ledge", ((x0 + x1) / 2, -YW + 0.13, 2.13), (x1 - x0, 0.26, 0.05), M["M_MetalLight"], exp), 0.012)
    box("WALL_F_ledge_trim", ((x0 + x1) / 2, -YW + 0.262, 2.13), (x1 - x0, 0.012, 0.05), M["M_PaintOrange"], exp)
    for k in range(len(WINDOW_BAND) + 1):                            # brackets sit on the band pilasters (module grid)
        x = BAND_X0 + k * BAND_PITCH
        box(f"WALL_F_ledge_bracket_{k}", (x, -YW + 0.1, 2.05), (0.05, 0.18, 0.12), M["M_MetalDark"], exp)


def build_surface_detail(M, exp, segs, door):
    _detail_console(M, exp, segs)
    _detail_door_walls(M, exp, door)
    _detail_ceiling(M, exp)
    _detail_window_band(M, exp)


BAND_X0, BAND_PITCH = 0.45, 1.0                                    # interior lower band under the window, right of the console
BAND_TYPES = ("vent", "blank", "service", "control", "blank", "vent")  # A B C D B A: ends breathe, the middle works
WINDOW_BAND = tuple((BAND_X0 + i * BAND_PITCH, BAND_X0 + (i + 1) * BAND_PITCH, k) for i, k in enumerate(BAND_TYPES))
BAND_Z0, BAND_Z1 = F + 0.22, F + 0.82                               # module zone (kick below, raceway above)


def build_window_band(M, exp):
    """Lower band under the panoramic window as an obvious MODULE system: six equal 1.0 m sections, each in the same
    frame, types alternating vent / blank / service / control / blank / vent. Light is used twice only: the diagnostic
    panel of the control section and thin status lines on the two pilasters that flank it. Raceway on top, kick below,
    light under the ledge."""
    x0, x1 = WINDOW_BAND[0][0], WINDOW_BAND[-1][1]
    xc, ln = (x0 + x1) / 2, x1 - x0
    top = 2.08
    bevel(box("WALL_F_band_back", _wp("F", xc, 0.02, (F + top) / 2), _ws("F", ln, 0.04, top - F), M["M_MetalDark"], exp), 0.012)
    box("WALL_F_band_shadow_gap", _wp("F", xc, 0.045, F + 0.05), _ws("F", ln, 0.01, 0.1), M["M_Rubber"], exp)
    bevel(box("WALL_F_band_kick", _wp("F", xc, 0.08, F + 0.15), _ws("F", ln, 0.06, 0.1), M["M_MetalBare"], exp), 0.012)
    zm = (BAND_Z0 + BAND_Z1) / 2
    hm = BAND_Z1 - BAND_Z0
    ctrl = BAND_TYPES.index("control")
    for i, (a0, a1, kind) in enumerate(WINDOW_BAND):
        a0, a1 = a0 + 0.05, a1 - 0.05
        ac, w = (a0 + a1) / 2, a1 - a0
        n = f"WALL_F_band_{i}_{kind}"
        # same frame on every module -> the modularity reads first, the type second
        for s in (-1, 1):
            box(f"{n}_frame_{s:+d}", _wp("F", ac + s * (w / 2 - 0.03), 0.09, zm), _ws("F", 0.06, 0.06, hm), M["M_MetalDark"], exp)
            box(f"{n}_frame_h_{s:+d}", _wp("F", ac, 0.09, zm + s * (hm / 2 - 0.03)), _ws("F", w, 0.06, 0.06), M["M_MetalDark"], exp)
        iw, ih = w - 0.12, hm - 0.12                                 # opening inside the frame
        if kind == "vent":
            box(f"{n}_well", _wp("F", ac, 0.045, zm), _ws("F", iw, 0.006, ih), M["M_Rubber"], exp)
            louvre(f"{n}_louvre", "+y", ac, iw - 0.04, BAND_Z0 + 0.08, BAND_Z1 - 0.08, _plane("F", 0.07), M, exp)
        elif kind == "blank":                                        # blind panel: a pause in the rhythm, no features
            bevel(box(n, _wp("F", ac, 0.07, zm), _ws("F", iw, 0.03, ih), M["M_MetalDark"], exp), 0.012)
        elif kind == "service":                                      # hinged service panel
            bevel(box(n, _wp("F", ac, 0.075, zm), _ws("F", iw, 0.04, ih), M["M_MetalLight"], exp), 0.012)
            for s in (-1, 1):
                box(f"{n}_latch_{s:+d}", _wp("F", ac + s * (iw / 2 - 0.1), 0.1, zm + 0.12), _ws("F", 0.05, 0.02, 0.09),
                    M["M_MetalDark"], exp)
            box(f"{n}_handle", _wp("F", ac, 0.105, zm - 0.12), _ws("F", 0.3, 0.02, 0.035), M["M_MetalBare"], exp)
            box(f"{n}_label", _wp("F", ac, 0.097, zm + 0.12), _ws("F", 0.3, 0.004, 0.08), M["M_Hazard"], exp)
        else:                                                        # control: proud module with a diagnostic panel
            bevel(box(n, _wp("F", ac, 0.1, zm), _ws("F", iw, 0.12, ih), M["M_MetalDark"], exp), 0.03)
            box(f"{n}_screen", _wp("F", ac - 0.1, 0.162, zm + 0.06), _ws("F", 0.48, 0.004, 0.24), M["M_ScreenStatic"], exp)
            box(f"LIGHTS_{n}_status_bar", _wp("F", ac - 0.1, 0.162, zm - 0.14), _ws("F", 0.48, 0.004, 0.025), M["M_ScreenStatic"],
                exp)
            for r in range(2):
                box(f"{n}_key_{r}", _wp("F", ac + 0.3, 0.168, zm + 0.1 - r * 0.1), _ws("F", 0.08, 0.016, 0.06), M["M_MetalBare"], exp)
            box(f"{n}_button", _wp("F", ac + 0.3, 0.168, zm - 0.12), _ws("F", 0.08, 0.02, 0.06), M["M_Beacon"], exp)
    for k in range(len(WINDOW_BAND) + 1):                            # pilasters on the module grid (ends included)
        a = BAND_X0 + k * BAND_PITCH
        bevel(box(f"WALL_F_band_pilaster_{k}", _wp("F", a, 0.06, (F + top) / 2), _ws("F", 0.1, 0.12, top - F), M["M_MetalDark"],
                  exp), 0.012)
        if k in (ctrl, ctrl + 1):                                    # thin status lines frame the control section only
            box(f"LIGHTS_band_pilaster_{k}", _wp("F", a, 0.122, zm), _ws("F", 0.02, 0.004, hm - 0.1), M["M_ScreenStatic"], exp)
    # raceway along the whole band + light under the ledge
    rz = F + 0.9
    bevel(box("WALL_F_band_raceway", _wp("F", xc, 0.11, rz), _ws("F", ln, 0.1, 0.08), M["M_MetalDark"], exp), 0.012)
    box("WALL_F_band_raceway_cover", _wp("F", xc, 0.162, rz), _ws("F", ln - 0.05, 0.006, 0.05), M["M_MetalLight"], exp)
    box("LIGHTS_band_under_ledge", _wp("F", xc, 0.2, 2.095), _ws("F", ln - 0.1, 0.03, 0.012), M["M_LightWarm"], exp)
    _preview_light("PREVIEW_band", xc, -YW + 0.35, 2.0, ln, 0.1, 60.0)


def build_interior_v2(M, exp, ref, door):
    """door = (DOOR_X, DOOR_W, DOOR_H) of the model."""
    door_x, door_w, door_h = door
    wall_in = YW
    pit = (door_x - door_w / 2 - 0.1, door_x + door_w / 2 + 0.1, wall_in - 4 * 0.3)
    build_floor(M, exp, pit)
    build_walls(M, exp, (door_x - door_w / 2, door_x + door_w / 2, door_h))
    segs = build_console(M, exp, ref)
    build_operator_mat(M, exp)
    build_service_console(M, exp)
    build_holo(M, exp)
    build_ceiling(M, exp)
    build_services(M, exp)
    build_entrance(M, exp, (door_x - door_w / 2, door_x + door_w / 2, door_h), pit)
    build_back_wall(M, exp, (door_x - door_w / 2, door_x + door_w / 2, door_h))
    build_surface_detail(M, exp, segs, (door_x - door_w / 2, door_x + door_w / 2, door_h))
    build_window_band(M, exp)
    build_ref(M, ref, door_x)
