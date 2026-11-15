# Состояние роли Gf2

Обновлено: 15.11.2026 (база `origin/main` `f688fd6`).

## Вопросы и уведомления
- **Очередь чиста:** `./tools/questions.py Gf2` — `0` открытых, `0` неуведомлённых.
- [Gf2-34](../questions/Gf2.md): ответ на `Co-103`. В `FA_LOG_FATAL` (`tools/host/lib.sh`) добавлены `appError called` и `Assertion failed` для выявления зависших падений движка при `RUN_EXIT=124`. В `tools/host/selftest.sh` добавлен тест `app_error` (45/45 пройдены). В `tools/questions.py` маркер `вопрос` распознаётся как открытый вопрос.
- [Gf2-35](../questions/Gf2.md): ознакомлен с `Co-100` (отчёт W), `Co-101` (ADR-032 принят King), `Gs-68`, `Gs-69` (ревью #49).
- [Gf2-31](../questions/Gf2.md): согласие по OWNERSHIP §21 на PR #54 (`tools/host/README.md`, `prepare-webruntime-cef.sh`).

## Стенд и текущие задачи
- Личный проект `~/Projects/SML-gf2` на `a7e8550` (`WwisePatches` `v3.12.0`); сборка `FicsitAI` (`BUILD_EXIT=0`), `6/6` автотестов UE (`EXIT CODE: 0`), Save A под Proton (`CL=517554`, `FATAL=0`).
- **S8 (Ворота W):** Решение King 15.11.2026: **ADR-032 принят условно** (Co-101). PR #49 влит в `main` (`69182d4`), пункт 3.4 закрыт в `s8-checklist.md`. Ждём слияния PR #54 и подключения CEF к мешу от Co для финальных замеров Конфигурации C (3 браузера).
- **S1 (#9):** PR #49 влит, раннер диагностических сценариев `-FicsitAITestScenario=` доступен в `main`.
- **Ожидания от King:** `Save C` (P-5 #6) и ручная проверка ввода на Windows до G1.
