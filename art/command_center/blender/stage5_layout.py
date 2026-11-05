"""Stage 5 texture / UV layout shared by the texture generator (system Python + Pillow) and the UV pass (Blender).

No imports from bpy or PIL here: both sides read the same cell tables, so atlas cells never drift apart.

UV0 rules (per FACE, by the face's material slot):
  * tiling slots  - exact per-face planar projection, TILE_M metres per UV unit (uniform texel density everywhere,
                    also on 45-degree chamfers); textures tile in both directions;
  * M_Hazard      - planar on the plate, HAZARD_M metres per UV unit (same stripe width on every part);
  * M_Decal       - one cell of the decal atlas per object (labels, signs, floor stencils; white cell for lane marks);
  * M_ScreenStatic- one cell of the screen atlas per screen; LEDs / tiny indicators -> the LED strip;
  * M_ScreenRT    - exactly 0..1 (render target);
  * emissive / holo / glass - planar 0..1 or tiling (no texture needed).
Paint mask: face-corner colour attribute "PaintMask": R = primary paint (M_PaintOrange), G = secondary (M_PaintGray).
"""
import hashlib

TILE_M = 2.0            # metres per UV unit on tiling slots -> 1024 px texture = 512 px/m
HAZARD_M = 0.5          # metres per UV unit on hazard stripes (one black + one yellow band per tile)
ATLAS_PX = 2048
PAD = 4 / ATLAS_PX      # UV padding inside each atlas cell

TILING = ("M_PaintOrange", "M_PaintGray", "M_MetalDark", "M_MetalBare", "M_Rubber", "M_Glass")
PLANAR01 = ("M_LightWarm", "M_Beacon", "M_Holo")

# ---- decal atlas: 2 columns x 8 rows of 1024 x 256 (4:1) --------------------------------------------------------------
LABELS = (("SERVICE ACCESS", "AUTHORISED ONLY"), ("FICSIT INC.", "UNIT CC-01"), ("POWER 480 V", "ISOLATE FIRST"),
          ("COOLANT LOOP", "B-02  MAX 6 BAR"), ("DATA NODE", "NET 04 / OP-01"), ("INSPECT", "EVERY 200 H"),
          ("CAUTION", "MOVING PARTS"), ("SPARE PARTS", "RACK 3"))
DECAL_CELLS = [f"label_{k}" for k in range(len(LABELS))] + ["sign_cc", "sign_entry", "sign_exit", "floor_operator",
                                                            "floor_service", "floor_holo", "floor_tech", "white"]
DECAL_GRID = (2, 8)

# ---- screen atlas: 2 columns x 3 rows of 1024 x 576 (16:9) + LED strip at the bottom -------------------------------
SCREEN_CELLS = ["ui_wing", "ui_list", "ui_cam", "ui_status_0", "ui_status_1", "ui_status_2"]
SCREEN_GRID = (2, 3)
SCREEN_CELL_PX = (1024, 576)
LED_RECT_PX = (0, 1728, 2048, 2048)   # x0, y0, x1, y1 in pixels (top-left origin): cyan half | amber half

SCREEN_BY_NAME = {"DISPLAY_PLANES_wing_left": "ui_wing", "DISPLAY_PLANES_wing_right": "ui_list",
                  "DISPLAY_PLANES_wing_left_upper": "ui_cam", "DISPLAY_PLANES_wing_right_upper": "ui_wing"}


def pick(name, n):
    return int(hashlib.md5(name.encode()).hexdigest(), 16) % n


def decal_cell_for(name, dims):
    """dims = object dimensions sorted descending."""
    if name.startswith("FLOOR_lane") or dims[1] < 0.05 or dims[0] / max(dims[1], 1e-6) < 1.5:
        return "white"
    if name.startswith("DECALS_logo") or name == "DECALS_sign_front":
        return "sign_cc"
    if name == "DECALS_sign_back":
        return "sign_entry"
    if name == "DOOR_IN_sign_label":
        return "sign_exit"
    if name.startswith("FLOOR_label_"):
        return "floor_" + name[len("FLOOR_label_"):]
    return f"label_{pick(name, len(LABELS))}"


def screen_cell_for(name, dims):
    if dims[1] < 0.05 or "led" in name.lower():
        return "led"
    if name in SCREEN_BY_NAME:
        return SCREEN_BY_NAME[name]
    return f"ui_status_{pick(name, 3)}"


def _rect_uv(x0, y0, x1, y1):
    """Pixel rect (top-left origin) -> UV rect (u0, v0, u1, v1) with v up, padded."""
    return (x0 / ATLAS_PX + PAD, 1 - y1 / ATLAS_PX + PAD, x1 / ATLAS_PX - PAD, 1 - y0 / ATLAS_PX - PAD)


def decal_rect(cell):
    i = DECAL_CELLS.index(cell)
    cols, rows = DECAL_GRID
    cw, ch = ATLAS_PX // cols, ATLAS_PX // rows
    c, r = i % cols, i // cols
    return _rect_uv(c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)


def decal_rect_px(cell):
    i = DECAL_CELLS.index(cell)
    cols, rows = DECAL_GRID
    cw, ch = ATLAS_PX // cols, ATLAS_PX // rows
    c, r = i % cols, i // cols
    return (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)


def screen_rect_px(cell):
    if cell == "led":
        return LED_RECT_PX
    i = SCREEN_CELLS.index(cell)
    cols, _ = SCREEN_GRID
    cw, ch = SCREEN_CELL_PX
    c, r = i % cols, i // cols
    return (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)


def screen_rect(cell):
    return _rect_uv(*screen_rect_px(cell))
