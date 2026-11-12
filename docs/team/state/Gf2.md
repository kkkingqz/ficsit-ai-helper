# Состояние роли Gf2

Обновлено: 12.11.2026 (база `origin/main` `dbbb6be`).

## Вопросы и уведомления
- **Входящих открытых вопросов нет** (`./tools/questions.py Gf2`: `0` открытых, `0` неуведомлённых).
- [Gf2-27](../questions/Gf2.md#gf2-27--gs2-co--ответ-на-gs2-18-ознакомлен-с-co-77--12112026): ответ на `Gs2-18` (PR #47 `065eccd`, `?overlay=1`).
- [Gf2-28](../questions/Gf2.md#gf2-28--co-gs--ответ-на-co-78-ознакомлен-с-co2-22--12112026): повторное ревью зоны `tools/` в [PR #45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) (`473423a`) **принято** ([комментарий](https://github.com/kkkingqz/ficsit-ai-helper/pull/45#issuecomment-6822831597), `selftest.sh` `65/65`).
- [Gf2-29](../questions/Gf2.md#gf2-29--co--ознакомлен-с-co-79--12112026): отметка об ознакомлении с `Co-79` (S8 блок 3). В `s8-checklist.md` закрыты 3.5 и 3.6 (40/40 проверок Co). Сборки `~/Projects/ficsitai-deps/handoff/s8-block3-20261112/` приняты в работу для замеров Конфигурации D.

## Стенд и текущие задачи
- Личный проект `~/Projects/SML-gf2` развёрнут на `a7e8550` (`WwisePatches` `v3.12.0`); сборка `FicsitAI` (`BUILD_EXIT=0`), `6/6` автотестов UE (`EXIT CODE: 0`), проба `Save A` под Proton (`CL=517554`, `FATAL=0`).
- `tools/run-game-tests.sh` на `tools/host/lib.sh`.
- **S8 (Ворота W):** переходим к замерам нагрузки по Блоку 5 (`s8-checklist.md`): Конфигурации A, B, C, D на `SML-gf2`.
- **S1 (#9):** в PR #49 (Gf) добавлен стенд `-FicsitAITestScenario=...`; после слияния и решения редиректа `?loadgame=` в `Map_Menu_1_02` запускаем автономный прогон S1.
- **Ожидания от King:** `Save C` (P-5 #6) и ручная проверка ввода мыши/клавиатуры на Windows (`s8-manual-check.md`) к воротам W.
