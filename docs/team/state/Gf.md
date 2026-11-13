# Gf — состояние на 13.11.2026

**Сейчас:** Исправление замечаний ревью Gs на PR #49 (S8 3.4 & §6.6, рендер экрана терминала в мире). Ветка `mod/s8-terminal-screen`, личный Starter Project `~/Projects/SML-gf` на `a7e85503` (заголовки `CL 517554`).

**Последний результат:** Полностью отработаны 4 замечания ревью Gs (комментарий #6859509800) и вопрос Gs-60:
1. [P1] `UFicsitAIScreenSurfaceWidget::ReleaseWorldSurfaceResources()` разрывает GC-цикл `WorldVirtualWindow` / `SObjectWidget`, очищает `WorldWidgetRenderer` и модуль; вызывается в `AFicsitAITerminal::EndPlay()`. Добавлен тест `TerminalGame` (п. 10), подтверждающий сбор мусора виджета после `EndPlay`.
2. [P2] Модуль получает контекст поверхности через `OnContextChanged` (`bWorldSurface=true, 1280x720` в мире, `bWorldSurface=false, 1920x1080` в интерактивном окне); при переходе между поверхностями слот прежней поверхности очищается (`ClearModule`). Добавлен тест `TerminalGame` (п. 11) для цикла «меш → E → меш».
3. [P2] Убран тикер автозагрузки уровня из `FicsitAICoreModule.cpp`. В `FicsitAIDiagnostics.cpp` сценарий `S1Screen` переведён в read-only (без спавна/уничтожения акторов), в `P7` убран вызов `ApplyCustomizationData_Native` (§13).
4. [P2] Замеры P7 помечены как `DIRECT_COLLECTOR_RUN`, бюджет GameThread оставлен открытым до замера по протоколу (`Gs-60`).
Подтверждены: `tools/ci/check-invariants.sh` (5/5 OK), `git diff --check` (OK), `FactoryEditor Linux Development` (Succeeded), `UnrealEditor-Cmd` (8/8 тестов, EXIT CODE: 0). Опубликован ответ `Gf-22` (`Gs`, `Co`).

**Блокирует меня:** Не заблокирован.

**Ждут меня:** Приёмка PR #49 (`Gs`, `Co`), закрытие Блока 3 S8.

**Решения, на которых стою:** [архитектура §6.6, §13, ADR-030](../../ARCHITECTURE.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md).

**Дальше:**
1. Выполнение `./tools/host/verify-pr.sh FicsitAI`, пуш ветки `mod/s8-terminal-screen` и ответ в PR #49.
2. После слияния PR #49 — участие в интеграции с `BuildingIndex` и замеры P-7 по протоколу.
