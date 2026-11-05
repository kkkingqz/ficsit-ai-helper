"""Preview-only graphics for screens, labels and signs (stage 4 previews).

Exports keep the 13 standard slots: in UE `DISPLAY_MAIN_RT` is a render target (FR-01 AI Terminal UMG), static screens
get a material instance, and every `M_Decal` plate becomes a decal / text. For RENDERS ONLY (after export) this module
swaps those placeholders for simple Pillow-made textures, so the previews read as signage and interfaces, not as blank
white plates:
  * screens    - main AI Terminal, power trend, production list, camera/map feed, small status screens;
  * labels     - dark plates with an orange tab and a two-line marking (unit, ID, warnings), picked per object;
  * floor      - stencil zone names (OPERATOR / SERVICE / HOLO / TECH);
  * signs      - the backlit COMMAND CENTER sign over the door and the EXIT sign in the door header.
White floor lane marks (movement code) stay plain white.

    python ui_preview.py            # (re)generate ../textures/preview/*.png
"""
import hashlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "textures", "preview")

BG, PANEL, LINE = (9, 22, 40), (18, 40, 66), (40, 80, 120)
ORANGE, CYAN, AMBER, GREEN, WHITE = (242, 155, 56), (90, 200, 255), (255, 190, 60), (110, 220, 140), (225, 235, 245)
PLATE, PLATE_EDGE, INK = (38, 42, 50), (70, 76, 86), (215, 220, 226)

from stage5_layout import LABELS  # noqa: E402  (one label list for the preview images and the decal atlas)
FLOOR = {"operator": "OPERATOR", "service": "SERVICE", "holo": "HOLO", "tech": "TECH"}


def _png(name):
    return os.path.join(OUT, name + ".png")


def _font(size):
    from PIL import ImageFont
    try:
        return ImageFont.load_default(size=size)
    except TypeError:                     # old Pillow
        return ImageFont.load_default()


def _panel(d, box, title=None):
    d.rectangle(box, fill=PANEL, outline=LINE, width=3)
    if title:
        d.rectangle((box[0], box[1], box[2], box[1] + 44), fill=LINE)
        d.text((box[0] + 16, box[1] + 8), title, fill=WHITE, font=_font(26))


# ---- screens --------------------------------------------------------------------------------------------------------
def make_main(path):
    """AI Terminal main screen: header, factory map, assistant dialogue, production bars, power gauge, status strip."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 1920, 90), fill=ORANGE)
    d.text((40, 20), "FICSIT  AI TERMINAL", fill=BG, font=_font(48))
    d.text((1480, 28), "ONLINE  //  OP-01", fill=BG, font=_font(34))
    _panel(d, (40, 130, 620, 760), "FACTORY MAP")
    for gx in range(8):
        for gy in range(8):
            x0, y0 = 70 + gx * 66, 200 + gy * 66
            lit = (gx * 3 + gy * 5) % 7 in (0, 3)
            d.rectangle((x0, y0, x0 + 56, y0 + 56), fill=CYAN if lit else (26, 56, 88))
    d.rectangle((70 + 4 * 66 - 6, 200 + 3 * 66 - 6, 70 + 4 * 66 + 62, 200 + 3 * 66 + 62), outline=ORANGE, width=6)
    _panel(d, (660, 130, 1340, 760), "ASSISTANT")
    rows = [(0, "Q: How do I unlock Tier 3?", WHITE), (1, "Milestone: Coal Power", CYAN), (1, "Build 2 Coal Generators", CYAN),
            (0, "Q: Iron plates low?", WHITE), (1, "Add a 2nd Constructor", CYAN), (1, "Input 30/min -> 20/min", AMBER)]
    for i, (side, txt, col) in enumerate(rows):
        y = 200 + i * 88
        x0 = 690 if side == 0 else 760
        d.rectangle((x0, y, x0 + 540, y + 66), fill=(30, 62, 96) if side == 0 else (16, 54, 80), outline=col, width=3)
        d.text((x0 + 18, y + 16), txt, fill=col, font=_font(30))
    _panel(d, (1380, 130, 1880, 520), "PRODUCTION / MIN")
    for i, (v, col) in enumerate(((0.9, GREEN), (0.65, CYAN), (0.4, AMBER), (0.75, CYAN), (0.25, ORANGE))):
        y = 200 + i * 62
        d.rectangle((1410, y, 1850, y + 40), fill=(26, 56, 88))
        d.rectangle((1410, y, 1410 + int(440 * v), y + 40), fill=col)
    _panel(d, (1380, 550, 1880, 760), "POWER")
    d.arc((1430, 600, 1590, 760), 180, 360, fill=(26, 56, 88), width=22)
    d.arc((1430, 600, 1590, 760), 180, 300, fill=GREEN, width=22)
    d.text((1630, 640), "1.2 GW", fill=WHITE, font=_font(44))
    for i, (txt, col) in enumerate((("POWER OK", GREEN), ("BELTS 98%", CYAN), ("ALERT: SULFUR", AMBER), ("HUB LINK", GREEN))):
        x0 = 40 + i * 470
        d.rectangle((x0, 800, x0 + 440, 880), fill=PANEL, outline=col, width=4)
        d.text((x0 + 24, 820), txt, fill=col, font=_font(34))
    d.rectangle((40, 920, 1880, 1040), fill=PANEL, outline=LINE, width=3)
    d.text((70, 955), "> ask the assistant ...", fill=(140, 170, 200), font=_font(40))
    d.rectangle((1700, 945, 1850, 1015), fill=ORANGE)
    im.save(path)


def make_wing(path):
    """Power-grid trend line + four status tiles."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1280, 720), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 1280, 64), fill=LINE)
    d.text((24, 12), "POWER GRID  //  TREND", fill=WHITE, font=_font(36))
    _panel(d, (24, 90, 1256, 470))
    for k in range(1, 5):
        d.line((24, 90 + k * 76, 1256, 90 + k * 76), fill=(30, 60, 92), width=2)
    pts = [(40 + i * 40, 400 - int(160 * (0.5 + 0.45 * ((i * 7) % 11) / 10.0))) for i in range(31)]
    d.line(pts, fill=CYAN, width=6)
    d.line((24, 180, 1256, 180), fill=AMBER, width=3)
    for i, (txt, col) in enumerate((("GEN 12/12", GREEN), ("LOAD 86%", CYAN), ("FUSE OK", GREEN), ("BATT 40%", AMBER))):
        x0 = 24 + i * 312
        d.rectangle((x0, 500, x0 + 290, 690), fill=PANEL, outline=col, width=4)
        d.text((x0 + 22, 570), txt, fill=col, font=_font(40))
    im.save(path)


