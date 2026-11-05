"""Preview-only test UI for two console screens (stage 4 previews).

Generates two simple placeholder UI images with Pillow and, for RENDERS ONLY (after export), swaps the screen material
of DISPLAY_MAIN_RT and the left wing lower screen to an emissive image material. Exports keep the 13 standard slots:
in UE the main screen is a render target (FR-01 AI Terminal UMG), the static screens get a material instance.

    python ui_preview.py            # (re)generate ../textures/preview/ui_*.png
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "textures", "preview")
MAIN_PNG = os.path.join(OUT, "ui_main.png")
WING_PNG = os.path.join(OUT, "ui_wing.png")

BG, PANEL, LINE = (9, 22, 40), (18, 40, 66), (40, 80, 120)
ORANGE, CYAN, AMBER, GREEN, WHITE = (242, 155, 56), (90, 200, 255), (255, 190, 60), (110, 220, 140), (225, 235, 245)


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


def make_main(path=MAIN_PNG):
    """AI Terminal main screen: header, factory map, assistant dialogue, production bars, power gauge, status strip."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 1920, 90), fill=ORANGE)
    d.text((40, 20), "FICSIT  AI TERMINAL", fill=BG, font=_font(48))
    d.text((1480, 28), "ONLINE  //  OP-01", fill=BG, font=_font(34))
    # factory map
    _panel(d, (40, 130, 620, 760), "FACTORY MAP")
    for gx in range(8):
        for gy in range(8):
            x0, y0 = 70 + gx * 66, 200 + gy * 66
            lit = (gx * 3 + gy * 5) % 7 in (0, 3)
            d.rectangle((x0, y0, x0 + 56, y0 + 56), fill=CYAN if lit else (26, 56, 88))
    d.rectangle((70 + 4 * 66 - 6, 200 + 3 * 66 - 6, 70 + 4 * 66 + 62, 200 + 3 * 66 + 62), outline=ORANGE, width=6)
    # assistant dialogue
    _panel(d, (660, 130, 1340, 760), "ASSISTANT")
    rows = [(0, "Q: How do I unlock Tier 3?", WHITE), (1, "Milestone: Coal Power", CYAN), (1, "Build 2 Coal Generators", CYAN),
            (0, "Q: Iron plates low?", WHITE), (1, "Add a 2nd Constructor", CYAN), (1, "Input 30/min -> 20/min", AMBER)]
    for i, (side, txt, col) in enumerate(rows):
        y = 200 + i * 88
        x0 = 690 if side == 0 else 760
        d.rectangle((x0, y, x0 + 540, y + 66), fill=(30, 62, 96) if side == 0 else (16, 54, 80), outline=col, width=3)
        d.text((x0 + 18, y + 16), txt, fill=col, font=_font(30))
    # production bars
    _panel(d, (1380, 130, 1880, 520), "PRODUCTION / MIN")
    for i, (v, col) in enumerate(((0.9, GREEN), (0.65, CYAN), (0.4, AMBER), (0.75, CYAN), (0.25, ORANGE))):
        y = 200 + i * 62
        d.rectangle((1410, y, 1850, y + 40), fill=(26, 56, 88))
        d.rectangle((1410, y, 1410 + int(440 * v), y + 40), fill=col)
    # power gauge
    _panel(d, (1380, 550, 1880, 760), "POWER")
    d.arc((1430, 600, 1590, 760), 180, 360, fill=(26, 56, 88), width=22)
    d.arc((1430, 600, 1590, 760), 180, 300, fill=GREEN, width=22)
    d.text((1630, 640), "1.2 GW", fill=WHITE, font=_font(44))
    # status strip
    for i, (txt, col) in enumerate((("POWER OK", GREEN), ("BELTS 98%", CYAN), ("ALERT: SULFUR", AMBER), ("HUB LINK", GREEN))):
        x0 = 40 + i * 470
        d.rectangle((x0, 800, x0 + 440, 880), fill=PANEL, outline=col, width=4)
        d.text((x0 + 24, 820), txt, fill=col, font=_font(34))
    d.rectangle((40, 920, 1880, 1040), fill=PANEL, outline=LINE, width=3)
    d.text((70, 955), "> ask the assistant ...", fill=(140, 170, 200), font=_font(40))
    d.rectangle((1700, 945, 1850, 1015), fill=ORANGE)
    im.save(path)


def make_wing(path=WING_PNG):
    """Wing screen: power-grid trend line + four status tiles."""
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


def ensure_textures():
    os.makedirs(OUT, exist_ok=True)
    if not os.path.exists(MAIN_PNG):
        make_main()
    if not os.path.exists(WING_PNG):
        make_wing()


def _ui_material(name, png, strength=1.4):
    import bpy
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png, check_existing=True)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["X"], inv.inputs[1])       # the operator looks towards -y: screen right = world -x
    nt.links.new(inv.outputs[0], comb.inputs["X"])
    nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
    nt.links.new(comb.outputs[0], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def apply_preview_ui():
    """Render-time only: put the test UI on DISPLAY_MAIN_RT and the left wing lower screen."""
    import bpy
    ensure_textures()
    for obj_name, mat_name, png in (("DISPLAY_MAIN_RT", "PREVIEW_UI_main", MAIN_PNG),
                                    ("DISPLAY_PLANES_wing_left", "PREVIEW_UI_wing", WING_PNG)):
        ob = bpy.data.objects.get(obj_name)
        if ob is None:
            continue
        m = _ui_material(mat_name, png)
        for i in range(len(ob.data.materials)):
            ob.data.materials[i] = m


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_main()
    make_wing()
    print("written", MAIN_PNG, WING_PNG)
