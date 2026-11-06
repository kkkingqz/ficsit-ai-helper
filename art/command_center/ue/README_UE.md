# Command Center — сборка в UE 5.6 (этап 7)

Инструкция для того, кто собирает здание в редакторе мода. Всё, что можно было сделать без Unreal Editor, уже
лежит в репозитории; здесь — что запустить, что настроить руками, что проверить в игре и что прислать обратно.

> **Статус пакета.** Скрипт `ue_import_command_center.py` и C++ в `Source/` **написаны без доступа к UE/SML и ни разу
> не запускались**. Всё, что зависит от версии движка или FactoryGame, помечено `VERIFY`; скрипт при любой ошибке не
> падает, а пишет шаг для ручного выполнения в `ue_manual_steps.txt`.

## 0. Что в пакете

| Файл | Что это |
|---|---|
| `../export/ue/*.fbx` | игровые меши этапа 6 (см. таблицу ниже) |
| `../textures/T_CC_*.png`, `../textures/manifest.json` | текстуры этапа 5 и манифест (sRGB, сжатие, параметры слотов, палитра) |
| `content_spec.json` | **единый источник данных**: пути в Content, меши, LOD, питание, рецепт, схема, иконки |
| `ue_material_map.json` | карта «слот → мастер-материал игры + имена параметров»: **заполняется по шагу 2** |
| `ue_import_command_center.py` | Python-скрипт для редактора: `--discover`, `--import`, `--content`, `--verify` |
| `Source/FicsitAIHelper/...` | черновик C++: `AFAIHCommandCenter` и `UFAIHTerminalEvents` (папка `GameFacade/`, ADR-021) |
| `icons/IconDesc_CommandCenter_512.png`, `_256.png` | иконки меню строительства (прозрачный фон) |
| `../export/ue/clearance.json` | clearance-бокс |

| Меш | Файлы | Компонент в `Build_CommandCenter` |
|---|---|---|
| `SM_CommandCenter` | `SM_CommandCenter.fbx` (LOD0 + 28 UCX + 5 сокетов), `_LOD1.fbx`, `_LOD2.fbx` | `FGColoredInstanceMeshProxy`, тег **`Exterior`** |
| `SM_CommandCenter_Interior` | `_Interior.fbx`, `_Interior_LOD1.fbx` | `FGColoredInstanceMeshProxy`, тег **`Interior`**, Max Draw Distance 6000 |
| `SM_CommandCenter_ScreenRT` | `_ScreenRT.fbx` | `MainScreen` (C++), материал `MI_CC_ScreenRT` |
| `SM_CommandCenter_Holo` | `_Holo.fbx` | `HoloStatic` (C++) |
| `SM_CommandCenter_HoloSpin` | `_HoloSpin.fbx` (опорная точка = `SOCKET_holo`) | `HoloSpin` (C++), крепится к сокету сам |

Сокеты в `SM_CommandCenter`: `SOCKET_power` (силовой разъём), `SOCKET_interact` (центр зоны E у пульта),
`SOCKET_ui_camera` (глаза оператора → главный экран), `SOCKET_holo` (центр голограммы), `SOCKET_door` (порог снаружи).

## 1. Подготовка

1. Проект мода: форк Satisfactory Build Calculator (ADR-016) на целевом стеке **Satisfactory 1.2 / SML 3.12 / UE 5.6**
   (Coffee Stain UE 5.6, starter project SML). Mod reference — `FicsitAIHelper` (если в форке другой — поправить
   `mod_reference` и `content_root` в `content_spec.json`).
2. Включить плагин **Python Editor Script Plugin** (Edit → Plugins), перезапустить редактор.
3. Репозиторий `ficsit-ai-helper` доступен на диске (скрипт находит FBX и текстуры относительно себя).

## 2. Мастер-материалы игры (решение: используем игровые)

1. Output Log → Cmd:
   `py "<repo>/art/command_center/ue/ue_import_command_center.py" --discover`
   → `ue_material_discovery.json`: материалы `/Game/FactoryGame` с подходящими именами и их параметры
   (scalar / vector / texture / static switch).
