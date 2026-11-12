# Gf2 — состояние на 12.11.2026

**Сейчас:** подготовка к игровым проверкам под Proton (P-8, [#39](https://github.com/kkkingqz/ficsit-ai-helper/issues/39)), тестовые сохранения (P-5, [#6](https://github.com/kkkingqz/ficsit-ai-helper/issues/6)). Ветка: `work/gf2`.

**Последний результат:**
- **Gs-52 / PR #45:** дано отдельное согласие Gf2 по `OWNERSHIP.md` §21 на правку 5 файлов `tools/host/` (Gf2-26) и оставлено ревью ревизии `fd63572` — **нужны правки**.
- **Co-68, Co-69, Co-72, Co-73 (Gf2-25):** отмечены пункты S8 `3.1` (клавиша F8), `3.2`, `3.3` и масштаб вьюпорта §5.2 в `s8-checklist.md`; [`tools/run-game-tests.sh`](../../tools/run-game-tests.sh) переведён на `tools/host/lib.sh` (`fa_game_session`).
- **Co-61, Co-66, Co-67, Gs-40:** очищены `tests/test-plan/`, добавлено правило `[6/6]` (предупреждение) в `check-invariants.sh`; починен `tools/questions.py` (`answered_by`); отмечены S8 `1.1b`, `1.4`, `2.1–2.3` и S3 §3.1 (Save D).
- **P-5 / P-7:** верифицированы Save A (`eba4645f...`) и Save D (`76ebe073...`), Save C ожидается от King; закрыт `#32`.

**Блокирует меня:** ничего.

**Ждут меня:**
- Открытых вопросов и непрочитанных уведомлений нет (`0`).
- Повторное ревью PR #45 после правок `Co`.
- Живой прогон переоткрытого S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)) на `a7e8550` через `tools/host/`; замеры S8 и телеметрии S3 при сдаче сборок Co/Gs.

**Решения, на которых стою:** ADR-029 (инварианты CI), ADR-032 (ворота W), ADR-033 (Proton), ADR-034 (нормализатор), ADR-035 (HUD без предмета), §11 (GameThread ≤ 1.0 мс), §17.1 (решения King 10–12.11.2026).

**Дальше:**
1. Подготовить личный `~/Projects/SML-gf2` на `a7e8550` (`ENVIRONMENT.md §5.1`) и прогнать S1 (`#9`) в игре под Proton.
2. Повторно проревьюить PR #45 (`tools/host/`) и поддерживать CI-инварианты (`check-invariants.sh`).
