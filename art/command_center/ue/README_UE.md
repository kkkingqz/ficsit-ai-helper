# Command Center — сборка в UE 5.6 (этап 7)

Инструкция для того, кто собирает здание в редакторе мода. Всё, что можно было сделать без Unreal Editor, уже
лежит в репозитории; здесь — что запустить, что настроить руками, что проверить в игре и что прислать обратно.

> **Статус пакета.** Скрипт `ue_import_command_center.py` и C++ в `Source/` **ещё не запускались в настоящем
> редакторе**, но проверены без него (§9): C++ и имена свойств FactoryGame сверены с заголовками **SML v3.12.0**,
> скрипт прогнан во всех режимах на стабе **UE 5.6.0 Python API** — 0 расхождений. `VERIFY` осталось только у путей
> ассетов `/Game/FactoryGame/...` (контент игры, в заголовках его нет): проверить в Content Browser → Copy Reference.
> Скрипт при любой ошибке не падает, а пишет шаг для ручного выполнения в `ue_manual_steps.txt`.

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
| `tools/ue_stub_dryrun.py` | прогон скрипта без UE со сверкой API по стабу UE 5.6 и свойств — по заголовкам SML (§9) |
| `tools/apply_localization.py` | заполняет RU-перевод в `.po` из `content_spec.json` → `localization` (§6) |
| `../../../tools/ci/check_adr021.py` | CI-проверка ADR-021: `AFG*`/`UFG*` только в `GameFacade/`, `core/` без Unreal (§9) |

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
   | `M_ScreenStatic` | эмиссивный экран с текстурой → `T_CC_ScreenAtlas_E`. Если `parent` пуст — **fallback `MM_CC_ScreenRT`** |
   | `M_ScreenRT` | эмиссивный экран с **texture-параметром**: его имя записать в `AFAIHCommandCenter::ScreenRTParameter` (по умолчанию `ScreenRT`). Если `parent` пуст — **fallback `MM_CC_ScreenRT`** |
   | `M_Holo` | translucent additive (голограммы, проекторы); край по френелю, без заливки тела. Если `parent` пуст — **fallback `MM_CC_Holo`** |
   | `M_Hazard`, `M_Decal` | материал с base color-текстурой → `T_CC_Hazard_D` / `T_CC_DecalAtlas_D` |

   **Fallback-мастера.** Для трёх эмиссивных слотов, у которых в игре может не найтись подходящего мастера, скрипт сам
   строит свои (ключ `fallback` в карте; используются имена `fallback_param` вместо `game_param`):

   | Мастер | Устройство | Параметры |
   |---|---|---|
   | `MM_CC_ScreenRT` | Default Lit, чёрная глянцевая база; Emissive = `ScreenRT`.rgb × `Emissive` × `Power` | texture `ScreenRT`; scalar `Emissive` 3, `Power` 1 (C++ ставит 1/0 по питанию), `Roughness` 0,15 |
   | `MM_CC_Holo` | Unlit, **Additive**, Two Sided; Emissive = `HoloColor` × `Intensity` × (Fresnel + `Core`) | vector `HoloColor` (0,1; 0,55; 1,0); scalar `Intensity` 4, `Core` 0,25, `FresnelExponent` 2,5 |

   `MI_CC_ScreenStatic` тоже идёт от `MM_CC_ScreenRT` (в `ScreenRT` — атлас `T_CC_ScreenAtlas_E`, `Emissive` 1,2).
   Как только в карте указан игровой `parent`, fallback не используется. Для остальных слотов без мастера — создать
   простой свой (`MM_CC_<слот>`) по полям `textures/manifest.json` и указать его в `parent`.

## 3. Импорт

1. `py ".../ue_import_command_center.py" --import`. Скрипт:
   - импортирует текстуры с sRGB и сжатием из манифеста (`_N` — Normalmap, **DirectX**, без флипа зелёного;
     `_M`/`_ARW` — линейные маски; `_D`/`_E` — sRGB), иконки — группа UI;
   - импортирует меши: Combine Meshes, **Import Normals and Tangents**, без автогенерации коллизии (берутся `UCX_`),
     без лайтмап-UV, **Nanite выключен**, Remove Degenerates; LOD1/LOD2 — Import LOD в слоты 1/2 того же ассета,
     экранные размеры LOD — `StaticMeshEditorSubsystem.set_lod_screen_sizes`. На время импорта мешей скрипт
     переключает `Interchange.FeatureFlags.Import.FBX 0` (в UE 5.5+ FBX может идти через Interchange, который не
     читает `FbxImportUI`) и возвращает прежнее значение;
   - создаёт `MI_CC_<слот>` от выбранных мастеров с параметрами из манифеста и раскладывает по секциям по
     **имени слота** (FBX сохраняет имена `M_*`).