2. В `ue_material_map.json` для каждого из 14 слотов указать `parent` и заполнить `game_param` у нужных значений
   (пустое — пропускается). Ориентиры:

   | Слоты | Что искать у игры |
   |---|---|
   | `M_PaintOrange`, `M_PaintGray` | фабричный мастер **с покраской** (primary / secondary). Цвет обычно даёт сама покраска — `base_color` оставить пустым. **U-11**: как этот мастер получает зоны — маска-текстура, цвет вершин или слот. У нас есть всё: два слота, атрибут цвета вершин `PaintMask` (R — primary, G — secondary, B — кромки фасок), UV0 с единой плотностью |
   | `M_MetalDark`, `M_MetalBare`, `M_MetalTread`, `M_Rubber` | фабричный мастер без покраски (металл / резина); подключить нормаль, деталь и ARW из манифеста, если у мастера есть такие входы |
   | `M_Glass` | стекло зданий игры |
   | `M_LightWarm`, `M_Beacon` | эмиссивные светильники / сигнальные огни |
   | `M_ScreenStatic` | эмиссивный экран с текстурой → `T_CC_ScreenAtlas_E` |
   | `M_ScreenRT` | эмиссивный экран с **texture-параметром**: его имя записать в `AFAIHCommandCenter::ScreenRTParameter` (по умолчанию `ScreenRT`) |
   | `M_Holo` | translucent additive (голограммы, проекторы); край по френелю, без заливки тела |
   | `M_Hazard`, `M_Decal` | материал с base color-текстурой → `T_CC_Hazard_D` / `T_CC_DecalAtlas_D` |

   Если для какого-то слота у игры нет подходящего мастера — создать простой свой (`MM_CC_<слот>`) по полям
   `textures/manifest.json` и указать его в `parent`.

## 3. Импорт

1. `py ".../ue_import_command_center.py" --import`. Скрипт:
   - импортирует текстуры с sRGB и сжатием из манифеста (`_N` — Normalmap, **DirectX**, без флипа зелёного;
     `_M`/`_ARW` — линейные маски; `_D`/`_E` — sRGB), иконки — группа UI;
   - импортирует меши: Combine Meshes, **Import Normals and Tangents**, без автогенерации коллизии (берутся `UCX_`),
     без лайтмап-UV, **Nanite выключен**, Remove Degenerates; LOD1/LOD2 — Import LOD в слоты 1/2 того же ассета;
   - создаёт `MI_CC_<слот>` от выбранных мастеров с параметрами из манифеста и раскладывает по секциям по
     **имени слота** (FBX сохраняет имена `M_*`).
2. Открыть `ue_manual_steps.txt` и выполнить всё, что скрипт не смог (обычно: экранные размеры LOD, Nanite).
3. `py ".../ue_import_command_center.py" --verify` — ожидается:

   | Меш | LOD | UCX | Сокеты | Габарит (half extent) |
   |---|---|---|---|---|
   | `SM_CommandCenter` | 3, screen size 1,0 / 0,35 / 0,12 | 28 | 5 | ≈ 800 × 400 см |
   | `SM_CommandCenter_Interior` | 2, 1,0 / 0,35 | 0 | 0 | ≈ 745 × 345 см |
   | `SM_CommandCenter_Holo`, `_HoloSpin`, `_ScreenRT` | 1 | 0 | 0 | — |

   Секции: у экстерьера 12 слотов, у интерьера 12, у LOD2 экстерьера 10 (нет стекла и мелочи — это нормально).

4. **Ориентация (U-2).** Блендер экспортирует «перед» здания (окно) в −Y. Поставить меш в уровень и посмотреть, на
   какую ось UE смотрит окно и куда строительная пушка ставит «перёд» постройки. Если не совпадает — переимпорт с
   Import Rotation (FBX), а не поворот компонента в BP (иначе сокеты и UCX разъедутся).

## 4. C++ (GameFacade)

1. Скопировать `Source/FicsitAIHelper/Public|Private/GameFacade/Buildings/*` в модуль мода (если модуль называется
   иначе — заменить `FICSITAIHELPER_API`).
2. `Build.cs`: `PublicDependencyModuleNames` — `Core`, `CoreUObject`, `Engine`, `FactoryGame`, `SML`.
3. **Сверить с заголовками SML 3.12** всё, что помечено `VERIFY`: `AFGBuildableFactory` (`mPowerConsumption`,
   `mCanChangePotential`, `HasPower()`, `CanProduce_Implementation`), сигнатуры `IFGUseableInterface`
   (`IsUseable_Implementation`, `OnUse_Implementation`, `GetLookAtDecription_Implementation` — в игре именно так,
   с опечаткой), include-пути.
4. ADR-021: `AFG*`/`UFG*` только в `GameFacade/`. UI-контроллер подписывается на `UFAIHTerminalEvents::OnTerminalUsed`
   (`TerminalId`, `APlayerController*`, render target) — заголовок содержит только типы движка.
