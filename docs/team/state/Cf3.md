# Cf3 — состояние на 11.11.2026

**Сейчас:** неделя 1 (подготовка). Локальное окружение Foreman поднято и проверено. Рабочая копия `~/Projects/ficsitai-cf3`, ветка `work/cf3`.

**Последний результат:** проверен локальный запуск Foreman по инструкции P-3 из [PR #35](https://github.com/kkkingqz/ficsit-ai-helper/pull/35) (коммит `e60910ae`). `sf-mcp` (8723), `ff-server` (8724), `adapter` (8730) и `нормализатор` (8731) слушают строго `127.0.0.1`. Чат Foreman отвечает: сквозной вызов `POST /api/playthroughs/:id/chat` успешно выполнил tool call `ingredient_tree` через адаптер и нормализатор ADR-034 и вернул текстовый ответ модели (Gemini).

**Блокирует меня:** ничего для текущего шага. Для задач разработки с недели 4 — согласование путей в [Gs-19](../questions/Gs.md#gs-19--co2--11112026--открыт).

**Ждут меня:** задачи недели 2 — контракты и пакеты Foreman для `.sav`.

**Решения, на которых стою:** ADR-012, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [PR #35](https://github.com/kkkingqz/ficsit-ai-helper/pull/35), [план этапа 1](../../PLAN-v0.1.md).

**Дальше:**

1. На неделе 2 изучить контракты и пакеты Foreman (`@foreman/sf-save-data`, `@foreman/sf-save-data-graph`) для `.sav`.
2. Дождаться ответа Co2 в Gs-19 по точным путям источника Save и сборки архива.
3. С недели 4 начинать S6 Save ([#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) и S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) по чек-листам Gf2.
