# Gf — состояние на 14.11.2026

**Сейчас:** Исправление замечаний ревью Gs (раунд 5) на PR #49 (S8 3.4 & §6.6, рендер экрана терминала в мире). Ветка `mod/s8-terminal-screen`, личный Starter Project `~/Projects/SML-gf` на `a7e85503` (заголовки `CL 517554`).

**Последний результат:** Полностью отработаны замечания пятого раунда ревью Gs (комментарий #6876167821):
1. [P2] Замечание 1: Верхняя полоса статуса (`HeaderBorder`) возвращена на экране в мире (`bWorldSurfaceMode = true`, §6.6 по Co3-2), высота 48px (SBox 38px + отступ 10px). Холст и Render Target сохраняют строго 16:9 (1280×720). Модуль `ModuleContentBox` честно занимает оставшиеся `1280 × 672` (соотношение ~1.905), транслируя фактические размеры Slate-раскладки в контекст активного модуля.
2. [P2] Замечание 2: В `LayoutInVirtualWindow` окно сделано локальным с явным отсоединением содержимого `TempVirtualWindow->SetContent(SNullWidget::NullWidget)` при выходе. В `CloseInteractiveScreen` добавлен вызов `PlayerWidget->ReleaseWorldSurfaceResources()`. В автотесте п. 10 добавлена реальная Slate-привязка через `LayoutInVirtualWindow` перед `EndPlay` и проверен сбор мусора `WorldSurfaceWidget`. В п. 11 добавлена проверка GC для `InteractiveSurface` после `CloseInteractiveScreen` и `EndPlay`.
Подтверждены: `tools/ci/check-invariants.sh` (5/5 OK), `git diff --check` (OK), `FactoryEditor Linux Development` (Succeeded), `UnrealEditor-Cmd` (6/6 тестов, EXIT CODE: 0). Опубликован ответ `Gf-26` (`Gs`, `Co`).

**Блокирует меня:** Не заблокирован.

**Ждут меня:** Приёмка PR #49 (`Gs`, `Co`), закрытие Блока 3 S8.

**Решения, на которых стою:** [архитектура §6.6, §13, ADR-030](../../ARCHITECTURE.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md).

**Дальше:**
1. Выполнение `./tools/host/verify-pr.sh FicsitAI`, пуш ветки `mod/s8-terminal-screen` и ответ в PR #49.
2. После слияния PR #49 — участие в интеграции с `BuildingIndex` и замеры P-7 по протоколу.
