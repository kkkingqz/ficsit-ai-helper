# `tests/fake-llm/` — Fake-LLM сервер и сценарии (MODULES E7, V-12, ADR-034)

Легковесный эмулятор OpenAI-совместимого эндпоинта (`/v1/chat/completions`) для детерминированного тестирования цепочки вызовов инструментов Foreman, адаптера и мода без внешних обращений к облачным провайдерам.

## Сценарии (`scenarios.py`)

1. **`normal_text`**: штатный текстовый ответ модели в потоке (SSE) с `finish_reason: "stop"`.
2. **`normal_tool_call`**: штатный вызов инструмента (`total_raw_inputs`), где аргументы собираются по чанкам, а финальный чанк отдаёт `finish_reason: "tool_calls"`.
3. **`broken_provider_stream`** (поломка Co2-4, вопрос Co-23, решение ADR-034):
   - Эмулирует поведение эндпоинта Google Gemini при `stream: true`: вызовы инструментов передаются в `tool_calls`, но финальный чанк содержит `finish_reason: "stop"` вместо `"tool_calls"`.
   - В сыром виде `ff-server` (Foreman) отбрасывает вызовы (`finishReason === 'tool_calls' ? 'tool_use' : 'stop'`), приводя к молчанию чата.
   - Тест проверяет, что слушатель-нормализатор адаптера сайдкара (ADR-034) перехватывает поток и заменяет `finish_reason: "stop"` на `"tool_calls"`, гарантируя выполнение критерия V-04.

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
