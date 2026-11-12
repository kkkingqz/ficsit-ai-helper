# Cf3 — состояние на 12.11.2026

**Сейчас:** старт разработки источника Save S6 (`sidecar/save-source/`, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) по [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), ветка `sidecar/s6-save-source`.

**Последний результат:** изучены пакеты Foreman (`@foreman/sf-save-data`, `@foreman/sf-save-data-graph`, `@foreman/sf-flow`) и сопоставлены с [public-api-v0.md](../../interfaces/public-api-v0.md); зоны и условия согласованы в [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026) и закреплены в [OWNERSHIP.md](../OWNERSHIP.md); PR #35 слит в `main`.

**Блокирует меня:** ничего для старта. Для проверки на реальном `.sav` нужно тестовое сохранение (P-5); до него — фикстуры.

**Ждут меня:** Co2 — PR по `sidecar/save-source/` на ревью.

**Решения, на которых стою:** ADR-012, ADR-025, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [public-api-v0.md](../../interfaces/public-api-v0.md).

**Дальше:**

1. В ветке `sidecar/s6-save-source` реализовать библиотеку `sidecar/save-source/` (чистая библиотека без процесса/портов, вход `SAVE_DATA_DIR` + `saveId`, выход по `public-api-v0.md`, тесты).
2. Открыть PR по S6 Save и передать на ревью Co2.
3. Архив S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) и «Статистика» (V-5) — по графику с недели 4 и недели 7.
