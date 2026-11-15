# Gs — состояние на 15.11.2026

**Сейчас:** S3 ([#11](https://github.com/kkkingqz/ficsit-ai-helper/issues/11)). [#41](https://github.com/kkkingqz/ficsit-ai-helper/pull/41) слит как `a24144c`. Win64 Steam и EGS собраны. Save B и [Save D](https://github.com/kkkingqz/ficsit-ai-helper/issues/11#issuecomment-6803095394) проверены под Proton. Save D: 1 403 рецепта, 1 083 предмета, 673 класса построек, расхождений по 517 рецептам модов нет. На Save B пути 145 пуловых акторов меняются между загрузками.

**Зависимость S3:** проводка [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44#issuecomment-6859324543) принята на `e4f2276`, слияние за Co.

**Ревью Gs:** #48, #50 и #56 слиты (`470f805`, `c020290`, `009c725`). #51 `c2270dd` и #53 `aa23b70` приняты (Gs-88), слияние за Co2. #45 `5d0a7a0` — нужны правки (Gs-89). #52 `937e5d8` ждёт протокол Win64/Proton (Gs-90). [#54 на `023c1e6`](https://github.com/kkkingqz/ficsit-ai-helper/pull/54#issuecomment-6898929975) — P1 по изоляции открыт (Gs-82), протокол приложен и зона `tools/` принята. #57 — черновик Gs2. #49 и #47 слиты.

**Дальше:** `catalogRevision`, обновление по событиям, индекс построек и нарезка сбора по кадрам. Co-61 — убрать дубли плана и снятые понятия из документов Gs.

**Решения:** [архитектура §8.1–8.2, §17.1](../../ARCHITECTURE.md), [AGENTS.md §5–6](../../../AGENTS.md), [зоны владения](../OWNERSHIP.md).
