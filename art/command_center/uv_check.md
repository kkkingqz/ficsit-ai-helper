# Проверка UV и маски покраски — SM_CommandCenter (этап 5)

Собрано и проверено `blender/uv_check.py`. Плотность тайлинга: 1 UV = 2.0 м (текстура 1024 px → 512 px/м); полосы hazard: 1 UV = 0.5 м.

| Проверка | Результат |
|---|---|
| Мешей с UV0 `UVMap` и маской `PaintMask` | 1911 |
| Граней всего / тайлинг / атласы | 26287 / 23509 / 888 |
| Плотность на тайлинговых гранях (отн. цели) | 0.9997 … 1.0002 |
| Грани фасок в маске кромок `PaintMask.B` | 7583 |
| Щепки после булевых операций (< 1 см², не проверяются; очистка сетки — этап 6) | 2066 |
| Ошибок | 0 ✅ |

## Экраны: все UI-плоскости 16:9 (одна текстура подходит на любой экран)

| Экран | Размер, м | Соотношение | Ячейка атласа |
|---|---|---|---|
| `BACK_BAND_gauge_0` | 0.480 × 0.270 | 1.778 : 1 | ui_status_2 |
| `BACK_BAND_gauge_1` | 0.480 × 0.270 | 1.778 : 1 | ui_status_0 |
| `CONSOLE_TOWER_left_screen` | 0.320 × 0.180 | 1.778 : 1 | ui_cam |
| `CONTROL_PANELS_centre_touch` | 0.500 × 0.281 | 1.778 : 1 | ui_idle |
| `DISPLAY_MAIN_RT` | 2.600 × 1.463 | 1.778 : 1 | RT |
| `DISPLAY_PLANES_wing_left` | 1.300 × 0.731 | 1.778 : 1 | ui_wing |
| `DISPLAY_PLANES_wing_left_upper` | 0.900 × 0.506 | 1.778 : 1 | ui_tasks |
| `DISPLAY_PLANES_wing_right` | 1.300 × 0.731 | 1.778 : 1 | ui_list |
| `DISPLAY_PLANES_wing_right_upper` | 0.900 × 0.506 | 1.778 : 1 | ui_map |
| `DOOR_IN_control_screen` | 0.220 × 0.124 | 1.778 : 1 | ui_status_2 |
| `DOOR_reader_screen` | 0.220 × 0.124 | 1.778 : 1 | ui_status_2 |
| `HOLO_FEED_control_screen` | 0.320 × 0.180 | 1.778 : 1 | ui_resources |
| `HOLO_UI_card_0` | 0.512 × 0.288 | 1.778 : 1 | holo card |
| `HOLO_UI_card_1` | 0.512 × 0.288 | 1.778 : 1 | holo card |
| `HOLO_UI_card_2` | 0.512 × 0.288 | 1.778 : 1 | holo card |
| `LEFT_TECHBLOCK_screen_0` | 0.500 × 0.281 | 1.778 : 1 | ui_status_1 |
| `LEFT_TECHBLOCK_screen_1` | 0.500 × 0.281 | 1.778 : 1 | ui_status_2 |
| `RIGHT_CABINET_window` | 0.450 × 0.253 | 1.778 : 1 | ui_status_1 |
| `RIGHT_IFACE_screen` | 0.450 × 0.253 | 1.778 : 1 | ui_status_0 |
| `SERVICE_CONSOLE_screen` | 0.420 × 0.236 | 1.778 : 1 | ui_warning |
| `WALL_F_band_3_control_screen` | 0.480 × 0.270 | 1.778 : 1 | ui_logistics |

Индикаторы не 16:9 (светящиеся клавиши, дисплеи-полоски у ручек, окно маяка, мелкие лампы) берут светящуюся полосу атласа, а не UI-картинку.

