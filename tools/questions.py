#!/usr/bin/env bash
#
# Helper launcher for tools/questions.py
""":"
exec python3 "$0" "$@"
"""
# FICSIT AI — Очередь вопросов и сообщений между ролями (задача Co-14)
# Роль: Gf2
#
# Сканирует docs/team/questions/*.md, парсит вопросы, уведомления (в т.ч. адресованные «все»)
# и ответы («ответ на <ID>»), исключая ложные совпадения из блоков кода и шаблонов.

import argparse
import glob
import io
import os
import re
import sys
from pathlib import Path

ROLES = ["King", "Co", "Gs", "Gf", "Co2", "Gs2", "Co3", "Gf2", "Cf3"]


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

    # 2. Второй проход: собираем заголовки вопросов и уведомлений
    # Формат: ## ID → Адресат · [ответ на ...] · [Дата] · [Статус/уведомление]
    header_re = re.compile(r"^##\s+([A-Za-z0-9]+-\d+)\s+→\s+([^·\n]+)·\s*(.+)$")

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

            m = header_re.match(stripped)
            if m:
                q_id = m.group(1)
                recipients_raw = m.group(2).strip()
                rest = m.group(3).strip()
                recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

                date_m = re.search(r"\b\d{2}\.\d{2}\.\d{4}\b", rest)
                date_str = date_m.group(0) if date_m else ""

                if "ответ на" in rest:
                    continue  # Блок ответа на вопрос, не отдельный тикет
                elif "уведомление" in rest:
                    kind = "notification"
                    status = "уведомление"
                elif "закрыт" in rest:
                    kind = "question"
                    status = "закрыт"
                elif "открыт" in rest:
                    kind = "question"
                    status = "открыт"
                else:
                    kind = "unknown"
                    status = rest

                # Читаем текст первого абзаца для контекста
                desc = ""
                for next_line in lines[line_idx:]:
                    ns = next_line.strip()
                    if ns.startswith("## ") or ns.startswith("```"):
                        break
                    if ns:
                        desc = ns
                        break

                questions.append(
                    {
                        "id": q_id,
                        "file": os.path.relpath(f, repo_root),
                        "line": line_idx,
                        "recipients": recipients,
                        "date": date_str,
                        "kind": kind,
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
        print("=== Статистика очереди вопросов и уведомлений docs/team/questions/ ===")
        print(f"{'Роль':<8} | {'Уведомления':<12} | {'Ждут ответа':<12} | {'Отвечены (ждут закрытия)':<24} | {'Закрыты':<8}")
        print("-" * 74)
        for r in ROLES:
            notifs = sum(
                1
                for q in questions
                if q["kind"] == "notification"
                and (r in q["recipients"] or "все" in q["recipients"])
            )
            waiting = sum(
                1
                for q in questions
                if q["kind"] == "question"
                and (r in q["recipients"] or "все" in q["recipients"])
                and q["status"] == "открыт"
                and not q["has_answer"]
            )
            answ = sum(
                1
                for q in questions
                if q["kind"] == "question"
                and q["id"].startswith(f"{r}-")
                and q["status"] == "открыт"
                and q["has_answer"]
            )
            closed = sum(
                1
                for q in questions
                if q["kind"] == "question"
                and q["id"].startswith(f"{r}-")
                and q["status"] == "закрыт"
            )
            print(f"{r:<8} | {notifs:<12} | {waiting:<12} | {answ:<24} | {closed:<8}")
        return 0

    target_role = args.role
    if target_role and target_role.lower() == "all":
        target_role = None

    print("=== FICSIT AI: Очередь вопросов и сообщений docs/team/questions/ ===")
    if target_role:
        print(f"Фильтр: адресовано роли '{target_role}' (включая 'все')\n")
    else:
        print("Все роли\n")

    notifications_count = 0
    unanswered_count = 0
    waiting_close_count = 0
    closed_count = 0

    # 1. Уведомления и общекомандные сообщения
    for q in questions:
        if q["kind"] != "notification":
            continue
        is_target = True
        if target_role:
            is_target = (target_role in q["recipients"]) or ("все" in q["recipients"])
        if not is_target and not args.all:
            continue

        notifications_count += 1
        recips = ", ".join(q["recipients"])
        dt = f" · {q['date']}" if q["date"] else ""
        print(f"  [УВЕДОМЛЕНИЕ] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")
        if q["desc"]:
            print(f"    Контекст: {q['desc']}")

    # 2. Вопросы (открытые, отвеченные, закрытые)
    for q in questions:
        if q["kind"] != "question":
            continue

        is_recipient = (target_role in q["recipients"]) or ("все" in q["recipients"]) if target_role else True
        is_author = q["id"].startswith(f"{target_role}-") if target_role else True

        if q["status"] == "закрыт":
            if args.all and (is_recipient or is_author):
                closed_count += 1
                recips = ", ".join(q["recipients"])
                dt = f" · {q['date']}" if q["date"] else ""
                print(f"  [ЗАКРЫТ] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")
                if q["desc"]:
                    print(f"    Контекст: {q['desc']}")
            continue

        # Открытые вопросы:
        if q["has_answer"]:
            # Отвечен, ожидает закрытия автором
            if is_author:
                waiting_close_count += 1
                if args.answered or args.all:
                    recips = ", ".join(q["recipients"])
                    dt = f" · {q['date']}" if q["date"] else ""
                    print(f"  [ОТВЕЧЕН] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")
                    if q["desc"]:
                        print(f"    Контекст: {q['desc']}")
            elif (args.answered or args.all) and is_recipient:
                recips = ", ".join(q["recipients"])
                dt = f" · {q['date']}" if q["date"] else ""
                print(f"  [ОТВЕЧЕН (чужой)] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")
                if q["desc"]:
                    print(f"    Контекст: {q['desc']}")
        else:
            # Ждет ответа от адресата
            if is_recipient or args.all:
                unanswered_count += 1
                recips = ", ".join(q["recipients"])
                dt = f" · {q['date']}" if q["date"] else ""
                print(f"  [ЖДЕТ ОТВЕТА] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")
                if q["desc"]:
                    print(f"    Вопрос: {q['desc']}")

    print("\n---------------------------------------------------------")
    print(f"Уведомлений для ознакомления: {notifications_count}")
    print(f"Открытых вопросов без ответа: {unanswered_count}")
    print(f"Отвеченных вопросов, ожидающих закрытия автором: {waiting_close_count}")
    if args.all:
        print(f"Закрытых вопросов: {closed_count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
