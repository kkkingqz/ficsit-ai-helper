# `tests/fake-llm/` — Fake-LLM сервер и сценарии (MODULES E7, V-12, ADR-034)

Легковесный эмулятор OpenAI-совместимого эндпоинта (`/v1/chat/completions`) для детерминированного тестирования цепочки вызовов инструментов Foreman, адаптера и мода без внешних обращений к облачным провайдерам.

## Сценарии (`scenarios.py`)

1. **`normal_text`**: штатный текстовый ответ модели в потоке (SSE) с `finish_reason: "stop"`.
2. **`normal_tool_call`**: штатный вызов инструмента (`total_raw_inputs`), где аргументы собираются по чанкам, а финальный чанк отдаёт `finish_reason: "tool_calls"`.
3. **`broken_provider_stream`** (поломка Co2-4, Co2-6, вопросы Co-23, Co-27, решение ADR-034):
   - **Ход 1 (ответ провайдера):** эмулирует поведение Google Gemini при `stream: true`: вызовы инструментов передаются в `tool_calls` вместе с `thought_signature`, но финальный чанк содержит `finish_reason: "stop"` вместо `"tool_calls"`. Нормализатор запоминает подпись и правит `"stop"` на `"tool_calls"`.
   - **Ход 2 (запрос к провайдеру):** если клиент (Foreman) отправляет результат вызова инструмента без `thought_signature`, fake-LLM возвращает HTTP 400 (`Function call is missing a thought_signature`). При восстановлении подписи нормализатором fake-LLM отдаёт HTTP 200 и финальный текст ответа.
   - Тест проверяет обе стороны нормализатора ADR-034, гарантируя выполнение сквозного критерия V-04 для Gemini как провайдера по умолчанию.

## Запуск сервера

```bash
# Запуск сервера на порту 8089 со сценарием поломки Gemini по умолчанию
python3 tests/fake-llm/server.py --port 8089 --scenario broken_provider_stream
```

Сервер поддерживает переопределение сценария на лету:
- Заголовком запроса: `X-Mock-Scenario: normal_tool_call`
- Либо query-параметром: `http://127.0.0.1:8089/v1/chat/completions?scenario=normal_tool_call`

## Запуск тестов сценариев

```bash
python3 tests/fake-llm/test_normalizer_scenario.py
```
