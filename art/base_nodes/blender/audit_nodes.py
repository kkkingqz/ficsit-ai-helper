"""Audit of the base-node holograms: where the triangles go and what is wasted.

    python audit_nodes.py [--node ore_mine] [--json ../audit.json]

Per mesh (full and _Mini): triangles, per-module triangle cost (each module built alone, with its rims), faces that can
never be seen (pointing down at ground level: the hologram is always seen from above its base), coplanar overlapping
faces (z-fighting in UE: two opaque faces in one plane), degenerate slivers, share of rim (bevel) triangles.
"""
import argparse
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402,F401
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import bn_geom as G  # noqa: E402
import bn_kit  # noqa: E402
import build_nodes as B  # noqa: E402

GROUND = 0.35          # top of the plate (0.3) + margin: downward faces below this are never visible


def make(tier, scale, disp, mini, modules=None):
    n = G.Node(rim=disp["rim_mm"] / 1000 / scale, outline=disp["outline_mm"] / 1000 / scale,
               thin_mul=disp["multi"]["thin_mul"] if mini else 1.0, mini=mini)
    for m in (modules if modules is not None else tier["modules"]):
        bn_kit.build(n, m)
    bm = n.finish()
    return bm, n


def analyse(bm, n, rim):
    bm.faces.ensure_lookup_table()
    tris = len(bm.faces)
    down = [f for f in bm.faces if f.normal.z < -0.9 and f.calc_center_median().z < GROUND]
    sliver = 0
    for f in bm.faces:
        a = f.calc_area()
        p = f.calc_perimeter()
        if a < 1e-8 or (p > 0 and a / (p * p) < 2e-4 and a < (rim * rim)):
            sliver += 1
    edge = sum(1 for f in bm.faces if f[n.edge] > 0.5)
    # coplanar overlaps: probe slightly in front of each face centre; another face of the same orientation within
    # 0.5 mm that also contains the probe point = two faces in one plane
    tree = BVHTree.FromBMesh(bm)
    coplanar = 0
    for f in bm.faces:
        if f.calc_area() < 1e-4:
            continue
        c = f.calc_center_median()
        hits = tree.find_nearest_range(c + f.normal * 2e-4, 6e-4)
        for co, nrm, idx, dist in hits:
            # dist ~ probe offset: the probe projects INTO the other face (a neighbour sharing an edge is farther)
            if idx != f.index and nrm.dot(f.normal) > 0.999 and dist < 2.6e-4:
                coplanar += 1
                break
    return {"tris": tris, "down_hidden": len(down), "coplanar": coplanar, "slivers": sliver, "rim_tris": edge}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--node")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    spec = B.load_spec()
    disp = spec["display"]
    single, multi, _ = B.scales(spec)
    report = {}
    by_type = defaultdict(int)
    cop_by_type = defaultdict(int)          # coplanar faces inside one module (the rest come from module overlaps)
    for key, node in spec["nodes"].items():
        if a.node and key != a.node:
            continue
        for tk, tier in node["tiers"].items():
            for mini in (False, True):
                sc = multi["5"] if mini else single[(key, tk)]
                bm, n = make(tier, sc, disp, mini)
                row = analyse(bm, n, n.rim)
                bm.free()
                mods = []
                if not mini:
                    for i, m in enumerate(tier["modules"]):
                        bmm, nn = make(tier, sc, disp, mini, [m])
                        t = len(bmm.faces)
                        cp = analyse(bmm, nn, nn.rim)["coplanar"]
                        bmm.free()
                        mods.append((t, f"{i}:{m['type']}"))
                        if cp:
                            cop_by_type[m["type"]] += cp
                        by_type[m["type"]] += t
                    mods.sort(reverse=True)
                    row["top_modules"] = mods[:6]
                name = B.mesh_name(node, tk, mini)
                report[name] = row
                print(f"{name:32s} tris {row['tris']:6d}  rim {row['rim_tris'] / max(1, row['tris']):4.0%}  "
                      f"hidden-down {row['down_hidden']:4d}  coplanar {row['coplanar']:4d}  slivers {row['slivers']:4d}"
                      + ("  top: " + ", ".join(f"{m} {t}" for t, m in row['top_modules']) if not mini else ""))
    print("\ntriangles by module type (full meshes, all nodes):")
    for t, v in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {t:12s} {v:7d}")
    print("\ncoplanar faces inside single modules:", dict(sorted(cop_by_type.items(), key=lambda x: -x[1])))
    if a.json:
        json.dump({"meshes": report, "by_type": by_type}, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
