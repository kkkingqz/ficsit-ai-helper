"""
FICSIT AI — Сценарии fake-LLM (MODULES E7, V-12, Co-23, ADR-034)
Роль: Gf2

Набор предопределённых сценариев потоковых ответов LLM, включая:
1. normal_text: обычный текстовый ответ.
2. normal_tool_call: корректный вызов инструмента со стримингом аргументов и finish_reason="tool_calls".
3. broken_provider_gemini_stream (Co2-4 / Co-23): вызов инструмента, где провайдер в финальном
   чанке ошибочно отдаёт finish_reason="stop", ломая сквозной путь V-04.
"""

import json


def get_chunks_for_scenario(scenario_name: str, model: str = "fake-model"):
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
        # Поломка Co2-4: Google Gemini OpenAI-совместимый эндпоинт отдает finish_reason="stop"
        # несмотря на наличие tool_calls в потоке.
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
                            "function": {"name": "total_raw_inputs", "arguments": ""}
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
                    # ВОТ ОНА: провайдер ошибочно отдаёт "stop" вместо "tool_calls"
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
