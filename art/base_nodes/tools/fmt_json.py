#!/usr/bin/env python3
"""Re-format a JSON spec (nodes.json): anything that fits in 118 columns stays on one line. Usage: fmt_json.py FILE"""
import json
import sys

WIDTH = 118


def dump(o, ind=0):
    flat = json.dumps(o, ensure_ascii=False)
    if len(flat) + ind <= WIDTH or not isinstance(o, (dict, list)) or not o:
        return flat
    pad, inner = " " * ind, " " * (ind + 2)
    if isinstance(o, dict):
        items = [f"{inner}{json.dumps(k, ensure_ascii=False)}: {dump(v, ind + 2).lstrip()}" for k, v in o.items()]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    items = [inner + dump(v, ind + 2) for v in o]
    return "[\n" + ",\n".join(items) + "\n" + pad + "]"


if __name__ == "__main__":
    p = sys.argv[1]
    d = json.load(open(p, encoding="utf-8"))
    open(p, "w", encoding="utf-8").write(dump(d) + "\n")
