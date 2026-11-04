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

from cc_lib import (CEIL, D, FLOOR_Z, FRAME_MINOR, LOUVRE_ANGLE, SHELL_INSET, WALL, W, bevel, boolean, box, cylinder,
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
    """Seams on the 1 x 1 m panel grid, orange perimeter line, dashed walkway, floor grilles."""
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
    # orange perimeter line, 0.5 m in from the walls
    ix, iy = XW - 0.5, YW - 0.5
    ring = [(-ix + 0.5, -iy), (ix - 0.5, -iy), (ix, -iy + 0.5), (ix, iy - 0.5), (ix - 0.5, iy), (-ix + 0.5, iy),
            (-ix, iy - 0.5), (-ix, -iy + 0.5)]
    k = 0
    for i in range(len(ring)):
        for a, b in clipped(*ring[i], *ring[(i + 1) % len(ring)]):
            _seg(f"FLOOR_marking_perimeter_{k}", a, b, 0.1, z + 0.001, 0.004, M["M_PaintOrange"], exp)
            k += 1
    # dashed walkway (white): stair pit -> console, branch to the holo platform
    path = [((px0 + px1) / 2, py0 - 0.2), ((px0 + px1) / 2, -0.95), (CONSOLE_X + 0.6, -0.95)]
    branch = [((px0 + px1) / 2, -0.95), (HOLO_XY[0] - 1.95, -0.95)]
    k = 0
    for poly in (path, branch):
        for (a, b) in zip(poly[:-1], poly[1:]):
            ln = math.dist(a, b)
            n = int(ln / 0.6)
            for i in range(n):
                t0, t1 = i * 0.6 / ln, (i * 0.6 + 0.38) / ln
                p0 = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
                p1 = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
                _seg(f"FLOOR_marking_walkway_{k}", p0, p1, 0.08, z + 0.001, 0.004, M["M_Decal"], exp)
                k += 1
    # floor grilles: recessed dark plate + flat bare-metal bars
    for g, (x, y) in enumerate(((-5.9, -1.15), (1.5, 2.2))):
        bevel(box(f"FLOOR_grille_{g}_frame", (x, y, F + 0.004), (1.1, 0.6, 0.012), M["M_MetalDark"], exp), 0.012)
        for i in range(8):
            box(f"FLOOR_grille_{g}_bar_{i}", (x - 0.42 + i * 0.12, y, F + 0.012), (0.03, 0.5, 0.008), M["M_MetalBare"], exp)
    # holo platform floor plate with an orange octagon edge
    hx, hy = HOLO_XY
    prism("FLOOR_holo_plate", octagon(1.9, hx, hy), "z", F, F + 0.012, M["M_MetalDark"], exp)
    ring = prism("FLOOR_marking_holo_ring", octagon(1.95, hx, hy), "z", F + 0.012, F + 0.016, M["M_PaintOrange"], exp)
    boolean(ring, prism("tmp_hr", octagon(1.83, hx, hy), "z", F, F + 0.1, None, exp))


# ---------------------------------------------------------------------------------------------------------
def build_walls(M, exp, door):
    """Modular wall lining: dark dado with intake louvres + orange upper panels with dark inset stripes.
    Side walls and the back wall; the window wall gets dado panels where the console does not stand."""
    door_x0, door_x1, door_h = door
    dz1 = F + 0.9                       # dado top
    uz0, uz1 = dz1 + 0.06, WALL_TOP - 0.15

    def panel_run(prefix, axis, sign, spans, skip_upper=()):
        for i, (a0, a1) in enumerate(spans):
            a0, a1 = a0 + 0.03, a1 - 0.03
            ac, ln = (a0 + a1) / 2, a1 - a0
            if axis == "x":      # side wall, panels run along y
                plane = sign * XW
                c = lambda t, z, d: (plane - sign * d / 2, ac, z)           # noqa: E731
                size = lambda d, h: (d, ln, h)                              # noqa: E731
                side = "+x" if sign < 0 else "-x"
            else:                # back / front wall, panels run along x
                plane = sign * YW
                c = lambda t, z, d: (ac, plane - sign * d / 2, z)           # noqa: E731
                size = lambda d, h: (ln, d, h)                              # noqa: E731
                side = "+y" if sign < 0 else "-y"
            bevel(box(f"{prefix}_dado_{i}", c(0, (F + dz1) / 2, 0.06), size(0.06, dz1 - F), M["M_MetalDark"], exp), 0.012)
            pl = (plane - sign * 0.075)
            louvre(f"{prefix}_dado_{i}_vent", side, ac, min(ln - 0.3, 0.9), F + 0.25, F + 0.61, pl, M, exp)
            if i in skip_upper:
                continue
            bevel(box(f"{prefix}_upper_{i}", c(0, (uz0 + uz1) / 2, 0.05), size(0.05, uz1 - uz0), M["M_PaintOrange"], exp),
                  0.03)
            bevel(box(f"{prefix}_upper_{i}_stripe", c(0, uz0 + 0.55, 0.07), size(0.07, 0.18), M["M_MetalDark"], exp),
                  0.012)
        # cornice under the ceiling chamfer
        a0, a1 = spans[0][0], spans[-1][1]
        if axis == "x":
            box(f"{prefix}_cornice", (sign * (XW - 0.05), (a0 + a1) / 2, WALL_TOP - 0.08), (0.1, a1 - a0, 0.1),
                M["M_MetalDark"], exp)
        else:
            box(f"{prefix}_cornice", ((a0 + a1) / 2, sign * (YW - 0.05), WALL_TOP - 0.08), (a1 - a0, 0.1, 0.1),
                M["M_MetalDark"], exp)

    side_spans = [(-2.65, -1.35), (-1.35, 0.0), (0.0, 1.35), (1.35, 2.65)]
    panel_run("WALL_L", "x", -1, side_spans)
    panel_run("WALL_R", "x", 1, side_spans, skip_upper=(2,))        # cable duct runs in front of panel 2
    back_spans = [(-6.65, -5.3), (-5.3, -3.95), (-3.95, door_x0 - 0.35), (door_x1 + 0.35, 1.55), (1.55, 2.9),
                  (2.9, 4.25), (4.25, 5.6), (5.6, 6.65)]
    panel_run("WALL_B", "y", 1, back_spans, skip_upper=(3, 4))        # logo panel there
    front_spans = [(0.45, 2.45), (2.45, 4.45), (4.45, 6.45)]          # under the window, right of the console
    for i, (a0, a1) in enumerate(front_spans):
        ac = (a0 + a1) / 2
        bevel(box(f"WALL_F_dado_{i}", (ac, -YW + 0.03, (F + 2.1) / 2), (a1 - a0 - 0.06, 0.06, 2.1 - F), M["M_MetalDark"],
                  exp), 0.012)
        louvre(f"WALL_F_dado_{i}_vent", "+y", ac, 1.2, F + 0.25, F + 0.61, -YW + 0.075, M, exp)
    # orange structural columns: window ends + back corners + door jambs
    for i, (x, y) in enumerate(((-6.75, -YW + 0.17), (6.75, -YW + 0.17), (-6.75, YW - 0.17), (6.75, YW - 0.17))):
        bevel(box(f"WALL_column_{i}", (x, y, (F + WALL_TOP) / 2), (0.32, 0.34, WALL_TOP - F), M["M_PaintOrange"], exp),
              0.03)
        box(f"WALL_column_{i}_stripe", (x, y - math.copysign(0.172, y), F + 0.5), (0.24, 0.004, 0.5), M["M_Hazard"], exp)
    # interior door frame (orange) over the stair pit
    for i, x in enumerate((door_x0 - 0.17, door_x1 + 0.17)):
        bevel(box(f"WALL_door_jamb_{i}", (x, YW - 0.08, door_h / 2), (0.3, 0.16, door_h), M["M_PaintOrange"], exp), 0.03)
    bevel(box("WALL_door_header", ((door_x0 + door_x1) / 2, YW - 0.08, door_h + 0.15),
              (door_x1 - door_x0 + 0.64, 0.16, 0.3), M["M_PaintOrange"], exp), 0.03)
    box("LIGHTS_door_inside", ((door_x0 + door_x1) / 2, YW - 0.165, door_h + 0.15), (1.2, 0.01, 0.08),
        M["M_LightWarm"], exp)
    # FICSIT logo panel on the back wall
    lx0, lx1 = door_x1 + 0.35, 2.9
    bevel(box("WALL_logo_panel", ((lx0 + lx1) / 2, YW - 0.04, (uz0 + uz1) / 2), (lx1 - lx0 - 0.06, 0.08, uz1 - uz0),
              M["M_MetalDark"], exp), 0.03)
    box("DECALS_logo_inside", ((lx0 + lx1) / 2, YW - 0.083, uz0 + 1.75), (1.6, 0.006, 0.5), M["M_Decal"], exp)
    for j in range(4):
        box(f"WALL_logo_panel_stripe_{j}", (lx0 + 0.4 + j * 0.22, YW - 0.083, uz0 + 1.2), (0.12, 0.006, 0.3),
            M["M_PaintOrange"], exp, rot=(0, math.radians(-25), 0))


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


def build_operator_mat(M, exp):
    """Anti-fatigue rubber mat where the operator stands (replaces the chair)."""
    x, y = OPERATOR_XY
    bevel(box("PROP_MAT_operator", (x, y + 0.15, F + 0.008), (2.6, 0.9, 0.016), M["M_Rubber"], exp), 0.012)
    for s_ in (-1, 1):
        box(f"PROP_MAT_operator_edge_{s_:+d}", (x, y + 0.15 + s_ * 0.44, F + 0.012), (2.6, 0.03, 0.01), M["M_Hazard"], exp)


def build_kiosk(M, exp):
    """Standing terminal at the left wall (concept: kiosk next to the console)."""
    x, y = -XW + 0.55, 0.6                # mid left wall (the console end tower took its old spot)
    bevel(box("KIOSK_base", (x, y, F + 0.04), (0.6, 0.5, 0.08), M["M_MetalDark"], exp), 0.012)
    bevel(box("KIOSK_column", (x, y, F + 0.55), (0.26, 0.22, 0.95), M["M_MetalDark"], exp), 0.03)
    box("KIOSK_column_trim", (x + 0.132, y, F + 0.55), (0.004, 0.18, 0.8), M["M_PaintOrange"], exp)
    bevel(box("KIOSK_head", (x + 0.05, y, F + 1.12), (0.18, 0.62, 0.42), M["M_MetalDark"], exp,
              rot=(0, math.radians(-35), 0)), 0.012)
    box("KIOSK_screen", (x + 0.105, y, F + 1.15), (0.01, 0.52, 0.32), M["M_ScreenStatic"], exp,
        rot=(0, math.radians(-35), 0))
    box("KIOSK_led", (x + 0.135, y + 0.22, F + 0.9), (0.004, 0.06, 0.03), M["M_Beacon"], exp)


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
    for i in range(24):                                          # scale ticks
        a = i * math.pi / 12
        box(f"HOLO_PROJECTION_tick_{i}", (hx + 1.23 * math.cos(a), hy + 1.23 * math.sin(a), F + 1.08),
            (0.06 if i % 3 else 0.12, 0.008, 0.006), M["M_Holo"], exp, rot_z=a)
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
    frame = prism("HOLO_PROJECTOR_frame", octagon(1.42, hx, hy), "z", zc - 0.05, zc, M["M_MetalDark"], exp)
    boolean(frame, prism("tmp_pf", octagon(1.2, hx, hy), "z", zc - 1, zc + 1, None, exp))
    for i in range(8):
        a = math.pi / 8 + i * math.pi / 4
        cylinder(f"HOLO_PROJECTOR_frame_bolt_{i}", (hx + 1.32 * math.cos(a), hy + 1.32 * math.sin(a), zc - 0.06), 0.025,
                 0.02, M["M_MetalBare"], exp, 8)
    for i in range(4):                                           # hangers from the frame to the drum
        a = i * math.pi / 2
        box(f"HOLO_PROJECTOR_hanger_{i}", (hx + 1.18 * math.cos(a), hy + 1.18 * math.sin(a), zc - 0.15), (0.08, 0.16, 0.2),
            M["M_MetalBare"], exp, rot_z=a)
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
    jx = hx + 1.3                                                # junction box where the ceiling tray arrives
    bevel(box("HOLO_PROJECTOR_junction", (jx, 0.6, zc - 0.17), (0.3, 0.36, 0.26), M["M_MetalDark"], exp), 0.012)
    box("HOLO_PROJECTOR_junction_led", (jx - 0.152, 0.6, zc - 0.17), (0.004, 0.06, 0.03), M["M_Beacon"], exp)


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
        if i == 3:     # holo projector cell: dark coffer plate, nothing else in this bay
            bevel(box("CEILING_projector_cell", (xc, 0.0, zc - 0.01), (bw - 0.32, 2.9, 0.02), M["M_MetalDark"], exp), 0.012)
            for s in (-1, 1):
                for t in (-1, 1):             # knee braces from the beams to the projector frame
                    box(f"CEILING_projector_brace_{s:+d}{t:+d}", (xc + s * 1.15, t * 1.25, zc - 0.1), (0.5, 0.08, 0.08),
                        M["M_MetalDark"], exp, rot_z=math.radians(45 * s * t))
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
    # service cabinets: two on the right wall (equipment / power), two at the back-right
    cabs = [((XW - 0.27, 1.25), (0.5, 0.9), math.radians(90)), ((XW - 0.27, 2.2), (0.5, 0.9), math.radians(90)),
            ((4.95, YW - 0.27), (0.9, 0.5), 0.0), ((5.9, YW - 0.27), (0.9, 0.5), 0.0)]
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
    # FICSIT crates in the back-left corner
    crates = [((-5.85, 2.75, F + 0.32), (0.9, 0.7, 0.64)), ((-4.85, 2.85, F + 0.28), (0.8, 0.6, 0.56)),
              ((-5.8, 2.75, F + 0.94), (0.7, 0.55, 0.6))]
    for i, ((x, y, z), (sx, sy, sz)) in enumerate(crates):
        bevel(box(f"PROP_CRATE_{i}", (x, y, z), (sx, sy, sz), M["M_MetalDark"], exp), 0.03)
        for s in (-1, 1):
            box(f"PROP_CRATE_{i}_band_{s:+d}", (x + s * (sx / 2 - 0.08), y, z), (0.1, sy + 0.02, sz + 0.02),
                M["M_PaintOrange"], exp)
        box(f"PROP_CRATE_{i}_label", (x, y - sy / 2 - 0.004, z + 0.05), (0.3, 0.006, 0.12), M["M_Decal"], exp)


def build_pit_guard(M, exp, pit):
    """Guard rails along both long sides of the stair pit + hazard nosing on every step."""
    px0, px1, py0 = pit
    for s, x in (("L", px0 - 0.05), ("R", px1 + 0.05)):
        for j, y in enumerate((py0, (py0 + YW) / 2, YW - 0.05)):
            cylinder(f"PIT_RAIL_{s}_post_{j}", (x, y, F + 0.5), 0.03, 1.0, M["M_PaintOrange"], exp, 8)
        for j, z in enumerate((F + 0.5, F + 1.0)):
            cylinder(f"PIT_RAIL_{s}_rail_{j}", (x, (py0 + YW) / 2, z), 0.025, YW - py0, M["M_PaintOrange"], exp, 8, axis="Y")
    for i in range(4):
        y = YW - 0.3 * i - 0.03
        box(f"DECALS_hazard_step_{i}", ((px0 + px1) / 2, y, 0.25 * (i + 1) + 0.003), (px1 - px0 - 0.1, 0.06, 0.006),
            M["M_Hazard"], exp)
    box("DECALS_hazard_pit_edge", ((px0 + px1) / 2, py0 + 0.04, F + 0.003), (px1 - px0, 0.08, 0.006), M["M_Hazard"], exp)


def build_ref(M, ref, door_x):
    """Reference objects (not exported): foundations and player capsules."""
    for i, x in enumerate((-4.0, 4.0)):
        box(f"REF_foundation_{i}", (x, 0, -0.5), (7.98, 7.98, 1.0), M["REF_Foundation"], ref)
    for nm, pos in (("REF_player_inside", (OPERATOR_XY[0] + 0.5, OPERATOR_XY[1], F)),
                    ("REF_player_outside", (-9.3, -4.6, 0.0))):
        cap = cylinder(nm, (pos[0], pos[1], pos[2] + 0.9), 0.3, 1.8, M["REF_Foundation"], ref, 12)   # 1.8 m pioneer
        cap.hide_render = nm.endswith("inside")   # scale check in the viewport; read as a stray column in renders


def build_interior_v2(M, exp, ref, door):
    """door = (DOOR_X, DOOR_W, DOOR_H) of the model."""
    door_x, door_w, door_h = door
    wall_in = YW
    pit = (door_x - door_w / 2 - 0.1, door_x + door_w / 2 + 0.1, wall_in - 4 * 0.3)
    build_floor(M, exp, pit)
    build_walls(M, exp, (door_x - door_w / 2, door_x + door_w / 2, door_h))
    build_console(M, exp, ref)
    build_operator_mat(M, exp)
    build_kiosk(M, exp)
    build_holo(M, exp)
    build_ceiling(M, exp)
    build_services(M, exp)
    build_pit_guard(M, exp, pit)
    build_ref(M, ref, door_x)
