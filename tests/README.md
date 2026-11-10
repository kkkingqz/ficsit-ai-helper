# `tests/` — тесты вне кода модулей

- **Тест-план этапа 1 (P-7):** чек-листы готовности и протоколы замеров в [`test-plan/`](test-plan/README.md) (чек-лист S8 — [`test-plan/s8-checklist.md`](test-plan/s8-checklist.md)).
- **Автопрогон проверок в игре под Proton (P-8, [#39](https://github.com/kkkingqz/ficsit-ai-helper/issues/39)):**
  - Раннер под Proton: [`tools/run-game-tests.sh`](../tools/run-game-tests.sh) (запуск с таймаутом, сбор логов, JSONL и скриншотов).
  - Парсер результатов: [`tools/parse-test-results.py`](../tools/parse-test-results.py) (разбор записей `test_event`, таймеров `scoped_timer` и снимков телеметрии, генерация отчёта Markdown).
  - Загрузка сохранений проверена: опция `?loadgame=<SaveName>` в URL карты уровня (`AFGGameMode::LoadGameOption`).
  - Флаг диагностики: `-FicsitAIDiagnostics=1 -FicsitAITestScenario=<scenario>` (ARCHITECTURE §6.9, Co-16).
- **Сценарии fake-LLM** и тесты адаптера.
- **Автотесты экранов** на наборах Fixture в браузере.
- **Протоколы замеров:** кадровое время BLUI (S8), стоимость телеметрии (S3), время до первого ответа сайдкара (S5-lite).
- **Тест паритета:** падает, если операция выставлена модели без ручной точки входа (V-05, AC-21).

Тесты `core/` на хосте живут рядом с кодом (`mod/FicsitAI/Source/FicsitAICore/core/`) и собираются через CMake (пишет Gs, сборку на хосте настраивает Gf, CI автоматизирует Gf2). Чек-листы приёмки — из тест-плана P-7 ([#32](https://github.com/kkkingqz/ficsit-ai-helper/issues/32)).
