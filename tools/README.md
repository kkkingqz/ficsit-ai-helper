# `tools/` — скрипты для CI и разработки

- **Инварианты архитектуры ([`tools/ci/check-invariants.sh`](ci/check-invariants.sh)):** проверяет 5 правил ADR-029, AC-21, Co-3 (`AFG*`/`UFG*` только в `GameFacade/`, `FicsitAIUI` без заголовков игры и SML, отсутствие мутирующего API в сайдкаре, паритет операций, отсутствие класса терминала в `FicsitAIUI`). Подключён в CI ([`.github/workflows/invariants.yml`](../.github/workflows/invariants.yml)).
- **Очередь вопросов ([`tools/questions.py`](questions.py)):** утилита проверки очереди вопросов в `docs/team/questions/` с фильтрацией ложных срабатываний шаблонов и учётом блоков ответов (`./tools/questions.py <Роль>` или `--stats`).
- Вспомогательное для сборки архива сайдкара и запуска Foreman локально (этап 1, недели 4–5).

Сам мод в CI на этапе 1 не собирается: движок Coffee Stain слишком велик для бесплатных раннеров GitHub, сборку для альфы делает Gf локально (план §10).