def make_list(path):
    """Production queue: rows with item, rate and a progress bar."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1280, 720), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 1280, 64), fill=LINE)
    d.text((24, 12), "PRODUCTION QUEUE", fill=WHITE, font=_font(36))
    rows = (("IRON PLATE", "60/min", 0.9, GREEN), ("IRON ROD", "45/min", 0.7, GREEN), ("SCREW", "120/min", 0.55, CYAN),
            ("WIRE", "30/min", 0.35, AMBER), ("CABLE", "15/min", 0.8, CYAN), ("CONCRETE", "0/min", 0.05, ORANGE))
    for i, (it, rate, v, col) in enumerate(rows):
        y = 92 + i * 100
        d.rectangle((24, y, 1256, y + 84), fill=PANEL, outline=LINE, width=2)
        d.text((48, y + 22), it, fill=WHITE, font=_font(36))
        d.text((480, y + 22), rate, fill=col, font=_font(36))
        d.rectangle((720, y + 28, 1220, y + 56), fill=(26, 56, 88))
        d.rectangle((720, y + 28, 720 + int(500 * v), y + 56), fill=col)
    im.save(path)


def make_cam(path):
    """Camera / site map feed: grid, conveyor lines, building blocks, REC tag."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1280, 720), (12, 30, 48))
    d = ImageDraw.Draw(im)
    for k in range(0, 1280, 80):
        d.line((k, 0, k, 720), fill=(22, 48, 72), width=2)
    for k in range(0, 720, 80):
        d.line((0, k, 1280, k), fill=(22, 48, 72), width=2)
    for x0, y0, x1, y1 in ((160, 160, 400, 320), (560, 120, 760, 300), (880, 380, 1140, 560), (240, 440, 460, 600)):
        d.rectangle((x0, y0, x1, y1), fill=(30, 70, 104), outline=CYAN, width=4)
    d.line((400, 240, 560, 210, 660, 300, 660, 470, 880, 470), fill=AMBER, width=8)
    d.line((460, 520, 880, 520), fill=AMBER, width=8)
    d.rectangle((0, 0, 1280, 60), fill=(0, 0, 0))
    d.text((24, 10), "SITE CAM 03  //  NORTH YARD", fill=WHITE, font=_font(34))
    d.ellipse((1150, 16, 1178, 44), fill=(240, 60, 50))
    d.text((1190, 10), "REC", fill=WHITE, font=_font(34))
    im.save(path)


