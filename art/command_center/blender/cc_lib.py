"""Shared helpers for the Command Center Blender scripts (geometry, materials, export, render).

Imported by build_blockout.py and build_model.py; not meant to be run directly.
Conventions: metres, Z up, pivot = footprint centre at foundation top, front = -Y (see ../README.md).
"""
import argparse
import math
import os
import sys

import bpy  # must be imported before bmesh when running from the bpy wheel
import bmesh
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# Key dimensions (single source of truth for the blockout)
# ---------------------------------------------------------------------------
W, D = 16.0, 8.0            # footprint (X, Y)
FLOOR_Z = 1.0               # interior floor (4 recessed steps at the back door, no ladder)
BASE_H = 2.0                # dark plinth band outside (concept: "цоколь 2 м"); sill = floor + 1 m
SHELL_INSET = 0.2           # shell sits inside the plinth outline
WALL = 0.35                 # wall thickness
CEIL = 5.8                  # interior ceiling (clear height 4.8 m)
ROOF = 6.8                  # top of main roof slab (roof box adds 0.7 m)
CORNER = 0.9                # vertical corner chamfer (plan)

WIN_Z0, WIN_Z1 = 2.0, 5.4   # panoramic window band
WIN_X = 5.9                 # half width of the flat part of the window
MULLION_X = 2.4             # vertical mullions; angled ends -> 5 panes in total

DOOR_X, DOOR_W, DOOR_H = -1.0, 2.0, 2.8   # door at ground level, 4 steps inside

# Material families (final slot list, see ../README.md "Слоты материалов"). Linear-space approximations.
COLORS = {
    "M_PaintOrange": (0.93, 0.33, 0.016, 1.0),   # painted metal, FICSIT Orange #F79A22   (paint-gun primary)
    "M_PaintGray":   (0.105, 0.122, 0.147, 1.0), # painted metal, Panel Gray #5B626B      (paint-gun secondary)
    "M_MetalDark":   (0.027, 0.031, 0.039, 1.0), # structural dark metal #2E3238: frames, plinth, mullions
    "M_MetalBare":   (0.33, 0.35, 0.38, 1.0),    # clean bare metal #9AA0A6: pipes, bolts, slats, antennas
    "M_MetalLight":  (0.11, 0.13, 0.16, 1.0),    # legacy authoring slot, remapped to PaintGray / MetalBare
    "M_Rubber":      (0.011, 0.013, 0.015, 1.0), # rubber / composite #1C1E22: seals, cables, joints
    "M_Hazard":      (1.0, 0.58, 0.0, 1.0),      # service marking: black/yellow stripes #FFD200
    "M_Decal":       (0.79, 0.79, 0.79, 1.0),    # service marking: labels, text, pictograms #E6E6E6
    "REF_Foundation": (0.2, 0.2, 0.2, 1.0),      # reference foundations only (never exported)
}
METALLIC = {"M_MetalDark": 0.6, "M_MetalBare": 1.0, "M_MetalLight": 0.6}
ROUGHNESS = {"M_MetalBare": 0.3, "M_Rubber": 0.85, "M_Decal": 0.6}
EMISSIVE = {
    "M_LightWarm":   ((1.0, 0.91, 0.70, 1.0), 8.0),   # #FFF4D6
    "M_ScreenRT":    ((0.15, 0.55, 1.0, 1.0), 3.0),   # render-target screen (UV 0-1, 16:9)
    "M_ScreenStatic":((0.10, 0.35, 0.85, 1.0), 2.0),
    "M_Holo":        ((0.10, 0.55, 1.0, 1.0), 4.0),
    "M_Beacon":      ((1.0, 0.45, 0.05, 1.0), 15.0),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def make_materials():
    mats = {}
    for name, col in COLORS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = col
        b.inputs["Roughness"].default_value = ROUGHNESS.get(name, 0.55)
        b.inputs["Metallic"].default_value = METALLIC.get(name, 0.0)
        m.diffuse_color = col
        mats[name] = m
    _hazard_stripes(mats["M_Hazard"])
    for name, (col, strength) in EMISSIVE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = col
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = strength
        if name == "M_Holo":
            b.inputs["Alpha"].default_value = 0.45
        m.diffuse_color = col
        mats[name] = m
    g = bpy.data.materials.new("M_Glass")
    g.use_nodes = True
    b = g.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.7, 0.8, 1.0)        # light blue-grey tint
    b.inputs["Roughness"].default_value = 0.05
    b.inputs["Transmission Weight"].default_value = 0.92
    b.inputs["IOR"].default_value = 1.45
    g.diffuse_color = (0.4, 0.55, 0.65, 0.3)
    mats["M_Glass"] = g
    return mats


