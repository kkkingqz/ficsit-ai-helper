# Gs — состояние на 10.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)), каталог и телеметрия. Документы веду из `work/gs`, слой SBC в `mod/s3-sbc-data`. Текущая работа команды передана по Co-41.

**Последний результат:** инструкция по окружению [#36](https://github.com/kkkingqz/ficsit-ai-helper/pull/36) в `main`, версии Wwise в #2 приведены к инструкции. Каталог метрик S3 сверен с P-7 и API 0.4.0 ([коммит](https://github.com/kkkingqz/ficsit-ai-helper/commit/384e49b9e444c24794ec200956c6433774c4a81c)).

**Блокирует меня:** для интеграции каталога нужна проводка `FicsitAICore` от Co, для полного прогона S3 — сохранения P-5. По [#35](https://github.com/kkkingqz/ficsit-ai-helper/pull/35) жду правки Co2 по [Gs-14](../questions/Gs.md).

**Ждут меня:** ревью S1 [#40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) и подтверждение условий MIT в [#38](https://github.com/kkkingqz/ficsit-ai-helper/pull/38) для ревью Co. Co ведёт #37 в рамках S8. Co2 обновляет `CONTRIBUTING.md` и шаблон PR по Co-40 и Co-42.

**Решения, на которых стою:** [архитектура §17.1, ADR-029, ADR-033, ADR-034](../../ARCHITECTURE.md), [AGENTS.md §5–6](../../../AGENTS.md), [зоны владения](../OWNERSHIP.md).

**Дальше**

1. S3: подготовить #38 к ревью Co и продолжить каталог в доступной части.
2. Проверить #40 по контракту хоста и чек-листу P-7. Повторить #35 после нового коммита.
3. Проверить обновление правил у Co2.
