"""Stage 5 UV / paint-mask check for SM_CommandCenter.

    python uv_check.py                                   # validate, print, write ../uv_check.md (exit 1 on errors)
    python uv_check.py --render ../renders/stage5 [--samples 16] [--shots a,b]   # + checker / atlas renders

Checks (on the exported collection, built exactly like build_model.py):
  1. every mesh has UV0 "UVMap" and the "PaintMask" colour attribute;
  2. tiling faces: texel density = 1 / TILE_M per metre within 1 % (UV area / surface area), no zero-area UV faces;
  3. decal / static-screen faces: every UV inside the object's atlas cell;
  4. DISPLAY_MAIN_RT: UV exactly spans 0..1 (render target);
  5. paint mask: primary = M_PaintOrange faces, secondary = M_PaintGray faces, nothing else painted.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401
from mathutils import Vector

import build_model
import cc_lib
import stage5_layout as L
import ui_preview

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = ("01_three_quarter", "09_rear_three_quarter", "21_interior_main", "23_interior_console", "42_interior_back_wall",
         "18_detail_back_door")


def _uv_area(uvs):
    a = 0.0
    for i in range(len(uvs)):
        x0, y0 = uvs[i]
        x1, y1 = uvs[(i + 1) % len(uvs)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


def check(coll):
    errors, stats = [], {"meshes": 0, "faces": 0, "tiling": 0, "atlas": 0, "slivers": 0}
    dens_lo, dens_hi = 1e9, 0.0
    target = 1.0 / L.TILE_M ** 2
    for ob in coll.objects:
        if ob.type != "MESH" or not ob.data.polygons:
            continue
        me = ob.data
        stats["meshes"] += 1
        uvl = me.uv_layers.get("UVMap")
        pm = me.color_attributes.get("PaintMask")
        if uvl is None or pm is None:
            errors.append(f"{ob.name}: missing {'UVMap' if uvl is None else 'PaintMask'}")
            continue
        mw = ob.matrix_world
        dims = sorted(ob.dimensions, reverse=True)
        mats = [m.name if m else "" for m in me.materials]
        uv_min, uv_max = Vector((9, 9)), Vector((-9, -9))
        for poly in me.polygons:
            stats["faces"] += 1
            slot = mats[poly.material_index] if poly.material_index < len(mats) else ""
            uvs = [tuple(uvl.data[li].uv) for li in poly.loop_indices]
            for u, v in uvs:
                uv_min.x, uv_min.y = min(uv_min.x, u), min(uv_min.y, v)
                uv_max.x, uv_max.y = max(uv_max.x, u), max(uv_max.y, v)
            col = pm.data[poly.loop_indices[0]].color
            want = (1, 0) if slot == "M_PaintOrange" else (0, 1) if slot == "M_PaintGray" else (0, 0)
            if (round(col[0]), round(col[1])) != want:
                errors.append(f"{ob.name}: paint mask {tuple(round(c) for c in col[:2])} on {slot}")
            area3 = (mw.to_3x3() @ poly.normal).length * poly.area if mw != mw.Identity(4) else poly.area
            if slot in L.TILING:
                stats["tiling"] += 1
                if area3 < 1e-4:                 # boolean slivers < 1 cm2 (< 5 x 5 px): mesh cleanup, stage 6
                    stats["slivers"] += 1
                    continue
                d = _uv_area(uvs) / area3
                if abs(d / target - 1) > 0.01:
                    errors.append(f"{ob.name}: texel density {math.sqrt(d) * L.TILE_M:.3f} x target on {slot}")
                dens_lo, dens_hi = min(dens_lo, d), max(dens_hi, d)
            elif slot in ("M_Decal", "M_ScreenStatic"):
                stats["atlas"] += 1
                rect = L.decal_rect(L.decal_cell_for(ob.name, dims)) if slot == "M_Decal" else \
                    L.screen_rect(L.screen_cell_for(ob.name, dims))
                for u, v in uvs:
                    if not (rect[0] - 1e-4 <= u <= rect[2] + 1e-4 and rect[1] - 1e-4 <= v <= rect[3] + 1e-4):
                        errors.append(f"{ob.name}: UV ({u:.3f}, {v:.3f}) outside its {slot} atlas cell")
                        break
        if ob.name == "DISPLAY_MAIN_RT":
            if (uv_min - Vector((0, 0))).length > 1e-4 or (uv_max - Vector((1, 1))).length > 1e-4:
                errors.append(f"DISPLAY_MAIN_RT: UV spans {tuple(uv_min)}..{tuple(uv_max)}, expected 0..1")
    stats["density"] = (math.sqrt(dens_lo) * L.TILE_M, math.sqrt(dens_hi) * L.TILE_M) if dens_hi else (0, 0)
    return errors, stats


def report(errors, stats, path):
    lo, hi = stats["density"]
    lines = ["# Проверка UV и маски покраски — SM_CommandCenter (этап 5)", "",
             f"Собрано и проверено `blender/uv_check.py`. Плотность тайлинга: 1 UV = {L.TILE_M} м "
             f"(текстура 1024 px → {1024 / L.TILE_M:.0f} px/м); полосы hazard: 1 UV = {L.HAZARD_M} м.", "",
             "| Проверка | Результат |", "|---|---|",
             f"| Мешей с UV0 `UVMap` и маской `PaintMask` | {stats['meshes']} |",
             f"| Граней всего / тайлинг / атласы | {stats['faces']} / {stats['tiling']} / {stats['atlas']} |",
             f"| Плотность на тайлинговых гранях (отн. цели) | {lo:.4f} … {hi:.4f} |",
             f"| Щепки после булевых операций (< 1 см², не проверяются; очистка сетки — этап 6) | {stats['slivers']} |",
             f"| Ошибок | {len(errors)} {'✅' if not errors else '⚠️'} |", ""]
    if errors:
        lines += ["## Ошибки", ""] + [f"- {e}" for e in errors[:200]]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", default=None)
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--shots", default=None)
    ap.add_argument("--report", default=os.path.join(HERE, "..", "uv_check.md"))
    a = ap.parse_args(sys.argv[1:])
    cc_lib.reset_scene()
    mats = cc_lib.make_materials()
    exp = cc_lib.collection("EXPORT")
    ref = cc_lib.collection("REF_NOT_EXPORTED")
    build_model.build(mats, exp, ref)
    errors, stats = check(exp)
    report(errors, stats, a.report)
    print(f"[uv] meshes {stats['meshes']}  faces {stats['faces']}  tiling {stats['tiling']}  atlas {stats['atlas']}  "
          f"density {stats['density'][0]:.4f}..{stats['density'][1]:.4f}  slivers {stats['slivers']}  errors {len(errors)}")
    for e in errors[:30]:
        print("   ", e)
    if a.render:
        for hook in cc_lib.PREVIEW_HOOKS:
            hook()
        ui_preview.apply_uv_checker()
        cc_lib.setup_render(samples=a.samples)
        cc_lib.render_all(a.render, a.shots.split(",") if a.shots else list(SHOTS))
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
