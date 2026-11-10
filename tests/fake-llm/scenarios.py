"""
FICSIT AI — Сценарии fake-LLM (MODULES E7, V-12, Co-23, Co-27, Co2-6, ADR-034)
Роль: Gf2

Набор предопределённых сценариев потоковых ответов LLM, включая:
1. normal_text: обычный текстовый ответ.
2. normal_tool_call: корректный вызов инструмента со стримингом аргументов и finish_reason="tool_calls".
3. broken_provider_gemini_stream (Co2-4 / Co-23 / Co-27 / ADR-034):
   - Ход 1 (ответ): вызов инструмента, где провайдер в первом чанке отдаёт thought_signature,
     а в финальном ошибочно отдаёт finish_reason="stop", ломая сквозной путь V-04.
   - Ход 2 (запрос): клиент отправляет результат вызова инструмента. Если в assistant сообщении
     отсутствует thought_signature (потерянная Foreman), провайдер отвечает HTTP 400.
     При её восстановлении нормализатором (ADR-034) отдаётся успешный ответ.
"""

import json


THOUGHT_SIGNATURE_MOCK = "fake_thought_signature_xyz789"


class MissingThoughtSignatureError(Exception):
    """Исключение при отсутствии thought_signature во втором ходе (Co2-6, Co-27)."""
    pass


def validate_request_thought_signature(messages: list):
    """
    Проверяет наличие thought_signature во втором ходе с вызовом инструмента.
    Возвращает True, если валидация пройдена (или это первый ход).
    Вызывает MissingThoughtSignatureError, если подпись отсутствует.
    """
    has_tool_reply = any(m.get("role") == "tool" for m in messages)
    if not has_tool_reply:
        return True

    # Проверяем предшествующее сообщение assistant с tool_calls
    for m in messages:
        if m.get("role") == "assistant" and isinstance(m.get("tool_calls"), list):
            for call in m["tool_calls"]:
                extra = call.get("extra_content", {})
                google = extra.get("google", {}) if isinstance(extra, dict) else {}
                sig = google.get("thought_signature")
                if not sig:
                    raise MissingThoughtSignatureError(
                        "Function call is missing a thought_signature in functionCall parts"
                    )
    return True


def get_chunks_for_scenario(scenario_name: str, model: str = "fake-model", messages: list = None):
    messages = messages or []

    if scenario_name == "normal_text":
        return [
            {
                "id": "chatcmpl-fake-text",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Factory"}, "finish_reason": None}]
            },
            {
                "id": "chatcmpl-fake-text",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": " is operating normally."}, "finish_reason": None}]
            },
            {
                "id": "chatcmpl-fake-text",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
            }
        ]

    elif scenario_name == "normal_tool_call":
        has_tool_reply = any(m.get("role") == "tool" for m in messages)
        if has_tool_reply:
            # Второй ход: модель сообщает результат игроку
            return [
                {
                    "id": "chatcmpl-fake-tool-2",
                    "object": "chat.completion.chunk",
                    "created": 1762776005,
                    "model": model,
                    "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Total raw inputs for Iron Ore: 450 items/min."}, "finish_reason": None}]
                },
                {
                    "id": "chatcmpl-fake-tool-2",
                    "object": "chat.completion.chunk",
                    "created": 1762776005,
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                }
            ]

        # Первый ход: вызов инструмента
        return [
            {
                "id": "chatcmpl-fake-tool",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "index": 0,
                            "id": "call_normal_123",
                            "type": "function",
                            "function": {"name": "total_raw_inputs", "arguments": ""}
                        }]
                    },
                    "finish_reason": None
                }]
            },
            {
                "id": "chatcmpl-fake-tool",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "function": {"arguments": "{\"item\": \"Desc_OreIron_C\"}"}
                        }]
                    },
                    "finish_reason": None
                }]
            },
            {
                "id": "chatcmpl-fake-tool",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": "tool_calls"
                }]
            }
        ]

    elif scenario_name in ("broken_provider_stream", "broken_provider_gemini_stream"):
        has_tool_reply = any(m.get("role") == "tool" for m in messages)
        if has_tool_reply:
            # Второй ход: проверяем наличие thought_signature в запросе (Co-27, Co2-6)
            validate_request_thought_signature(messages)

            # Если проверка прошла успешно (нормализатор вернул подпись):
            return [
                {
                    "id": "chatcmpl-broken-gemini-turn2",
                    "object": "chat.completion.chunk",
                    "created": 1762776005,
                    "model": model,
                    "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Total raw inputs for Iron Ore: 450 items/min."}, "finish_reason": None}]
                },
                {
                    "id": "chatcmpl-broken-gemini-turn2",
                    "object": "chat.completion.chunk",
                    "created": 1762776005,
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                }
            ]

        # Первый ход: провайдер Gemini возвращает вызов с thought_signature, но с finish_reason="stop"
        return [
            {
                "id": "chatcmpl-broken-gemini",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "index": 0,
                            "id": "call_broken_gemini_999",
                            "type": "function",
                            "function": {"name": "total_raw_inputs", "arguments": ""},
                            "extra_content": {"google": {"thought_signature": THOUGHT_SIGNATURE_MOCK}}
                        }]
                    },
                    "finish_reason": None
                }]
            },
            {
                "id": "chatcmpl-broken-gemini",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "function": {"arguments": "{\"item\": \"Desc_OreIron_C\"}"}
                        }]
                    },
                    "finish_reason": None
                }]
            },
            {
                "id": "chatcmpl-broken-gemini",
                "object": "chat.completion.chunk",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    # Поломка 1: ошибочно "stop" вместо "tool_calls"
                    "finish_reason": "stop"
                }]
            }
        ]

    else:
        raise ValueError(f"Неизвестный сценарий: {scenario_name}")


def format_sse_stream(chunks):
    """Преобразует список чанков в поток Server-Sent Events (SSE)."""
    lines = []
    for chunk in chunks:
        lines.append(f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n")
    lines.append("data: [DONE]\n\n")
    return "".join(lines)
