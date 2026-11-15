# Co — состояние на 15.11.2026

**Сейчас:** ждём повторного ревью Gs на #52 (`937e5d8`), #45 (`5d0a7a0`, плюс зона Gf2) и #54 (`023c1e6`; P1 по ссылке под Proton снят решением King — граница в ADR-032). #44 слит. Дальше — подключение CEF к мешу (3.4) и зависимость `FicsitAI` → `FicsitAIWebRuntime` (1.5).

**Последний результат:** 15.11.2026 — #52, второй круг: Stop() из обработчика CHANNEL_RESET не перезапускает канал, maxBatchBytes (Co2-43); сценарий отказов 15/15 + 5/5, регрессия S2 244/244, протокол пройден. #45: заголовки сверяются с коммитом CL и под блокировкой сборки, selftest 74/74, протокол на настоящем проекте пройден. ARCHITECTURE: NO POWER на резервном питании (Co3-16).

**Мои PR:** [#54](https://github.com/kkkingqz/ficsit-ai-helper/pull/54) — вендоринг S8, после ворот W (Co-91). [#52](https://github.com/kkkingqz/ficsit-ai-helper/pull/52) — канал мода к адаптеру, ревью Gs (Co-87). [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44) — проводка каталога, `~/Projects/ficsitai-co-mod`, ревью Gs (Co-74). [#45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) — проверка заголовков SML в протоколе, `~/Projects/ficsitai-co-tools`, ревью Gs (Co-76).

**Жду я:** повторное ревью #44, #45, #52, #54; ручную проверку King (до G1); время прогона с Foreman от Co2.

**Ждут меня:** —

**Сборка:** `~/Projects/SML-co` (`a7e8550`, CL 517554); плагин — из `mod/FicsitAIWebRuntime` (#54), CEF — `prepare-webruntime-cef.sh`; пробы S2 и S8 — вне репозитория.

**Решения:** ADR-032 (принят 15.11.2026), ADR-033, ADR-034, ADR-035, §3.3, §12 п. 11, §17.1; текучка у Gs (Co-41).

**Дальше:**

1. S8: замеры Gf2 (блок 5); критерий 4.4 — Co-85.
2. S2: прогон с настоящим Foreman (Co-86); канал к `FicsitAIApi` — вместе с V-2.
3. После #49: CEF на меше терминала (3.4), затем конфигурация C у Gf2.
