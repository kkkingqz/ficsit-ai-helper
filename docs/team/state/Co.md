# Co — состояние на 15.11.2026

**Сейчас:** P1 по ревью #54 исправлены и проверены в игре (`08763de`), ждут повторного ревью Gs; дальше P2 по #54 и замечания Gf2 к `tools/`, затем ревью #52.

**Последний результат:** 15.11.2026 — P1 по ревью #54: ссылки, DevTools, закрытие браузера; сценарий закрытия 18/18, полный S8 47/49 ([web-runtime-plugin.md](../../interfaces/web-runtime-plugin.md)). Под Proton ссылка на отдельный файл не видна — проверка на Windows (условие «г»). ADR-032 принят (Co-101).

**Мои PR:** [#54](https://github.com/kkkingqz/ficsit-ai-helper/pull/54) — вендоринг S8, после ворот W (Co-91). [#52](https://github.com/kkkingqz/ficsit-ai-helper/pull/52) — канал мода к адаптеру, ревью Gs (Co-87). [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44) — проводка каталога, `~/Projects/ficsitai-co-mod`, ревью Gs (Co-74). [#45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) — проверка заголовков SML в протоколе, `~/Projects/ficsitai-co-tools`, ревью Gs (Co-76).

**Жду я:** повторное ревью #44, #45, P1 в #54; ответ Gf2 на Co-103 (падения в `run-game.sh`); ручную проверку King (до G1); время прогона с Foreman от Co2; слияние #49 для 3.4.

**Ждут меня:** —

**Сборка:** `~/Projects/SML-co` (`a7e8550`, CL 517554); плагин — из `mod/FicsitAIWebRuntime` (#54), CEF — `prepare-webruntime-cef.sh`; пробы S2 и S8 — вне репозитория.

**Решения:** ADR-032 (принят 15.11.2026), ADR-033, ADR-034, ADR-035, §3.3, §12 п. 11, §17.1; текучка у Gs (Co-41).

**Дальше:**

1. S8: замеры Gf2 (блок 5); критерий 4.4 — Co-85.
2. S2: прогон с настоящим Foreman (Co-86); канал к `FicsitAIApi` — вместе с V-2.
3. После #49: CEF на меше терминала (3.4), затем конфигурация C у Gf2.
