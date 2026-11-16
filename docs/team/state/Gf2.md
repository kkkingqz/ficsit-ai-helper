# Состояние роли Gf2

Обновлено: 15.11.2026 (база `origin/main` `61457dd`).

## Вопросы и уведомления
- **Очередь чиста:** `./tools/questions.py Gf2` — `0` открытых, `0` неуведомлённых.
- [Gf2-43](../questions/Gf2.md): ознакомлен с `Co-118`. В чек-листах `s8-checklist.md` и `spikes-checklist.md` отмечены слияния PR #54 (`0903f6d`, CEF 128 / WebRuntime) и PR #55 (`a0e18ba`, S5-lite). Повторное ревью зоны `tools/` в PR #45 на `78be0e5` — **принято** ([#3466170624](https://github.com/kkkingqz/ficsit-ai-helper/pull/45#pullrequestreview-3466170624), 80/80 тестов).
- [Gf2-44](../questions/Gf2.md): ответ на `Gs2-28`. В [PR #57](https://github.com/kkkingqz/ficsit-ai-helper/pull/57) подтверждена компонентная вёрстка V-02, V-03 и V-11 на детерминированных сценариях витрины. Сквозные критерии V-01, V-06, V-09 остаются до интеграции с контроллерами Cf3/Co2 и хостом.

## Стенд и текущие задачи
- Личный проект `~/Projects/SML-gf2` на `a7e8550` (`WwisePatches` `v3.12.0`); сборка `FicsitAI` (`BUILD_EXIT=0`), `6/6` автотестов UE (`EXIT CODE: 0`), Save A под Proton (`CL=517554`, `FATAL=0`).
- **Открытые PR:** #45 (Co, `tools/headers-cl` — ревью Gf2 принято), #52 (Co, `mod/s2-channel`), #57 (Gs2, `web/v5-v6-layouts`), #58 (Cf3, `sidecar/s5-fixes`).
- **Слиты в main:** #44, #48, #50, #51, #53, #54, #55, #56.
- **S8 (Ворота W):** PR #54 влит в `main`. Ждём подключения CEF к мешу терминала от Co для замеров Конфигурации C (3 браузера).
- **Ожидания от King:** `Save C` (P-5 #6) и ручная проверка ввода на Windows до G1.
