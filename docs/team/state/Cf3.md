# Cf3 — состояние на 15.11.2026

**Сейчас:** Открыт [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) по спайку S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) в `sidecar/package/` (сборка архива сайдкара для альфы). Жду ревью Co2 (Cf3-7).

**Последний результат:**
1. Пакет `@ficsitai/package` (S5-lite, [#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) полностью реализован в `sidecar/package/`:
   - Сборка самодостаточных архивов в двух раскладках (`linux-x64` и `win-x64`) с портативным Node.js 22 (`v22.23.4`, по `foreman.pin.json`).
   - Поставка ровно 3 процессов: `ff-server`, `sf-mcp`, `adapter` (с `save-source` и нормализатором).
   - Все слушатели строго на `127.0.0.1` (AC-12, V-08 — брандмауэр не задаёт вопросов).
   - Предсозданная SQLite база `data/foreman.db` со всеми 12 применёнными миграциями.
   - Для Windows поставляется предсобранный нативный аддон `better_sqlite3.node` (win32-x64, Node 22 ABI v127).
   - Автономные лаунчеры `start.sh` / `start.bat`, `stop.sh` / `stop.bat`, `status.sh` / `status.bat` поверх кроссплатформенного `launcher.js`.
2. Windows-архив успешно протестирован под Wine 11.0: запуск `node.exe` и тестовые операции с SQLite в памяти работают штатно (пункт 4.1 чек-листа `spikes-checklist.md` закрыт).
3. Тесты пакета зелёные (5/5). Открыт [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55).
4. Ранее библиотека `@ficsitai/save-source` (S6 Save, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) полностью реализована, протестирована, одобрена Co2 и влита в `main` ([PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46)).

**Блокирует меня:** ничего.

**Ждут меня:**
- Co2: ревью [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) по S5-lite.
- V-5 ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) и V-14 ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31)): веб-экраны и карточки поверх `@ficsitai/screens-api` по графику.

**Решения, на которых стою:** ADR-012, ADR-015, ADR-025, ADR-032, ADR-033, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), [Co-84](../questions/Co.md#co-84--co2-gf2-gs-все--уведомление--12112026), [Co-100](../questions/Co.md#co-100--все--уведомление--отчёт-по-воротам-w-готов-решение-за-king--15112026), [Co-101](../questions/Co.md#co-101--все--уведомление--adr-032-принят-экраны--веб-во-встроенном-браузере--15112026), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [Co2-32](../questions/Co2.md#co2-32--cf3-co3--уведомление--ревью-46-закрыто-прочерк-на-экране--12112026), [Co2-38](../questions/Co2.md#co2-38--cf3-gs2--уведомление--фасад-api-готов-на-него-можно-опираться--13112026), [public-api-v0.md](../../interfaces/public-api-v0.md), `AGENTS.md` §6 и §9.

**Дальше:**

1. Ревью и слияние PR #55 по S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)).
2. Экран «Статистика» (V-5) и карточки (V-14) — в `web/screens/statistics/` и `web/screens/cards/` поверх фасада Co2 (`@ficsitai/screens-api`).
