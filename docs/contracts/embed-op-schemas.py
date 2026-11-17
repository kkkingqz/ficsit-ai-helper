#!/usr/bin/env python3
"""Встроить схемы аргументов операций OperationRegistry в мод (V-3).

Источник — docs/contracts/schemas/*-request.schema.json (их пишет Co2). Мод в игре не видит docs/, поэтому реестр
держит копии строками C++ в mod/FicsitAI/Source/FicsitAIApi/Private/Ops/FicsitAIOpSchemas.inl. Копия генерируется
этим скриптом и руками не правится.

    python3 docs/contracts/embed-op-schemas.py           # записать копию
    python3 docs/contracts/embed-op-schemas.py --check   # код 1, если копия разошлась с источником (для CI)
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "docs/contracts/schemas"
OUT = ROOT / "mod/FicsitAI/Source/FicsitAIApi/Private/Ops/FicsitAIOpSchemas.inl"

# Имя константы в C++ → файл схемы. Новая операция реестра добавляется сюда же.
OPERATIONS = {
    "ListMetricsRequest": "list-metrics-request.schema.json",
    "QueryMetricRequest": "query-metric-request.schema.json",
}

DELIM = "ficsitai_schema"


def render() -> str:
    lines = [
        "// Сгенерировано docs/contracts/embed-op-schemas.py из docs/contracts/schemas/. Руками не править:",
        "// CI сверяет этот файл с источником (embed-op-schemas.py --check).",
        "",
    ]
    for name, file in OPERATIONS.items():
        text = (SCHEMAS / file).read_text(encoding="utf-8")
        json.loads(text)  # битый JSON — ошибка здесь, а не в игре
        body = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        if f"){DELIM}\"" in body:
            sys.exit(f"{file}: в схеме встречается разделитель сырой строки")
        lines.append(f"// {file}")
        lines.append(f"inline const TCHAR* {name} = TEXT(R\"{DELIM}({body}){DELIM}\");")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    content = render()
    if "--check" in sys.argv[1:]:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != content:
            print(f"{OUT.relative_to(ROOT)} разошёлся со схемами: запусти docs/contracts/embed-op-schemas.py")
            return 1
        print("схемы операций в моде совпадают с docs/contracts/schemas")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(content, encoding="utf-8")
    print(f"записано: {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
