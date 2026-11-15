# Gs — состояние на 15.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), каталог и телеметрия. Документы в `work/gs`.

**Последний результат:** [#41](https://github.com/kkkingqz/ficsit-ai-helper/pull/41) слит как `a24144c` после ревью Co и зелёных чеков. Номинальные количества и отдельный множитель проверены на Save B. Win64 Shipping собран для Steam и EGS, архив Steam проверен под Proton. [Save D](https://github.com/kkkingqz/ficsit-ai-helper/issues/11#issuecomment-6803095394) прошёл на CL 517554 под Proton. Две выборки: 1 403 рецепта, 1 083 предмета, 673 класса построек. У 517 рецептов Satisfactory Plus и Refined Power расхождений в разблокировках и количествах нет.

**Зависимости:** проводка каталога Co в [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44#issuecomment-6859324543) принята на `e4f2276`, слияние за Co. На Save B пути 145 пуловых акторов изменились между загрузками, для индекса S3 нужен отдельный способ идентификации или исключения.

**Ревью:** [#49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49) слит как `69182d4`. По Co2-40 опубликованы повторные ревью [#48](https://github.com/kkkingqz/ficsit-ai-helper/pull/48#issuecomment-6891660374), [#50](https://github.com/kkkingqz/ficsit-ai-helper/pull/50#issuecomment-6891660688), [#51](https://github.com/kkkingqz/ficsit-ai-helper/pull/51#issuecomment-6891660987), [#53](https://github.com/kkkingqz/ficsit-ai-helper/pull/53#issuecomment-6891661247). Нужны правки. Co ответил на Gs-76–78 (Co-104–106), вопросы закрыты. В штатном адаптере фильтр обязателен, сравнение со штатным Foreman — на отдельном стенде. Протокол уточнил размер пачки и новое рукопожатие при будущем `ack`. #45 и #52 — нужны правки. [#52 на `0079a8a`](https://github.com/kkkingqz/ficsit-ai-helper/pull/52#issuecomment-6860019274). Зона `Sidecar/` у Co (Co-87). [#54 на `3e16a75`](https://github.com/kkkingqz/ficsit-ai-helper/pull/54#issuecomment-6860287384) — нужны правки. Согласие Gf2 получено (Gf2-31), проверка зоны после правок. ADR-032 принят с условиями (Co-101).

**Новые ревизии:** #48 `145c90d`, #50 `6ff5de6`, #51 `1cabf0a` — правки опубликованы. #54 `08763de` — код плагина обновлён, в PR приложен протокол на прежнюю ревизию.

**Дальше:** `catalogRevision`, обновление каталога по событиям, индекс построек и нарезка сбора по кадрам. Co-61 — убрать дубли плана и снятые понятия из своих документов.

**Решения:** [архитектура §8.1–8.2 и §17.1](../../ARCHITECTURE.md), [AGENTS.md §5–6](../../../AGENTS.md), [зоны владения](../OWNERSHIP.md).
