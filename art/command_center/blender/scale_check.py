"""Scale / ergonomics check for SM_CommandCenter against a 1.8 m pioneer (stage 4 final check).

    python scale_check.py                       # measure, print the table, write ../scale_check.md
    python scale_check.py --render ../renders/scale [--samples 16]   # + shots with 1.8 m capsules placed in key spots

Measures the REAL geometry (world bounding boxes of the named exported objects), compares with target ranges for a
standing 1.8 m player (eye height 1.65 m, UE-style capsule r = 0.3 m) and writes a markdown report. Heights are above
the interior floor F unless stated otherwise. Capsules are reference objects only (never exported).
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: F401  (must precede bmesh when running from the bpy wheel)
from mathutils import Vector

import build_model
import cc_lib
import interior_model as im

PLAYER_H, EYE_H, CAP_R = 1.8, 1.65, 0.3
HERE = os.path.dirname(os.path.abspath(__file__))


def bbox(name):
    ob = bpy.data.objects.get(name)
    if ob is None:
        raise KeyError(name)
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi


def screen_wh(name):
    """Width x height of a screen plane in its own plane (thin box, any yaw/tilt): from the mesh edges."""
    ob = bpy.data.objects[name]
    me = ob.data
    vs = [ob.matrix_world @ v.co for v in me.vertices]
    lens = sorted({round((vs[e.vertices[0]] - vs[e.vertices[1]]).length, 4) for e in me.edges}, reverse=True)
    w, h = lens[0], lens[1]
    return w, h


def measure():
    F = im.F
    rows = []          # (group, item, value, target, verdict, note)

    def add(group, item, value, lo, hi, unit="m", note=""):
        ok = (lo is None or value >= lo - 1e-6) and (hi is None or value <= hi + 1e-6)
        tgt = (f"{lo:.2f}–{hi:.2f}" if lo is not None and hi is not None else
               f"≥ {lo:.2f}" if lo is not None else f"≤ {hi:.2f}")
        rows.append((group, item, f"{value:.2f} {unit}".strip(), tgt, "OK" if ok else "CHECK", note))

    # ---- door ---------------------------------------------------------------------------------------------------------
    l_lo, l_hi = bbox("DOOR_IN_frame_-1")
    r_lo, r_hi = bbox("DOOR_IN_frame_+1")
    t_lo, _ = bbox("DOOR_IN_frame_top")
    clear_w = r_lo.x - l_hi.x
    add("Дверь", "ширина в свету", clear_w, 2 * CAP_R + 1.0, 3.0, note="капсула 0,6 м + запас на развороты; ворота Satisfactory ~2–3 м")
    add("Дверь", "высота в свету от земли (низ лестницы)", t_lo.z, PLAYER_H + 0.8, 4.0)
    add("Дверь", "просвет над верхней ступенью (+1,0 м)", t_lo.z - 1.0, PLAYER_H + 0.3, None, note="U-4: ≥ 2,2 м с рюкзаком/джетпаком")
    s_lo, s_hi = bbox("STEPS_0")
    add("Дверь", "подъём ступени", s_hi.z - s_lo.z, 0.15, 0.3, note="шаг персонажа UE ~0,45 м, комфортно ≤ 0,3")
    # ---- rails --------------------------------------------------------------------------------------------------------
    _, rt_hi = bbox("PIT_RAIL_L_rail_top")
    add("Перила", "верх поручня над полом", rt_hi.z - F, 1.0, 1.15, note="промышленная норма 1,0–1,1 м")
    _, rm_hi = bbox("PIT_RAIL_L_rail_mid")
    add("Перила", "средняя перекладина над полом", rm_hi.z - F, 0.45, 0.65)
    rl_lo, rl_hi = bbox("PIT_RAIL_L_rail_top")
    rr_lo, _ = bbox("PIT_RAIL_R_rail_top")
    add("Перила", "проход между перилами", rr_lo.x - rl_hi.x, 2 * CAP_R + 1.2, None)
    add("Перила", "сечение поручня (ширина)", rl_hi.x - rl_lo.x, 0.06, 0.12, note="читаемость в игре: ≥ 6 см")
    # ---- wall terminals -----------------------------------------------------------------------------------------------
    for name, label in (("SERVICE_CONSOLE_screen", "служебная консоль: центр экрана"),
                        ("DOOR_IN_control_screen", "пульт двери: центр экрана"),
                        ("DOOR_IN_reader_pad", "считыватель карт: центр")):
        lo, hi = bbox(name)
        add("Терминалы", label, (lo.z + hi.z) / 2 - F, 1.2 if "экрана" in label else 1.0, 1.6 if "экрана" in label else 1.35,
            note="экран ≈ уровень глаз 1,65 или чуть ниже; считыватель — уровень руки 1,0–1,3")
    _, sh = bbox("SERVICE_CONSOLE_shelf")
    add("Терминалы", "служебная консоль: полка с клавишами", sh.z - F, 1.0, 1.25, note="рабочая высота стоя")
    lo, hi = bbox("POWER_board")
    add("Терминалы", "силовой щит: центр", (lo.z + hi.z) / 2 - F, 1.2, 1.7)
    # ---- projector frames ---------------------------------------------------------------------------------------------
    g_lo, g_hi = bbox("HOLO_MOUNT_girder_0")
    add("Проектор", "несущая рама: ширина ригеля", g_hi.x - g_lo.x, 0.22, 0.3, note="FRAME_MAJOR 0,24 / балки потолка 0,26–0,30")
    add("Проектор", "несущая рама: высота ригеля", g_hi.z - g_lo.z, 0.18, 0.3)
    b_lo, b_hi = bbox("HOLO_PROJECTOR_band")
    add("Проектор", "оранжевый пояс эмиттера: высота", b_hi.z - b_lo.z, 0.08, 0.16)
    p_lo, p_hi = bbox("HOLO_PEDESTAL_band")
    add("Проектор", "оранжевый пояс основания: высота", p_hi.z - p_lo.z, 0.06, 0.12, note="FRAME_MINOR 0,12")
    e_lo, e_hi = bbox("HOLO_EMITTER")
    add("Проектор", "плоскость эмиттера над полом", e_hi.z - F, 0.8, 1.1, note="голограмма на уровне груди-глаз")
    add("Проектор", "просвет эмиттер ↔ потолочный модуль", bbox("HOLO_PROJECTOR_lower")[0].z - e_hi.z, 3.0, None)
    # ---- console --------------------------------------------------------------------------------------------------
    add("Пульт", "глубина нижних тумб", im.CONSOLE_DEPTH, 0.6, 0.85, note="стоя без ниши для колен: 0,6–0,8")
    _, pad = bbox("CONSOLE_armpad_centre")
    add("Пульт", "передняя кромка (подлокотник)", pad.z - F, 0.95, 1.1, note="стоячий стол: 0,95–1,1 для 1,8 м")
    add("Пульт", "ниша для носков: высота", 0.1, 0.08, 0.15)
    _, deck = bbox("CONTROL_DECK_centre")
    add("Пульт", "верх деки", deck.z - F, 1.0, 1.25)
    m_lo, m_hi = bbox("DISPLAY_MAIN_RT")
    eye_y = im.OPERATOR_XY[1] + 0.15          # operator stands on the mat
    dist = abs(eye_y - (m_lo.y + m_hi.y) / 2)
    mw, mh = screen_wh("DISPLAY_MAIN_RT")
    add("Пульт", "расстояние глаза → главный экран", dist, 1.0, 2.0)
    add("Пульт", "главный экран: горизонтальный угол обзора", math.degrees(2 * math.atan(mw / 2 / dist)), 40, 100, "°",
        note="кино ~60°; в игре UMG открывается поверх, экран — образ")
    add("Пульт", "главный экран: верх над уровнем глаз (угол)", math.degrees(math.atan((m_hi.z - F - EYE_H) / dist)), None, 40,
        "°", note="при > 30° игрок задирает камеру")
    add("Пульт", "главный экран: центр над полом", (m_lo.z + m_hi.z) / 2 - F, 1.6, 2.2)
    # ---- screens: aspect --------------------------------------------------------------------------------------------
    scr = []
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data.materials and ob.data.materials[0] and \
                ob.data.materials[0].name in ("M_ScreenRT", "M_ScreenStatic") and ob.name.startswith(("DISPLAY", "SERVICE_CONSOLE_screen",
                                                                                                    "DOOR_IN_control_screen",
                                                                                                    "CONSOLE_TOWER_left_screen",
                                                                                                    "WALL_F_band_3_control_screen",
                                                                                                    "HOLO_FEED_control_screen")):
            w, h = screen_wh(ob.name)
            if h > 0.05:
                scr.append((ob.name, w, h))
    for name, w, h in sorted(scr):
        r = w / h
        std = min((abs(r - 16 / 9), "16:9"), (abs(r - 4 / 3), "4:3"), (abs(r - 1.0), "1:1"))
        rows.append(("Экраны", name, f"{w:.2f} × {h:.2f} ({r:.2f}:1)", "16:9 / 4:3 / 1:1",
                     "OK" if std[0] < 0.03 else "CHECK", f"ближайший {std[1]}"))
    return rows


def report(rows, path):
    lines = ["# Проверка масштаба и эргономики — SM_CommandCenter", "",
             f"Эталон: игрок {PLAYER_H} м, глаза {EYE_H} м, капсула r = {CAP_R} м. Измерено по геометрии модели "
             "(`blender/scale_check.py`), высоты — от пола интерьера (+1,02 м над фундаментом), если не сказано иное.", "",
             "| Узел | Параметр | Значение | Цель | Итог | Примечание |", "|---|---|---|---|---|---|"]
    for g, i, v, t, ok, n in rows:
        lines.append(f"| {g} | {i} | {v} | {t} | {'✅' if ok == 'OK' else '⚠️'} | {n} |")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


CAPSULES = {           # name: (x, y, z_floor)
    "door_top_step": (cc_lib.DOOR_X, im.YW - 0.15, 1.0),
    "door_outside": (cc_lib.DOOR_X, cc_lib.D / 2 + 0.6, 0.0),
    "landing_rail": (cc_lib.DOOR_X - 0.6, im.YW - 1.6, None),
    "service_console": (3.22, im.YW - 0.75, None),
    "door_control": (-2.88, im.YW - 0.7, None),
    "projector": (im.HOLO_XY[0] - 1.9, im.HOLO_XY[1] - 0.6, None),
    "operator": (im.OPERATOR_XY[0] + 0.4, im.OPERATOR_XY[1] + 0.15, None),
    "window_band": (3.45, -2.6, None),
}

SCALE_SHOTS = {
    "S1_door": ((-1.0, -0.6, 2.4), (-1.0, 3.45, 2.0), None, 18),
    "S2_console": ((-0.6, 0.3, 2.6), (-3.0, -2.6, 2.1), None, 20),
    "S3_service": ((0.4, 0.6, 2.4), (3.6, 3.4, 1.9), None, 20),
    "S4_projector": ((-0.8, 1.2, 2.3), (2.4, -0.9, 1.7), None, 18),
    "S5_section": ((0.0, -12.0, 2.7), (0.0, 0.0, 2.7), 15.4, 0, 10.6),   # cut at y = -1.4: console out, back half in
}


def place_capsules(mats, ref):
    m = bpy.data.materials.new("REF_Capsule")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.1, 0.85, 0.35, 1.0)
    b.inputs["Emission Color"].default_value = (0.1, 0.85, 0.35, 1.0)
    b.inputs["Emission Strength"].default_value = 0.4
    for ob in list(ref.objects):
        if ob.name.startswith("REF_player"):
            ob.hide_render = True
    for nm, (x, y, z) in CAPSULES.items():
        z0 = im.F if z is None else z
        cc_lib.cylinder(f"REF_scale_{nm}", (x, y, z0 + PLAYER_H / 2), CAP_R, PLAYER_H, m, ref, 16)
        cc_lib.box(f"REF_scale_{nm}_eye", (x, y - CAP_R, z0 + EYE_H), (0.3, 0.04, 0.04), mats["M_LightWarm"], ref)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", default=None)
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--shots", default=None, help="comma-separated subset of S1..S5")
    ap.add_argument("--report", default=os.path.join(HERE, "..", "scale_check.md"))
    a = ap.parse_args(sys.argv[1:])
    cc_lib.reset_scene()
    mats = cc_lib.make_materials()
    exp = cc_lib.collection("EXPORT")
    ref = cc_lib.collection("REF_NOT_EXPORTED")
    build_model.build(mats, exp, ref)
    rows = measure()
    report(rows, a.report)
    for g, i, v, t, ok, n in rows:
        print(f"[scale] {ok:5s} {g:10s} {i:45s} {v:22s} target {t}")
    if a.render:
        place_capsules(mats, ref)
        for hook in cc_lib.PREVIEW_HOOKS:
            hook()
        cc_lib.setup_render(samples=a.samples)
        os.makedirs(a.render, exist_ok=True)
        s = bpy.context.scene
        only = a.shots.split(",") if a.shots else None
        for name, spec in SCALE_SHOTS.items():
            if only and name not in only:
                continue
            loc, tgt, ortho, lens = spec[:4]
            s.camera = cc_lib.camera(f"CAM_{name}", loc, tgt, ortho, lens, spec[4] if len(spec) > 4 else None)
            s.render.filepath = os.path.join(a.render, f"{name}.png")
            bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
