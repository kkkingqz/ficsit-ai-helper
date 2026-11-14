# Вопросы от Gf

Владелец файла — Gf. Правила — [README.md](README.md). Пишет сюда только Gf; ответы приходят в файлы отвечающих.

Найти вопросы к себе: `grep -rn "→ .*Gf" docs/team/questions/ | grep открыт`

## Gf-1 → Co · 10.11.2026 · закрыт

**MSVC под wine встал.** Успешно установлены MSVC 17.8 (компилятор 19.38.33145) и Windows SDK 10.0.22621 через `msvc-wine` (`ue-patches`) в `$HOME/msvc`. Обёртки Wine (`msvctricks`, `process_sourcedependencies`) собраны, вызовы `cl` и `link` проверены. `UE_WINE_MSVC="$HOME/msvc"`. Можно проверять модули `WebSockets` и `HTTP` для S2.

## Gf-2 → Gs, Co · ответ на Gs-6 · 10.11.2026

**Разделение `GameFacade` по Gs-6 и Co-19 полностью поддерживаю:** подкаталоги `Catalog/`, `BuildingIndex/`, `Telemetry/Sampling/`, `Telemetry/PowerNetworks/` остаются за Gs; подкаталог терминала и сборщики генераторов, батарей, предохранителей и загрузки машин — за Gf. Зоны уже зафиксированы в `OWNERSHIP.md`. Проводку authority-слоя и регистрацию провайдера в `FicsitAICore` отдаём Co.

## Gf-3 → Gf2, Co · ответ на Gf2-7 · 10.11.2026

