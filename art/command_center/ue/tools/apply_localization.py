#!/usr/bin/env python3
"""Fill the Russian translations of the Command Center into a .po exported by the UE Localization Dashboard.

Source table: content_spec.json -> localization.entries (en / ru, plus namespace / key for C++ LOCTEXT strings).
Asset texts (descriptor, schematic) get random keys from the editor, so they are matched by source string (msgid);
LOCTEXT strings are matched by msgctxt "Namespace,Key" first. Existing non-empty translations are kept unless --force.

    python3 tools/apply_localization.py <Content/Localization/FicsitAIHelper/ru/FicsitAIHelper.po> [--force] [--check]

--check only reports (exit 1 if an entry of the table is missing from the .po or untranslated). Plain Python 3.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = json.load(open(os.path.join(HERE, "..", "content_spec.json"), encoding="utf-8"))


def unquote(s):
    return re.sub(r'\\(.)', lambda m: {"n": "\n", "t": "\t", "r": "\r"}.get(m.group(1), m.group(1)), s)


def quote(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")


def parse(lines):
    """Return entries: dict(start, end, ctx, id, str_lines=(i0, i1)) over the line list."""
    entries, cur, field = [], None, None
    for i, line in enumerate(lines + [""]):
        s = line.strip()
        if not s:
            if cur and "id" in cur:
                cur["end"] = i
                entries.append(cur)
            cur, field = None, None
            continue
        if cur is None:
            cur = {"start": i, "ctx": "", "id": "", "str": ""}
        m = re.match(r'(msgctxt|msgid|msgstr)\s+"(.*)"\s*$', s)
        if m:
            field = {"msgctxt": "ctx", "msgid": "id", "msgstr": "str"}[m.group(1)]
            cur[field] = unquote(m.group(2))
            if field == "str":
                cur["str_at"] = [i, i + 1]
        elif s.startswith('"') and field:
            cur[field] += unquote(s[1:-1])
            if field == "str":
                cur["str_at"][1] = i + 1
    return entries


def main(argv):
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    path, force, check = argv[0], "--force" in argv, "--check" in argv
    raw = open(path, encoding="utf-8-sig").read()
    lines = raw.split("\n")
    entries = parse(lines)
    table = SPEC["localization"]["entries"]
    edits, report, bad = {}, [], 0
    for t in table:
        ctx = f"{t['namespace']},{t['key']}" if t.get("namespace") else None
        hits = [e for e in entries if ctx and e["ctx"] == ctx] or [e for e in entries if e["id"] == t["en"]]
        if not hits:
            report.append(f"MISSING   {t['where']}: '{t['en']}' not in the .po (gather again?)")
            bad += 1
            continue
        for e in hits:
            if e["id"] != t["en"]:
                report.append(f"CHANGED   {t['where']}: source in .po is '{e['id']}', table has '{t['en']}' — check the RU text")
                bad += 1
            if e["str"] and not force:
                state = "OK" if e["str"] == t["ru"] else "KEPT"
                report.append(f"{state:9s} {t['where']} ({e['ctx'] or 'no ctx'})")
                continue
            edits[tuple(e["str_at"])] = f'msgstr "{quote(t["ru"])}"'
            report.append(f"{'TODO' if check else 'SET':9s} {t['where']} ({e['ctx'] or 'no ctx'})")
            bad += check
    for r in report:
        print(r)
    if check:
        return 1 if bad else 0
    for (i0, i1), new in sorted(edits.items(), reverse=True):
        lines[i0:i1] = [new]
    if edits:
        open(path, "w", encoding="utf-8").write("\n".join(lines))
    print(f"{len(edits)} translation(s) written to {path}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
