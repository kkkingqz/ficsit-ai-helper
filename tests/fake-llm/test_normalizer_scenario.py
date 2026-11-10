#!/usr/bin/env python3
# FICSIT AI — Тест сценария поломки стриминга провайдера и нормализатора ADR-034 (Co-23, MODULES E7)
# Роль: Gf2
#
# Проверяет:
# 1. Сырой сценарий Google Gemini (broken_provider_stream):
#    Провайдер отдаёт tool_calls, но finish_reason="stop".
#    Логика ff-server (Foreman) отбрасывает вызовы -> чат молчит (ошибка V-04).
# 2. Поведение через нормализатор ADR-034:
#    Нормализатор сайдкара исправляет finish_reason="stop" -> "tool_calls".
#    ff-server успешно распознаёт вызов инструмента -> V-04 выполняется.

import json
import sys
from scenarios import get_chunks_for_scenario


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


def normalize_stream_chunks_adr034(chunks):
    """
    Эмулирует логику слушателя-нормализатора сайдкара (ADR-034):
    Если в потоке зафиксированы tool_calls, а финальный finish_reason равен 'stop',
    нормализатор заменяет его на 'tool_calls'.
    """
    has_seen_tool_calls = False
    normalized = []

    for chunk in chunks:
        # Клонируем чанк
        c_copy = json.loads(json.dumps(chunk))
        for choice in c_copy.get("choices", []):
            delta = choice.get("delta", {})
            if delta.get("tool_calls"):
                has_seen_tool_calls = True
            if choice.get("finish_reason") == "stop" and has_seen_tool_calls:
                # Нормализация по ADR-034
                choice["finish_reason"] = "tool_calls"
        normalized.append(c_copy)

    return normalized


def run_tests():
    print("=== Тестирование сценариев fake-LLM и нормализатора ADR-034 (Co-23) ===")

    # 1. Базовый сценарий: нормальный вызов инструмента
    chunks_norm = get_chunks_for_scenario("normal_tool_call")
    res_norm = simulate_foreman_stream_parser(chunks_norm)
    assert res_norm["tools_executed"] is True, "Штатный вызов должен исполняться"
    assert res_norm["stop_reason"] == "tool_use"
    print("✅ 1. normal_tool_call: штатный стриминг распознаётся Foreman (stop_reason='tool_use')")

    # 2. Сценарий поломки Gemini (Co2-4): finish_reason='stop' при наличии tool_calls
    chunks_broken = get_chunks_for_scenario("broken_provider_stream")
    res_broken = simulate_foreman_stream_parser(chunks_broken)
    # Демонстрация воспроизведения бага:
    assert len(res_broken["tool_calls"]) > 0, "Вызовы инструментов были переданы"
    assert res_broken["finish_reason"] == "stop", "Провайдер ошибочно отдал finish_reason='stop'"
    assert res_broken["stop_reason"] == "stop", "Foreman выставил stop_reason='stop'"
    assert res_broken["tools_executed"] is False, "Foreman сбросил вызовы: чат замолчал!"
    print("✅ 2. broken_provider_stream: воспроизведена поломка Co2-4 (вызовы есть, но отброшены Foreman)")

    # 3. Сценарий нормализации по ADR-034:
    chunks_fixed = normalize_stream_chunks_adr034(chunks_broken)
    res_fixed = simulate_foreman_stream_parser(chunks_fixed)
    assert len(res_fixed["tool_calls"]) > 0
    assert res_fixed["finish_reason"] == "tool_calls", "Нормализатор исправил finish_reason на 'tool_calls'"
    assert res_fixed["stop_reason"] == "tool_use", "Foreman получил tool_use"
    assert res_fixed["tools_executed"] is True, "Инструмент успешно передан на исполнение!"
    print("✅ 3. normalizer_adr034: нормализатор сайдкара восстановил цепочку вызова инструмента (V-04 спасён)")

    print("\nВсе проверки сценария поломки и нормализации пройдены успешно!")
    return 0


if __name__ == "__main__":
    sys.exit(run_tests())
