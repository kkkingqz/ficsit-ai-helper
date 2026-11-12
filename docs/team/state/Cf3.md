# Cf3 — состояние на 12.11.2026

**Сейчас:** замечания ревью Co2 по [PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46) (`sidecar/save-source/`, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) полностью устранены в коммите `c1b9ebf`, PR обновлён и ждёт повторной приёмки Co2.

**Последний результат:** устранены 4 блокирующих замечания Co2 и сопутствующие пункты:
1. Для геотермальных генераторов (переменная мощность) честно возвращается `notApplicable` в `generators.production` и в сети `power.network.*` (включая предохранитель и батареи), исключая ложную аварию сети.
2. Мёртвый тип `QuerySeriesResponse` удалён из экспортов, `querySeries` типизирован `Promise<never>` (ряд бросает `SERIES_NOT_AVAILABLE`).
3. В описании PR `Closes #12` заменено на `Часть #12 (S6 Save source)`, ревьюер указан без собаки (`Co2`).
4. `getStatus` при недоступности файла `.sav` возвращает `inert: false` (ошибка пишется в `reason`).
5. Разряд батарей ограничен 100 МВт/шт (`BATTERY_MK1_MAX_DISCHARGE_MW`), превышение отдачи вызывает аварийное отключение сети (`fuse_tripped = 1`). Тест реального `.sav` читает только `FICSIT_TEST_SAV_PATH`. В README зафиксированы особенности расчёта и пути Foreman.
6. Проверки: `npm run typecheck` — 0 ошибок, `npm run build` — passed, `npm test` — passed (8/8 unit + 2/2 реальные с `FICSIT_TEST_SAV_PATH`).

**Блокирует меня:** ничего; жду повторного ревью и слияния PR #46 от Co2.

**Ждут меня:** Co2 — приёмка [PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46) (`sidecar/save-source/`).

**Решения, на которых стою:** ADR-012, ADR-025, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [public-api-v0.md](../../interfaces/public-api-v0.md), `AGENTS.md` §9.

**Дальше:**

1. Приёмка и слияние PR #46 (S6 Save) с Co2.
2. Архив S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) — после завершения S6.
3. Экран «Статистика» (V-5) и виджеты интерфейса (V-10, V-13, V-14) — по графику с недели 7.