def _hazard_stripes(m):
    """Preview-only black/yellow diagonal stripes (object space); in UE this becomes a texture or decal."""
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "DIAGONAL"
    wave.wave_profile = "SAW"
    wave.inputs["Scale"].default_value = 1.2
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = (0.012, 0.012, 0.012, 1.0)
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = COLORS["M_Hazard"]
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])


def mesh_object(name, bm, mat, coll):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob


def prism(name, poly, axis, a0, a1, mat, coll):
    """Extrude a 2D polygon along an axis.
    axis='z': poly is (x, y);  axis='y': poly is (x, z);  axis='x': poly is (y, z)."""
    bm = bmesh.new()

    def v3(p, a):
        if axis == "z":
            return (p[0], p[1], a)
        if axis == "y":
            return (p[0], a, p[1])
        return (a, p[0], p[1])

    lo = [bm.verts.new(v3(p, a0)) for p in poly]
    hi = [bm.verts.new(v3(p, a1)) for p in poly]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    return mesh_object(name, bm, mat, coll)


def box(name, center, size, mat, coll, rot_z=0.0, rot=None):
    """Axis-aligned box rotated about its own centre (rot = Euler XYZ in radians)."""
    from mathutils import Euler
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    r = Euler(rot if rot else (0.0, 0.0, rot_z), "XYZ").to_matrix()
    bmesh.ops.rotate(bm, matrix=r, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, mat, coll)


