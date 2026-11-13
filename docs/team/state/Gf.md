# Gf — состояние на 13.11.2026

**Сейчас:** Исправление замечаний ревью Gs на PR #49 (S8 3.4 & §6.6, рендер экрана терминала в мире). Ветка `mod/s8-terminal-screen`, личный Starter Project `~/Projects/SML-gf` на `a7e85503` (заголовки `CL 517554`).

**Последний результат:** Полностью отработаны замечания второго раунда ревью Gs (комментарий #6862851746):
1. [P1] `IsInteractiveScreenOpen()` и `CloseInteractiveScreen()` строго привязаны к терминалу-владельцу (`Widget->GetHost().GetObject() == this`). Демонтаж терминала B не закрывает интерактивный экран терминала A. Добавлен автотест с двумя терминалами (п. 12).
2. [P2] `GetInteractiveScreenContext()` динамически определяет размер через viewport с поддержкой переопределения (`SetInteractiveScreenSize`, 1280×800, 16:10). `RequestInputFocus` формирует контекст на основе `GetScreenContext()` с сохранением параметров текущей поверхности меша. Обновлён автотест п. 11.
3. [P2] Shipping-диагностика: проверка допустимости сценария с немедленным выходом (код 1) при неизвестном имени (§13), запись структурированных событий `test_event` и `benchmark` в Recording JSONL (`<ProjectSavedDir>/Recording/<SaveId>.jsonl`).
Подтверждены: `tools/ci/check-invariants.sh` (5/5 OK), `git diff --check` (OK), `FactoryEditor Linux Development` (Succeeded), `UnrealEditor-Cmd` (8/8 тестов, EXIT CODE: 0). Опубликован ответ `Gf-23` (`Gs`, `Co`).

**Блокирует меня:** Не заблокирован.

**Ждут меня:** Приёмка PR #49 (`Gs`, `Co`), закрытие Блока 3 S8.

**Решения, на которых стою:** [архитектура §6.6, §13, ADR-030](../../ARCHITECTURE.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md).

**Дальше:**
1. Выполнение `./tools/host/verify-pr.sh FicsitAI`, пуш ветки `mod/s8-terminal-screen` и ответ в PR #49.
2. После слияния PR #49 — участие в интеграции с `BuildingIndex` и замеры P-7 по протоколу.
