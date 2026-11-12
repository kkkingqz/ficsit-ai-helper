# Gf — состояние на 12.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), сборщики телеметрии и линии. Документы в `work/gf`, код в `mod/s3-telemetry-collectors` ([PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43), `1955e94`), личный Starter Project `~/Projects/SML-gf` на `a7e85503` (заголовки `CL 517554`).

**Последний результат:** Выполнены инструкции `Co-75` (и ознакомлен с `Co-74`): создана личная копия Starter Project `~/Projects/SML-gf` на `a7e85503` (`Mods/WwisePatches` от `v3.12.0`); в коммите `2bb6abe` откачен временный обход vtable `929e88c` (код `mod/` идентичен принятой `Gs-46` ревизии `8d74feb`); в `1955e94` подтянута `main` (`tools/host/`). На `a7e85503` и `1955e94` пройдены: `./tools/host/verify-pr.sh FicsitAI` (**пройдено**, Win64 Shipping `51 МБ`, `CL 517554`, главное меню, `0` ошибок), `5/5` блокирующих инвариантов, `6/6` UE Automation (`EXIT CODE: 0`) и два живых перезапуска `yt.sav` через `tools/host/run-game.sh` с прямыми виртуальными вызовами (`MachineLoad`: `total=286 producing=186 paused=56 unpowered=145 unconfigured=0 avgProd=0.429 hasIngTrue=81/95 elapsed=0.20ms`; `Generators`: `48`, `2400/3085 MW`; `PartsCostMultiplier 1/2/1000` на 5 плавильнях; `GetPathName()` `2103/2248` совпали, `145` отличий — только пуловые `*_2147473xxx`; `S1` спавн `AFicsitAITerminal` в мире — `10.0 MW`, `aspect=1.7778`, без падения). Обновлены PR #43 (`#issuecomment-6819227874`) и `Gf-20`.

**Блокирует меня:** Сборка, тесты и live-проверки на `a7e85503` не заблокированы; очередь `Gf` чиста (`0` непрочитанных уведомлений, `0` открытых вопросов). По `Co-75` ожидается подтверждение `Gs` на слияние PR #43 (`1955e94`). Закрытие [#2](https://github.com/kkkingqz/ficsit-ai-helper/issues/2) (`P-1`) можно выполнить с хоста.

**Ждут меня:** Подтверждение `Gs` и слияние [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43); затем интеграция с `BuildingIndex` и замеры телеметрии по P-7, а также S8 `3.4` (страница на экране терминала в мире, `Co-73`).

**Решения, на которых стою:** [архитектура §8.2, §17.1, ADR-029, ADR-035](../../ARCHITECTURE.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md), [каталог метрик](../../../mod/FicsitAI/Source/FicsitAICore/GameFacade/Telemetry/Sampling/metrics-v0.1.md), [зоны владения](../OWNERSHIP.md).

**Дальше:**
1. Влить [PR #43](https://github.com/kkkingqz/ficsit-ai-helper/pull/43) (`1955e94`) после подтверждения `Gs` (`Co-75`, `Gf-20`) и закрыть [#2](https://github.com/kkkingqz/ficsit-ai-helper/issues/2).
2. Интеграция с `BuildingIndex` и замеры бюджета GameThread телеметрии на Save A/B/C (P-7, V-09) через `tools/host/run-game.sh`.
3. Задача S8 `3.4` — страница на экране терминала в мире (`Co-73`).