def cylinder(name, center, radius, height, mat, coll, segments=24, axis="Z"):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments,
                          radius1=radius, radius2=radius, depth=height)
    if axis == "X":
        bmesh.ops.rotate(bm, matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    elif axis == "Y":
        bmesh.ops.rotate(bm, matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_object(name, bm, mat, coll)


def apply_modifier(target, mtype, **props):
    """Add a modifier, bake the evaluated mesh into the object and drop the modifier (no operator context)."""
    mod = target.modifiers.new("tmp_mod", mtype)
    for k, v in props.items():
        setattr(mod, k, v)
    dg = bpy.context.evaluated_depsgraph_get()
    new_me = bpy.data.meshes.new_from_object(target.evaluated_get(dg))
    old = target.data
    target.modifiers.remove(mod)
    target.data = new_me
    bpy.data.meshes.remove(old)
    return target


def boolean(target, cutter, op="DIFFERENCE"):
    """Exact boolean; cut faces take the cutter's material (interior = dark metal). Removes the cutter."""
    apply_modifier(target, "BOOLEAN", operation=op, solver="EXACT", object=cutter, material_mode="TRANSFER")
    bpy.data.objects.remove(cutter)
    return target


BEVEL_TIERS = (0.012, 0.03, 0.06)   # small details / modules & panels / structural masses


def bevel_tier(width):
    """Snap any requested chamfer to one of three tiers so edge highlights read the same everywhere."""
    if width <= 0:
        return 0.0
    return BEVEL_TIERS[0] if width < 0.018 else BEVEL_TIERS[1] if width < 0.045 else BEVEL_TIERS[2]


def bevel(target, width=0.04, angle_deg=40.0):
    """45° chamfer on hard edges — the 'Satisfactory panel' read from a distance. Width snaps to BEVEL_TIERS."""
    width = bevel_tier(width)
    if width == 0.0:
        return target
    return apply_modifier(target, "BEVEL", width=width, segments=1, limit_method="ANGLE",
                          angle_limit=math.radians(angle_deg), use_clamp_overlap=True)


def shear_y(obj, z0, angle):
    """Tilt a vertical (XZ-plane) object: points move along +Y by (z - z0) * tan(angle)."""
    t = math.tan(angle)
    for v in obj.data.vertices:
        v.co.y += (v.co.z - z0) * t
    obj.data.update()
    return obj


def chamfer_rect(hx, hy, c):
    return [(-hx + c, -hy), (hx - c, -hy), (hx, -hy + c), (hx, hy - c),
            (hx - c, hy), (-hx + c, hy), (-hx, hy - c), (-hx, -hy + c)]


def octagon(r, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(math.pi / 8 + i * math.pi / 4),
             cy + r * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]


# ---------------------------------------------------------------------------
# Building parts
# ---------------------------------------------------------------------------
def shell_volume(name, inset, z0, mat, coll, ceil_top, front_ch=0.8, back_ch=1.2, side_ch=1.0):
    """Plan ∩ side section ∩ front elevation -> chamfered industrial box.
    front_ch / back_ch: 45° chamfers of the top front / back edges, side_ch: of the top side edges."""
    hx, hy = W / 2 - SHELL_INSET - inset, D / 2 - SHELL_INSET - inset
    top = ceil_top
    plan = prism(name, chamfer_rect(hx, hy, CORNER - inset * 0.4), "z", z0, top + 1, mat, coll)
    sec = [(-hy, z0 - 1), (hy, z0 - 1), (hy, top - back_ch), (hy - back_ch, top),
           (-hy + front_ch, top), (-hy, top - front_ch)]
    s = prism(name + "_sec", sec, "x", -W, W, None, coll)
    boolean(plan, s, "INTERSECT")
    ele = [(-hx, z0 - 1), (hx, z0 - 1), (hx, top - side_ch), (hx - side_ch, top),
           (-hx + side_ch, top), (-hx, top - side_ch)]
    e = prism(name + "_ele", ele, "y", -D, D, None, coll)
    boolean(plan, e, "INTERSECT")
    return plan



# ---------------------------------------------------------------------------
# Export & render
# ---------------------------------------------------------------------------
def select_only(coll):
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for ob in coll.objects:
        ob.select_set(True)


def export(exp, out, basename):
    os.makedirs(out, exist_ok=True)
    select_only(exp)
    bpy.ops.export_scene.fbx(filepath=os.path.join(out, basename + ".fbx"),
                             use_selection=True, object_types={"MESH"}, mesh_smooth_type="FACE",
                             apply_scale_options="FBX_SCALE_UNITS", axis_forward="-Z", axis_up="Y")
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, basename + ".glb"),
                              export_format="GLB", use_selection=True)


