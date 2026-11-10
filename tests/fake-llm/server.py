#!/usr/bin/env python3
# FICSIT AI — Fake-LLM сервер для детерминированных тестов AI-контура (MODULES E7, V-12)
# Роль: Gf2
#
# Эмулирует OpenAI-совместимый эндпоинт (/v1/chat/completions).
# Поддерживает стриминг SSE и сценарии:
# - normal_text
# - normal_tool_call
# - broken_provider_stream (Co2-4 / Co-23 / ADR-034: Gemini stream finish_reason="stop" with tool_calls)

import argparse
import http.server
import json
import socketserver
import sys
from urllib.parse import urlparse, parse_qs

from scenarios import get_chunks_for_scenario, format_sse_stream


class FakeLLMRequestHandler(http.server.BaseHTTPRequestHandler):
    scenario_override = "broken_provider_stream"

    def do_POST(self):
        parsed_url = urlparse(self.path)
        if parsed_url.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        # Определяем сценарий
        query_params = parse_qs(parsed_url.query)
        scenario = self.headers.get("X-Mock-Scenario")
        if not scenario and "scenario" in query_params:
            scenario = query_params["scenario"][0]
        if not scenario:
            scenario = self.scenario_override

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            req_json = json.loads(post_data.decode("utf-8"))
        except Exception:
            req_json = {}

        is_stream = req_json.get("stream", True)
        model = req_json.get("model", "fake-model")

        try:
            chunks = get_chunks_for_scenario(scenario, model=model)
        except ValueError as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        if is_stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            sse_body = format_sse_stream(chunks)
            self.wfile.write(sse_body.encode("utf-8"))
            self.wfile.flush()
        else:
            # Непотоковый ответ (для проверки, что без стриминга tool_calls отдаются нормально)
            final_finish_reason = "tool_calls" if "tool" in scenario else "stop"
            tool_calls = []
            if "tool" in scenario:
                tool_calls = [{
                    "id": "call_nonstream_123",
                    "type": "function",
                    "function": {"name": "total_raw_inputs", "arguments": "{\"item\":\"Desc_OreIron_C\"}"}
                }]
            resp = {
                "id": "chatcmpl-fake-nostream",
                "object": "chat.completion",
                "created": 1762776000,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None if tool_calls else "OK",
                        "tool_calls": tool_calls or None
                    },
                    "finish_reason": final_finish_reason
                }]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode("utf-8"))

    def log_message(self, format, *args):
        # Отключаем дефолтный вывод логов запросов в stdout, чтобы не засорять тесты
        pass


def run_server(port: int, default_scenario: str):
    FakeLLMRequestHandler.scenario_override = default_scenario
    with socketserver.TCPServer(("127.0.0.1", port), FakeLLMRequestHandler) as httpd:
        print(f"Fake-LLM сервер слушает на http://127.0.0.1:{port} (сценарий по умолчанию: {default_scenario})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nОстановка Fake-LLM сервера.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FICSIT AI — Fake-LLM Mock Server (E7, ADR-034)")
    parser.add_argument("--port", type=int, default=8089, help="Порт для сервера (по умолчанию: 8089)")
    parser.add_argument("--scenario", default="broken_provider_stream",
                        choices=["normal_text", "normal_tool_call", "broken_provider_stream"],
                        help="Сценарий по умолчанию")
    args = parser.parse_args()
    run_server(args.port, args.scenario)
