"""Stage 5 texture / UV layout shared by the texture generator (system Python + Pillow) and the UV pass (Blender).

No imports from bpy or PIL here: both sides read the same cell tables, so atlas cells never drift apart.

UV0 rules (per FACE, by the face's material slot):
  * tiling slots  - exact per-face planar projection, TILE_M metres per UV unit (uniform texel density everywhere,
                    also on 45-degree chamfers); textures tile in both directions;
  * M_Hazard      - planar on the plate, HAZARD_M metres per UV unit (same stripe width on every part);
  * M_Decal       - one cell of the decal atlas per object, picked by what the part IS (power -> POWER tag,
                    cabinets -> numbers, projector -> HP-01, console modules -> 01..04 ...); square plates -> icons;
  * M_ScreenStatic- one cell of the screen atlas per screen (assistant tasks, map, logistics, ...); LEDs -> LED strip;
  * M_ScreenRT    - exactly 0..1 (render target);
  * emissive / holo / glass - planar 0..1 or tiling (no texture needed).
Paint mask: face-corner colour attribute "PaintMask": R = primary (M_PaintOrange), G = secondary (M_PaintGray),
B = chamfer edges. All text on textures is English.
"""
import hashlib
import re

TILE_M = 2.0            # metres per UV unit on tiling slots -> 1024 px texture = 512 px/m
HAZARD_M = 0.5          # metres per UV unit on hazard stripes (one black + one yellow band per tile)

TILING = ("M_PaintOrange", "M_PaintGray", "M_MetalDark", "M_MetalBare", "M_MetalTread", "M_Rubber", "M_Glass")
PLANAR01 = ("M_LightWarm", "M_Beacon", "M_Holo")

# ---- palette (texture concept boards) ---------------------------------------------------------------------------------
PALETTE = {"ficsit_orange": "#F59B1B", "graphite": "#1F2329", "tech_grey": "#5B6470", "panel_grey": "#B7BDC4",
           "hazard_yellow": "#F3C540", "light_white": "#F7FAFF", "ui_blue": "#7FD7FF", "plate_dark": "#2E3640"}


def rgb(name):
    h = PALETTE[name].lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def linear(name):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(round(lin(c), 4) for c in rgb(name))


# ---- decal atlas: 4096 x 2048; rows 0..6 = 4 x 7 strips of 1024 x 256 (4:1); row 7 = 16 icons of 256 x 256 ---------
DECAL_W, DECAL_H = 4096, 2048
STRIP = (1024, 256)
LABELS = (("SERVICE ACCESS", "AUTHORISED ONLY", "tools"), ("FICSIT INC.", "UNIT CC-01", "data"),
          ("POWER 480 V", "ISOLATE FIRST", "electric"), ("COOLANT LOOP", "B-02  MAX 6 BAR", "heat"),
          ("DATA NODE", "NET 04 / OP-01", "data"), ("INSPECT", "EVERY 200 H", "tools"),
          ("CAUTION", "MOVING PARTS", "warn"), ("SPARE PARTS", "RACK 3", "tools"))
TAGS = ("SERVICE", "ACCESS", "POWER", "VENTILATION")
IDS = ("CC-01", "HP-01", "CS-3A")
DECAL_STRIPS = ([f"label_{k}" for k in range(len(LABELS))] + ["sign_cc", "sign_entry", "sign_exit",
                "floor_operator", "floor_service", "floor_holo", "floor_tech"]
                + [f"tag_{t.lower()}" for t in TAGS] + [f"id_{i.lower().replace('-', '')}" for i in IDS]
                + [f"num_{k:02d}" for k in range(1, 5)] + ["barcode", "high_voltage"])
ICONS = ("warn", "electric", "tools", "heat", "fan", "data", "chevrons", "bracket", "white")
DECAL_CELLS = DECAL_STRIPS + [f"icon_{i}" for i in ICONS]
DECAL_GRID = (4, 7)
assert len(DECAL_STRIPS) <= DECAL_GRID[0] * DECAL_GRID[1], "decal strips do not fit"

# ---- screen atlas: 4096 x 2048; 4 x 3 cells of 1024 x 576 (16:9) + LED glow strip at the bottom --------------------
SCREEN_W, SCREEN_H = 4096, 2048
SCREEN_CELLS = ["ui_wing", "ui_list", "ui_cam", "ui_status_0", "ui_status_1", "ui_status_2", "ui_tasks", "ui_map",
                "ui_logistics", "ui_warning", "ui_resources", "ui_idle"]
