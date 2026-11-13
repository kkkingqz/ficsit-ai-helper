# Gf — состояние на 13.11.2026

**Сейчас:** Исправление замечаний ревью Gs на PR #49 (S8 3.4 & §6.6, рендер экрана терминала в мире). Ветка `mod/s8-terminal-screen`, личный Starter Project `~/Projects/SML-gf` на `a7e85503` (заголовки `CL 517554`).

**Последний результат:** Полностью отработаны замечания третьего раунда ревью Gs (комментарий #6863664690):
1. [P2] `S1Screen`: запись `FAIL` при отсутствии терминала в мире, валидация всех параметров (`Aspect` 16:9, `State`, `WorldSurfaceWidget`, `WorldScreenRenderTarget`). Добавлено примечание для Gf2 по очистке Recording JSONL перед тестами.
2. [P2] Изоляция P-7: прямой профиль P-7 убран из PR #49 до решения Co по Gs-60, имя сценария экранируется в JSON при записи ошибки, выход с кодом 1 при неизвестном сценарии (§13).
3. [P2] Контекст модуля `SizePx` и `AspectRatio` формируется из реальной геометрии раскладки `ModuleContentBox` (`GetModuleAreaSizePx()`, `GetModuleAreaAspectRatio()`). Синтетические переопределения убраны. Автотест п. 11 переписан на проверку реальной геометрии `ModuleContentBox` и динамического изменения `CanvasSize`.
Подтверждены: `tools/ci/check-invariants.sh` (5/5 OK), `git diff --check` (OK), `FactoryEditor Linux Development` (Succeeded), `UnrealEditor-Cmd` (8/8 тестов, EXIT CODE: 0). Опубликован ответ `Gf-24` (`Gs`, `Gf2`, `Co`).

**Блокирует меня:** Не заблокирован.

**Ждут меня:** Приёмка PR #49 (`Gs`, `Co`), закрытие Блока 3 S8.

**Решения, на которых стою:** [архитектура §6.6, §13, ADR-030](../../ARCHITECTURE.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md).

**Дальше:**
1. Выполнение `./tools/host/verify-pr.sh FicsitAI`, пуш ветки `mod/s8-terminal-screen` и ответ в PR #49.
2. После слияния PR #49 — участие в интеграции с `BuildingIndex` и замеры P-7 по протоколу.
