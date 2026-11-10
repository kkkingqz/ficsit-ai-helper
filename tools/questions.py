#!/usr/bin/env bash
#
# Helper launcher for tools/questions.py
""":"
exec python3 "$0" "$@"
"""
# FICSIT AI — Очередь вопросов между ролями (задача Co-14)
# Роль: Gf2
#
# Сканирует docs/team/questions/*.md, отслеживает блоки «ответ на <ID>»
# и фильтрует ложные совпадения шаблонов/отвеченных вопросов.

import argparse
import glob
import io
import os
import re
import sys
from pathlib import Path

ROLES = ["King", "Co", "Gs", "Gf", "Co2", "Gs2", "Co3", "Gf2"]


def parse_questions(repo_root: Path):
    questions_dir = repo_root / "docs" / "team" / "questions"
    if not questions_dir.is_dir():
        print(f"Каталог не найден: {questions_dir}", file=sys.stderr)
        return [], set()

    files = glob.glob(str(questions_dir / "*.md"))
    answered_ids = set()
    questions = []

    # 1. Первый проход: собираем все идентификаторы, на которые есть ответ
    for f in files:
        if os.path.basename(f) == "README.md":
            continue
        try:
            with io.open(f, "r", encoding="utf-8") as fp:
                content = fp.read()
        except OSError:
            continue

        for m in re.finditer(r"ответ на ([A-Za-z0-9]+-\d+)", content):
            answered_ids.add(m.group(1))

    # 2. Второй проход: собираем заголовки вопросов
    # Формат: ## ID → Адресат · Дата · Статус
    q_pattern = re.compile(
        r"^##\s+([A-Za-z0-9]+-\d+)\s+→\s+([^·\n]+)·\s*([^·\n]+)·\s*(открыт|закрыт)\s*$",
        re.MULTILINE,
    )

    for f in files:
        if os.path.basename(f) == "README.md":
            continue
        try:
            with io.open(f, "r", encoding="utf-8") as fp:
                lines = fp.readlines()
        except OSError:
            continue

        in_code_block = False
        for line_idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block:
                continue

            m = q_pattern.match(stripped)
            if m:
                q_id = m.group(1)
                recipients_raw = m.group(2).strip()
                date_str = m.group(3).strip()
                status = m.group(4).strip()
                recipients = [r.strip() for r in recipients_raw.split(",")]

                # Читаем текст первого абзаца вопроса для контекста
                desc = ""
                for next_line in lines[line_idx:]:
                    if next_line.strip().startswith("## ") or next_line.strip().startswith("```"):
                        break
                    if next_line.strip():
                        desc = next_line.strip()
                        break

                questions.append(
                    {
                        "id": q_id,
                        "file": os.path.relpath(f, repo_root),
                        "line": line_idx,
                        "recipients": recipients,
                        "date": date_str,
                        "status": status,
                        "has_answer": q_id in answered_ids,
                        "desc": desc,
                    }
                )

    return questions, answered_ids


def main():
    parser = argparse.ArgumentParser(
        description="FICSIT AI — Утилита проверки очереди вопросов docs/team/questions/"
    )
    parser.add_argument(
        "role",
        nargs="?",
        default=None,
        help="Роль для проверки (King, Co, Gs, Gf, Co2, Gs2, Co3, Gf2 или 'all')",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Показать все вопросы, включая закрытые и отвеченные",
    )
    parser.add_argument(
        "--answered",
        action="store_true",
        help="Показать отвеченные вопросы, ожидающие закрытия автором",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Показать сводную статистику по ролям",
    )

    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    questions, answered_ids = parse_questions(repo_root)

    if args.stats:
        print("=== Статистика очереди вопросов docs/team/questions/ ===")
        print(f"{'Роль':<8} | {'Ждут ответа':<12} | {'Отвечены (ждут закрытия)':<24} | {'Закрыты':<8}")
        print("-" * 60)
        for r in ROLES:
            waiting = sum(
                1
                for q in questions
                if (r in q["recipients"] or "все" in q["recipients"])
                and q["status"] == "открыт"
                and not q["has_answer"]
            )
            answ = sum(
                1
                for q in questions
                if q["id"].startswith(f"{r}-") and q["status"] == "открыт" and q["has_answer"]
            )
            closed = sum(1 for q in questions if q["id"].startswith(f"{r}-") and q["status"] == "закрыт")
            print(f"{r:<8} | {waiting:<12} | {answ:<24} | {closed:<8}")
        return 0

    target_role = args.role
    if target_role and target_role.lower() == "all":
        target_role = None

    print(f"=== FICSIT AI: Очередь вопросов docs/team/questions/ ===")
    if target_role:
        print(f"Фильтр: адресовано роли '{target_role}' (включая 'все')\n")
    else:
        print(f"Все роли\n")

    unanswered_count = 0
    waiting_close_count = 0

    for q in questions:
        is_target = True
        if target_role:
            is_target = (target_role in q["recipients"]) or ("все" in q["recipients"])

        if not is_target and not args.all:
            continue

        if q["status"] == "закрыт" and not args.all:
            continue

        if q["has_answer"]:
            waiting_close_count += 1
            if args.answered or args.all:
                print(
                    f"  [ОТВЕЧЕН] {q['id']} → {', '.join(q['recipients'])} ({q['file']}:{q['line']})"
                )
                if q["desc"]:
                    print(f"    Контекст: {q['desc']}")
        else:
            unanswered_count += 1
            print(
                f"  [ЖДЕТ ОТВЕТА] {q['id']} → {', '.join(q['recipients'])} ({q['file']}:{q['line']})"
            )
            if q["desc"]:
                print(f"    Вопрос: {q['desc']}")

    print("\n---------------------------------------------------------")
    print(f"Открытых вопросов без ответа: {unanswered_count}")
    print(f"Отвеченных вопросов, ожидающих закрытия автором: {waiting_close_count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