def make_status(path, variant):
    """Small status screen (16:9): header, one big value, two bars."""
    from PIL import Image, ImageDraw
    title, value, col = (("STATUS", "OK", GREEN), ("LOAD", "72%", CYAN), ("ACCESS", "LVL 2", AMBER))[variant % 3]
    im = Image.new("RGB", (640, 360), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 640, 64), fill=LINE)
    d.text((20, 12), title, fill=WHITE, font=_font(38))
    d.text((24, 96), value, fill=col, font=_font(96))
    for k, v in enumerate((0.8, 0.45)):
        y = 250 + k * 50
        d.rectangle((24, y, 616, y + 30), fill=(26, 56, 88))
        d.rectangle((24, y, 24 + int(592 * v), y + 30), fill=col)
    im.save(path)


# ---- labels and signs ------------------------------------------------------------------------------------------------
def make_label(path, lines):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (640, 160), PLATE)
    d = ImageDraw.Draw(im)
    d.rectangle((3, 3, 636, 156), outline=PLATE_EDGE, width=6)
    d.rectangle((14, 14, 54, 146), fill=ORANGE)
    d.text((80, 18), lines[0], fill=INK, font=_font(54))
    d.text((80, 92), lines[1], fill=(170, 176, 186), font=_font(42))
    im.save(path)


def make_floor(path, word):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (800, 160), (30, 32, 36))
    d = ImageDraw.Draw(im)
    f = _font(120)
    w = d.textlength(word, font=f)
    d.text(((800 - w) / 2, 12), word, fill=(205, 205, 200), font=f)
    im.save(path)


def make_sign(path):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1280, 336), (14, 16, 20))
    d = ImageDraw.Draw(im)
    d.rectangle((8, 8, 1272, 328), outline=ORANGE, width=10)
    size = 140
    while size > 40 and d.textlength("COMMAND CENTER", font=_font(size)) > 1280 - 120:   # fit inside the frame
        size -= 4
    f = _font(size)
    w = d.textlength("COMMAND CENTER", font=f)
    d.text(((1280 - w) / 2, 40), "COMMAND CENTER", fill=ORANGE, font=f)
    f2 = _font(54)
    t = "FICSIT  AI TERMINAL  //  CC-01"
    w2 = d.textlength(t, font=f2)
    d.text(((1280 - w2) / 2, 232), t, fill=(220, 225, 230), font=f2)
    im.save(path)


def make_entry(path):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1280, 336), (14, 16, 20))
    d = ImageDraw.Draw(im)
    d.rectangle((8, 8, 1272, 328), outline=ORANGE, width=10)
    for txt, size, y, col in (("COMMAND CENTER", 120, 34, ORANGE), ("ENTRY  //  AUTHORISED PERSONNEL", 50, 226, (220, 225, 230))):
        while size > 30 and d.textlength(txt, font=_font(size)) > 1280 - 120:
            size -= 4
        w = d.textlength(txt, font=_font(size))
        d.text(((1280 - w) / 2, y), txt, fill=col, font=_font(size))
    im.save(path)


def make_exit(path):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (640, 150), (14, 60, 36))
    d = ImageDraw.Draw(im)
    d.rectangle((6, 6, 634, 144), outline=(120, 230, 150), width=6)
    d.text((60, 22), "EXIT", fill=(230, 255, 235), font=_font(100))
    d.polygon(((470, 40), (560, 75), (470, 110)), fill=(230, 255, 235))
    d.rectangle((400, 62, 470, 88), fill=(230, 255, 235))
    im.save(path)


def ensure_textures(force=False):
    os.makedirs(OUT, exist_ok=True)
    jobs = {"ui_main": lambda p: make_main(p), "ui_wing": lambda p: make_wing(p), "ui_list": lambda p: make_list(p),
            "ui_cam": lambda p: make_cam(p), "sign_cc": lambda p: make_sign(p), "sign_exit": lambda p: make_exit(p),
            "sign_entry": lambda p: make_entry(p)}
    for k in range(3):
        jobs[f"ui_status_{k}"] = (lambda kk: (lambda p: make_status(p, kk)))(k)
    for k, lines in enumerate(LABELS):
        jobs[f"label_{k}"] = (lambda ll: (lambda p: make_label(p, ll)))(lines)
    for key, word in FLOOR.items():
        jobs[f"floor_{key}"] = (lambda ww: (lambda p: make_floor(p, ww)))(word)
    for name, fn in jobs.items():
        if force or not os.path.exists(_png(name)):
            fn(_png(name))


# ---- render-time application (stage 5: the real UV0 + atlases, one material per slot as in UE) --------------------
TEX = os.path.join(HERE, "..", "textures")


