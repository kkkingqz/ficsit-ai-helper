"""Build the base-node holograms from ../nodes.json: one mesh per node x tier for the single-node projector mode and a
lighter `_Mini` mesh for the multi-node mode (2-5 nodes), FBX export + manifest; optional renders.

    python build_nodes.py [--node central_hub] [--tiers 1,2,3] [--out ../export]
                          [--render ../renders] [--screens ../ue/screens] [--review] [--samples 16]

(run with the Python that has the bpy 5.2 module, or `blender -b -P build_nodes.py -- ...`)

Rim and outline widths are given in millimetres ON THE HOLOGRAM (nodes.json -> display) and converted to model metres
with the display scale of each mesh, so lines look equally thick on every tier and in both modes.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

import bn_geom as G  # noqa: E402
import bn_kit  # noqa: E402

SPEC_PATH = os.path.join(HERE, "..", "nodes.json")
MATERIAL = "M_HoloSolid"


def load_spec():
    with open(SPEC_PATH, encoding="utf-8") as f:
        return json.load(f)


def plate_radius(tier):
    p = next(m for m in tier["modules"] if m["type"] == "plate")
    return G.poly_radius(G.plate_poly(p))


def plate_outline(tier):
    """Plate outline in model metres after the tier yaw (links start on this edge)."""
    pts = G.plate_poly(next(m for m in tier["modules"] if m["type"] == "plate"))
    yaw = math.radians(tier.get("yaw", 0.0))
    c, s = math.cos(yaw), math.sin(yaw)
    return [(x * c - y * s, x * s + y * c) for x, y in pts]


def export_link_mesh(coll, mat, out):
    """SM_Holo_Link: flat strip 1 m along +X (forward axis of a spline mesh) x 1 m wide (Y -0.5..0.5), 8 segments,
    UV0 u 0..1 along X, v 0..1 across. The component bends it along the link and scales the width."""
    bm = bmesh.new()
    n = 8
    rows = [[bm.verts.new((i / n, y, 0.0)) for y in (0.5, -0.5)] for i in range(n + 1)]
    uv = bm.loops.layers.uv.new("UVMap")
    for i in range(n):
        f = bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = (co.x, 0.5 - co.y)
    me = bpy.data.meshes.new("SM_Holo_Link")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new("SM_Holo_Link", me)
    coll.objects.link(ob)
    path = export_fbx(ob, out)
    print("[nodes] link mesh", os.path.relpath(path, os.path.join(HERE, "..")))
    return ob


def scales(spec):
    """Display scales: single (per tier, fit) and multi (per layout, common for all nodes)."""
    d = spec["display"]
    r_all = max(plate_radius(t) for n in spec["nodes"].values() for t in n["tiers"].values())
    single = {}
    for key, node in spec["nodes"].items():
        for tk, t in node["tiers"].items():
            single[(key, tk)] = min(d["radius"] / plate_radius(t), d["max_height"] / t["size"][2])
    mm = d["multi"]
    multi = {n: lay["slot_radius"] * mm["margin"] / r_all for n, lay in mm["layouts"].items()}
    return single, multi, r_all


def mesh_name(node, tier, mini):
    return f"SM_Holo_{node['asset']}_T{tier}" + ("_Mini" if mini else "")


def build_mesh(node, tier_key, tier, scale, disp, mini, coll, mat):
    rim = disp["rim_mm"] / 1000.0 / scale
    outline = disp["outline_mm"] / 1000.0 / scale
    n = G.Node(rim=rim, outline=outline, thin_mul=disp["multi"]["thin_mul"] if mini else 1.0, mini=mini)
    for m in tier["modules"]:
        bn_kit.build(n, m)
    bm = n.finish()
    if tier.get("yaw"):                                     # turn the whole node (front portal towards -Y)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(tier["yaw"]), 3, "Z"))
    name = mesh_name(node, tier_key, mini)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def export_fbx(ob, out):
    os.makedirs(out, exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(out, ob.name + ".fbx")
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH"}, mesh_smooth_type="FACE",
                             apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y",
                             colors_type="LINEAR", prioritize_active_color=True)
    return path


def stats(ob):
    me = ob.data
    xs = [v.co for v in me.vertices]
    lo = [min(c[i] for c in xs) for i in range(3)]
    hi = [max(c[i] for c in xs) for i in range(3)]
    return {"tris": len(me.polygons), "verts": len(me.vertices),
            "bbox_min": [round(v, 2) for v in lo], "bbox_max": [round(v, 2) for v in hi],
            "radius_xy": round(max(math.hypot(c[0], c[1]) for c in xs), 2)}


def write_table(spec, single):
    """Rows of DT_BaseNodes (struct FFAIHBaseNodeVisual) as the JSON that DataTableFunctionLibrary imports.
    Lengths in cm (UE units); ScaleSingle is unitless (model and hologram are in the same units)."""
    ue = spec["ue"]
    root = ue["content_root"]
    fold = ue["folders"]

    def ref(folder, name):
        return f"{root}/{fold[folder]}/{name}.{name}"

    rows = []
    for key, node in spec["nodes"].items():
        for tk, tier in node["tiers"].items():
            a = node["asset"]
            rows.append({
                "Name": f"{key}_T{tk}",
                "NodeId": key,
                "Tier": int(tk),
                "DisplayName": f'NSLOCTEXT("{ue["loc_namespace"]}", "{key}.name", "{node["display_name"]["en"]}")',
                "TypeLabel": f'NSLOCTEXT("{ue["loc_namespace"]}", "{key}.type", "{node["type_label"]["en"]}")',
                "HoloMesh": ref("meshes", f"SM_Holo_{a}_T{tk}"),
                "HoloMeshMini": ref("meshes", f"SM_Holo_{a}_T{tk}_Mini"),
                "ScreenImage": ref("screens", f"T_Node_{a}_T{tk}_Screen"),
                "Icon": ref("icons", f"T_Node_{a}_T{tk}_Icon_256"),
                "PlateRadius": round(plate_radius(tier) * 100, 1),
                "Height": round(tier["size"][2] * 100, 1),
                "ScaleSingle": round(single[(key, tk)], 5),
                "PlateOutline": [{"X": round(x * 100, 1), "Y": round(y * 100, 1)} for x, y in plate_outline(tier)],
            })
    path = os.path.join(HERE, "..", "ue", "base_nodes_table.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    print(f"[nodes] table: {len(rows)} rows -> {os.path.relpath(path, os.path.join(HERE, '..'))}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--node", default=None)
    ap.add_argument("--tiers", default=None)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "export"))
    ap.add_argument("--render", default=None, help="review renders directory")
    ap.add_argument("--screens", default=None, help="prepared terminal-screen renders directory")
    ap.add_argument("--review", action="store_true", help="tier sheet + projector mock-ups (single / multi)")
    ap.add_argument("--turnaround", default=None, help="views from many angles: per-tier sheets + projector angles")
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--blend", action="store_true")
    a = ap.parse_args(argv)

    spec = load_spec()
    disp = spec["display"]
    single, multi, r_all = scales(spec)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = bpy.data.materials.new(MATERIAL)
    coll = bpy.data.collections.new("EXPORT")
    bpy.context.scene.collection.children.link(coll)

    built = {}
    manifest = {"display": {"radius": disp["radius"], "max_height": disp["max_height"], "base_z": disp["base_z"],
                            "largest_plate_radius": round(r_all, 2),
                            "scale_multi": {k: round(v, 5) for k, v in multi.items()}},
                "meshes": {}}
    for key, node in spec["nodes"].items():
        if a.node and key != a.node:
            continue
        for tk, tier in node["tiers"].items():
            if a.tiers and tk not in a.tiers.split(","):
                continue
            for mini in (False, True):
                sc = multi["5"] if mini else single[(key, tk)]
                ob = build_mesh(node, tk, tier, sc, disp, mini, coll, mat)
                path = export_fbx(ob, a.out)
                st = stats(ob)
                st.update({"node": key, "tier": int(tk), "mode": "multi" if mini else "single",
                           "fbx": os.path.relpath(path, os.path.join(HERE, "..")),
                           "rim_m": round(disp["rim_mm"] / 1000 / sc, 3)})
                if not mini:
                    st["scale_single"] = round(single[(key, tk)], 5)
                manifest["meshes"][ob.name] = st
                built[(key, tk, mini)] = ob
                print(f"[nodes] {ob.name}: tris={st['tris']} r={st['radius_xy']} h={st['bbox_max'][2]}")
    mpath = os.path.join(a.out, "manifest.json")
    if (a.node or a.tiers) and os.path.exists(mpath):       # partial build: keep the other nodes' entries
        old = json.load(open(mpath, encoding="utf-8"))
        old["meshes"].update(manifest["meshes"])
        manifest["meshes"] = dict(sorted(old["meshes"].items()))
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    if not a.node and not a.tiers:
        write_table(spec, single)
        link_mat = bpy.data.materials.new(spec["display"]["links"]["material"])
        export_link_mesh(coll, link_mat, a.out).hide_render = True
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, "base_nodes.blend"))

    if a.render or a.screens or a.turnaround:
        import bn_render
        bn_render.setup(mat, a.samples)
        if a.screens:
            bn_render.screens(spec, built, a.screens)
        if a.render and a.review:
            bn_render.review(spec, built, single, multi, a.render)
            bn_render.links_review(spec, built, single, multi, a.render, plate_outline)
        if a.turnaround:
            bn_render.turnaround(spec, built, single, multi, a.turnaround)


if __name__ == "__main__":
    main()
