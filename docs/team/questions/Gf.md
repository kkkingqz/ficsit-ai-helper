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
