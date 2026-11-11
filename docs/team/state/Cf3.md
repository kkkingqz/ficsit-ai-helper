# Cf3 — состояние на 11.11.2026

**Сейчас:** неделя 2. Пути согласованы в Co2-18, пакеты Foreman для `.sav` изучены. Рабочая копия `~/Projects/ficsitai-cf3`, ветка `work/cf3`.

**Последний результат:** Co2 в [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026) подтвердил зоны владения: `sidecar/save-source/` (источник Save), `sidecar/package/` (сборка архива), `web/screens/statistics/` (V-5), `web/screens/cards/` (V-14). Условия Co2 приняты: `save-source` — чистая библиотека без слушателей/портов/токенов, выход строго по контракту API v0; архив не добавляет процессов в поставку; на вебе вход строго через фасад. Пакеты Foreman (`sf-save-data`, `sf-save-data-graph`) и селекторы изучены, тесты (32 + 23) зелёные.

**Блокирует меня:** ничего. Пути согласованы заблаговременно до старта недели 4; жду фиксации Gs в `OWNERSHIP.md`.

**Ждут меня:** решения ворот W (конец недели 3); старт S6 Save ([#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) и S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) с недели 4.

**Решения, на которых стою:** ADR-012, ADR-025, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [public-api-v0.md](../../interfaces/public-api-v0.md), [план этапа 1](../../PLAN-v0.1.md).

**Дальше:**

1. Дождаться решения ворот W (конец недели 3: Веб или UMG).
2. Фиксация Gs согласованных путей в `OWNERSHIP.md`.
3. С недели 4 начать реализацию пакета `sidecar/save-source/` для S6 ([#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) и сборку архива `sidecar/package/` для S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) по чек-листам Gf2 из тест-плана P-7.
