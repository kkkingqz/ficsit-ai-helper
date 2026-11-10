#!/usr/bin/env python3
# FICSIT AI — Тест сценариев fake-LLM и двунаправленного нормализатора ADR-034 (Co-23, Co-27, Co2-6, MODULES E7)
# Роль: Gf2
#
# Проверяет:
# 1. Штатный текст (normal_text):
#    Нормализатор НЕ трогает finish_reason="stop", когда tool_calls не было (проверка Co2-9).
# 2. Штатный вызов инструмента (normal_tool_call):
#    Провайдер отдаёт tool_calls и finish_reason="tool_calls".
# 3. Ход 1 (ответ провайдера, Co2-4, Co-23):
#    - Провайдер Gemini отдаёт tool_calls и thought_signature, но finish_reason="stop".
#    - Сырой поток: ff-server отбрасывает вызовы -> чат молчит (дефект V-04).
#    - Через нормализатор: finish_reason="stop" -> "tool_calls", thought_signature запоминается.
# 4. Ход 2 (запрос к провайдеру, Co2-6, Co-27):
#    - Без нормализатора: Foreman отправляет результат вызова инструмента, теряя thought_signature.
#      Провайдер отвечает HTTP 400 "Function call is missing a thought_signature".
#    - С нормализатором: нормализатор восстанавливает thought_signature в исходящем теле.
#      Провайдер отвечает HTTP 200, отдаёт финальный текст -> V-04 завершается успешно.

import json
import sys
from scenarios import (
    get_chunks_for_scenario,
    MissingThoughtSignatureError,
    THOUGHT_SIGNATURE_MOCK
)


class MockSignatureStore:
    """Эмулирует SignatureStore нормализатора сайдкара (ADR-034 с изоляцией разговоров по Gs-11 / Co2-11)."""
    def __init__(self):
        # Хранит (conv_id, tool_call_id) -> signature
        self.signatures = {}

    def remember(self, conv_id: str, tool_calls: list):
        for tc in tool_calls:
            cid = tc.get("id")
            sig = tc.get("extra_content", {}).get("google", {}).get("thought_signature")
            if cid and sig:
                self.signatures[(conv_id, cid)] = sig

    def restore(self, messages: list):
        user_msgs = [m.get("content", "") for m in messages if m.get("role") == "user"]
        conv_id = user_msgs[-1] if user_msgs else "default"

        restored = 0
        for m in messages:
            if m.get("role") == "assistant" and isinstance(m.get("tool_calls"), list):
                for call in m["tool_calls"]:
                    cid = call.get("id")
                    extra = call.setdefault("extra_content", {})
                    google = extra.setdefault("google", {})
                    key = (conv_id, cid)
                    if "thought_signature" not in google and key in self.signatures:
                        google["thought_signature"] = self.signatures[key]
                        restored += 1
        return restored


def parse_stream_choices(chunks):
    """Парсит чанки потока с разделением по choice.index (Gs-11, Co2-12)."""
    choices_map = {}
    for chunk in chunks:
        for choice in chunk.get("choices", []):
            idx = choice.get("index", 0)
            if idx not in choices_map:
                choices_map[idx] = {"text": "", "tool_calls": [], "finish_reason": None}
            delta = choice.get("delta", {})
            if delta.get("content"):
                choices_map[idx]["text"] += delta["content"]
            if delta.get("tool_calls"):
                choices_map[idx]["tool_calls"].extend(delta["tool_calls"])
            if choice.get("finish_reason"):
                choices_map[idx]["finish_reason"] = choice["finish_reason"]
    return choices_map


def simulate_foreman_stream_parser(chunks):
    """
    Эмулирует логику парсера ff-server из Co2-4:
    return { text, toolCalls, stopReason: finishReason === 'tool_calls' ? 'tool_use' : 'stop' };
    """
    text = ""
    tool_calls = []
    finish_reason = None

    for chunk in chunks:
        for choice in chunk.get("choices", []):
            delta = choice.get("delta", {})
            if delta.get("content"):
                text += delta["content"]
            if delta.get("tool_calls"):
                for tc in delta["tool_calls"]:
                    idx = tc.get("index", 0)
                    while len(tool_calls) <= idx:
                        tool_calls.append({"id": "", "name": "", "arguments": ""})
                    if "id" in tc:
                        tool_calls[idx]["id"] = tc["id"]
                    func = tc.get("function", {})
                    if "name" in func:
                        tool_calls[idx]["name"] = func["name"]
                    if "arguments" in func:
                        tool_calls[idx]["arguments"] += func["arguments"]
                    if "extra_content" in tc:
                        tool_calls[idx]["extra_content"] = tc["extra_content"]
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]

    stop_reason = "tool_use" if finish_reason == "tool_calls" else "stop"
    return {
        "text": text,
        "tool_calls": tool_calls,
        "finish_reason": finish_reason,
        "stop_reason": stop_reason,
        "tools_executed": (stop_reason == "tool_use" and len(tool_calls) > 0)
    }


