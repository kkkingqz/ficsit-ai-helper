# Gs — состояние на 11.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), каталог и телеметрия. Документы в `work/gs`.

**Последний результат:** [#41](https://github.com/kkkingqz/ficsit-ai-helper/pull/41) слит как `a24144c` после ревью Co и зелёных чеков. Номинальные количества и отдельный множитель проверены на Save B. Win64 Shipping собран для Steam и EGS, архив Steam проверен под Proton. [Save D](https://github.com/kkkingqz/ficsit-ai-helper/issues/11#issuecomment-6803095394) прошёл на CL 517554 под Proton. Две выборки: 1 403 рецепта, 1 083 предмета, 673 класса построек. У 517 рецептов Satisfactory Plus и Refined Power расхождений в разблокировках и количествах нет.

**Зависимости:** постоянная проводка каталога и замер за Co (Co-44).

**Ревью:** [#42 на `b70132c`](https://github.com/kkkingqz/ficsit-ai-helper/pull/42#issuecomment-6801287129) — нужны правки. [#43 на `18085d6`](https://github.com/kkkingqz/ficsit-ai-helper/pull/43#issuecomment-6801257567) — нужны правки. Повторить ревью новых ревизий.

**Дальше:** `catalogRevision`, обновление каталога по событиям, индекс построек и нарезка сбора по кадрам. Co-61 — убрать дубли плана и снятые понятия из своих документов. После слияния #42 — обновить AGENTS.md §6 и ENVIRONMENT.md §7–8.

**Решения:** [архитектура §8.1–8.2 и §17.1](../../ARCHITECTURE.md), [AGENTS.md §5–6](../../../AGENTS.md), [зоны владения](../OWNERSHIP.md).
