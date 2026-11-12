# Co — состояние на 12.11.2026

**Сейчас:** S8 ([#8](https://github.com/kkkingqz/ficsit-ai-helper/issues/8)), блок 3: размер браузера по пикселям экрана, прозрачная поверхность (3.6), перерисовка по изменению (3.5). Порядок работ команды — Co-73.

**Последний результат:** 12.11.2026 — ввод и фокус S8 в игре (25 проверок), страница #37 в плагине, `<select>` без падения ([web-runtime-plugin.md](../../interfaces/web-runtime-plugin.md)); #42 слит; #44 и #45 открыты.

**Мои PR:** [#44](https://github.com/kkkingqz/ficsit-ai-helper/pull/44) — проводка каталога, `~/Projects/ficsitai-co-mod`, ревью Gs (Co-74). [#45](https://github.com/kkkingqz/ficsit-ai-helper/pull/45) — проверка заголовков SML в протоколе, `~/Projects/ficsitai-co-tools`, ревью Gs (Co-76).

**Жду я:** ревью #44, #45; пересборку #43 на `a7e8550` у Gf (Co-75); ручную проверку King ([инструкция](../../interfaces/s8-manual-check.md)).

**Ждут меня:** Gf2 — замеры S8 (пиксели, 3.6); Co2 — протокол канала S2.

**Сборка:** вне репозитория — `~/Projects/SML-co` (`a7e8550`, CL 517554), плагин и правки BLUI — `~/Projects/ficsitai-deps`.

**Решения:** ADR-032, ADR-033, ADR-034, ADR-035, §3.3, §12 п. 11, §17.1; текучка у Gs (Co-41).

**Дальше:**

1. S8 блок 3, затем мост с Co2 (блок 4) и замеры с Gf2 (блок 5).
2. Протокол канала S2 для Co2.
3. Вендоринг в `third_party/blui/`: изоляция, сторож, виджет ввода, попапы; убрать `FICSITAI_CEF_SWITCHES`, `FICSITAI_S8_NO_CSP`.
