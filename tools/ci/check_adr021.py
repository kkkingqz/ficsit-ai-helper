#!/usr/bin/env python3
"""ADR-021 / AC-14 invariant check (docs/ARCHITECTURE.md §3.2.1).

Rule 1  game types (AFG* / UFG*, and the other FactoryGame prefixes IFG* / FFG* / EFG*) and FactoryGame headers
        (#include "FG....h", "Buildables/FG....h", ...) appear only in files under a GameFacade/ directory.
Rule 2  files under a core/ directory do not depend on Unreal: no CoreMinimal / UObject headers, no *.generated.h,
        no reflection macros, no Unreal container / string / object types.

Comments and string literals are ignored (so a comment that names AFG* is fine). Exit code 1 if anything is found,
so the script can fail a CI job. Plain Python 3, no dependencies.

    python3 tools/ci/check_adr021.py                 # scan every Source/ tree in the repository
    python3 tools/ci/check_adr021.py path/to/Source  # scan given files / directories
"""
import os
import re
import sys

EXTS = (".h", ".hpp", ".hh", ".cpp", ".cc", ".cxx", ".inl", ".ipp")
SKIP_DIRS = {".git", "Intermediate", "Binaries", "Saved", "DerivedDataCache", "ThirdParty", "node_modules"}

GAME_TYPE = re.compile(r"\b[AUIFE]FG[A-Z]\w*")
INCLUDE = re.compile(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', re.M)
UNREAL_HEADER = re.compile(r"(^|/)(CoreMinimal|CoreTypes|Engine|EngineMinimal|UObject/.*|GameFramework/.*|"
                           r"Components/.*|Kismet/.*|Containers/.*|Templates/.*|Math/.*|HAL/.*|Misc/.*)\.h$"
                           r"|\.generated\.h$")
UNREAL_TOKEN = re.compile(r"\b(UCLASS|USTRUCT|UENUM|UINTERFACE|UPROPERTY|UFUNCTION|GENERATED_BODY|GENERATED_UCLASS_BODY|"
                          r"FString|FName|FText|TArray|TMap|TSet|TSharedPtr|TSharedRef|TWeakObjectPtr|TObjectPtr|"
                          r"TSubclassOf|UObject|AActor|UWorld|FVector|FRotator|FTransform|int32|uint8|uint32|int64)\b")


def strip_code(src):
    """Blank out comments and string / char literals, keeping line structure."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r"[^\n]", " ", src[i:j]))
            i = j
        elif c == "R" and nxt == '"':                                   # raw string R"delim( ... )delim"
            m = re.match(r'R"([^(\s]{0,16})\(', src[i:])
            if m:
                end = src.find(")" + m.group(1) + '"', i)
                j = n if end < 0 else end + len(m.group(1)) + 2
                out.append(re.sub(r"[^\n]", " ", src[i:j]))
                i = j
            else:
                out.append(c)
                i += 1
        elif c in "\"'":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            out.append(c + " " * max(0, j - i - 2) + (c if j - i >= 2 else ""))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parts(path):
    return os.path.normpath(path).replace("\\", "/").split("/")


def check_file(path):
    errors = []
    src = open(path, encoding="utf-8", errors="replace").read()
    p = parts(path)
    in_facade = "GameFacade" in p
    in_core = "core" in p
    line_of = lambda pos: src.count("\n", 0, pos) + 1
    for m in INCLUDE.finditer(src):
        inc = m.group(1)
        base = inc.rsplit("/", 1)[-1]
        if not in_facade and re.match(r"FG[A-Z]\w*\.h$", base):
            errors.append((line_of(m.start()), f'FactoryGame header "{inc}" outside GameFacade/'))
        if in_core and UNREAL_HEADER.search(inc):
            errors.append((line_of(m.start()), f'Unreal header "{inc}" in core/'))
    code = INCLUDE.sub(lambda m: " " * len(m.group(0)), src)            # includes already handled
    code = strip_code(code)
    for lineno, line in enumerate(code.split("\n"), 1):
        if not in_facade:
            for m in GAME_TYPE.finditer(line):
                errors.append((lineno, f"game type {m.group(0)} outside GameFacade/"))
        if in_core:
            for m in UNREAL_TOKEN.finditer(line):
                errors.append((lineno, f"Unreal symbol {m.group(0)} in core/"))
    return errors


def iter_files(paths):
    for root in paths:
        if os.path.isfile(root):
            yield root
            continue
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            for f in sorted(files):
                if f.endswith(EXTS):
                    yield os.path.join(d, f)


def default_roots(repo):
    roots = []
    for d, dirs, _ in os.walk(repo):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for x in list(dirs):
            if x in ("Source", "core"):
                roots.append(os.path.join(d, x))
                dirs.remove(x)
    return roots


def main(argv):
    repo = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    roots = argv or default_roots(repo)
    files = list(iter_files(roots))
    total = 0
    for f in files:
        for lineno, msg in check_file(f):
            print(f"{os.path.relpath(f, repo)}:{lineno}: ADR-021: {msg}")
            total += 1
    facade = sum(1 for f in files if "GameFacade" in parts(f))
    print(f"ADR-021: {len(files)} file(s) checked ({facade} in GameFacade/), {total} violation(s)")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
