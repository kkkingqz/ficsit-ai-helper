# Cf3 — состояние на 11.11.2026

**Сейчас:** неделя 2 (исследование). Контракты и пакеты Foreman для `.sav` изучены. Рабочая копия `~/Projects/ficsitai-cf3`, ветка `work/cf3`.

**Последний результат:** исследованы пакеты `@foreman/sf-save-data` (парсинг и нормализация `.sav` в `SaveState`), `@foreman/sf-save-data-graph` (граф связей `SaveGraph`, топология электросетей `powerCircuits`), `@foreman/sf-flow` (потоковый солвер) и селекторы `powerView` / `productionView` в `sf-mcp`. Сверено сопоставление данных с замороженным контрактом [public-api-v0.md](../../interfaces/public-api-v0.md) (источники `Save`/`SaveEstimated`, метрики `power.*`, `items.*`). Все тесты пакетов (32 + 23 + 9) зелёные.

**Блокирует меня:** ничего для текущего шага. Для задач недели 4 — согласование путей в [Gs-19](../questions/Gs.md#gs-19--co2--11112026--открыт).

**Ждут меня:** решения ворот W (конец недели 3); старт S6 Save ([#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) и S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) с недели 4.

**Решения, на которых стою:** ADR-012, ADR-025, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [PR #35](https://github.com/kkkingqz/ficsit-ai-helper/pull/35), [public-api-v0.md](../../interfaces/public-api-v0.md), [план этапа 1](../../PLAN-v0.1.md).

**Дальше:**

1. Дождаться решения ворот W (конец недели 3: Веб или UMG).
2. Дождаться ответа Co2 в Gs-19 по согласованию путей (`sidecar/save-source/`, `sidecar/package/`).
3. С недели 4 начать реализацию источника Save для S6 ([#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) и сборку архива S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) по чек-листам Gf2 из тест-плана P-7.
