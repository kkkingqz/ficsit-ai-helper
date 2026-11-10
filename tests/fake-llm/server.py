#!/usr/bin/env python3
# FICSIT AI — Fake-LLM сервер для детерминированных тестов AI-контура (MODULES E7, V-12, Co-23, Co-27)
# Роль: Gf2
#
# Эмулирует OpenAI-совместимый эндпоинт (/v1/chat/completions).
# Поддерживает стриминг SSE и сценарии:
# - normal_text
# - normal_tool_call
# - broken_provider_stream (Co2-4 / Co-23 / Co-27 / ADR-034: Gemini stream finish_reason="stop" + thought_signature)

import argparse
import http.server
import json
import socketserver
import sys
from urllib.parse import urlparse, parse_qs

from scenarios import (
    get_chunks_for_scenario,
    format_sse_stream,
    MissingThoughtSignatureError
)


class FakeLLMRequestHandler(http.server.BaseHTTPRequestHandler):
    scenario_override = "broken_provider_stream"

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        if parsed_url.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        if parsed_url.path == "/v1/chat/completions":
            self.handle_completions(parsed_url, is_stream=True, model="fake-model", messages=[])
            return
        self.send_response(404)
        self.end_headers()
        self.wfile.write(b"Not Found")

    def do_POST(self):
        parsed_url = urlparse(self.path)
        if parsed_url.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            req_json = json.loads(post_data.decode("utf-8"))
        except Exception:
            req_json = {}

        is_stream = req_json.get("stream", True)
        model = req_json.get("model", "fake-model")
        messages = req_json.get("messages", [])
        self.handle_completions(parsed_url, is_stream=is_stream, model=model, messages=messages)

    def handle_completions(self, parsed_url, is_stream: bool, model: str, messages: list):
        # Определение сценария: приоритет за заголовком X-Mock-Scenario, затем query-параметр ?scenario=
        query_params = parse_qs(parsed_url.query)
        scenario = self.headers.get("X-Mock-Scenario")
        if not scenario and "scenario" in query_params:
            scenario = query_params["scenario"][0]
        if not scenario:
            scenario = self.scenario_override

        try:
            chunks = get_chunks_for_scenario(scenario, model=model, messages=messages)
        except MissingThoughtSignatureError as e:
            # Воспроизведение ошибки Gemini 3.x во втором ходе без thought_signature (Co-27, Co2-6)
            err_body = json.dumps({
                "error": {
                    "code": 400,
                    "message": str(e),
                    "status": "INVALID_ARGUMENT"
                }
            }).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(err_body)
            self.wfile.flush()
            self.close_connection = True
            return
        except ValueError as e:
            err_body = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(err_body)
            self.wfile.flush()
            self.close_connection = True
            return

        if is_stream:
            sse_text = format_sse_stream(chunks)
            sse_bytes = sse_text.encode("utf-8")

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(sse_bytes)))
            self.send_header("Connection", "close")
            self.end_headers()

            self.wfile.write(sse_bytes)
            self.wfile.flush()
            self.close_connection = True
        else:
            final_finish_reason = "tool_calls" if "tool" in scenario else "stop"
            tool_calls = []
            if "tool" in scenario:
                tool_calls = [{
                    "id": "call_nonstream_123",
                    "type": "function",
                    "function": {"name": "total_raw_inputs", "arguments": '{"item":"Desc_OreIron_C"}'}
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
            resp_bytes = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp_bytes)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp_bytes)
            self.wfile.flush()
            self.close_connection = True

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
