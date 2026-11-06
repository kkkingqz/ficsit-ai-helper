"""Renders for the base nodes: hologram preview material, prepared terminal-screen renders, review sheets.

The preview material approximates the UE master M_HoloSolid (../ue/README_UE.md): unlit emissive, colour from a
fake key light on the normal, panel grid in object space, edge rim (vertex colour R), glow parts (G), fresnel.
Bloom is added afterwards in Python (PIL), so the PNGs also work over any dark UI background (alpha follows the glow).
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

FILL = (0.016, 0.10, 0.34)        # body fill (linear), deep blue: faces stay darker than the lines
EDGE = (0.16, 0.62, 1.0)          # rim lines + fresnel, cyan
GLOW = (0.55, 0.88, 1.0)          # glow parts, towards white
GRID = 2.0                        # panel grid, metres (model scale)


# ---------------------------------------------------------------------------------------------------------------
def _n(nt, kind, **kw):
    node = nt.nodes.new(kind)
    for k, v in kw.items():
        if k == "op":
            node.operation = v
        else:
            node.inputs[k].default_value = v
    return node


def holo_material(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links.new
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    L(em.outputs[0], out.inputs["Surface"])
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    L(col.outputs["Color"], sep.inputs[0])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    # fake key light (front-left-top) on the normal -> 0..1
    dot = _n(nt, "ShaderNodeVectorMath", op="DOT_PRODUCT")
    dot.inputs[1].default_value = Vector((-0.35, -0.5, 0.8)).normalized()
    L(geo.outputs["Normal"], dot.inputs[0])
    lit = _n(nt, "ShaderNodeMapRange")
    lit.inputs["From Min"].default_value, lit.inputs["From Max"].default_value = -1.0, 1.0
    lit.inputs["To Min"].default_value, lit.inputs["To Max"].default_value = 0.25, 1.9
    L(dot.outputs["Value"], lit.inputs["Value"])
    # panel grid: distance to the nearest grid line on the two axes in the face plane
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sc = _n(nt, "ShaderNodeVectorMath", op="MULTIPLY")
    sc.inputs[1].default_value = (1 / GRID, 1 / GRID, 1 / GRID)
    L(tc.outputs["Object"], sc.inputs[0])
    off = _n(nt, "ShaderNodeVectorMath", op="ADD")
    off.inputs[1].default_value = (0.5, 0.5, 0.5)
    L(sc.outputs[0], off.inputs[0])
    fr = _n(nt, "ShaderNodeVectorMath", op="FRACTION")
    L(off.outputs[0], fr.inputs[0])
    sub = _n(nt, "ShaderNodeVectorMath", op="SUBTRACT")
    sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    L(fr.outputs[0], sub.inputs[0])
    ab = _n(nt, "ShaderNodeVectorMath", op="ABSOLUTE")
    L(sub.outputs[0], ab.inputs[0])
    sx = nt.nodes.new("ShaderNodeSeparateXYZ")
    L(ab.outputs[0], sx.inputs[0])
    nabs = _n(nt, "ShaderNodeVectorMath", op="ABSOLUTE")
    L(geo.outputs["Normal"], nabs.inputs[0])
    nx = nt.nodes.new("ShaderNodeSeparateXYZ")
    L(nabs.outputs[0], nx.inputs[0])
    grid = None
    for i, ax in enumerate("XYZ"):
        lt = _n(nt, "ShaderNodeMath", op="LESS_THAN")
        lt.inputs[1].default_value = 0.025                 # line width (fraction of a panel)
        L(sx.outputs[ax], lt.inputs[0])
        w = _n(nt, "ShaderNodeMath", op="SUBTRACT")
        w.inputs[0].default_value = 1.0
        L(nx.outputs[ax], w.inputs[1])
        w2 = _n(nt, "ShaderNodeMath", op="GREATER_THAN")
        w2.inputs[1].default_value = 0.5
        L(w.outputs[0], w2.inputs[0])
        m = _n(nt, "ShaderNodeMath", op="MULTIPLY")
        L(lt.outputs[0], m.inputs[0])
        L(w2.outputs[0], m.inputs[1])
        if grid is None:
            grid = m
        else:
            mx = _n(nt, "ShaderNodeMath", op="MAXIMUM")
            L(grid.outputs[0], mx.inputs[0])
            L(m.outputs[0], mx.inputs[1])
            grid = mx
    # fresnel
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    # emission = FILL * (lit + 0.45 grid) * (1 - 0.75 dim) + EDGE * (1.3 edge + 0.9 fresnel^3) [fresnel also dimmed] + GLOW * 2.6 glow
    g1 = _n(nt, "ShaderNodeMath", op="MULTIPLY_ADD")
    g1.inputs[1].default_value = 0.45
    L(grid.outputs[0], g1.inputs[0])
    L(lit.outputs[0], g1.inputs[2])
    dm = _n(nt, "ShaderNodeMath", op="MULTIPLY_ADD")          # (1 - 0.75 * B)
    dm.inputs[1].default_value = -0.75
    dm.inputs[2].default_value = 1.0
    L(sep.outputs["Blue"], dm.inputs[0])
    g1d = _n(nt, "ShaderNodeMath", op="MULTIPLY")
    L(g1.outputs[0], g1d.inputs[0])
    L(dm.outputs[0], g1d.inputs[1])
    fill = _n(nt, "ShaderNodeVectorMath", op="SCALE")
    fill.inputs[0].default_value = FILL
    L(g1d.outputs[0], fill.inputs["Scale"])
    fz = _n(nt, "ShaderNodeMath", op="POWER")                # fresnel^3: only the silhouettes light up
    fz.inputs[1].default_value = 3.0
    L(lw.outputs["Facing"], fz.inputs[0])
    fd = _n(nt, "ShaderNodeMath", op="MULTIPLY")
    L(fz.outputs[0], fd.inputs[0])
    L(dm.outputs[0], fd.inputs[1])
    e1 = _n(nt, "ShaderNodeMath", op="MULTIPLY")
    e1.inputs[1].default_value = 0.9
    L(fd.outputs[0], e1.inputs[0])
    e2 = _n(nt, "ShaderNodeMath", op="MULTIPLY_ADD")
    e2.inputs[1].default_value = 1.3
    L(sep.outputs["Red"], e2.inputs[0])
    L(e1.outputs[0], e2.inputs[2])
    edge = _n(nt, "ShaderNodeVectorMath", op="SCALE")
    edge.inputs[0].default_value = EDGE
    L(e2.outputs[0], edge.inputs["Scale"])
    base = _n(nt, "ShaderNodeVectorMath", op="ADD")
    L(fill.outputs[0], base.inputs[0])
    L(edge.outputs[0], base.inputs[1])
    gl = _n(nt, "ShaderNodeVectorMath", op="SCALE")
    gl.inputs[0].default_value = GLOW
    gk = _n(nt, "ShaderNodeMath", op="MULTIPLY")
    gk.inputs[1].default_value = 2.6
    L(sep.outputs["Green"], gk.inputs[0])
    L(gk.outputs[0], gl.inputs["Scale"])
    tot = _n(nt, "ShaderNodeVectorMath", op="ADD")
    L(base.outputs[0], tot.inputs[0])
    L(gl.outputs[0], tot.inputs[1])
    L(tot.outputs[0], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0


def setup(mat, samples):
    holo_material(mat)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = False
    s.cycles.max_bounces = 0
    s.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("World")
    s.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"


# ---------------------------------------------------------------------------------------------------------------
def _cam(name, direction, ortho=True, lens=35):
    cam = bpy.data.cameras.new(name)
    cam.type = "ORTHO" if ortho else "PERSP"
    cam.lens = lens
    cam.clip_start, cam.clip_end = 0.01, 2000
    ob = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (-Vector(direction)).to_track_quat("-Z", "Y").to_euler()
    return ob


def fit_ortho(cam, objs, aspect, margin=1.06):
    """Centre an ortho camera on the projected vertices of objs and size it to fit."""
    R = cam.rotation_euler.to_matrix()
    rx, ry, rz = R.col[0], R.col[1], R.col[2]
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    xs = [p.dot(rx) for p in pts]
    ys = [p.dot(ry) for p in pts]
    zs = [p.dot(rz) for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    cam.data.ortho_scale = max(w, h * aspect) * margin
    cam.location = rx * cx + ry * cy + rz * (max(zs) + 50)
    return max(w, h * aspect) * margin


def render(path, res):
    s = bpy.context.scene
    s.render.resolution_x, s.render.resolution_y = res
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bloom(path)


def bloom(path, strength=0.9):
    from PIL import Image, ImageFilter, ImageChops
    im = Image.open(path).convert("RGBA")
    rgb, a = im.convert("RGB"), im.getchannel("A")
    r = max(2, int(im.width * 0.012))
    hi = rgb.point(lambda v: max(0, v - 150) * 2)
    glow = hi.filter(ImageFilter.GaussianBlur(r))
    glow2 = rgb.point(lambda v: max(0, v - 60)).filter(ImageFilter.GaussianBlur(r * 3)).point(lambda v: int(v * 0.45))
    out = ImageChops.add(ImageChops.add(rgb, glow.point(lambda v: int(v * strength))), glow2)
    lum = ImageChops.lighter(glow, glow2).convert("L").point(lambda v: min(255, int(v * 1.4)))
    alpha = ImageChops.lighter(a, lum)
    out.putalpha(alpha)
    out.save(path)


VIEW_A = (0.78, -1.0, 0.82)        # camera direction for the screen render: front-right, from above (concept view A)


def screens(spec, built, out):
    """Prepared renders for the terminal screens: one per node x tier, iso view A, transparent, 1280x800 + 640x400."""
    os.makedirs(out, exist_ok=True)
    s = bpy.context.scene
    s.render.film_transparent = True
    for (key, tk, mini), ob in built.items():
        if mini:
            continue
        _only(ob)
        cam = _cam("CAM_screen", VIEW_A)
        s.camera = cam
        fit_ortho(cam, [ob], 1280 / 800, 1.08)
        base = f"T_Node_{spec['nodes'][key]['asset']}_T{tk}_Screen"
        render(os.path.join(out, base + ".png"), (1280, 800))
        from PIL import Image
        Image.open(os.path.join(out, base + ".png")).resize((640, 400), Image.LANCZOS).save(
            os.path.join(out, base + "_640.png"))
        print("[render] screen", base)
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.hide_render = False


def _only(keep):
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.hide_render = o is not keep and not o.get("mock")


def review(spec, built, single, multi, out):
    """Tier sheet (iso / front / top at a common scale) and two projector mock-ups (single, multi = 5 slots)."""
    from PIL import Image, ImageDraw
    os.makedirs(out, exist_ok=True)
    s = bpy.context.scene
    s.render.film_transparent = False
    s.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.008, 0.014, 1)
    for key, node in spec["nodes"].items():
        obs = [built[(key, tk, False)] for tk in node["tiers"] if (key, tk, False) in built]
        if not obs:
            continue
        views = {"iso": VIEW_A, "front": (0, -1, 0), "top": (0, -0.0001, 1)}
        tiles = {}
        for vname, d in views.items():
            cam = _cam("CAM_" + vname, d)
            if vname == "top":
                cam.rotation_euler = (0.0, 0.0, 0.0)      # straight down, +X right, +Y (back) up, front at the bottom
            s.camera = cam
            scale = fit_ortho(cam, [obs[-1]], 1.0, 1.06)        # largest tier sets the common scale
            for ob in obs:
                _only(ob)
                c = ob.matrix_world.translation
                R = cam.rotation_euler.to_matrix()
                # re-centre on this tier, keep the common ortho scale
                pts = [v.co for v in ob.data.vertices]
                xs = [p.dot(R.col[0]) for p in pts]
                ys = [p.dot(R.col[1]) for p in pts]
                cam.location = R.col[0] * (min(xs) + max(xs)) / 2 + R.col[1] * (min(ys) + max(ys)) / 2 + R.col[2] * 200
                cam.data.ortho_scale = scale
                p = os.path.join(out, f"_tile_{ob.name}_{vname}.png")
                render(p, (560, 560))
                tiles[(ob.name, vname)] = p
        W = 560
        sheet = Image.new("RGB", (W * 3 + 40, W * len(obs) + 60 + 20 * len(obs)), (6, 12, 20))
        dr = ImageDraw.Draw(sheet)
        for i, ob in enumerate(obs):
            y0 = 50 + i * (W + 20)
            dr.text((20, y0 - 22), f"{node['asset']}  TIER {i + 1}   ({ob.data.polygons.__len__()} tris)", fill=(140, 210, 255))
            for j, vname in enumerate(views):
                t = Image.open(tiles[(ob.name, vname)]).convert("RGB")
                sheet.paste(t, (20 + j * W, y0))
        dr.text((20, 12), "views: ISO (A) / FRONT / TOP - common scale across tiers", fill=(200, 200, 200))
        sheet.save(os.path.join(out, f"review_{key}_tiers.png"))
        for p in tiles.values():
            os.remove(p)
        print("[render] sheet", key)
    _projector(spec, built, single, multi, out)


def _mock(spec):
    """Projector mock: pedestal, emitter disc, floor, light. Returns inst(src, scale, xy, name)."""
    s = bpy.context.scene
    disp = spec["display"]
    zb = 2.05 + disp["base_z"]                    # floor = 0, SOCKET_holo at 2.05 (Command Center interior)
    mock = []
    import bmesh
    for name, (r, h, z) in {"MOCK_pedestal": (1.3, 0.94, 0.47), "MOCK_disc": (0.9, 0.03, 0.96)}.items():
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=r, radius2=r, depth=h)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        ob.location = (0, 0, z)
        ob["mock"] = True
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (0.02, 0.025, 0.03, 1)
        if name == "MOCK_disc":
            b.inputs["Emission Color"].default_value = (0.1, 0.5, 1.0, 1)
            b.inputs["Emission Strength"].default_value = 0.6
        me.materials.append(m)
        s.collection.objects.link(ob)
        mock.append(ob)
    lamp = bpy.data.lights.new("MOCK_light", "AREA")
    lamp.energy, lamp.size = 120, 3
    lo = bpy.data.objects.new("MOCK_light", lamp)
    lo.location = (0, 0, 4.5)
    s.collection.objects.link(lo)
    s.cycles.max_bounces = 2
    floor = bpy.data.meshes.new("MOCK_floor")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
    bm.to_mesh(me := floor)
    bm.free()
    fo = bpy.data.objects.new("MOCK_floor", floor)
    fo["mock"] = True
    fm = bpy.data.materials.new("MOCK_floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.03, 0.035, 0.04, 1)
    floor.materials.append(fm)
    s.collection.objects.link(fo)

    def inst(src, scale, xy, name):
        ob = bpy.data.objects.new(name, src.data)
        ob.scale = (scale, scale, scale)
        ob.location = (xy[0], xy[1], zb)
        ob["mock"] = True
        s.collection.objects.link(ob)
        return ob

    return inst


def multi_mix(spec, built):
    """Five (node, tier, mini) keys for the multi-node mock: the first node (hub) T3 in the centre slot, then the
    other nodes' tiers round the ring; with a single node its own tiers repeat as placeholders."""
    keys = list(spec["nodes"])
    first = keys[0]
    ring = [(k, tk) for k in keys[1:] for tk in spec["nodes"][k]["tiers"]] or \
           [(first, tk) for tk in spec["nodes"][first]["tiers"]]
    ring += [(first, "1"), (first, "2")]
    out = [(first, "3", True)] + [(k, tk, True) for k, tk in ring[:4]]
    return [k for k in out if k in built]


