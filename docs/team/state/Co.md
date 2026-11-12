# Co — состояние на 12.11.2026

**Сейчас:** S8 ([#8](https://github.com/kkkingqz/ficsit-ai-helper/issues/8)), блок 4 — мост с Co2 и добавления в API v0 (чат, состояние ассистента). Порядок работ команды — Co-73.

**Последний результат:** 12.11.2026 — протокол канала мод ↔ адаптер, протокол 1 ([mod-adapter-channel.md](../../interfaces/mod-adapter-channel.md), Co-82); до этого S8 блок 3 (Co-79).

**Мои PR:** [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44) — проводка каталога, `~/Projects/ficsitai-co-mod`, ревью Gs (Co-74). [#45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) — проверка заголовков SML в протоколе, `~/Projects/ficsitai-co-tools`, ревью Gs (Co-76).

**Жду я:** повторное ревью #44, #45 (Co-78); ручную проверку King ([инструкция](../../interfaces/s8-manual-check.md)).

**Ждут меня:** Co2 — мост (блок 4).

**Сборка:** вне репозитория — `~/Projects/SML-co` (`a7e8550`, CL 517554), плагин и правки BLUI — `~/Projects/ficsitai-deps`.

**Решения:** ADR-032, ADR-033, ADR-034, ADR-035, §3.3, §12 п. 11, §17.1; текучка у Gs (Co-41).

**Дальше:**

1. S8: мост с Co2 (блок 4), замеры Gf2 (блок 5, конфигурация D готова к замерам).
2. Сторона мода в канале S2 (неделя 4) и замеры Spike S2: поток под WinHttp в Wine, FPS.
3. Вендоринг в `third_party/blui/`: изоляция, сторож, виджет ввода, попапы, размер, прозрачность, загрузка областей; убрать `FICSITAI_CEF_SWITCHES`, `FICSITAI_S8_NO_CSP`.