def _image_slot(mat, png, emission=0.0, roughness=0.6):
    """Rebuild a slot material as image texture on UVMap: emissive (screens) or painted (decals, hazard)."""
    import bpy
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png, check_existing=True)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    if emission > 0:
        sh = nt.nodes.new("ShaderNodeEmission")
        sh.inputs["Strength"].default_value = emission
        nt.links.new(tex.outputs["Color"], sh.inputs["Color"])
    else:
        sh = nt.nodes.new("ShaderNodeBsdfPrincipled")
        sh.inputs["Roughness"].default_value = roughness
        nt.links.new(tex.outputs["Color"], sh.inputs["Base Color"])
    nt.links.new(sh.outputs[0], out.inputs["Surface"])


def apply_preview_ui():
    """Render-time only: the slot materials read the stage-5 atlases through UV0 (exports are already written)."""
    import bpy
    for name, png, em in (("M_Decal", "T_CC_DecalAtlas_D.png", 0.0), ("M_ScreenStatic", "T_CC_ScreenAtlas_E.png", 1.2),
                          ("M_Hazard", "T_CC_Hazard_D.png", 0.0)):
        m = bpy.data.materials.get(name)
        if m:
            _image_slot(m, os.path.join(TEX, png), em)
    m = bpy.data.materials.get("M_ScreenRT")
    if m:                                                     # preview content for the render target
        _image_slot(m, _png("ui_main"), 1.4)


def apply_uv_checker():
    """UV check renders: every tiling slot shows the checker (TILE_M metres per tile) in its own tint."""
    import bpy
    for name in ("M_PaintOrange", "M_PaintGray", "M_MetalDark", "M_MetalBare", "M_Rubber"):
        m = bpy.data.materials.get(name)
        if m:
            _image_slot(m, os.path.join(TEX, "T_CC_UVChecker.png"), 0.0, 0.8)


# ---- hologram look (render-time only; UE: translucent additive material with fresnel edges) -------------------------
HOLO_CYAN = (0.02, 0.5, 1.0, 1.0)              # saturated: bright cyan emission turns milky under AgX


def _holo_material(name, fill, strength, edge=0.0, wire=0.0):
    """Mix(Transparent, Emission): fill = base opacity; edge = fresnel (silhouette) glow; wire = glowing mesh edges."""
    import bpy
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    mix = nt.nodes.new("ShaderNodeMixShader")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = HOLO_CYAN
    em.inputs["Strength"].default_value = strength
    fac = nt.nodes.new("ShaderNodeValue")
    fac.outputs[0].default_value = fill
    cur = fac.outputs[0]
    if edge:
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.35
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = edge
        nt.links.new(lw.outputs["Facing"], mul.inputs[0])
        mx = nt.nodes.new("ShaderNodeMath")
        mx.operation = "MAXIMUM"
        nt.links.new(cur, mx.inputs[0])
        nt.links.new(mul.outputs[0], mx.inputs[1])
        cur = mx.outputs[0]
    if wire:
        wf = nt.nodes.new("ShaderNodeWireframe")
        wf.use_pixel_size = False
        wf.inputs["Size"].default_value = wire
        mx2 = nt.nodes.new("ShaderNodeMath")
        mx2.operation = "MAXIMUM"
        nt.links.new(cur, mx2.inputs[0])
        nt.links.new(wf.outputs[0], mx2.inputs[1])
        cur = mx2.outputs[0]
    nt.links.new(cur, mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def _holo_role(name):
    if name == "HOLO_PROJECTION":
        return "body"
    if name.startswith(("HOLO_PROJECTION_ring", "HOLO_PROJECTION_scale", "HOLO_PROJECTION_tick", "HOLO_BEAM")):
        return "line"
    if name.startswith("HOLO_UI_card"):
        return "card_bar" if "_bar_" in name else "card"
    if name == "HOLO_EMITTER":
        return "disc"
    return None


HOLO_LOOKS = {"body": (0.02, 1.6, 0.45, 0.014), "line": (0.9, 1.1, 0.0, 0.0), "card": (0.14, 1.0, 0.35, 0.0),
              "card_bar": (0.85, 1.3, 0.0, 0.0), "disc": (0.35, 1.0, 0.5, 0.0)}   # (fill, strength, fresnel, wire)


def apply_preview_holo():
    """Render-time only: lighter, more transparent hologram (glowing edges instead of a milky solid)."""
    import bpy
    for ob in list(bpy.data.objects):
        if ob.type != "MESH" or not ob.data.materials or not ob.data.materials[0] \
                or ob.data.materials[0].name != "M_Holo":
            continue
        role = _holo_role(ob.name)
        if not role:
            continue
        m = _holo_material(f"PREVIEW_holo_{role}", *HOLO_LOOKS[role])
        for i in range(len(ob.data.materials)):
            ob.data.materials[i] = m


if __name__ == "__main__":
    ensure_textures(force=True)
    print("written", sorted(os.listdir(OUT)))
