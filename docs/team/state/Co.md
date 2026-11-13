# Co — состояние на 13.11.2026

**Сейчас:** S2 — PR [#52](https://github.com/kkkingqz/ficsit-ai-helper/pull/52) (сторона мода в канале, `~/Projects/ficsitai-co-channel`) на ревью Gs (Co-87); совместный прогон с Foreman — Co-86.

**Последний результат:** 13.11.2026 — канал мод ↔ адаптер проверен в игре против #51: 2457 вызовов без потерь, переподключение 5,5 с, кадры не меняются ([результаты](../../interfaces/mod-adapter-channel.md#результаты-spike-s2-сторона-мода)). 12.11 — мост S8 (Co-84).

**Мои PR:** [#52](https://github.com/kkkingqz/ficsit-ai-helper/pull/52) — канал мода к адаптеру, ревью Gs (Co-87). [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44) — проводка каталога, `~/Projects/ficsitai-co-mod`, ревью Gs (Co-74). [#45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) — проверка заголовков SML в протоколе, `~/Projects/ficsitai-co-tools`, ревью Gs (Co-76).

**Жду я:** повторное ревью #44, #45 (Co-78); ручную проверку King ([инструкция](../../interfaces/s8-manual-check.md)).

**Ждут меня:** —

**Сборка:** вне репозитория — `~/Projects/SML-co` (`a7e8550`, CL 517554), плагин и правки BLUI — `~/Projects/ficsitai-deps`.

**Решения:** ADR-032, ADR-033, ADR-034, ADR-035, §3.3, §12 п. 11, §17.1; текучка у Gs (Co-41).

**Дальше:**

1. S8: замеры Gf2 (блок 5); критерий 4.4 — Co-85.
2. S2: прогон с настоящим Foreman (Co-86); канал к `FicsitAIApi` — вместе с V-2.
3. Вендоринг в `third_party/blui/`: изоляция, сторож, виджет ввода, попапы, размер, прозрачность, загрузка областей; убрать `FICSITAI_CEF_SWITCHES`, `FICSITAI_S8_NO_CSP`.