def normalize_stream_chunks_adr034(chunks, sig_store: MockSignatureStore, conv_id: str = "default"):
    """
    Эмулирует логику слушателя-нормализатора сайдкара (ADR-034 на ответах):
    1. Запоминает thought_signature с привязкой к разговору conv_id.
    2. Исправляет finish_reason: "stop" -> "tool_calls" РАЗДЕЛЬНО для каждого choice.index (Gs-11, Co2-12).
    """
    choices_with_tools = set()
    normalized = []

    for chunk in chunks:
        c_copy = json.loads(json.dumps(chunk))
        for choice in c_copy.get("choices", []):
            idx = choice.get("index", 0)
            delta = choice.get("delta", {})
            if delta.get("tool_calls"):
                choices_with_tools.add(idx)
                if sig_store:
                    sig_store.remember(conv_id, delta["tool_calls"])
            if choice.get("finish_reason") == "stop" and idx in choices_with_tools:
                choice["finish_reason"] = "tool_calls"
        normalized.append(c_copy)

    return normalized


def run_tests():
    print("=== Тестирование сценариев fake-LLM и двунаправленного нормализатора ADR-034 (Co-23, Co-27) ===")
    sig_store = MockSignatureStore()

    # 1. Штатный текстовый ответ (Co2-9)
    chunks_text = get_chunks_for_scenario("normal_text")
    res_text_raw = simulate_foreman_stream_parser(chunks_text)
    assert res_text_raw["finish_reason"] == "stop"
    assert res_text_raw["stop_reason"] == "stop"
    assert res_text_raw["tools_executed"] is False
    assert "Factory is operating normally." in res_text_raw["text"]

    chunks_text_norm = normalize_stream_chunks_adr034(chunks_text, sig_store)
    res_text_norm = simulate_foreman_stream_parser(chunks_text_norm)
    assert res_text_norm["finish_reason"] == "stop", "Нормализатор НЕ должен менять finish_reason без tool_calls"
    assert res_text_norm["text"] == res_text_raw["text"], "Текст ответа должен оставаться неизменным"
    print("✅ 1. normal_text: штатный текст не повреждается нормализатором (Co2-9)")

    # 2. Штатный вызов инструмента
    chunks_norm = get_chunks_for_scenario("normal_tool_call")
    res_norm = simulate_foreman_stream_parser(chunks_norm)
    assert res_norm["tools_executed"] is True
    assert res_norm["stop_reason"] == "tool_use"
    print("✅ 2. normal_tool_call: штатный вызов инструмента отдаёт stop_reason='tool_use'")

    # 3. Ход 1 (ответ провайдера Gemini, Co2-4, Co-23)
    chunks_broken = get_chunks_for_scenario("broken_provider_stream")
    res_broken = simulate_foreman_stream_parser(chunks_broken)
    # Воспроизведение поломки finish_reason:
    assert len(res_broken["tool_calls"]) > 0
    assert res_broken["finish_reason"] == "stop"
    assert res_broken["stop_reason"] == "stop"
    assert res_broken["tools_executed"] is False, "Foreman сбросил вызовы: чат молчит"
    print("✅ 3. broken_provider_stream (ход 1, сырой): воспроизведена поломка finish_reason='stop'")

    # Нормализация хода 1:
    user_prompt_1 = "Сколько железной руды поступает на завод?"
    chunks_fixed = normalize_stream_chunks_adr034(chunks_broken, sig_store, conv_id=user_prompt_1)
    res_fixed = simulate_foreman_stream_parser(chunks_fixed)
    assert res_fixed["finish_reason"] == "tool_calls"
    assert res_fixed["stop_reason"] == "tool_use"
    assert res_fixed["tools_executed"] is True
    cache_key_1 = (user_prompt_1, "call_broken_gemini_999")
    assert cache_key_1 in sig_store.signatures
    assert sig_store.signatures[cache_key_1] == THOUGHT_SIGNATURE_MOCK
    print("✅ 4. normalizer_adr034 (ход 1, нормализован): finish_reason исправлен, подпись сохранена в кэш")

    # 4. Ход 2 (запрос к провайдеру Gemini, Co2-6, Co-27)
    # Foreman готовит сообщение для следующего хода:
    # Стандартная OpenAI-схема Foreman теряет extra_content!
    foreman_messages = [
        {"role": "user", "content": user_prompt_1},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_broken_gemini_999",
                    "type": "function",
                    "function": {"name": "total_raw_inputs", "arguments": "{\"item\":\"Desc_OreIron_C\"}"}
                    # extra_content потерян!
                }
            ]
        },
        {
            "role": "tool",
            "tool_call_id": "call_broken_gemini_999",
            "content": "{\"rate\": 450.0, \"unit\": \"items/min\"}"
        }
    ]

    # Попытка 4A: Отправка сырого запроса Foreman без нормализатора
    raw_req_messages = json.loads(json.dumps(foreman_messages))
    try:
        get_chunks_for_scenario("broken_provider_stream", messages=raw_req_messages)
        assert False, "Провайдер должен вернуть ошибку 400 без thought_signature"
    except MissingThoughtSignatureError as err:
        assert "missing a thought_signature" in str(err)
        print("✅ 5. broken_provider_stream (ход 2, сырой): воспроизведён отказ Gemini 400 (Co2-6)")

    # Попытка 4B: Пропуск через нормализатор исходящих запросов ADR-034
    normalized_req_messages = json.loads(json.dumps(foreman_messages))
    restored_count = sig_store.restore(normalized_req_messages)
    assert restored_count == 1, "Нормализатор должен восстановить 1 подпись мысли"

    # Теперь запрос уходит в Gemini fake-LLM:
    turn2_chunks = get_chunks_for_scenario("broken_provider_stream", messages=normalized_req_messages)
    res_turn2 = simulate_foreman_stream_parser(turn2_chunks)
    assert res_turn2["finish_reason"] == "stop"
    assert "Total raw inputs for Iron Ore: 450 items/min." in res_turn2["text"]
    print("✅ 6. normalizer_adr034 (ход 2, нормализован): подпись восстановлена, провайдер ответил текстом")

    # 5. Смешанный поток: tool_call в index=0 и текст в index=1 (Gs-11, Co2-12)
    mixed_chunks = get_chunks_for_scenario("mixed_stream")
    raw_mixed_choices = parse_stream_choices(mixed_chunks)
    assert raw_mixed_choices[0]["finish_reason"] == "stop", "Сырой провайдер ошибочно отдал stop для tool_call"
    assert raw_mixed_choices[1]["finish_reason"] == "stop", "Сырой провайдер отдал stop для текста"

    norm_mixed_chunks = normalize_stream_chunks_adr034(mixed_chunks, sig_store, conv_id="mixed_conv")
    norm_mixed_choices = parse_stream_choices(norm_mixed_chunks)
    assert norm_mixed_choices[0]["finish_reason"] == "tool_calls", "Нормализатор должен исправить finish_reason на tool_calls для choice 0"
    assert norm_mixed_choices[1]["finish_reason"] == "stop", "Нормализатор НЕ должен менять finish_reason на tool_calls для чистого текста в choice 1"
    print("✅ 7. mixed_stream (Gs-11, Co2-12): finish_reason исправлен для choice 0 и сохранён stop для choice 1")

    # 6. Изоляция кэша подписей по разговорам (Gs-11, Co2-12)
    # Разговор 1:
    conv1_user = "Разговор 1: проверь батареи"
    conv1_chunks = [
        {
            "id": "cmpl-c1",
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "shared_call_id_777",
                        "type": "function",
                        "function": {"name": "query_metric"},
                        "extra_content": {"google": {"thought_signature": "signature_for_conv1_only"}}
                    }]
                },
                "finish_reason": "stop"
            }]
        }
    ]
    normalize_stream_chunks_adr034(conv1_chunks, sig_store, conv_id=conv1_user)
    assert (conv1_user, "shared_call_id_777") in sig_store.signatures

    # Разговор 2 (с тем же tool_call_id, но другим пользователем):
    conv2_user = "Разговор 2: покажи генераторы"
    conv2_messages = [
        {"role": "user", "content": conv2_user},
        {
            "role": "assistant",
            "tool_calls": [{
                "id": "shared_call_id_777",
                "type": "function",
                "function": {"name": "query_metric", "arguments": "{}"}
            }]
        },
        {
            "role": "tool",
            "tool_call_id": "shared_call_id_777",
            "content": "{}"
        }
    ]
    # Пытаемся восстановить подпись для разговора 2:
    conv2_restored = sig_store.restore(conv2_messages)
    assert conv2_restored == 0, "Подпись из разговора 1 НЕ должна попадать в разговор 2!"

    # Отправка в провайдер без подписи в разговоре 2 приводит к ошибке 400:
    try:
        get_chunks_for_scenario("broken_provider_stream", messages=conv2_messages)
        assert False, "Провайдер должен вернуть HTTP 400 для второго разговора без подписи"
    except MissingThoughtSignatureError as err:
        assert "missing a thought_signature" in str(err)
    print("✅ 8. conversation_isolation (Gs-11, Co2-12): подпись изолирована по отпечатку разговора, чужой вызов отклонён 400")

    print("\nВсе 8 тестов двунаправленной нормализации ADR-034 и fake-LLM успешно пройдены!")
    return 0


if __name__ == "__main__":
    sys.exit(run_tests())
