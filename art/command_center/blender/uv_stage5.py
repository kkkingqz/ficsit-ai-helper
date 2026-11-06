"""Stage 5 UV pass + paint mask for SM_CommandCenter (runs inside Blender, called by build_model.build before export).

UV0 ("UVMap") per FACE by the face's material slot (rules and atlas cells: stage5_layout.py):
  tiling slots  -> exact planar projection on each face's own plane, TILE_M m per UV unit (uniform texel density);
  M_Hazard      -> planar on the plate, HAZARD_M m per UV unit;
  M_Decal       -> one decal-atlas cell per object;  M_ScreenStatic -> one screen-atlas cell per screen (LEDs -> strip);
  M_ScreenRT    -> 0..1;  light / beacon / holo -> 0..1.
Tiling UVs get a per-object random offset (stable hash of the name) so neighbouring parts do not repeat the same
2 m tile in phase; the material adds T_CC_Macro_M at UV / 8 for large-scale variation.
Paint mask: face-corner colour attribute "PaintMask" (R = primary M_PaintOrange, G = secondary M_PaintGray,
B = edge mask: the 45-degree chamfer faces made by bevel(), for paint wear / edge highlights in the master material).
"""
import json
import math
import os

import bmesh
import bpy  # noqa: F401
from mathutils import Vector

import cc_lib
import stage5_layout as L


def object_frame(ob):
    """Plane frame of a thin plate/screen: centre, normal (towards the viewer), up, right, and extents along them.
    Interior plates face the room centre, exterior plates face away from the building; 45-degree faces count as
    vertical; on near-horizontal faces 'up' points away from the viewer side."""
    me = ob.data
    mw = ob.matrix_world
    pts = [mw @ v.co for v in me.vertices]
    c = sum(pts, Vector()) / len(pts)
    best = max(me.polygons, key=lambda p: p.area)
    n = (mw.to_3x3() @ best.normal).normalized()
    xw = cc_lib.W / 2 - cc_lib.SHELL_INSET - cc_lib.WALL
    yw = cc_lib.D / 2 - cc_lib.SHELL_INSET - cc_lib.WALL
    outside = abs(c.x) > xw + 0.06 or abs(c.y) > yw + 0.06 or c.z > cc_lib.CEIL + 0.1
    if abs(n.z) > 0.8:
        n = n if n.z > 0 else -n
        up = Vector((0.0, -1.0 if c.y < 0 else 1.0, 0.0))
    else:
        to_c = Vector((-c.x, -c.y, 0.0))
        if (n.dot(to_c) < 0) != outside:
            n = -n
        up = Vector((0.0, 0.0, 1.0))
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n).normalized()
    us = [(p - c).dot(right) for p in pts]
    vs = [(p - c).dot(up) for p in pts]
    return c, n, up, right, (min(us), max(us), min(vs), max(vs))


def _face_frame(n):
    up = Vector((0.0, 1.0, 0.0)) if abs(n.z) > 0.9 else Vector((0.0, 0.0, 1.0))
    up = (up - n * up.dot(n)).normalized()
    return up, up.cross(n).normalized()


def _in_rect(uv01, rect):
    u0, v0, u1, v1 = rect
    return (u0 + uv01[0] * (u1 - u0), v0 + uv01[1] * (v1 - v0))


def apply_uvs(coll):
    stats = {}
    for ob in coll.objects:
        if ob.type != "MESH" or not ob.data.polygons:
            continue
        me = ob.data
        mw = ob.matrix_world
        rot = mw.to_3x3()
        uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
        me.uv_layers.active = uvl
        uvl.active_render = True
        frame = None
        dims = sorted(ob.dimensions, reverse=True)
        h = L.pick(ob.name, 1 << 20)
        off = ((h & 1023) / 1024.0, (h >> 10) / 1024.0)          # per-object tiling offset in [0, 1)
        mats = [m.name if m else "" for m in me.materials]
        for poly in me.polygons:
            slot = mats[poly.material_index] if poly.material_index < len(mats) else ""
            stats[slot] = stats.get(slot, 0) + 1
            if slot in L.TILING or slot not in ("M_Hazard", "M_Decal", "M_ScreenStatic", "M_ScreenRT") + L.PLANAR01:
                n = (rot @ poly.normal).normalized()
                up, right = _face_frame(n)
                for li in poly.loop_indices:
                    p = mw @ me.vertices[me.loops[li].vertex_index].co
                    uvl.data[li].uv = (p.dot(right) / L.TILE_M + off[0], p.dot(up) / L.TILE_M + off[1])
                continue
            if frame is None:
                frame = object_frame(ob)
            c, _, up, right, (u0, u1, v0, v1) = frame
            for li in poly.loop_indices:
                p = mw @ me.vertices[me.loops[li].vertex_index].co
                du, dv = (p - c).dot(right), (p - c).dot(up)
                if slot == "M_Hazard":
                    uvl.data[li].uv = (du / L.HAZARD_M, dv / L.HAZARD_M)
                    continue
                uv01 = ((du - u0) / max(u1 - u0, 1e-6), (dv - v0) / max(v1 - v0, 1e-6))
                if slot == "M_Decal":
                    uvl.data[li].uv = _in_rect(uv01, L.decal_rect(L.decal_cell_for(ob.name, dims)))
                elif slot == "M_ScreenStatic":
                    uvl.data[li].uv = _in_rect(uv01, L.screen_rect(L.screen_cell_for(ob.name, dims, (u1 - u0, v1 - v0))))
                else:                                            # RT screen, lights, beacon, holo: 0..1
                    uvl.data[li].uv = uv01
    return stats