def _projector(spec, built, single, multi, out):
    """Simple projector mock (emitter disc + scale ring) with the hologram at its display scale, seen by a player."""
    s = bpy.context.scene
    disp = spec["display"]
    inst = _mock(spec)
    for o in s.objects:
        if o.type == "MESH" and not o.get("mock"):
            o.hide_render = True
    cam = _cam("CAM_player", (0.55, -2.4, 0.55), ortho=False, lens=30)
    cam.location = (1.15, -2.75, 1.65)
    cam.rotation_euler = (Vector((0, 0, 1.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    s.camera = cam
    shots = []
    for key in spec["nodes"]:
        for tk in ("1", "3"):
            src = built.get((key, tk, False))
            if src is None:
                continue
            o = inst(src, single[(key, tk)], (0, 0), f"I_single_{key}_T{tk}")
            p = os.path.join(out, f"review_projector_single_{key}_T{tk}.png")
            render(p, (1280, 800))
            shots.append(p)
            bpy.data.objects.remove(o)
    lay = disp["multi"]["layouts"]["5"]
    tmp = []
    for i, (xy, k) in enumerate(zip(lay["slots"], multi_mix(spec, built))):
        tmp.append(inst(built[k], multi["5"], xy, f"I_multi_{i}"))
    p = os.path.join(out, "review_projector_multi5.png")
    render(p, (1280, 800))
    for o in tmp:
        bpy.data.objects.remove(o)
    asset = ", ".join(n["asset"] for n in spec["nodes"].values())
    print("[render] projector", shots, p, asset)


# ---------------------------------------------------------------------------------------------------------------
TURN = [(a, 25, f"az{a:03d}") for a in range(0, 360, 45)] + [(-35, 7, "low_front_left"), (145, 7, "low_back_right"),
                                                            (20, 62, "high_front"), (0, 90, "top")]


def _persp_fit(cam, ob, direction, lens=50, aspect=1.6, margin=1.12):
    """Perspective camera along `direction`, aimed at the bbox centre; distance iterated until the projected
    vertices fill the frame (with margin)."""
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2
    d = Vector(direction).normalized()
    if abs(d.z) > 0.999:
        cam.rotation_euler = (0.0, 0.0, 0.0)
    else:
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    R = cam.rotation_euler.to_matrix()
    tx = 18.0 / lens                                          # tan(half horizontal fov), sensor 36 mm
    ty = tx / aspect
    dist = (hi - lo).length * 2.0
    for _ in range(4):
        eye = c + d * dist
        m = 0.0
        for p in pts:
            q = R.transposed() @ (p - eye)                    # camera space: looks along -Z
            z = max(-q.z, 1e-3)
            m = max(m, abs(q.x) / z / tx, abs(q.y) / z / ty)
        dist *= 0.35 + 0.65 * m * margin                      # damped: converge without overshooting
    cam.location = c + d * dist


def turnaround(spec, built, single, multi, out, tile=(640, 400)):
    """Per tier: 8 views around (every 45°, 25° above), two low views, a high and a top view -> one sheet.
    Then the projector mock seen from four player positions (single T2 and five nodes)."""
    from PIL import Image, ImageDraw
    os.makedirs(out, exist_ok=True)
    s = bpy.context.scene
    s.render.film_transparent = False
    s.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.008, 0.014, 1)
    for (key, tk, mini), ob in sorted(built.items()):
        if mini:
            continue
        _only(ob)
        cam = _cam("CAM_turn", (0, -1, 0), ortho=False, lens=50)
        s.camera = cam
        tiles = []
        for az, el, name in TURN:
            a, e = math.radians(az), math.radians(el)
            # az 0 = front (-Y), clockwise seen from above (az 90 = right side, +X)
            d = (math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))
            _persp_fit(cam, ob, d)
            p = os.path.join(out, f"_t_{ob.name}_{name}.png")
            render(p, tile)
            tiles.append((name, p))
        cols = 4
        W, H = tile
        sheet = Image.new("RGB", (cols * W, (len(tiles) + cols - 1) // cols * (H + 24) + 40), (6, 12, 20))
        dr = ImageDraw.Draw(sheet)
        dr.text((12, 12), f"{ob.name}   tris {len(ob.data.polygons)}   az 0 = front, clockwise; el = camera height",
                fill=(150, 210, 255))
        for i, (name, p) in enumerate(tiles):
            x, y = (i % cols) * W, 40 + (i // cols) * (H + 24)
            sheet.paste(Image.open(p).convert("RGB"), (x, y))
            dr.text((x + 10, y + H + 4), name, fill=(190, 190, 190))
            os.remove(p)
        sheet.save(os.path.join(out, f"turnaround_{ob.name}.png"))
        print("[render] turnaround", ob.name)
    _projector_angles(spec, built, single, multi, out, tile)


def _projector_angles(spec, built, single, multi, out, tile):
    from PIL import Image, ImageDraw
    s = bpy.context.scene
    disp = spec["display"]
    inst = _mock(spec)
    for o in s.objects:
        if o.type == "MESH" and not o.get("mock"):
            o.hide_render = True
    key = next(iter(spec["nodes"]))
    eyes = {"operator_front_right": (1.15, -2.75, 1.65), "left_side": (-2.9, -0.6, 1.65),
            "back": (0.4, 2.9, 1.65), "close_low": (0.9, -1.75, 1.25)}
    cam = _cam("CAM_eye", (0, -1, 0), ortho=False, lens=30)
    s.camera = cam
    W, H = tile
    rows = []
    sets = {f"single_{k}_T2": [((k, "2", False), single.get((k, "2"), 1.0), (0, 0))] for k in spec["nodes"]}
    lay = disp["multi"]["layouts"]["5"]
    sets["multi5"] = [(k, multi["5"], xy) for xy, k in zip(lay["slots"], multi_mix(spec, built))]
    for label, items in sets.items():
        tmp = [inst(built[k], sc, xy, f"I_{label}_{i}") for i, (k, sc, xy) in enumerate(items) if k in built]
        row = []
        for ename, loc in eyes.items():
            cam.location = loc
            cam.rotation_euler = (Vector((0, 0, 1.45)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
            p = os.path.join(out, f"_p_{label}_{ename}.png")
            render(p, tile)
            row.append((f"{label} / {ename}", p))
        rows.append(row)
        for o in tmp:
            bpy.data.objects.remove(o)
    sheet = Image.new("RGB", (len(eyes) * W, len(rows) * (H + 24) + 40), (6, 12, 20))
    dr = ImageDraw.Draw(sheet)
    dr.text((12, 12), "projector mock, player eye 1.65 m (close_low 1.25 m); multi5: hub T3 in the centre + other nodes",
            fill=(150, 210, 255))
    for j, row in enumerate(rows):
        for i, (name, p) in enumerate(row):
            x, y = i * W, 40 + j * (H + 24)
            sheet.paste(Image.open(p).convert("RGB"), (x, y))
            dr.text((x + 10, y + H + 4), name, fill=(190, 190, 190))
            os.remove(p)
    sheet.save(os.path.join(out, "turnaround_projector.png"))
    print("[render] projector angles")
