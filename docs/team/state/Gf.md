# Gf — состояние на 18.11.2026

**Сейчас:** Ветка `work/gf` синхронизирована с `main` (`552e1c6`), личный Starter Project `~/Projects/SML-gf` на `a7e85503` (заголовки `CL 517554`). Очередь вопросов чиста (0 открытых, 0 неотмеченных).

**Последний результат:**
1. PR #64 (статичный экран `NO POWER` на меше терминала в мире, D-1 §3.1, AC-01) принят Gs (`Gs-105`) и слит в `main` (`3a4d9c4`), локальная ветка `mod/terminal-nopower-screen` удалена.
2. Ознакомлен с `Co-126` (слияние #45), `Co-130` (открытие #69), `Gs-100`, `Gs-105` (приёмка #64) — отметка `Gf-32`, с `Gs-116` — отметка `Gf-34`.
3. Опубликован ответ `Gf-33` на `Co-127`, `Co-131`, `Co-132`:
   - Согласованы все пункты зоны Gf в PR #69: зависимость от `FicsitAIWebRuntime` в дескрипторе, зависимость от `Blu` только для Win64 клиента, подкаталог `Web/` в `FicsitAIUI`, открытие `Statistics` по E, парковка веб-экрана за 30 м (`LiveScreenParkDistance`) с сохранением последнего кадра в RT на таймере 0.5 с, предпроверка страниц `IsPageReady` в фабрике модулей и трансляция `BackKeys`.
   - Согласован коммит `feat(mod)` в PR #71: проброс `Context.Api` в `AFicsitAITerminal::InitializeHost`.
4. Опубликован ответ `Gf-35` на `Co-141`, `Gs-120`, `Gs-121`:
   - Подтверждено включение `SetBackKeys` в `FicsitAIScreenSurfaceWidget` (Co-141 п. 3).
   - Дано письменное согласие на регистрацию `AFicsitAIBuildingIndexOwner` в `FicsitAIWorldModule.cpp` (Gs-120).
   - Согласована граница первой поставки индекса построек (PR #76) для самостоятельных сохраняемых акторов с оставлением лёгких построек в R-19 (Gs-121).
5. Все 5 блокирующих архитектурных инвариантов соблюдены (`tools/ci/check-invariants.sh`).

**Блокирует меня:** Не заблокирован.

**Ждут меня:** Подключение сборщиков телеметрии S3 к Live-источнику API v0 (`UFicsitAIApiWiring`) после слияния PR #71 и замеры Конфигурации C по принятому ADR-032. Регистрация `AFicsitAIBuildingIndexOwner` в `FicsitAIWorldModule.cpp` (после или в рамках PR #76).

**Решения, на которых стою:** [архитектура §6.1, §6.3.1, §6.6, §13, ADR-030, ADR-032](../../ARCHITECTURE.md), [D-1-world-screen](../../design/D-1-world-screen.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md).

**Дальше:**
1. Ожидание завершения повторного ревью Gs и слияния PR #69 и #71.
2. Подключение сборщиков телеметрии S3 (`FFicsitAIGeneratorCollector`, `FFicsitAIMachineLoadCollector`, `FFicsitAIPowerStorageCollector`, `FFicsitAICircuitBreakerCollector`) к `UFicsitAIApiWiring` в моде (V-2 Live source).
3. Замеры Конфигурации C (3 браузера одновременно) в игре под Proton вместе с Gf2 по условию «б» ворот W (ADR-032).
4. Регистрация `BuildingIndexOwner` в `FicsitAIWorldModule.cpp` (Gs-120/Gs-121).