EDGE_MAX_W = 0.09                     # widest chamfer face: tier 0.06 x sqrt(2) ~ 0.085
EDGE_ANGLE = (math.radians(25), math.radians(65))   # one-segment 45-degree chamfer against both neighbours


def chamfer_faces(me):
    """Indices of the narrow 45-degree faces created by bevel(): long thin faces whose neighbours across both long
    edges meet them at ~45 degrees (slats, cables and thin plates meet at 90 degrees and are not marked)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    out = set()
    for f in bm.faces:
        if len(f.edges) < 4:
            continue
        es = sorted(f.edges, key=lambda e: e.calc_length(), reverse=True)
        ln = es[0].calc_length()
        if ln < 1e-6:
            continue
        w = f.calc_area() / ln
        if w > EDGE_MAX_W or ln < 1.5 * w:
            continue
        if f.normal.length < 1e-6:
            continue
        angs = [f.normal.angle(o.normal) for e in es[:2] for o in e.link_faces if o is not f and o.normal.length > 1e-6]
        if len(angs) >= 2 and all(EDGE_ANGLE[0] <= a <= EDGE_ANGLE[1] for a in angs):
            out.add(f.index)
    bm.free()
    return out


def apply_paint_mask(coll):
    """R = primary paint (FICSIT orange slot), G = secondary paint (panel grey slot), B = chamfer (edge) faces."""
    edge_faces = 0
    for ob in coll.objects:
        if ob.type != "MESH" or not ob.data.polygons:
            continue
        me = ob.data
        attr = me.color_attributes.get("PaintMask") or me.color_attributes.new("PaintMask", "BYTE_COLOR", "CORNER")
        mats = [m.name if m else "" for m in me.materials]
        edges = chamfer_faces(me)
        edge_faces += len(edges)
        for poly in me.polygons:
            slot = mats[poly.material_index] if poly.material_index < len(mats) else ""
            b = 1.0 if poly.index in edges else 0.0
            col = (1.0, 0.0, b, 1.0) if slot == "M_PaintOrange" else (0.0, 1.0, b, 1.0) if slot == "M_PaintGray" \
                else (0.0, 0.0, b, 1.0)
            for li in poly.loop_indices:
                attr.data[li].color = col
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find("PaintMask")
    return edge_faces


# ---- material / texture manifest for the UE import (stage 7) -------------------------------------------------------
TEXTURES = {
    "T_CC_MetalDetail_M": {"size": 1024, "srgb": False, "compression": "Grayscale / Masks", "use": "detail multiplier"},
    "T_CC_MetalDetail_N": {"size": 1024, "srgb": False, "compression": "Normalmap (DXT5/BC5)",
                           "use": "tangent-space normal, DirectX (green = -Y), no flip on import"},
    "T_CC_MetalDetail_ARW": {"size": 1024, "srgb": False, "compression": "Masks (no sRGB)",
                             "use": "R ambient occlusion, G roughness (absolute), B wear mask"},
    "T_CC_Macro_M": {"size": 512, "srgb": False, "compression": "Grayscale / Masks",
                     "use": "large-scale variation, sample at UV0 / 8 (16 m per tile)"},
    "T_CC_Tread_M": {"size": 1024, "srgb": False, "compression": "Grayscale / Masks", "use": "diamond tread detail"},
    "T_CC_Tread_N": {"size": 1024, "srgb": False, "compression": "Normalmap (DXT5/BC5)", "use": "tread normal, DirectX"},
    "T_CC_Tread_ARW": {"size": 1024, "srgb": False, "compression": "Masks (no sRGB)", "use": "tread R AO, G roughness, B wear"},
    "T_CC_Brushed_M": {"size": 1024, "srgb": False, "compression": "Grayscale / Masks", "use": "brushed streaks, bare metal"},
    "T_CC_Brushed_N": {"size": 1024, "srgb": False, "compression": "Normalmap (DXT5/BC5)", "use": "brushed normal, DirectX"},
    "T_CC_Hazard_D": {"size": 512, "srgb": True, "compression": "Default (DXT1/BC1)", "use": "hazard stripes"},
    "T_CC_DecalAtlas_D": {"size": [4096, 2048], "srgb": True, "compression": "Default (DXT1/BC1)",
                          "use": "decal atlas (labels with pictograms, signs, tags, IDs, numbers, barcode, pictograms)"},
    "T_CC_ScreenAtlas_E": {"size": [4096, 2048], "srgb": True, "compression": "Default (DXT1/BC1)",
                           "use": "screen atlas, emissive (12 UIs + LED strip)"},
}


def write_manifest(path):
    """textures/manifest.json: which texture goes into which slot, colour-space flags and material parameters."""
    tiling = {"uv": "UV0", "tile_m": L.TILE_M, "detail": "T_CC_MetalDetail_M", "normal": "T_CC_MetalDetail_N",
              "arw": "T_CC_MetalDetail_ARW", "macro": "T_CC_Macro_M", "macro_uv_scale": 1 / 8}
    slots = {}
    for name in L.TILING:
        col = cc_lib.COLORS.get(name, (0.5, 0.5, 0.5, 1.0))
        slot = dict(tiling, base_color_linear=[round(c, 4) for c in col[:3]],
                    metallic=cc_lib.METALLIC.get(name, 0.0), roughness=cc_lib.ROUGHNESS.get(name, 0.55))
        wear = "wear = max(PaintMask.B * 0.7, ARW.B * 0.7) -> lerp to bare metal (0.45 grey, metallic 1)"
        if name == "M_PaintOrange":
            slot.update(paint="primary", paint_mask="PaintMask.R", edge_wear=wear, palette="ficsit_orange #F59B1B")
        elif name == "M_PaintGray":
            slot.update(paint="secondary", paint_mask="PaintMask.G", edge_wear=wear, palette="tech_grey #5B6470")
        elif name == "M_MetalDark":
            slot.update(palette="graphite #1F2329", note="dark PAINTED structural metal (metallic 0)")
        elif name == "M_MetalBare":
            slot.update(detail="T_CC_Brushed_M", normal="T_CC_Brushed_N", anisotropy=0.6,
                        palette="panel_grey #B7BDC4", note="brushed, anisotropic along U")
        elif name == "M_MetalTread":
            slot.update(detail="T_CC_Tread_M", normal="T_CC_Tread_N", arw="T_CC_Tread_ARW",
                        note="diamond tread plate: floor metal inserts (service areas), hatches, threshold, step treads")
        elif name == "M_Glass":
            slot = {"uv": "UV0", "translucent": True, "base_color_linear": [round(c, 4) for c in (0.55, 0.7, 0.8)],
                    "opacity": 0.08, "roughness": 0.05}
        slots[name] = slot
    slots["M_Hazard"] = {"uv": "UV0", "tile_m": L.HAZARD_M, "base_color": "T_CC_Hazard_D", "roughness": 0.6}
    slots["M_Decal"] = {"uv": "UV0 (atlas cells, stage5_layout.DECAL_CELLS)", "base_color": "T_CC_DecalAtlas_D",
                        "roughness": 0.6}
    slots["M_ScreenStatic"] = {"uv": "UV0 (atlas cells, stage5_layout.SCREEN_CELLS)", "emissive": "T_CC_ScreenAtlas_E",
                               "emissive_strength": 1.2}
    slots["M_ScreenRT"] = {"uv": "UV0 0..1", "emissive": "render target (FR-01 AI Terminal UMG)"}
    for name in ("M_LightWarm", "M_Beacon", "M_Holo"):
        col, strength = cc_lib.EMISSIVE[name]
        slots[name] = {"uv": "UV0 0..1", "emissive_color_linear": [round(c, 4) for c in col[:3]],
                       "emissive_strength": strength}
    slots["M_Holo"].update(translucent="additive", fresnel_edges=True)
    data = {"mesh": "SM_CommandCenter", "vertex_color": {"PaintMask": "R primary paint, G secondary paint, B chamfer edges"},
            "uv0": {"tiling_m_per_uv": L.TILE_M, "hazard_m_per_uv": L.HAZARD_M, "decal_atlas_px": [L.DECAL_W, L.DECAL_H], "screen_atlas_px": [L.SCREEN_W, L.SCREEN_H]},
            "palette": L.PALETTE, "textures": TEXTURES, "slots": slots}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
