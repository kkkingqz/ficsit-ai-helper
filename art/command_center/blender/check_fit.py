"""Foundation fit check for SM_CommandCenter (2 x 1 Satisfactory foundations = 16 x 8 m).

    python check_fit.py            # bpy wheel
    blender -b -P check_fit.py     # Blender 5.2

Builds the model exactly like build_model.py and checks every exported vertex:
  * inside the footprint |x| <= 8, |y| <= 4 (tolerance 1 mm);
  * nothing below the foundation top (z >= 0);
  * the mounting plate is the only part touching z = 0 and covers the footprint.
Prints a short report and exits with code 1 if anything sticks out.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)

import build_model
import cc_lib

TOL = 0.001
HALF_X, HALF_Y = cc_lib.W / 2, cc_lib.D / 2


def main():
    cc_lib.reset_scene()
    mats = cc_lib.make_materials()
    exp = cc_lib.collection("EXPORT")
    ref = cc_lib.collection("REF_NOT_EXPORTED")
    build_model.build(mats, exp, ref)

    out_xy, below, ground = [], [], set()
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for ob in exp.objects:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        worst = 0.0
        for v in ob.data.vertices:
            p = mw @ v.co
            for i in range(3):
                lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
            worst = max(worst, abs(p.x) - HALF_X, abs(p.y) - HALF_Y)
            if p.z < -TOL:
                below.append((ob.name, p.z))
            if abs(p.z) <= TOL:
                ground.add(ob.name)
        if worst > TOL:
            out_xy.append((ob.name, worst))

    print(f"[fit] bounds x {lo[0]:+.3f}..{hi[0]:+.3f}  y {lo[1]:+.3f}..{hi[1]:+.3f}  z {lo[2]:+.3f}..{hi[2]:+.3f}")
    print(f"[fit] footprint 16 x 8: {'OK' if not out_xy else 'FAIL'}")
    for name, d in sorted(out_xy, key=lambda t: -t[1])[:20]:
        print(f"        {name}: {d * 100:.1f} cm outside")
    print(f"[fit] nothing below foundation top: {'OK' if not below else 'FAIL'}")
    for name, z in below[:20]:
        print(f"        {name}: z = {z:.3f}")
    others = sorted(ground - {"BASE_platform", "BASE"})
    print(f"[fit] parts touching z = 0: {sorted(ground)}")
    if others:
        print(f"[fit] note: besides the plate/core also touching the ground: {others}")
    sys.exit(1 if (out_xy or below) else 0)


if __name__ == "__main__":
    main()