2. Открыть `ue_manual_steps.txt` и выполнить всё, что скрипт не смог. При пустой карте материалов ожидается
   11 шагов «no parent» (все слоты, кроме трёх с fallback).
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
3. **Сверено с заголовками SML v3.12.0** (`Buildables/FGBuildableFactory.h`, `Buildables/FGBuildable.h`,
   `FGUseableInterface.h`, `FGColoredInstanceMeshProxy.h`):

   | Что | Результат |
   |---|---|
   | `AFGBuildableFactory::mPowerConsumption` | **private** (`EditDefaultsOnly`) — из конструктора не присвоить. Решение: override виртуального `GetProducingPowerConsumptionBase()` → `PowerConsumptionMW` (10), плюс BP-default «Power Consumption» = 10 (его читает меню строительства), ставит `--content` |
   | `mCanChangePotential` | protected — присваивается в конструкторе |
   | `HasPower()` | public, кэшируется в `Factory_Tick` |
   | `CanProduce_Implementation() const` | BlueprintNativeEvent, override допустим |
   | `IsUseable_Implementation`, `OnUse_Implementation(AFGCharacterPlayer*, const FUseState&)`, `GetLookAtDecription_Implementation(...) const` | совпадают с overrides в `AFGBuildable` (в игре именно `Decription`) |
   | `BeginPlay`, `Tick(float)` | виртуальные в `AFGBuildableFactory` |
   | `#include "FGCharacterPlayer.h"` | `FactoryGame/Public/FGCharacterPlayer.h` |
   | `UFGColoredInstanceMeshProxy` | наследник `UStaticMeshComponent` → его находит `GetComponentsByTag(UStaticMeshComponent, "Exterior")`, сокеты доступны |
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
   - `FGColoredInstanceMeshProxy` «Exterior» → `SM_CommandCenter`, тег `Exterior` (класс сверен с SML 3.12);
   - `FGColoredInstanceMeshProxy` «Interior» → `SM_CommandCenter_Interior`, тег `Interior`;
   - `MainScreen` → `SM_CommandCenter_ScreenRT`, `HoloStatic` → `SM_CommandCenter_Holo`,
     `HoloSpin` → `SM_CommandCenter_HoloSpin`;
   - `FGPowerConnectionComponent` в точке `SOCKET_power` (снаружи, задняя сторона цоколя);
   - Clearance Data (`AFGBuildable::mClearanceData`, массив `FFGClearanceData`: Type, ClearanceBox, RelativeTransform)
     — одна запись по `clearance.json`: от −800, −400, 0 до 800, 400, 760 см;
   - Power Consumption = 10 и Can Change Potential = false — ставит `--content` (проверить в Class Defaults);
   - Descriptor → `Desc_CommandCenter`.
3. **`Desc_CommandCenter`**: имя **Command Center**, описание из `content_spec.json`, иконки 256 / 512, Menu Priority
   10, Buildable Class → `Build_CommandCenter` — ставит скрипт; руками — Organization → Category / Sub Categories
   (`mCategory` / `mSubCategories`: выбрать ассет категории меню строительства).
4. **`Recipe_CommandCenter`** (Tier 2, флагман — предложение баланса): Reinforced Iron Plate × 15, Modular Frame × 5,
   Rotor × 10, Cable × 50, Concrete × 80 → `Desc_CommandCenter` × 1; Produced In — Build Gun. Всё ставит скрипт,
   если пути `/Game/FactoryGame/...` в `content_spec.json` верны (**VERIFY** — контент игры).
5. **`Schem_CommandCenter`**: Type Milestone, «FICSIT AI Operations», Tech Tier 2, стоимость Reinforced Iron Plate × 50,
   Rotor × 40, Cable × 200; Unlocks → `BP_UnlockRecipe` с `Recipe_CommandCenter` (скрипт создаёт сам, путь класса
   **VERIFY**). Руками — зарегистрировать в blueprint `GameWorldModule` мода (`UGameWorldModule::mSchematics`).

