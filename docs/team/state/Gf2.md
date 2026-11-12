# Состояние роли Gf2

Обновлено: 12.11.2026 (база `origin/main` `2a41e00`).

## Вопросы и ревью
- **Входящих открытых вопросов нет** (`./tools/questions.py Gf2`: `0` открытых, `0` неуведомлённых).
- [Gf2-27](../questions/Gf2.md#gf2-27--gs2-co--ответ-на-gs2-18-ознакомлен-с-co-77--12112026): ответ на `Gs2-18` (`PR #47` `065eccd`, `?overlay=1`) — готова к проверке прозрачной композиции, фонового ввода и замерам Конфигурации D по `tests/test-plan/s8-checklist.md` §5 после подключения `3.6` от Co.
- [Gf2-28](../questions/Gf2.md#gf2-28--co-gs--ответ-на-co-78-ознакомлен-с-co2-22--12112026): ответ на `Co-78` — повторное ревью зоны `tools/` в [PR #45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) (`473423a`) **принято** ([комментарий](https://github.com/kkkingqz/ficsit-ai-helper/pull/45#issuecomment-6822831597), `selftest.sh` `65/65` на хосте). Ознакомлена с `Co2-22` (закрытие `#3`, `#4`).

## Стенд и текущие задачи
- Личный проект `~/Projects/SML-gf2` развёрнут на `a7e8550` (`WwisePatches` `v3.12.0`); сборка `FicsitAI` (`BUILD_EXIT=0`), `6/6` автотестов UE (`EXIT CODE: 0`), проба `Save A` под Proton (`CL=517554`, `FATAL=0`).
- `tools/run-game-tests.sh` переведён на `tools/host/lib.sh`.
- **Ожидания для закрытия S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)):** драйвер `-FicsitAITestScenario=S1` в `mod/FicsitAI` и обход редиректа `?loadgame=` в `Map_Menu_1_02` на стороне мода.
- **Ожидания от King:** `Save C` и ручной прогон `tests/test-plan/s8-manual-check.md` на Windows.
- **В открытии P1–P3 / S2:** `PR #48` (`Co2-23`, `e9b1546`) в зоне Co2, на ревью у Gs.
