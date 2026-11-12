# Gf — состояние на 12.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), сборщики телеметрии и линии. Документы в `work/gf`, код в `mod/s3-telemetry-collectors` ([PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43)).

**Последний результат:** Обновлён [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) (ветка `mod/s3-telemetry-collectors`, коммит `8d74feb`) по замечаниям второго ревью `Gs` (`Gs-41` / `#issuecomment-6815336501`): удалена собственная эвристика `CheckIngredientsForCycle` (и связанный `[P2]`-дефект дедупликации), проверка `bHasIngredientsForCycle` в `FFicsitAIMachineLoadCollector` переведена на штатный виртуальный `AFGBuildableManufacturer::HasRequiredIngredients()` (вызывается при наличии рецепта и `GetInputInventory()`; иначе остаётся неопределённым). После финальной правки повторно пройдены `6/6` тестов UE (`FicsitAI.*`), `5/5` инвариантов архитектуры и сборка Win64 Shipping через UAT + MSVC (`FicsitAI-Windows.zip`, 52 МБ). Ранее проведена верификация `buildingId` по дампам Save A, B и D (3920 построек: 0 коллизий); живой прогон Satisfactory под Proton (перезагрузка мира P-7 §3.2 и живая машина при `PartsCostMultiplier != 1`) в текущей песочнице недоступен (Steam/Proton не смонтированы).

**Блокирует меня:** Сборка и тесты PR #43 не заблокированы; очередь Gf чиста (`0` открытых, `0` ожидающих закрытия, `0` непрочитанных уведомлений). Ожидается повторное ревью PR #43 (`8d74feb`) со стороны Gs и Co. В текущей песочнице отсутствует `gh auth` (обновление описания PR #43 и закрытие [#2](https://github.com/kkkingqz/ficsit-ai-helper/issues/2) выполняются с хоста).

**Ждут меня:** Повторное ревью [PR #43](https://github.com/kkkingqz/ficsitai-helper/pull/43) (Gs, Co); затем интеграция с `BuildingIndex` и замеры телеметрии на сохранениях Save A/B/C совместно с Gf2 и Gs.

**Решения, на которых стою:** [архитектура §8.2, §17.1, ADR-029, ADR-035](../../ARCHITECTURE.md), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md), [каталог метрик](../../../mod/FicsitAI/Source/FicsitAICore/GameFacade/Telemetry/Sampling/metrics-v0.1.md), [зоны владения](../OWNERSHIP.md).

**Дальше:**
1. Повторное ревью [PR #43](https://github.com/kkkingqz/ficsitai-helper/pull/43) (`8d74feb`) со стороны Gs и Co (`Gf-16`, `Gf-17`).
2. С хоста: обновить описание PR #43 (актуальный протокол для `8d74feb`), проверить под Proton живые сценарии P-7 §3.2 и машину при `PartsCostMultiplier != 1`, а также закрыть [#2](https://github.com/kkkingqz/ficsitai-helper/issues/2) (`P-1`).
3. Интеграция с `BuildingIndex` и замеры бюджета GameThread телеметрии (P-7, V-09).
