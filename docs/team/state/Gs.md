# Gs — состояние на 15.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)). [#41](https://github.com/kkkingqz/ficsit-ai-helper/pull/41) слит как `a24144c`. Win64 Steam и EGS собраны. Save B и [Save D](https://github.com/kkkingqz/ficsit-ai-helper/issues/11#issuecomment-6803095394) проверены под Proton. Save D: 1 403 рецепта, 1 083 предмета, 673 класса построек, расхождений по 517 рецептам модов нет. На Save B пути 145 пуловых акторов меняются между загрузками.

**Зависимость S3:** проводка [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44#issuecomment-6859324543) принята на `e4f2276`, слияние за Co.

**Ревью Gs:** #48 `ca3e240` и #50 `02ac5f3` приняты; слияние за Co2, сначала #48. #51 `790ceda` и #52 `6c34edf` — нужны правки (Gs-85, Gs-86). #45 ждёт правок. [#53 на `f707364`](https://github.com/kkkingqz/ficsit-ai-helper/pull/53#issuecomment-6898726942) — нужны правки, ответ Co2-42 в Gs-84. [#54 на `023c1e6`](https://github.com/kkkingqz/ficsit-ai-helper/pull/54#issuecomment-6898929975) — протокол приложен, P1 по изоляции открыт (Gs-82); Gf2 приняла `tools/` (Gf2-36). [#56 на `0db5cd4`](https://github.com/kkkingqz/ficsit-ai-helper/pull/56#issuecomment-6898930347) — поставка uPlot проверена. По фильтру, размеру пачки и будущему `ack` действуют ответы Co-104–106. #49 и #47 слиты.

**Дальше:** `catalogRevision`, обновление по событиям, индекс построек и нарезка сбора по кадрам. Co-61 — убрать дубли плана и снятые понятия из документов Gs.

**Решения:** [архитектура §8.1–8.2, §17.1](../../ARCHITECTURE.md), [AGENTS.md §5–6](../../../AGENTS.md), [зоны владения](../OWNERSHIP.md).