5. Что делает класс: потребляет **10 МВт** (без разгона); без питания — голограмма скрыта, подсказка «no power», UI не
   открывается; по E на запитанном здании — событие `OnTerminalUsed` (стандартный виджет фабрики не открывается);
   создаёт render target 1920 × 1080 на `MainScreen`; крутит `HoloSpin` (12°/с) на `SOCKET_holo`; ставит Max Draw
   Distance компонентам с тегом `Interior`.

## 5. Blueprint-ассеты

1. `py ".../ue_import_command_center.py" --content` — создаёт `Build_CommandCenter`, `Desc_CommandCenter`,
   `Recipe_CommandCenter`, `Schem_CommandCenter` и заполняет, что получится; остальное — в `ue_manual_steps.txt`.
2. **`Build_CommandCenter`** (родитель — `AFAIHCommandCenter`; пока C++ не собран — `FGBuildableFactory`):
   - `FGColoredInstanceMeshProxy` «Exterior» → `SM_CommandCenter`, тег `Exterior` (**VERIFY** класс прокси в SML 3.12);
   - `FGColoredInstanceMeshProxy` «Interior» → `SM_CommandCenter_Interior`, тег `Interior`;
   - `MainScreen` → `SM_CommandCenter_ScreenRT`, `HoloStatic` → `SM_CommandCenter_Holo`,
     `HoloSpin` → `SM_CommandCenter_HoloSpin`;
   - `FGPowerConnectionComponent` в точке `SOCKET_power` (снаружи, задняя сторона цоколя);
   - `FGClearanceComponent` (или clearance-данные здания) по `clearance.json`: от −800, −400, 0 до 800, 400, 760 см;
   - Descriptor → `Desc_CommandCenter`.
3. **`Desc_CommandCenter`**: имя **Command Center**, описание из `content_spec.json`, иконки 256 / 512, категория меню
   строительства (**VERIFY**), Buildable Class → `Build_CommandCenter`.
4. **`Recipe_CommandCenter`** (Tier 2, флагман — предложение баланса): Reinforced Iron Plate × 15, Modular Frame × 5,
   Rotor × 10, Cable × 50, Concrete × 80 → `Desc_CommandCenter` × 1; Produced In — Build Gun (**VERIFY** путь).
5. **`Schem_CommandCenter`**: Milestone «FICSIT AI Operations», Tier 2, стоимость Reinforced Iron Plate × 50,
   Rotor × 40, Cable × 200; Unlock Recipe → `Recipe_CommandCenter`. Зарегистрировать в `GameWorldModule` мода
   (`mSchematics`).

## 6. Проверка в игре

| ID | Что проверить | Как |
|---|---|---|
| U-1 | масштаб: 1600 × 800 см, pivot в центре на верхе фундамента | поставить на 2 фундамента |
| U-2 | окно — «перёд» постройки | голограмма строительной пушки |
| U-3, U-4 | ступени 0,25 м проходятся без прыжка; дверь 2,4 × 3,2 м, над верхней ступенью 2,2 м | пройти внутрь и обратно, с рюкзаком / джетпаком |
| U-5 | E у пульта: дистанция, эргономика, главный экран не закрыт столешницей | встать на коврик оператора |
| U-6, U-7 | обзор через стекло; читаемость главного экрана снаружи | render target с тестовой картинкой |
| U-8 | шейдинг: свои нормали, фаски, нет швов | день / ночь |
| U-9 | посадка на сетку фундаментов, стыковка с соседними постройками вплотную | приставить стену / здание |
| U-10 | питание 10 МВт: без сети — подсказка «no power», голограмма скрыта, UI не открывается | отключить / подключить |
| U-11 | покраска пушкой: primary — оранжевые панели, secondary — серые, остальное не красится | покрасить двумя цветами |
| U-12 | лайтмапы не нужны (Lumen): нет предупреждений импорта | лог импорта, вид при Lumen |
| LOD | переходы LOD0 → 1 → 2 без скачков; интерьер исчезает на ~60 м, голограмма на ~40 м | отойти от здания |
| коллизия | проход дверь → лестница → пульт → проектор → шкафы; сквозь стены и стекло не пройти | пройти, попробовать пробежать сквозь стекло |

## 7. Что прислать обратно

- `ue_manual_steps.txt` и лог `--verify`;
- заполненный `ue_material_map.json` и `ue_material_discovery.json`;
- ошибки компиляции C++ (если были) — поправлю заголовки по факту;
- скриншоты: спереди, сзади, интерьер у пульта, голограмма, без питания, покраска двумя цветами, три дистанции LOD;
- результаты таблицы §6 (OK / что не так).