SCREEN_GRID = (4, 3)
SCREEN_CELL_PX = (1024, 576)
LED_RECT_PX = (0, 1728, SCREEN_W, SCREEN_H)
SCREEN_BY_NAME = {"DISPLAY_PLANES_wing_left": "ui_wing", "DISPLAY_PLANES_wing_right": "ui_list",
                  "DISPLAY_PLANES_wing_left_upper": "ui_tasks", "DISPLAY_PLANES_wing_right_upper": "ui_map",
                  "SERVICE_CONSOLE_screen": "ui_warning", "BASE_SERVICE_screen": "ui_warning",
                  "HOLO_FEED_control_screen": "ui_resources", "CONTROL_PANELS_centre_touch": "ui_idle",
                  "CONSOLE_TOWER_left_screen": "ui_cam", "DOOR_IN_control_screen": "ui_status_2",
                  "DOOR_reader_screen": "ui_status_2"}
PAD_PX = 4


def pick(name, n):
    return int(hashlib.md5(name.encode()).hexdigest(), 16) % n


def _icon_for(n):
    u = n.upper()
    if any(k in u for k in ("POWER", "BREAKER", "ENERGY", "ELECT")):
        return "icon_electric"
    if any(k in u for k in ("COOL", "HVAC", "VENT", "FAN", "PUMP")):
        return "icon_fan"
    if any(k in u for k in ("HATCH", "SERVICE", "COVER")):
        return "icon_tools"
    if "DATA" in u or "RACK" in u:
        return "icon_data"
    return "icon_warn"


def decal_cell_for(name, dims):
    """dims = object dimensions sorted descending. The cell says what the part is."""
    n, u = name, name.upper()
    if n.startswith("FLOOR_lane") or dims[1] < 0.05:
        return "icon_white"
    if n.startswith("DECALS_logo") or n == "DECALS_sign_front":
        return "sign_cc"
    if n == "DECALS_sign_back":
        return "sign_entry"
    if n == "DOOR_IN_sign_label":
        return "sign_exit"
    if n.startswith("FLOOR_label_"):
        return "floor_" + n[len("FLOOR_label_"):]
    if dims[0] / max(dims[1], 1e-6) < 1.5:                      # square plates carry a pictogram
        return _icon_for(n)
    m = re.search(r"_(?:key|toggle|dial)_(\d+)_label$", n) or re.search(r"INT_CABINET_(\d+)_label$", n)
    if m:                                                       # repeated modules / cabinets are numbered
        return f"num_{min(int(m.group(1)) + 1, 4):02d}"
    if "warning_text" in n:
        return "high_voltage" if ("WALL_B_3" in n or "PYLON_back_R" in n) else "label_6"
    if "POWER_board" in n:
        return "high_voltage"
    if "ACCESS" in u:
        return "tag_access"
    if n.endswith("_plate") or "CABINET_plate" in n:
        return "barcode"
    if "HOLO" in u and "ENERGY" not in u and "COOLER" not in u:
        return "id_hp01"
    if any(k in u for k in ("POWER", "BREAKER", "ENERGY")):
        return "tag_power"
    if any(k in u for k in ("COOL", "HVAC", "VENT", "PUMP")):
        return "tag_ventilation"
    if "UNIT_ID" in u or "COMMS" in u:
        return "id_cc01"
    if "CONTAINER_PARTS" in u:
        return "label_7"
    if "CONTAINER_CELLS" in u:
        return "label_2"
    if "RACK" in u:
        return "label_4"
    if "CONSOLE" in u and "HATCH" not in u:
        return "id_cs3a"
    if any(k in u for k in ("SERVICE", "HATCH")):
        return "tag_service"
    return f"label_{pick(n, len(LABELS))}"


def screen_cell_for(name, dims):
    if dims[1] < 0.05 or "led" in name.lower():
        return "led"
    if name in SCREEN_BY_NAME:
        return SCREEN_BY_NAME[name]
    if "_control_screen" in name and name.startswith("WALL_F_band"):
        return "ui_logistics"
    return f"ui_status_{pick(name, 3)}"


def decal_rect_px(cell):
    if cell.startswith("icon_"):
        i = ICONS.index(cell[5:])
        return (i * 256, 7 * 256, (i + 1) * 256, 8 * 256)
    i = DECAL_STRIPS.index(cell)
    cols, _ = DECAL_GRID
    cw, ch = STRIP
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


def _rect_uv(px, w, h):
    """Pixel rect (top-left origin) -> padded UV rect (u0, v0, u1, v1) with v up."""
    x0, y0, x1, y1 = px
    pu, pv = PAD_PX / w, PAD_PX / h
    return (x0 / w + pu, 1 - y1 / h + pv, x1 / w - pu, 1 - y0 / h - pv)


def decal_rect(cell):
    return _rect_uv(decal_rect_px(cell), DECAL_W, DECAL_H)


def screen_rect(cell):
    return _rect_uv(screen_rect_px(cell), SCREEN_W, SCREEN_H)
