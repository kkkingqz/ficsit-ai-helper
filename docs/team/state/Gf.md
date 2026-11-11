# Gf — состояние на 11.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), сборщики телеметрии и линии. Документы в `work/gf`, код в `mod/s3-telemetry-collectors` ([PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43)).

**Последний результат:** Обновлён [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) (ветка `mod/s3-telemetry-collectors`, коммит `7e9d690` на базе `3900aa0`) по всем замечаниям ревью `Gs-37`, `Co-60` и PR #43: сборщики `FFicsitAIGeneratorCollector`, `FFicsitAIPowerStorageCollector`, `FFicsitAICircuitBreakerCollector`, `FFicsitAIMachineLoadCollector` переведены на одноакторный `Collect` в GameThread + worker-безопасный `Aggregate`; DTO приведены к POD без `BuildingId`/`BuildingTag`/`Items[]`; в генераторы добавлены поля `PowerInfo` и `Coal`; в батареях `EstimatedTimeToEmptySeconds`/`FullSeconds` переведены в `TOptional<float>`; из коллектора машин убрана диагностика FR-23 и реализовано снятие сырого состояния (§8.2); в `FFicsitAILineRegistry` исправлен рассинхрон индексов при повторном `RegisterLine`. Пройдены `6/6` тестов UE (`FicsitAI.*`), `5/5` инвариантов архитектуры и сборка Win64 Shipping через UAT + Wine/MSVC (`FicsitAI-Windows.zip`, 52 МБ). Ранее проведена верификация `buildingId` по дампам Save A, B и D (3920 построек: 0 коллизий); живой прогон Satisfactory под Proton (перезагрузка мира P-7 §3.2 и 3 живые машины по `Co-60`) в текущей песочнице недоступен (Steam/Proton не смонтированы).

**Блокирует меня:** Сборка и тесты PR #43 не заблокированы; очередь Gf чиста (`0` открытых, `0` ожидающих закрытия, `0` непрочитанных уведомлений). Ожидается повторное ревью PR #43 (`7e9d690`) со стороны Gs и Co. В текущей песочнице отсутствует `gh auth` (закрытие [#2](https://github.com/kkkingqz/ficsit-ai-helper/issues/2) и публикация комментария в PR #43 выполняются с хоста).

**Ждут меня:** Повторное ревью [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) (Gs, Co); затем интеграция с `BuildingIndex` и замеры телеметрии на сохранениях Save A/B/C совместно с Gf2 и Gs.

**Решения, на которых стою:** [архитектура §8.2, §17.1, ADR-029, ADR-035](../../ARCHITECTURE.md), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md), [каталог метрик](../../../mod/FicsitAI/Source/FicsitAICore/GameFacade/Telemetry/Sampling/metrics-v0.1.md), [зоны владения](../OWNERSHIP.md).

**Дальше:**
1. Повторное ревью [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) (`7e9d690`) со стороны Gs и Co (ответ и уведомление: `Gf-13`, `Gf-14`).
2. С хоста: живая проверка под Proton (P-7 §3.2 на перезагруженном сохранении и 3 живые машины по `Co-60`) и закрытие [#2](https://github.com/kkkingqz/ficsit-ai-helper/issues/2) (`P-1`) при наличии доступа к Steam/Proton и `gh`.
3. Интеграция с `BuildingIndex` и замеры бюджета GameThread телеметрии (P-7, V-09).