def setup_render(res=(1600, 900), samples=48):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.render.resolution_x, s.render.resolution_y = res
    s.render.film_transparent = False
    s.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("World")
    s.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.45, 0.6, 1.0)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.5
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("Sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    s.collection.objects.link(so)


def camera(name, loc, target, ortho=None, lens=35):
    cam = bpy.data.cameras.new(name)
    if ortho:
        cam.type = "ORTHO"
        cam.ortho_scale = ortho
    else:
        cam.lens = lens
    cam.clip_end = 500
    ob = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def render_all(out, only=None, suffix=""):
    os.makedirs(out, exist_ok=True)
    s = bpy.context.scene
    zc = 4.0
    shots = {
        "01_three_quarter": ((-17.0, -21.0, 7.5), (0.0, 0.0, 3.0), None, 35),
        "02_front": ((0, -40, zc), (0, 0, zc), 19.0, 0),
        "03_left": ((-40, 0, zc), (0, 0, zc), 19.0, 0),
        "04_back": ((0, 40, zc), (0, 0, zc), 19.0, 0),
        "05_right": ((40, 0, zc), (0, 0, zc), 19.0, 0),
        "06_top": ((0, 0, 40), (0, 0.0001, 0), 19.0, 0),
        "07_interior": ((6.8, 2.6, 2.8), (-3.0, -3.0, 2.6), None, 18),
        "09_rear_three_quarter": ((14.0, 17.0, 5.5), (0.0, 1.0, 3.0), None, 35),
        "10_left_three_quarter": ((-19.0, -6.0, 5.0), (-6.0, -0.3, 3.4), None, 35),
        "11_right_three_quarter": ((19.0, -6.0, 6.5), (6.0, 0.3, 3.8), None, 35),
        "13_roof": ((-9.0, 12.0, 16.0), (0.0, 0.6, 6.8), None, 35),
    }
    for name, (loc, tgt, ortho, lens) in shots.items():
        if only and name not in only:
            continue
        s.camera = camera("CAM_" + name, loc, tgt, ortho, lens or 35)
        s.render.filepath = os.path.join(out, name + suffix + ".png")
        bpy.ops.render.render(write_still=True)


MATID = {   # flat preview colours per material family (checks that zones are separated by geometry)
    "M_PaintOrange": (0.9, 0.35, 0.02), "M_PaintGray": (0.25, 0.35, 0.55), "M_MetalDark": (0.06, 0.06, 0.07),
    "M_MetalBare": (0.75, 0.75, 0.78), "M_Rubber": (0.25, 0.02, 0.3), "M_Glass": (0.1, 0.8, 0.8),
    "M_LightWarm": (1.0, 1.0, 1.0), "M_Beacon": (1.0, 0.3, 0.0), "M_ScreenRT": (0.0, 0.3, 1.0),
    "M_ScreenStatic": (0.1, 0.5, 1.0), "M_Holo": (0.0, 0.9, 1.0), "M_Hazard": (1.0, 0.85, 0.0),
    "M_Decal": (1.0, 0.0, 0.8), "REF_Foundation": (0.45, 0.45, 0.45),
}


def matid_pass(out, shots):
    """Re-render with one flat colour per material family; unknown/legacy slots show as bright green."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        b = m.node_tree.nodes.get("Principled BSDF")
        if b is None:
            continue
        for l in list(m.node_tree.links):
            if l.to_node == b and l.to_socket.name == "Base Color":
                m.node_tree.links.remove(l)
        c = MATID.get(m.name, (0.0, 1.0, 0.0))
        b.inputs["Base Color"].default_value = (*c, 1.0)
        b.inputs["Metallic"].default_value = 0.0
        b.inputs["Roughness"].default_value = 0.8
        b.inputs["Transmission Weight"].default_value = 0.0
        b.inputs["Alpha"].default_value = 1.0
        b.inputs["Emission Strength"].default_value = 1.5 if m.name in ("M_LightWarm", "M_Beacon", "M_ScreenRT",
                                                                       "M_ScreenStatic", "M_Holo") else 0.0
        b.inputs["Emission Color"].default_value = (*c, 1.0)
    render_all(out, shots, suffix="_matid")


def triangle_count(coll):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.objects if o.type == "MESH")


def run(build_fn, basename, label):
    """CLI entry shared by the build scripts: build -> export -> optional .blend / renders."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "export"))
    ap.add_argument("--render", default=None)
    ap.add_argument("--blend", action="store_true", help="also save the .blend next to the exports")
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--shots", default=None, help="comma-separated subset of render shots")
    ap.add_argument("--matid", default=None, help="comma-separated shots to re-render in material-ID colours")
    a = ap.parse_args(argv)

    reset_scene()
    mats = make_materials()
    exp = collection("EXPORT")
    ref = collection("REF_NOT_EXPORTED")
    build_fn(mats, exp, ref)
    export(exp, a.out, basename)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, basename + ".blend"))
    if a.render:
        setup_render(samples=a.samples)
        render_all(a.render, a.shots.split(",") if a.shots else None)
        if a.matid:
            matid_pass(a.render, a.matid.split(","))
    print(f"[{label}] objects={len(exp.objects)} tris={triangle_count(exp)}")