## 6. Локализация (EN → RU)

Переводимые строки — в `content_spec.json` → `localization.entries`: название и описание здания, две подсказки
look-at (C++ `LOCTEXT`, namespace `FAIHCommandCenter`, ключи `UsePowered` / `UseNoPower`, у второй — плейсхолдер
`{0}` для МВт) и название milestone.

| Строка | EN | RU |
|---|---|---|
| Desc: Display Name | Command Center | Командный центр |
| Desc: Description | FICSIT AI Terminal, flagship model. … | Терминал ИИ FICSIT, флагманская модель. … |
| Look-at, есть питание | Command Center — press E to open the AI terminal | Командный центр — нажмите E, чтобы открыть терминал ИИ |
| Look-at, нет питания | Command Center — no power ({0} MW) | Командный центр — нет питания ({0} МВт) |
| Schematic: Display Name | FICSIT AI Operations | Операции ИИ FICSIT |

1. Tools → Localization Dashboard → цель **`FicsitAIHelper`** (в плагине мода): Gather from Text Files — папка
   `Source` мода, Gather from Packages — `/FicsitAIHelper/**`; native culture `en`, добавить `ru`.
2. Gather Text → Export Text (получится `Content/Localization/FicsitAIHelper/ru/FicsitAIHelper.po`).
3. `python3 tools/apply_localization.py <путь к ru .po>` — заполняет `msgstr` (C++ строки — по `msgctxt`,
   строки ассетов — по исходному тексту, у них ключи случайные). `--check` — только отчёт; `MISSING` значит, что
   строка не собралась (например, текст ассета culture-invariant — перепечатать его в редакторе и повторить Gather).
4. Import Text → Compile Text. В `.uplugin` мода — `"LocalizationTargets": [{"Name": "FicsitAIHelper",
   "LoadingPolicy": "Always"}]`, чтобы `.locres` попал в сборку.
5. Проверить в игре с языком «Русский»: меню строительства, подсказка у пульта с питанием и без, дерево milestone.

## 7. Проверка в игре

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

## 8. Что прислать обратно

- `ue_manual_steps.txt` и лог `--verify`;
- заполненный `ue_material_map.json` и `ue_material_discovery.json`;
- ошибки компиляции C++ (если были) — поправлю заголовки по факту;
- скриншоты: спереди, сзади, интерьер у пульта, голограмма, без питания, покраска двумя цветами, три дистанции LOD;
- результаты таблицы §7 (OK / что не так), включая RU-строки.

## 9. Проверки без редактора

| Проверка | Команда | Результат на этом пакете |
|---|---|---|
| Скрипт против UE 5.6 Python API: классы, сигнатуры, enum, editor-свойства; все режимы, с C++ и без | `python3 tools/ue_stub_dryrun.py --stub <unreal.py> --headers <SML>/Source/FactoryGame/Public <SML>/Mods/SML/Source/SML/Public Source` | 6 прогонов без падений, 36 вызовов API, **0 расхождений**; 18 свойств FactoryGame/мода — все объявлены в заголовках |
| ADR-021 / AC-14 | `python3 ../../../tools/ci/check_adr021.py` (без аргументов — все `Source/` и `core/` репозитория) | 3 файла, 0 нарушений |
| RU-перевод | `python3 tools/apply_localization.py <ru .po> --check` | после Gather |

Стаб `unreal.py` — тот, что редактор пишет в `Intermediate/PythonStub/` при включённом Developer Mode, или из
PyPI `unreal-stub` 0.3 (сгенерирован UE 5.6.0). Прогон уже нашёл и исправил: `import_mesh_lo_ds` → `import_mesh_lods`
(FBX), `StaticMesh.sockets` не доступен из Python в 5.6 (`--verify` ищет сокеты через `find_socket`); Nanite
выключается через `StaticMeshEditorSubsystem.set_nanite_settings`, сохранение — с `only_if_is_dirty=False`
(правки CDO не всегда помечают пакет). Что стаб проверить не может: поведение FBX/Interchange, реальный граф
материалов, значения в игровых CDO — это §7.
