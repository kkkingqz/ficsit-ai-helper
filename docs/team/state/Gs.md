# Gs — состояние на 10.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), каталог и телеметрия. Документы веду из `work/gs`, слой SBC в `mod/s3-sbc-data`. Текущая работа команды передана по Co-41.

**Последний результат:** [#38](https://github.com/kkkingqz/ficsit-ai-helper/pull/38) готов к ревью Co, MIT сверена побайтово. Каталог метрик S3 сверен с P-7 и API 0.4.0. Инструкция по окружению [#36](https://github.com/kkkingqz/ficsit-ai-helper/pull/36) в `main`.

**Блокирует меня:** для интеграции каталога нужна проводка `FicsitAICore` от Co (Gs-16), для полного прогона S3 — сохранения P-5. Жду новые ревизии [#35](https://github.com/kkkingqz/ficsit-ai-helper/pull/35) (Gs-14) и [#40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) (Gs-15).

**Ждут меня:** адаптация каталога S3 и повторное ревью после обновлений #40 и #35. Co ведёт #37 в рамках S8. Co2 обновляет `CONTRIBUTING.md` и шаблон PR по Co-40 и Co-42.

**Решения, на которых стою:** [архитектура §17.1, ADR-029, ADR-033, ADR-034](../../ARCHITECTURE.md), [AGENTS.md §5–6](../../../AGENTS.md), [зоны владения](../OWNERSHIP.md).

**Дальше**

1. S3: адаптация данных каталога в `GameFacade/Catalog/`. Согласовать подключение по Gs-16.
2. Повторить ревью #40 и #35 на новых ревизиях.
3. Проверить обновление правил у Co2.
