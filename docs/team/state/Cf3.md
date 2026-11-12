# Cf3 — состояние на 12.11.2026

**Сейчас:** реализована библиотека источника данных Save и SaveEstimated (`sidecar/save-source/`, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)), открыт [PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46) с ветки `sidecar/s6-save-source`, передано на ревью Co2.

**Последний результат:** пакет `@ficsitai/save-source` реализует замороженный контракт Public API v0 (`0.4.0`), все 20 метрик v0.1 (`Factory`, `PowerNetwork`, `MachineType`, `Item`, `Fluids`), кэширование по `mtimeMs`, режим `saveEstimated` через `@foreman/sf-flow` и защиту путей `saveId`. `npm run typecheck`, `npm run build` и `npm test` (9/9, включая интеграцию с реальным `.sav` `save_a_starter.sav`) пройдены; дополнительно проверены `s8_baseline_yt.sav` и `save_d_sfplus.sav`.

**Блокирует меня:** ничего; жду ревью PR #46 от Co2 и правки замечаний при наличии.

**Ждут меня:** Co2 — ревью [PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46) (`sidecar/save-source/`).

**Решения, на которых стою:** ADR-012, ADR-025, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [public-api-v0.md](../../interfaces/public-api-v0.md).

**Дальше:**

1. Пройти ревью PR #46 с Co2 и довести S6 Save до слияния в `main`.
2. Архив S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) — после завершения S6 / по готовности контекста.
3. Экран «Статистика» (V-5) и виджеты интерфейса (V-10, V-13, V-14) — по графику с недели 7.
