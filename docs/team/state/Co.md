# Co — состояние на 15.11.2026

**Сейчас:** ворота W — [отчёт](../../interfaces/s8-gate-w.md) у King (Co-100); дальше правки по ревью #54 (P1 — изоляция, DevTools, закрытие браузера) и #52.

**Последний результат:** 15.11.2026 — отчёт по воротам W; ответы Gs-60 (Co-99), Gs-71 (Co-98, §6.6 и правило 6 контракта). 13.11 — вендоринг S8 (#54), канал мода (#52).

**Мои PR:** [#54](https://github.com/kkkingqz/ficsit-ai-helper/pull/54) — вендоринг S8, после ворот W (Co-91). [#52](https://github.com/kkkingqz/ficsit-ai-helper/pull/52) — канал мода к адаптеру, ревью Gs (Co-87). [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44) — проводка каталога, `~/Projects/ficsitai-co-mod`, ревью Gs (Co-74). [#45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) — проверка заголовков SML в протоколе, `~/Projects/ficsitai-co-tools`, ревью Gs (Co-76).

**Жду я:** решение King по ADR-032; повторное ревью #44, #45; ручную проверку King; время прогона с Foreman от Co2 (Co-90).

**Ждут меня:** —

**Сборка:** `~/Projects/SML-co` (`a7e8550`, CL 517554); плагин — из `mod/FicsitAIWebRuntime` (#54), CEF — `prepare-webruntime-cef.sh`; пробы S2 и S8 — вне репозитория.

**Решения:** ADR-032, ADR-033, ADR-034, ADR-035, §3.3, §12 п. 11, §17.1; текучка у Gs (Co-41).

**Дальше:**

1. S8: замеры Gf2 (блок 5); критерий 4.4 — Co-85.
2. S2: прогон с настоящим Foreman (Co-86); канал к `FicsitAIApi` — вместе с V-2.
3. После #49: CEF на меше терминала (3.4), затем конфигурация C у Gf2.
