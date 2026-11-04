"""Command Center — stage 4 interior (replaces the stage-1 interior of cc_interior.py in build_model.py).

Reference: interior concept sheet (main / alternative view, plan, console layout, section, interior modules).
The room size comes from the approved exterior (14.9 x 6.9 m, 4.8 m clear), not from the sheet's
approximate numbers; the sheet drives composition, modules and materials.

Layout (world coordinates, front = -Y = panoramic window):
    operator console  front-left under the window, curved: centre + two angled wings, 5 displays
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

from cc_lib import (CEIL, D, FLOOR_Z, FRAME_MINOR, SHELL_INSET, WALL, W, bevel, boolean, box, cylinder, louvre,
                    mesh_object, octagon, prism)

XW = W / 2 - SHELL_INSET - WALL          # inner face of the side walls (7.45)
YW = D / 2 - SHELL_INSET - WALL          # inner face of front/back walls (3.45)
F = FLOOR_Z + 0.02                       # floor surface
CORNER_IN = 0.76                         # inner 45° corner chamfer
WALL_TOP = 4.75                          # where the inner ceiling chamfers start (lowest of the three)

CONSOLE_X = -3.0                         # console centre (front-left)
CONSOLE_Y = -2.85                        # centre line of the centre segment
CONSOLE_W, CONSOLE_DEPTH, DESK_H = 3.2, 0.8, 0.88
WING_W, WING_ANGLE = 1.8, math.radians(25)
HOLO_XY = (3.2, 0.0)                     # holo platform centre (under the ceiling projector bay)
CHAIR_XY = (CONSOLE_X, -1.75)
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
def _console_segment(name, cx, cy, w, rot, M, exp):
    """Desk body + top + orange edge + inclined control panel with buttons + monitor riser + front details."""
    ca, sa = math.cos(rot), math.sin(rot)

    def P(lx, ly):           # local (along, depth: +towards operator) -> world xy
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca)

    d = CONSOLE_DEPTH
    rz = rot
    body = box(f"CONSOLE_BODY_{name}", (*P(0, 0), F + DESK_H / 2), (w, d, DESK_H), M["M_MetalDark"], exp, rot_z=rz)
    boolean(body, box("tmp_kick", (*P(0, d / 2), F + 0.05), (w + 0.1, 0.16, 0.1), M["M_Rubber"], exp, rot_z=rz))
    bevel(body, 0.03)
    bevel(box(f"CONSOLE_TOP_{name}", (*P(0, 0.04), F + DESK_H + 0.03), (w + 0.04, d + 0.1, 0.06), M["M_MetalLight"], exp,
              rot_z=rz), 0.012)
    box(f"CONSOLE_EDGE_{name}", (*P(0, d / 2 + 0.08), F + DESK_H + 0.03), (w + 0.04, 0.05, 0.07), M["M_PaintOrange"], exp,
        rot_z=rz)
    box(f"LIGHTS_console_{name}", (*P(0, d / 2 + 0.06), F + DESK_H - 0.02), (w - 0.1, 0.02, 0.02), M["M_LightWarm"], exp,
        rot_z=rz)
    # inclined control panel on the front half of the desk
    bevel(box(f"CONTROL_PANELS_{name}", (*P(0, 0.12), F + DESK_H + 0.1), (w - 0.25, 0.4, 0.05), M["M_MetalDark"], exp,
              rot=(math.radians(-14), 0, rz)), 0.012)
    nb = max(3, int((w - 0.5) / 0.16))
    for i in range(nb):
        lx = -(w - 0.5) / 2 + i * (w - 0.5) / (nb - 1)
        mat = M["M_Beacon"] if i % 4 == 0 else M["M_ScreenStatic"] if i % 3 == 0 else M["M_MetalBare"]
        box(f"CONTROL_PANELS_{name}_key_{i}", (*P(lx, 0.2), F + DESK_H + 0.135), (0.07, 0.07, 0.02), mat, exp,
            rot=(math.radians(-14), 0, rz))
    box(f"CONTROL_PANELS_{name}_screen", (*P(0, 0.02), F + DESK_H + 0.16), (min(w - 0.6, 0.9), 0.16, 0.01),
        M["M_ScreenStatic"], exp, rot=(math.radians(-14), 0, rz))
    # monitor riser at the back of the desk
    bevel(box(f"CONSOLE_RISER_{name}", (*P(0, -d / 2 + 0.06), F + DESK_H + 0.2), (w, 0.12, 0.34), M["M_MetalDark"], exp,
              rot_z=rz), 0.012)
    # front of the desk (operator side): hazard strip, louvre, two cabinet doors
    fy = d / 2 + 0.005
    box(f"CONSOLE_hazard_{name}", (*P(0, fy), F + 0.24), (w - 0.5, 0.01, 0.12), M["M_Hazard"], exp, rot_z=rz)
    for j, lx in enumerate((-w / 4, w / 4)):
        bevel(box(f"CONSOLE_door_{name}_{j}", (*P(lx, fy), F + 0.58), (w / 2 - 0.12, 0.02, 0.42), M["M_MetalLight"], exp,
                  rot_z=rz), 0.012)
        box(f"CONSOLE_door_{name}_{j}_handle", (*P(lx + (0.2 if j == 0 else -0.2), fy + 0.02), F + 0.58),
            (0.04, 0.02, 0.18), M["M_MetalBare"], exp, rot_z=rz)
    return P


def _monitor(name, center_xy, z0, w, h, rot, screen_mat, exp, M, stand=True):
    """Frame + screen plane facing the operator (+local depth) + stand post."""
    ca, sa = math.cos(rot), math.sin(rot)
    off = lambda d: (center_xy[0] - d * sa, center_xy[1] + d * ca)       # noqa: E731
    zc = z0 + h / 2
    bevel(box(f"DISPLAY_FRAMES_{name}", (*off(0.0), zc), (w + 0.1, 0.06, h + 0.1), M["M_MetalDark"], exp, rot_z=rot),
          0.012)
    box(f"DISPLAY_{name}" if name == "MAIN_RT" else f"DISPLAY_PLANES_{name}", (*off(0.032), zc), (w, 0.01, h),
        screen_mat, exp, rot_z=rot)
    if stand:
        box(f"DISPLAY_FRAMES_{name}_stand", (*off(-0.06), z0 - 0.15), (0.12, 0.06, 0.32), M["M_MetalBare"], exp, rot_z=rot)


def build_console(M, exp, ref):
    """Curved operator console: centre segment + two wings angled towards the operator; five displays."""
    P0 = _console_segment("centre", CONSOLE_X, CONSOLE_Y, CONSOLE_W, 0.0, M, exp)
    wings = []
    for s, nm in ((-1, "left"), (1, "right")):
        inner = (CONSOLE_X + s * CONSOLE_W / 2, CONSOLE_Y)
        cx = inner[0] + s * math.cos(WING_ANGLE) * WING_W / 2
        cy = inner[1] + math.sin(WING_ANGLE) * WING_W / 2
        wings.append((nm, _console_segment(nm, cx, cy, WING_W, s * WING_ANGLE, M, exp), s))
    zt = F + DESK_H + 0.37                                      # top of the riser
    # main render-target display (16:9, own slot, UV 0-1 on the plane) + two flanking + one per wing
    _monitor("MAIN_RT", P0(0, -CONSOLE_DEPTH / 2 + 0.06), zt + 0.12, 2.4, 2.4 * 9 / 16, 0.0, M["M_ScreenRT"], exp, M)
    for i, lx in enumerate((-1.48, 1.48)):
        _monitor(f"centre_{i}", P0(lx, -CONSOLE_DEPTH / 2 + 0.06), zt + 0.12, 0.3, 0.9, 0.0, M["M_ScreenStatic"], exp, M,
                 stand=False)
    for nm, P, s in wings:
        _monitor(f"wing_{nm}", P(0, -CONSOLE_DEPTH / 2 + 0.06), zt + 0.12, 1.45, 1.45 * 9 / 16, s * WING_ANGLE,
                 M["M_ScreenStatic"], exp, M)
    # interaction zone for E (reference only, not exported)
    use = box("USE_ZONE_console", (CONSOLE_X, -1.75, F + 1.1), (6.0, 1.3, 2.2), None, ref)
    use.display_type = "WIRE"
    use.hide_render = True


def build_chair(M, exp):
    """Operator chair facing the console: five-star base, column, seat, backrest, headrest, armrests."""
    cx, cy = CHAIR_XY
    for i in range(5):
        a = math.radians(90 + i * 72)
        box(f"PROP_CHAIR_leg_{i}", (cx + 0.16 * math.cos(a), cy + 0.16 * math.sin(a), F + 0.07), (0.34, 0.06, 0.04),
            M["M_MetalDark"], exp, rot_z=a)
        cylinder(f"PROP_CHAIR_caster_{i}", (cx + 0.32 * math.cos(a), cy + 0.32 * math.sin(a), F + 0.03), 0.03, 0.05,
                 M["M_Rubber"], exp, 8, axis="X")
    cylinder("PROP_CHAIR_column", (cx, cy, F + 0.27), 0.035, 0.36, M["M_MetalBare"], exp, 10)
    bevel(box("PROP_CHAIR_seat", (cx, cy, F + 0.5), (0.52, 0.5, 0.1), M["M_Rubber"], exp), 0.03)
    box("PROP_CHAIR_seat_trim", (cx, cy, F + 0.44), (0.54, 0.52, 0.03), M["M_PaintOrange"], exp)
    bevel(box("PROP_CHAIR_back", (cx, cy + 0.27, F + 0.9), (0.48, 0.08, 0.65), M["M_Rubber"], exp,
              rot=(math.radians(-10), 0, 0)), 0.03)
    bevel(box("PROP_CHAIR_back_shell", (cx, cy + 0.32, F + 0.9), (0.5, 0.03, 0.62), M["M_PaintOrange"], exp,
              rot=(math.radians(-10), 0, 0)), 0.012)
    box("PROP_CHAIR_back_label", (cx, cy + 0.338, F + 1.0), (0.26, 0.004, 0.08), M["M_Decal"], exp,
        rot=(math.radians(-10), 0, 0))
    bevel(box("PROP_CHAIR_headrest", (cx, cy + 0.34, F + 1.33), (0.3, 0.08, 0.16), M["M_Rubber"], exp), 0.012)
    for s in (-1, 1):
        box(f"PROP_CHAIR_arm_{s:+d}", (cx + s * 0.28, cy + 0.02, F + 0.68), (0.05, 0.36, 0.04), M["M_MetalDark"], exp)
        box(f"PROP_CHAIR_arm_post_{s:+d}", (cx + s * 0.28, cy + 0.12, F + 0.59), (0.03, 0.03, 0.16), M["M_MetalDark"], exp)


def build_kiosk(M, exp):
    """Standing terminal at the left wall (concept: kiosk next to the console)."""
    x, y = -XW + 0.55, -1.3
    bevel(box("KIOSK_base", (x, y, F + 0.04), (0.6, 0.5, 0.08), M["M_MetalDark"], exp), 0.012)
    bevel(box("KIOSK_column", (x, y, F + 0.55), (0.26, 0.22, 0.95), M["M_MetalDark"], exp), 0.03)
    box("KIOSK_column_trim", (x + 0.132, y, F + 0.55), (0.004, 0.18, 0.8), M["M_PaintOrange"], exp)
    bevel(box("KIOSK_head", (x + 0.05, y, F + 1.12), (0.18, 0.62, 0.42), M["M_MetalDark"], exp,
              rot=(0, math.radians(-35), 0)), 0.012)
    box("KIOSK_screen", (x + 0.105, y, F + 1.15), (0.01, 0.52, 0.32), M["M_ScreenStatic"], exp,
        rot=(0, math.radians(-35), 0))
    box("KIOSK_led", (x + 0.135, y + 0.22, F + 0.9), (0.004, 0.06, 0.03), M["M_Beacon"], exp)


def build_holo(M, exp):
    """Holo platform: two-tier octagonal pedestal, emitter, floating island projection with rings, beam,
    and the ceiling projector above it."""
    hx, hy = HOLO_XY
    prism("HOLO_PEDESTAL", octagon(1.35, hx, hy), "z", F, F + 0.22, M["M_MetalDark"], exp)
    mid = prism("HOLO_PEDESTAL_body", octagon(1.18, hx, hy), "z", F + 0.22, F + 0.78, M["M_MetalDark"], exp)
    bevel(mid, 0.03)
    prism("HOLO_PEDESTAL_band", octagon(1.24, hx, hy), "z", F + 0.6, F + 0.74, M["M_PaintOrange"], exp)
    prism("HOLO_PEDESTAL_top", octagon(1.25, hx, hy), "z", F + 0.78, F + 0.86, M["M_MetalLight"], exp)
    for i in range(8):                       # light strip + vent on every facet
        a = math.pi / 8 + i * math.pi / 4 + math.pi / 8
        r = 1.18 * math.cos(math.pi / 8)
        px, py = hx + (r + 0.005) * math.cos(a), hy + (r + 0.005) * math.sin(a)
        box(f"HOLO_PEDESTAL_light_{i}", (px, py, F + 0.47), (0.01, 0.5, 0.06), M["M_LightWarm"], exp, rot_z=a)
        box(f"HOLO_PEDESTAL_vent_{i}", (px, py, F + 0.33), (0.01, 0.6, 0.12), M["M_Rubber"], exp, rot_z=a)
    cylinder("HOLO_EMITTER", (hx, hy, F + 0.89), 0.95, 0.04, M["M_Holo"], exp, 32)
    ring = cylinder("HOLO_EMITTER_ring", (hx, hy, F + 0.9), 1.08, 0.05, M["M_MetalBare"], exp, 32)
    boolean(ring, cylinder("tmp_er", (hx, hy, F + 0.9), 0.98, 0.2, None, exp, 32))
    # projection: floating island (terrain cone on top, rock cone below) + two orbit rings
    bm = bmesh.new()
    top = bmesh.ops.create_cone(bm, cap_ends=False, segments=9, radius1=0.75, radius2=0.0, depth=0.85)
    bmesh.ops.translate(bm, vec=(0, 0, 0.425), verts=top["verts"])
    for v in top["verts"]:                    # jagged ridge line
        if v.co.z > 0.01:
            v.co.x *= 1.0 + 0.25 * math.sin(v.co.y * 9)
    low = bmesh.ops.create_cone(bm, cap_ends=False, segments=9, radius1=0.0, radius2=0.75, depth=0.45)
    bmesh.ops.translate(bm, vec=(0, 0, -0.225), verts=low["verts"])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.translate(bm, vec=(hx, hy, F + 2.0), verts=bm.verts)
    mesh_object("HOLO_PROJECTION", bm, M["M_Holo"], exp)
    for i, (r, z) in enumerate(((1.15, F + 1.85), (0.9, F + 2.35))):
        rr = cylinder(f"HOLO_PROJECTION_ring_{i}", (hx, hy, z), r, 0.02, M["M_Holo"], exp, 40)
        boolean(rr, cylinder("tmp_pr", (hx, hy, z), r - 0.04, 0.2, None, exp, 40))
    # beam = ring of thin light strips (a solid translucent cylinder hid the projection)
    bz0, bz1 = F + 0.92, CEIL - 0.31
    for i in range(12):
        a = i * math.pi / 6
        box(f"HOLO_BEAM_{i}", (hx + 0.82 * math.cos(a), hy + 0.82 * math.sin(a), (bz0 + bz1) / 2), (0.012, 0.05, bz1 - bz0),
            M["M_Holo"], exp, rot_z=a)
    # ceiling projector
    bevel(cylinder("HOLO_PROJECTOR", (hx, hy, CEIL - 0.15), 1.25, 0.3, M["M_MetalDark"], exp, 32), 0.03)
    cylinder("HOLO_PROJECTOR_band", (hx, hy, CEIL - 0.2), 1.28, 0.08, M["M_PaintOrange"], exp, 32)
    cylinder("HOLO_PROJECTOR_lens", (hx, hy, CEIL - 0.305), 0.85, 0.01, M["M_Holo"], exp, 32)
    r2 = cylinder("HOLO_PROJECTOR_ring", (hx, hy, CEIL - 0.31), 1.05, 0.02, M["M_LightWarm"], exp, 32)
    boolean(r2, cylinder("tmp_pjr", (hx, hy, CEIL - 0.31), 0.97, 0.2, None, exp, 32))


def build_ceiling(M, exp):
    """Transverse beams, recessed light panels in the bays, cable tray from the right-wall duct to the projector."""
    zc = CEIL
    for i, x in enumerate(BEAMS_X):
        bevel(box(f"CEILING_beam_{i}", (x, 0.05, zc - 0.1), (0.26, 4.9, 0.2), M["M_MetalDark"], exp), 0.012)
    lights = [(-5.65, 0.0, 1.3), (-3.2, -1.2, 2.4), (-3.2, 1.2, 2.4), (0.0, -1.2, 2.4), (0.0, 1.2, 2.4), (5.65, 0.0, 1.3)]
    for i, (x, y, w) in enumerate(lights):
        bevel(box(f"CEILING_light_{i}_frame", (x, y, zc - 0.03), (w + 0.12, 0.72, 0.06), M["M_MetalDark"], exp), 0.012)
        box(f"LIGHTS_ceiling_{i}", (x, y, zc - 0.065), (w, 0.6, 0.02), M["M_LightWarm"], exp)
        L = bpy.data.lights.new(f"PREVIEW_area_{i}", "AREA")      # preview light only (not exported: not a mesh)
        L.energy, L.size, L.size_y, L.shape = 180.0, w, 0.6, "RECTANGLE"
        ob = bpy.data.objects.new(f"PREVIEW_area_{i}", L)
        ob.location = (x, y, zc - 0.1)
        bpy.context.scene.collection.objects.link(ob)
    # cable tray: right wall duct -> projector
    x0, x1 = HOLO_XY[0] + 1.25, XW - 0.3
    bevel(box("CEILING_cable_tray", ((x0 + x1) / 2, 0.6, zc - 0.07), (x1 - x0, 0.3, 0.1), M["M_MetalDark"], exp), 0.012)
    box("CEILING_cable_tray_cover", ((x0 + x1) / 2, 0.6, zc - 0.125), (x1 - x0 - 0.06, 0.24, 0.01), M["M_MetalLight"], exp)


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
    for nm, pos in (("REF_player_inside", (CHAIR_XY[0] + 0.9, CHAIR_XY[1] + 0.6, F)),
                    ("REF_player_outside", (-9.3, -4.6, 0.0))):
        cap = cylinder(nm, (pos[0], pos[1], pos[2] + 0.9), 0.3, 1.8, M["M_Rubber"], ref, 12)
        cap.hide_render = nm.endswith("inside")       # scale reference in the viewport, out of interior renders


def build_interior_v2(M, exp, ref, door):
    """door = (DOOR_X, DOOR_W, DOOR_H) of the model."""
    door_x, door_w, door_h = door
    wall_in = YW
    pit = (door_x - door_w / 2 - 0.1, door_x + door_w / 2 + 0.1, wall_in - 4 * 0.3)
    build_floor(M, exp, pit)
    build_walls(M, exp, (door_x - door_w / 2, door_x + door_w / 2, door_h))
    build_console(M, exp, ref)
    build_chair(M, exp)
    build_kiosk(M, exp)
    build_holo(M, exp)
    build_ceiling(M, exp)
    build_services(M, exp)
    build_pit_guard(M, exp, pit)
    build_ref(M, ref, door_x)