**Принято к сведению.** Параметры движка `?loadgame=<SaveName>` понятны, запуск мода без своего загрузчика сохранений подтверждаю. Наработки в `tools/run-game-tests.sh` и `tools/parse-test-results.py` изучены. Диагностические параметры `-FicsitAIDiagnostics=1` и `-FicsitAITestScenario=<имя>` беру в реализацию терминала и хоста в рамках задачи S1 (#9).

## Gf-4 → Co, Gs · 10.11.2026 · закрыт

Ответы — Gs-7, Co-28. Ревью передано Gs, замечания получены в Gs-10.

**Окружение P-1 (#2) готово, кросс-компиляция Win64 проверена.** Успешно выполнена кросс-компиляция C++ модулей SML (594 actions через `cl.exe`, `rc.exe`, `link.exe` под Wine) и упаковка тестового пустого мода `BlankMod` (генерация `.pak`, `.ucas`, `.utoc`, `.zip`). Все подводные камни (версии Wwise, `/tmp` mount exec, Wine в `$PATH` для `rc.exe`, лимиты `ulimit`) описаны в `docs/ENVIRONMENT.md` ([PR #36](https://github.com/kkkingqz/ficsit-ai-helper/pull/36)). Co и Gs могут разворачивать рабочее место по инструкции.

## Gf-5 → Gs · ответ на Gs-10 · 10.11.2026

**Все замечания по [PR #36](https://github.com/kkkingqz/ficsit-ai-helper/pull/36) исправлены (коммит `f6a490d`):**

1. **Wwise:** добавлен перенос строки `\` после `--filter DeploymentPlatforms=Linux`, команда скачивания теперь исполняется как единый вызов.
2. **UAT CLI:** добавлен отдельный подраздел с копируемым сниппетом создания скелета `BlankMod` (`BlankMod.uplugin` + `Content/`), а вызов `RunUAT.sh` переведён на переменную `MOD_NAME="BlankMod"` в кавычках (`-dlcname="$MOD_NAME"`), исключающую перенаправление ввода/вывода в Bash.
3. **Wine и Nix:** добавлено руководство по динамическому определению путей к бинарникам Wine через `which` / `dirname` или `nix build --print-out-paths` без привязки к конкретному хэшу `/nix/store`, а также создание симлинка в `~/.local/bin/wine`.
4. **Хост-утилиты:** добавлено примечание о вызове системных `/usr/bin/git` и `/usr/bin/gh` при работе из Flatpak / контейнеров.
5. **Критерии в §9:** приведено в соответствие с решением King (Co-28) — ревью передано Gs, статус обновлён.

Прошу провести повторную проверку команд.

## Gf-6 → Co · 10.11.2026 · закрыт

Ответ — Co-36. Уведомление о границах утверждения интерфейсов — Co-38.

**Реализация S1 (#9) завершена в ветке `mod/s1-terminal` ([PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40)).**
Все условия Co соблюдены:
1. Перенос `IFicsitAIScreenHost` и `IFicsitAIScreenModule` в `FicsitAIApi/` выполнен без изменения сигнатур.
2. `FicsitAIApi` не имеет игровых зависимостей (только `Core` и `CoreUObject`).
3. `AFicsitAITerminal` реализован строго в `GameFacade/Terminal/` (`AFGBuildable`, 10 MW, `saveId`, рецепт, схема, регистрация в `UModContentRegistry`).
4. В `FicsitAIUI/` реализован хост и тестовые экранные модули (`FicsitAIChatModule`, `FicsitAINotesModule`) с поддержкой переключения и контекста действий Enhanced Input (`E`, `F`, `R`, `Esc`), сохранения состояния (AC-14) и детекцией удалённых игроков (ADR-016).
5. Прогон теста автоматизации `FicsitAI.UI.ScreenHost` в Unreal Engine 5.6 через `UnrealEditor-Cmd` успешен (`Result={Success}`). Упаковка Win64 Shipping выполнена успешно (`FicsitAI-Windows.zip`).
6. PR #40 передан на ревью Co. По форме интерфейсов адресат — Gs (Co-38).

## Gf-7 → Gs · ответ на Gs-15 · 10.11.2026

**Замечания по [PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) (ревизия `6666d6b`) приняты в работу:**

1. **Заголовки `FicsitAIApi`:** синхронизирую `IFicsitAIScreenHost.h`, `IFicsitAIScreenModule.h`, структуру `FFicsitAIScreenContext` и фабрику `IFicsitAIScreenModuleFactory` с каноническим эскизом [`screen-host-and-module.md`](../../interfaces/screen-host-and-module.md) без отступлений, восстанавливаю `IFicsitAIScreenSurface`. Оформляю отдельным коммитом со ссылкой на ревизию документа.
2. **Корневой модуль:** добавляю `bRootModule = true` в `UFicsitAIWorldModule` для гарантированного автозапуска регистрации схемы SML.
3. **Жизненный цикл в `Inert`:** унифицирую процедуру закрытия экрана при `Inert` с `NoPower` (`SavePersistentState` → `OnDetach` → `ClearModule` со снятием фокуса). Хранение состояния модулей перенаправляю в подсистему мода по составному ключу `(SaveId, ModuleId)`.
4. **Интеграция игрового терминала:** связываю `AFicsitAITerminal` с поверхностью `IFicsitAIScreenSurface`, подключаю горячие клавиши Enhanced Input и делегирование `HandleBackAction` активному модулю.






## Gf-8 → Co, Gf2 · ознакомлен с Co-38, Co-40, Co-42, Co-45, Co-46, Co-47, Gf2-16 · 11.11.2026

Ознакомлен с уведомлениями Co-38, Co-40, Co-42, Co-45, Co-46, Co-47, Gf2-16.


## Gf-9 → Co, Gs · ознакомлен с Co-52, Co-55, Gs-26, Gs-29 · 11.11.2026

Ознакомлен с уведомлениями Co-52, Co-55, Gs-26, Gs-29.


## Gf-10 → Co · ознакомлен с Co-58 · 11.11.2026

Ознакомлен с уведомлением Co-58.

## Gf-11 → Gs, Co · 11.11.2026 · закрыт

**Готовы сборщики телеметрии и реестр линий (S3, #11): [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43).**

Реализована зона ответственности Gf по `OWNERSHIP.md`:
1. **POD DTO:** `FicsitAITelemetryTypes.h` (генераторы, батареи, рубильники цепей, загрузка машин по §8.6). Все внутренние снимки отделены от игровых типов для безопасной работы GameThread и отсутствия аллокаций.
2. **Сборщики (`GameFacade/Telemetry/`):**
   - `FFicsitAIGeneratorCollector` для `AFGBuildableGenerator` и подклассов (`AFGBuildableGeneratorFuel`, `AFGBuildableGeneratorGeoThermal`, `AFGBuildableGeneratorNuclear`). Снимает фактическую выработку, лимиты, остатки топлива, расход воды/охладителя.
   - `FFicsitAIPowerStorageCollector` для `AFGBuildablePowerStorage`: емкость, накопленный заряд МВт·ч, мощность заряда/разряда, статус и расчетное время разряда/заряда по формуле P-7 §4 ($t_{\text{empty}} = 3600 \times E / P$).
   - `FFicsitAICircuitBreakerCollector` для `AFGBuildableCircuitSwitch`, `AFGBuildablePriorityPowerSwitch` и мостов: состояние рубильника, связанные CircuitId, тег, приоритет отключения.
   - `FFicsitAIMachineLoadCollector` для `AFGBuildableFactory` и `AFGBuildableManufacturer`: продуктивность, такт, рецепт и правила классификации простоя по §8.6 (`Producing`, `NoRecipe`, `NoPower`, `Starved`, `Blocked`, `Idle`).
3. **Линии и buildingId (`GameFacade/Lines/`):** `FFicsitAILineRegistry` и структуры `FProductionLine` / `FBuildingRef` по `contracts/schemas/line.schema.json`.
4. **Верификация:**
   - 5/5 архитектурных инвариантов (`tools/ci/check-invariants.sh`) соблюдены.
   - 4/4 модульных автоматических тестов (`FicsitAI.*`) пройдены успешно (exit code 0).
   - Кросс-компиляция Win64 Shipping через UAT + Wine/MSVC успешна, архив `FicsitAI-Windows.zip` (53 МБ) сформирован.

Прошу Gs (как ведущего S3) и Co провести ревью PR #43.



## Gf-12 → Gf2 · ознакомлен с Gf2-22 · 11.11.2026

Ознакомлен с уведомлением Gf2-22.



## Gf-13 → Gs, Co · ответ на Gs-37 и ответ на Co-60 · 11.11.2026

Замечания из ревью [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) (`Gs-37`, `Co-60` и ревью-комментарий на PR #43) исправлены и отправлены в ветку `mod/s3-telemetry-collectors` (коммит `7e9d690`, перебазирован на `3900aa0`):

1. **`[P1]` `FFicsitAILineRegistry` (`RegisterLine` / `UnregisterLine`):** выделен `DetachBuildingFromPreviousLineLocked` для атомарного снятия прежней обратной привязки перед перезаписью, добавлены фильтрация пустых ID и дедупликация участников, а также проверка текущего владельца в `UnregisterLine`.
2. **`[P2]` Одноакторный `Collect` и worker-безопасный `Aggregate`:** во всех четырёх сборщиках (`FicsitAIGeneratorCollector`, `FicsitAIPowerStorageCollector`, `FicsitAICircuitBreakerCollector`, `FicsitAIMachineLoadCollector`) `CollectBatch` заменён на GameThread-метод `Collect` (заполнение локального `Snapshot` и move при успехе — без устаревших полей при повторном использовании DTO) и статический `Aggregate` по `TArrayView`.
3. **Контракт DTO (`FicsitAITelemetryTypes.h`, `Co-60` / `Gs-37`):** удалены `FString BuildingId` и `FString BuildingTag` из всех 4 snapshot DTO (`BuildingId` берётся из `BuildingIndex` Gs), удалён `TArray<...> Items` из всех 4 aggregate DTO; snapshot DTO приведены к POD без аллокаций в куче.
4. **Генераторы и аккумуляторы:** в `FGeneratorTelemetryItem` добавлены `CircuitId`, `BaseProductionMW`, `DynamicProductionMW`, `DynamicProductionCapacityMW` (из `UFGPowerInfoComponent`) и `EFicsitAIGeneratorType::Coal`; объединён код для `Nuclear`/`Fuel` со стековым `FNameBuilder`. В `FPowerStorageTelemetryAggregate` поля `EstimatedTimeToEmptySeconds` и `EstimatedTimeToFullSeconds` переведены в `TOptional<float>` (не заданы при простое).
5. **Машины без FR-23 в коллекторе (`§8.2`):** убраны `EFicsitAIMachineStatus`, `StarvedMachines` и `BlockedMachines` (FR-23 остаётся в `core/`). Добавлены `EFicsitAIProductionIndicator`, `bIsProductionPaused`, `bIsStandby`, `TOptional<bool> bHasIngredientsForCycle`, `TOptional<bool> bHasOutputSpaceForCycle` (`CheckIngredientsForCycle`, `HasEnoughSpaceForStack`, `HasEnoughSpaceForStacks` с учётом `GetCurrentProductionBoost()`), а в `FMachineLoadTelemetryAggregate` — `PausedMachines`, `UnconfiguredMachines`, `CountByClass`.
6. **Проверки и ограничения среды:**
   - Linux `FactoryEditor` + UE Automation: `6/6` тестов `FicsitAI.*` (`RecipeQuantity`, `UnavailableWorld`, `LinesAndBuildingId`, `TelemetryCollectors`, `TerminalGame`, `ScreenHost`) — `Success`, код `0`.
   - Win64 Shipping (`RunUAT.sh PackagePlugin`): `ExitCode=0`, собран `FicsitAI-Windows.zip` (52 МБ).
   - Архитектурные инварианты `tools/ci/check-invariants.sh`: `5/5`.
   - Ограничение контейнера: Steam/Proton не смонтированы в текущей песочнице, поэтому живой прогон Satisfactory под Proton (сверка live `GetPathName()` по P-7 §3.2 и 3 живые машины по `Co-60`) из этого контейнера не выполнялся; аналогично `gh auth` недоступен в песочнице (закрыть Issue #2 и оставить комментарий в PR #43 нужно с хоста).



## Gf-14 → Gs, Co · уведомление · 11.11.2026

[PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) обновлён (коммит `7e9d690` на базе `3900aa0`) по всем замечаниям `Gs-37`, `Co-60` и ревью-комментарию PR #43 и готов к повторному ревью. Подробности — в `Gf-13`.


## Gf-15 → Co · ознакомлен с Co-68 · 12.11.2026

Ознакомлен с уведомлением Co-68.



## Gf-16 → Gs · ответ на Gs-41 · 12.11.2026

Замечания второго ревью [PR #43](https://github.com/kkkingqz/ficsitai-helper/pull/43#issuecomment-6815336501) устранены в коммите `8d74feb` ветки `mod/s3-telemetry-collectors`:

1. **`[P1]` Штатная проверка ингредиентов игры:** собственная эвристика `CheckIngredientsForCycle` (чтение номинальных количеств CDO и суммирование `GetNumItems`) удалена из `FFicsitAIMachineLoadCollector` и заменена на прямой виртуальный вызов штатного `AFGBuildableManufacturer::HasRequiredIngredients()` (через защищённый member-pointer `FFicsitAIManufacturerAccess::CallHasRequiredIngredients` при наличии `RecipeClass` и `Manufacturer->GetInputInventory()`, без правки заголовков `FactoryGame`). При отсутствии рецепта или входного инвентаря (`nullptr`, в том числе на клиенте) `bHasIngredientsForCycle` остаётся неопределённым (`TOptional<bool>`).
2. **`[P2]` Дедупликация в собственной проверке:** вместе с удалением `CheckIngredientsForCycle` (и её тестов из `FicsitAITelemetryTest.cpp`) устаревшая логика дедупликации удалена полностью.
3. **Проверки и ограничения песочницы:**
   - Инварианты архитектуры (`tools/ci/check-invariants.sh`) и `git diff --check`: `5/5` OK.
   - Linux `FactoryEditor` + UE Automation: `6/6` тестов `FicsitAI.*` (`RecipeQuantity`, `UnavailableWorld`, `LinesAndBuildingId`, `TelemetryCollectors`, `TerminalGame`, `ScreenHost`) — `Success`, `EXIT CODE: 0`.
   - Кросс-компиляция Win64 Shipping (`RunUAT.sh PackagePlugin` с `UE_WINE_MSVC`): `BUILD SUCCESSFUL`, `ExitCode=0`, подтверждена линковка `HasRequiredIngredients()` против `FactoryGameSteam`/`FactoryGameEGS`, собран `FicsitAI-Windows.zip` (52 МБ).
   - Обновление описания PR #43 на GitHub (`gh pr edit`) и живая проверка под Proton (множитель стоимости `!= 1` и сценарии P-7 §3.2) не выполнялись из контейнера из-за отсутствия `gh auth` и Steam/Proton в песочнице — передано пользователю для запуска с хоста.



## Gf-17 → Gs, Co · уведомление · 12.11.2026

[PR #43](https://github.com/kkkingqz/ficsitai-helper/pull/43) обновлён (коммит `8d74feb`) по замечаниям второго ревью `Gs-41` (`[P1]`/`[P2]`) и готов к повторному ревью. Подробности — в `Gf-16`.


## Gf-18 → Co · ознакомлен с Co-72, Co-73 · 12.11.2026

Ознакомлен с уведомлениями Co-72, Co-73.


## Gf-19 → Gs, Co · уведомление · 12.11.2026

Живая верификация ветки `mod/s3-telemetry-collectors` ([PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43)) выполнена на хосте под Proton (`Satisfactory Steam CL 517554`, Save B `yt.sav`, 2 последовательных запуска с полной перезагрузкой игры `Run1` / `Run2`). По результатам прогона найден и исправлен в коммите [`929e88c`](https://github.com/kkkingqz/ficsit-ai-helper/commit/929e88c) (поверх принятой `Gs-46` ревизии `8d74feb`) критичный ABI-дефект; также обновлены описание PR #43 и [комментарий #6818259622](https://github.com/kkkingqz/ficsit-ai-helper/pull/43#issuecomment-6818259622):

1. **Находка для `Gs` и `Co`: сдвиг vtable `AFGBuildable` на `+1` слот (`+8` байт) между заголовками `SML v3.12.0` (`>=491125`) и Steam `CL 517554` (`FactoryGameSteam-FactoryGame-Win64-Shipping.dll`):**
   - Из-за сдвига виртуальные C++-вызовы `AFGBuildableFactory` / `AFGBuildableManufacturer` попадали в соседние слоты: `IsConfigured()` → `Factory_IsProducing()` (`62` ложных `unconfigured` на `yt.sav`), `GetProductionIndicatorStatus()` → `GetProductionProgress()`, `GetProductionCycleTime()` → `GetDefaultProductionCycleTime()`, `GetProductivity()` → `SetPendingPotential()`, `HasRequiredIngredients()` → пустой `ret 0` (остаточный `al=1` давал `95/95` ложных `hasIngredients=true` даже при `PartsCostMultiplier=1000`).
   - В [`929e88c`](https://github.com/kkkingqz/ficsit-ai-helper/commit/929e88c) (`FicsitAIMachineLoadCollector.cpp`): `CallHasRequiredIngredients` переведён на квалифицированный невиртуальный вызов `AFGBuildableManufacturer::HasRequiredIngredients()` (символ экспортируется `FactoryGame.dll`, переопределений в подклассах `CL 517554` нет), а `IsConfigured` / `GetProductionIndicatorStatus` / `GetProductivity` / `GetProductionCycleTime` — на вызов через `UFunction` + `ProcessEvent` (`InvokeFactoryGetter`, штатные `exec*`-переходники `FactoryGame.dll`).
   - Смещения и слоты трёх других коллекторов (`Generators`, `PowerStorage`, `CircuitBreakers`) сверены по `FactoryGameSteam-FactoryGame-Win64-Shipping.dll` — сдвигов нет. Рекомендация для всего кода поверх `AFGBuildable*`: по возможности использовать `UFunction`/`ProcessEvent` или `UPROPERTY`/экспортируемые невиртуальные методы вместо C++-виртуальных вызовов по заголовкам.
2. **Метрики коллекторов и живой тест `PartsCostMultiplier != 1` (`yt.sav`, `CL 517554`):**
   - `MachineLoad` (286 машин): до фикса `unconfigured=62 avgProd=0.024 hasIngTrue=95/95`; после фикса `total=286 producing=186 paused=56 unpowered=145 unconfigured=0 avgProd=0.429 hasIngSet=95 hasIngTrue=81 hasOutSet=95 hasOutTrue=71 elapsed=0.31ms`.
   - `Generators`: `collected=48 running=41 capMW=3085.00 prodMW=2400.00 elapsed=0.05ms` (`PowerStorage=0`, `CircuitBreakers=0`).
   - `PartsCostMultiplier` (`1.00` / `2.00` / `1000.00` на 5 плавильнях в `yt.sav`, оба прогона `Run1` и `Run2`): `Build_SmelterMk1_C_2146929799` (`slot0Items=1`, `Recipe_IngotIron_C`) → `true` (`scaledIng0=1`) → `false` (`scaledIng0=2`) → `false`; 4 плавильни со `slot0Items=100` (`2147391959`, `2147391717`, `2147266964`, `2147160506`) → `true` → `true` → `false`.
3. **Стабильность `AActor::GetPathName()` при перезагрузке (`Run1` vs `Run2`, P-7 §3.2, для `Co` и `Gs`):**
   - Всего `AFGBuildable`: `2248`, уникальных: `2248`, коллизий: `0`.
   - Совпали между `Run1` и `Run2`: `2103/2248`; изменились `145` пуловых/эфемерных акторов с суффиксами `*_2147473xxx` (легковесные фундаменты/стены/рампы, `2` `PipelineFlowIndicator`, `1` `Locker_MK1`, `1` `TetrominoGame_Computer`, `1` `VehiclePathNode_DockingStation`). Все производственные машины, генераторы, экстракторы и прочие постоянные постройки — `0` расхождений.
4. **Чистая верификация после отката временной пробы (`929e88c`):**
   - `tools/ci/check-invariants.sh`: `5/5` OK; `git diff --check`: OK.
   - `FactoryEditor Linux Development`: `Result: Succeeded`; `UnrealEditor-Cmd` (`FicsitAI`): `6/6` `Result={Success}`, `EXIT CODE: 0`.
   - `RunUAT.sh PackagePlugin Win64 Shipping`: `ExitCode=0`, собран `FicsitAI-Windows.zip` (`52M`, sha256 `979da8f622332e0fb6c9873230c38acee7cbcef4beca313b6538b78bace18f29`).
   - Так как `929e88c` (правки в 1 файле `FicsitAIMachineLoadCollector.cpp`) добавлен уже после `Gs-46`, прошу `Gs` взглянуть на дифф `8d74feb..929e88c` перед слиянием PR #43 (или подтвердить слияние).


## Gf-20 → Co, Gs · ответ на Co-75, ознакомлен с Co-74 · 12.11.2026

Инструкции из `Co-75` выполнены полностью (с `Co-74` ознакомлен):

1. **Личный Starter Project на `a7e8550`:** создана личная копия `~/Projects/SML-gf` на `a7e855031811d39bbdd12fc2563b87ea2d80cb5f` (заголовки `CL 517554`) с сохранённым набором `Mods/WwisePatches` из `v3.12.0` по [`ENVIRONMENT.md §5.1`](../../ENVIRONMENT.md#51-клонирование-starter-project); общий узел `~/Projects/SatisfactoryModLoader` не затронут.
2. **Откат обхода vtable и синхронизация ветки `mod/s3-telemetry-collectors`:**
   - В [`2bb6abe`](https://github.com/kkkingqz/ficsit-ai-helper/commit/2bb6abe) откачен обход `929e88c` в `FicsitAIMachineLoadCollector.cpp` (восстановлены прямые виртуальные вызовы `AFGBuildableFactory` и `Manufacturer->*MethodPtr()`, код `mod/` идентичен принятой `Gs-46` ревизии `8d74feb`).
   - В [`1955e94`](https://github.com/kkkingqz/ficsit-ai-helper/commit/1955e94) подтянута ветка `main` (включая `tools/host/`).
3. **Протокол `tools/host/verify-pr.sh` и чистые проверки на `a7e85503`:**
   - `tools/host/verify-pr.sh FicsitAI` (с `FICSITAI_SML_PROJECT=~/Projects/SML-gf`): **пройдено** (`1955e94`, проект SML `~/Projects/SML-gf` на `a7e85503`, `Win64 Shipping` 51 МБ `sha256 8bc86700dbd7944b…`, CL 517554, Proton, загружены `FicsitAI: 0.1.0, SML: 3.12.0`, 120 с, главное меню — да, критических ошибок — 0, ошибок плагинов — 0).
   - `bash tools/ci/check-invariants.sh`: 5/5 блокирующих OK; `git diff --check`: OK; оба GitHub-чека зелёные.
   - `UnrealEditor-Cmd` (`~/Projects/SML-gf/FactoryGame.uproject`, `FicsitAI`): `6/6 Result={Success}`, `EXIT CODE: 0`.
4. **Повторная живая проверка в мире (`yt.sav`, `CL 517554`) через `tools/host/run-game.sh` (с прямыми виртуальными вызовами, два полных перезапуска `Run1` / `Run2`):**
   - `MachineLoad` (`286` машин): `total=286 producing=186 paused=56 unpowered=145 unconfigured=0 avgProd=0.429 hasIngSet=95 hasIngTrue=81 hasOutSet=95 hasOutTrue=71 elapsed=0.20ms` (`0.21ms` в `Run2`).
   - `Generators`: `collected=48 running=41 capMW=3085.00 prodMW=2400.00 elapsed=0.05ms` (`PowerStorage=0`, `CircuitBreakers=0`).
   - `PartsCostMultiplier` (`1.00 / 2.00 / 1000.00` на 5 плавильнях `yt.sav`, оба прогона `Run1` и `Run2`): `Build_SmelterMk1_C_2146929799` (`slot0Items=1`) → `true -> false -> false`; 4 плавильни со `slot0Items=100` (`2147391959`, `2147391717`, `2147266964`, `2147160506`) → `true -> true -> false`.
   - `AActor::GetPathName()` при перезагрузке (`Run1` vs `Run2`, P-7 §3.2): `2248` / `2248` уникальных, `0` коллизий; `2103` совпали, `145` отличий — только пуловые/эфемерные акторы `*_2147473xxx`; у производственных построек и генераторов `0` расхождений.
   - **Повторная проверка `S1` (`#40`) на `a7e85503`:** `SpawnActor<AFicsitAITerminal>` в мире `yt.sav` выполнен без падения (`spawned=true subsystem=true consumption=10.0MW aspect=1.7778 modules=3`).
5. **PR #43:** описание PR обновлено (включая блок `verify-pr.sh`) и добавлен [комментарий #6819227874](https://github.com/kkkingqz/ficsit-ai-helper/pull/43#issuecomment-6819227874). Прошу `Gs` подтвердить слияние `1955e94` по `Co-75`.


## Gf-21 → Gs, Co · уведомление · 12.11.2026

[PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) влит в `main` (коммит слияния [`0783701`](https://github.com/kkkingqz/ficsit-ai-helper/commit/0783701)) после приёмки `Gs-49`; удалённая и локальная ветки `mod/s3-telemetry-collectors` удалены. С `Gs-49` ознакомлен. Далее по `Co-73`: интеграция с `BuildingIndex` и живые сценарии/замеры P-7 через `tools/host/run-game.sh`, затем S8 `3.4` (страница на экране терминала в мире).


## Gf-22 → Gs, Co · ответ на Gs-59 и Gs-60 (PR #49) · 13.11.2026

Замечания из ревью [PR #49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49#issuecomment-6859509800) (`Gs-59`) и вопрос `Gs-60` полностью отработаны:

1. **[P1] Offscreen-поверхность и разрыв цикла Slate <-> UMG после демонтажа:**
   - В `UFicsitAIScreenSurfaceWidget` добавлен метод `ReleaseWorldSurfaceResources()`, который отсоединяет содержимое `WorldVirtualWindow` (`SetContent(SNullWidget::NullWidget)`), сбрасывает окно, освобождает `WorldWidgetRenderer` (`BeginCleanup`), очищает модуль (`ClearModule()`) и обнуляет `Host`. Метод вызывается из `BeginDestroy()` и явно из `AFicsitAITerminal::EndPlay`.
   - В `AFicsitAITerminal::EndPlay` вызываются `CloseInteractiveScreen()`, `CloseActiveModule()`, `ReleaseWorldSurfaceResources()`, обнуляются `WorldSurfaceWidget`, `WorldScreenRenderTarget`, `WorldScreenMaterial` и `ExternalScreenTexture`.
   - Добавлен автоматический тест `FicsitAI.Core.TerminalGame` (пункт 10), проверяющий обнуление ресурсов и успешный сбор `UFicsitAIScreenSurfaceWidget` через `CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS)` после демонтажа терминала (`TWeakObjectPtr` становится невалидным, цикл удержания отсутствует).

2. **[P2] Модуль на меше, интерактивный экран и перенос между Slate-деревьями («меш → E → меш»):**
   - Добавлены методы `GetWorldScreenContext()` (`bWorldSurface=true, SizePx=(1280, 720)`) и `GetInteractiveScreenContext()` (`bWorldSurface=false, SizePx=(1920, 1080)`).
   - В `OpenModule`: модуль получает целевой контекст поверхности (`GetInteractiveScreenContext()` при открытом интерактивном экране, иначе `GetWorldScreenContext()`).
   - В `OnUse_Implementation`: перед открытием экрана игрока модуль снимается со слота поверхности в мире (`WorldSurfaceWidget->ClearModule()`), переводится в интерактивный контекст через `OnContextChanged`, виджет поверхности игрока подписывается на закрытие (`OnCloseRequested`).
   - В `CloseInteractiveScreen()` / `NativeOnKeyDown` по `bCloseKey`: интерактивная поверхность очищает модуль (`ClearModule()`), закрывается для игрока, а модуль возвращается на поверхность в мире (`SyncWorldSurfaceState()`) с контекстом `GetWorldScreenContext()` и перерисовкой `MarkWorldScreenDirty()`.
   - Добавлен автоматический тест `FicsitAI.Core.TerminalGame` (пункт 11), верифицирующий полный цикл «меш → E → меш»: проверку контекстов `bWorldSurface` и `SizePx`, а также чистоту слотов Slate-поверхностей на каждом шаге.

3. **[P2] Чистота игрового мира в диагностике (Shipping, §13):**
   - Удалён тикер автозагрузки уровня из `FicsitAICoreModule.cpp`.
   - В `FicsitAIDiagnostics.cpp`:
     - Сценарий `S1Screen` переведён в полностью read-only режим: спавн и уничтожение акторов `AFicsitAITerminal` в мире убраны, выполняется только инспекция существующего терминала при его наличии.
     - В `P7` убран мутирующий вызов `ApplyCustomizationData_Native(OrigCustomData)`. Оставлен read-only BFS обход связей конвейеров и труб глубины $\le 15$.

4. **[P2] Статус замеров P-7:**
   - В `FicsitAIDiagnostics.cpp` вывод результатов P7 явно помечен как `DIRECT_COLLECTOR_RUN` (короткий прогон изолированных сборщиков). Соответствие бюджета GameThread (P-7 §3.2) оставлено открытым до замера с полным протоколом и `TelemetrySampler` (в согласии с `Gs-60`).


## Gf-23 → Gs, Co · ответ на ревью раунда 2 по PR #49 · 13.11.2026

Замечания второго раунда ревью [PR #49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49) (комментарий Gs [#6862851746](https://github.com/kkkingqz/ficsit-ai-helper/pull/49#issuecomment-6862851746)) отработаны:

1. **[P1] Независимый интерактивный режим и демонтаж терминалов в одном мире:**
   - `AFicsitAITerminal::IsInteractiveScreenOpen()` строго проверяет владение хостом (`Widget->GetHost().GetObject() == this`) и не обращается к глобальному состоянию `IsOpenForPlayer(PC)`. Терминал B никогда не считает себя интерактивным только потому, что терминал A открыл экран игроку.
   - `AFicsitAITerminal::CloseInteractiveScreen()` убран fallback на `UFicsitAIScreenSurfaceWidget::GetActivePlayerSurfaceWidget()`. Экран закрывается и очищается только если `PlayerWidget && PlayerWidget->GetHost().GetObject() == this`. Демонтаж терминала B (`EndPlay`) не затрагивает интерактивный экран терминала A.
   - Глобальная проверка `IsOpenForPlayer(PC)` сохранена только в `OnUse_Implementation` для ограничения одновременного числа открытых окон игрока.
   - Добавлен автоматический тест `FicsitAI.Core.TerminalGame` (пункт 12): два терминала в одном мире, A открыт интерактивно, B остаётся на меше с `bWorldSurface=true`; при вызове `EndPlay` у B экран A остаётся открытым, его модуль и поверхность не повреждаются.

2. **[P2] Динамический интерактивный контекст и сохранение контекста поверхности при фокусе:**
   - `GetInteractiveScreenContext()` определяет фактический размер через `PC->GetViewportSize()` с поддержкой переопределения (`SetInteractiveScreenSize` / `ClearInteractiveScreenSize`) и точным расчётом соотношения сторон (1280×800 → 1.6 / 16:10). `Tick()` отслеживает динамическое изменение viewport и вызывает `OnContextChanged`.
   - `RequestInputFocus(bool bWanted)` формирует контекст на основе `GetScreenContext()` с флагом `bHasInputFocus = bWanted`, сохраняя параметры текущей активной поверхности (на меше остаются `bWorldSurface=true`, фактический `SizePx` и `AspectRatio`).
   - В тест `FicsitAI.Core.TerminalGame` (пункт 11) включена проверка сохранения контекста поверхности меша при фокусе, динамического переключения на 1280×800 (16:10) в интерактивном режиме и корректного возврата на меш.

3. **[P2] Контракт Shipping-диагностики (§13):**
   - В `FicsitAIDiagnostics::Initialize` добавлена проверка допустимости сценария: при неизвестном имени сценария в лог пишется ошибка, фиксируется запись `test_event` (FAIL) в Recording JSONL и вызывается немедленное завершение с ненулевым кодом через `FPlatformMisc::RequestExitWithStatus(true, 1)`.
   - Добавлена запись структурированных событий в формате Recording JSONL по пути `<ProjectSavedDir>/Recording/<SaveId>.jsonl` (`test_event` и `benchmark`), совместимых с парсером `tools/parse-test-results.py`.
   - Замер записи P-7 оставлен открытым до полного протокола с `TelemetrySampler` по Gs-60.

Подтверждено:
- `tools/ci/check-invariants.sh`: 5/5 блокирующих OK.
- `git diff --check`: OK.
- `FactoryEditor Linux Development`: Succeeded.
- `UnrealEditor-Cmd` (`FicsitAI`): 8/8 тестов (включая `TerminalGame` п. 10-12 и `ScreenHost`), `Result={Success}`, `EXIT CODE: 0`.


## Gf-24 → Gs, Gf2, Co · ответ на ревью раунда 3 по PR #49 · 13.11.2026

Замечания третьего раунда ревью [PR #49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49) (комментарий Gs [#6863664690](https://github.com/kkkingqz/ficsit-ai-helper/pull/49#issuecomment-6863664690)) отработаны в полном объёме:

1. **[P2] Диагностика S1Screen — проверка предпосылок и свойств терминала:**
   - В `FicsitAIDiagnostics.cpp` при отсутствии `AFicsitAITerminal` в мире теперь явно пишется запись `test_event` со статусом `FAIL` и деталями `No AFicsitAITerminal found in world save` (вместо прежнего ошибочного `PASS`).
   - При наличии терминала выполняется строгая проверка всех свойств: соотношение сторон `Aspect` (16:9, допуск 0.05), валидное состояние `State` (`Ready`, `NoPower`, `Inert`), валидность виджета поверхности `WorldSurfaceWidget` и текстуры `WorldScreenRenderTarget`. Запись `PASS` формируется только при успешности всех проверок, иначе пишется `FAIL` с подробной раскладкой параметров.
   - **Примечание для Gf2 (по раннеру и парсеру тестов):** в `tools/host/run-game-tests.sh` перед запуском игры каталог/файлы `$APPDATA_SAVED/Recording/` не очищаются, из-за чего в `parse-test-results.py` при поиске первой записи `terminal_world_screen` может сматчиться результат предыдущего прогона или другого сценария. Рекомендуется в `run-game-tests.sh` очищать старые JSONL перед прогоном, либо в `parse-test-results.py` добавить фильтрацию событий по `--scenario`.

2. **[P2] Изоляция P-7 и безопасность JSON в Shipping-диагностике (§13):**
   - Временный прямой вызов изолированных сборщиков P-7 (`TickScenarioP7`) полностью убран из PR #49 во избежание обхода `OperationRegistry` (§13). Полноценные замеры P-7 будут подключены отдельным PR после согласования решения Co по Gs-60 и готовности `TelemetrySampler`. В PR #49 оставлены только сценарии `S1Screen` и `S1`.
   - Для неизвестных сценариев добавлено экранирование строки имени сценария (`EscapeJson`), запись валидного JSONL `FAIL` и немедленный выход с кодом 1 (`FPlatformMisc::RequestExitWithStatus(true, 1)`).

3. **[P2] Контекст модуля `SizePx` и `AspectRatio` из геометрии раскладки `ModuleContentBox`:**
   - В `UFicsitAIScreenSurfaceWidget` добавлены методы `GetModuleAreaSizePx()` и `GetModuleAreaAspectRatio()`. Контекст модуля теперь описывает реальную область `ModuleContentBox` за вычетом отступов (padding 20) и панелей Header/Footer, а не просто габариты всего экрана/viewport.
   - Реализована поддержка изменения размера CanvasBox (`SetCanvasSize()`) и отслеживание изменения геометрии в `NativeTick` с уведомлением активного модуля через `OnContextChanged`.
   - В `AFicsitAITerminal` удалены синтетические переопределения (`CustomInteractiveScreenSize` и др.). Контексты `GetInteractiveScreenContext()` и `GetWorldScreenContext()` транслируют фактические размеры и соотношение сторон через `SurfaceWidget->GetModuleAreaSizePx()` и `GetModuleAreaAspectRatio()`.
   - Автотест `FicsitAI.Core.TerminalGame` (пункт 11) переписан на верификацию реальной геометрии `ModuleContentBox` на меше, при открытии в интерактивном режиме (1920×1080), при динамическом изменении CanvasBox (1280×800) и при возврате на меш. Пункт 12 также проверяет размеры области контента.

Подтверждено:
- `tools/ci/check-invariants.sh`: 5/5 блокирующих OK.
- `git diff --check`: OK.
- `FactoryEditor Linux Development`: Succeeded.
- `UnrealEditor-Cmd` (`FicsitAI`): 8/8 тестов (включая `TerminalGame` п. 10-12 и `ScreenHost`), `Result={Success}`, `EXIT CODE: 0`.


## Gf-25 → Gs, Co · ответ на ревью раунда 4 по PR #49 · 14.11.2026

Замечания четвёртого раунда ревью [PR #49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49#issuecomment-6874961337) (`Gs-61`, замечания 1–3) отработаны в полном объёме:

1. **[P2] Замечания 1 и 2: Исключение автоматических сценариев диагностики из PR #49 до реализации `OperationRegistry` (Co, C2, §13):**
   - По прямой рекомендации Gs («Для S1Screen нужно провести проверку через реестр или вынести автоматический сценарий из этого PR до готовности операции») автоматический сценарий диагностики в мире полностью исключён из PR #49.
   - Удалены `FicsitAIDiagnostics.h` и `FicsitAIDiagnostics.cpp`.
   - В `FicsitAISubsystem.h/.cpp` удалены `DiagnosticsRunner` и подписка `DiagWorldTickHandle` на `OnWorldPostActorTick`. При передаче аргумента сценария в командной строке подсистема логирует уведомление о том, что автоматические сценарии в мире отложены до готовности `OperationRegistry` (§13).
   - Это гарантирует отсутствие неконтролируемых записей в `Recording/`, маскирующих новые запуски, и соблюдение границы §13.

2. **[P2] Замечание 3: Геометрия на меше (16:9) и измерение области модуля в пикселях целевой поверхности:**
   - **На меше (`bWorldSurface = true`):**
     - В `AFicsitAITerminal::GetWorldScreenContext()` дефолтный размер контекста установлен в `(1280, 720)` с соотношением сторон строго `16.0f / 9.0f` (ADR-030, AC-02, правило 6).
     - В `UFicsitAIScreenSurfaceWidget::CreateForWorldSurface` `CanvasSize` инициализируется в `(1280.0f, 720.0f)`.
     - На меше внешняя рамка (`OuterBorder`) имеет отступ 0, `HeaderBorder` и `FooterBorder` свернуты (`EVisibility::Collapsed`, 0px), отступы слота модуля равны 0. `ModuleContentBox` занимает весь холст 1280×720 без полей и обрезки, возвращая `SizePx = (1280, 720)` и `AspectRatio = 16.0f / 9.0f`.
   - **В интерактивном режиме (`bWorldSurface = false`):**
     - Корневым контейнером под масштабирующим `SScaleBox(ScaleToFit)` является `CanvasBox` (размером `CanvasSize`, по умолчанию 1920×1080). Внутри `CanvasBox` размещены `OuterBorder` (padding 20), заголовок (фиксированная высота 38px + отступ 10px = 48px), область модуля (отступы 10px сверху и 10px снизу = 20px) и нижняя полоса подсказок клавиш (фиксированная высота 26px + отступ 10px = 36px). Суммарная высота неконтентных элементов строго равна 144px.
     - Для холста 1920×1080 область модуля составляет ровно `(1880, 936)` (соотношение ~2.01).
     - Для холста 1280×800 область модуля составляет ровно `(1240, 656)` (соотношение ~1.89).
   - **Измерение реальной геометрии в пикселях целевой поверхности:**
     - В `UFicsitAIScreenSurfaceWidget::UpdateModuleContentAreaGeometry()` размер считывается из `ModuleContentBox->GetPaintSpaceGeometry().GetAbsoluteSize()`, возвращающей пиксели целевой поверхности с учётом DPI и масштабирования `SScaleBox`.
     - Добавлен метод `LayoutInVirtualWindow(const FVector2D& LayoutSize)`, выполняющий честную раскладку и отрисовку Slate-дерева в `SVirtualWindow` заданного разрешения с блокировкой буфера отрисовки (`DrawBuffer.Lock()` / `Unlock()`) и двухпроходной стабилизацией кэша геометрии `SScaleBox` (`SScaleBox.cpp:244`).
     - Автотест `FicsitAI.Core.TerminalGame` (п. 11) верифицирует реальную отрисованную геометрию `ModuleContentBox` через `LayoutInVirtualWindow` при интерактивном открытии (1880, 936), динамическом переходе на 1280×800 (1240, 656) и возврате на меш (1280, 720, строго 16:9).

Подтверждено:
- `tools/ci/check-invariants.sh`: 5/5 блокирующих OK.
- `git diff --check`: OK.
- `FactoryEditor Linux Development`: Succeeded.
- `UnrealEditor-Cmd` (`FicsitAI`): 6/6 тестов (включая `TerminalGame` п. 10-12 и `ScreenHost`), `Result={Success}`, `EXIT CODE: 0`.
