#!/usr/bin/env bash
#
# Helper launcher for tools/questions.py
""":"
exec python3 "$0" "$@"
"""
# FICSIT AI — Очередь вопросов и сообщений между ролями (задача Co-14)
# Роль: Gf2
#
# Сканирует docs/team/questions/*.md, парсит вопросы, уведомления (в т.ч. адресованные «все»),
# отслеживает отметки об ознакомлении и блоки «ответ на <ID>».

import argparse
import collections
import datetime
import glob
import io
import os
import re
import subprocess
import sys
from pathlib import Path

ROLES = ["King", "Co", "Gs", "Gf", "Co2", "Gs2", "Co3", "Gf2", "Cf3"]


def get_current_role(repo_root: Path, explicit_role: str = None) -> str:
    if explicit_role:
        for r in ROLES:
            if r.lower() == explicit_role.lower():
                return r

    # 1. Попытка определить по текущей ветке git (например, work/gf2 -> Gf2)
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
        branch = res.stdout.strip()
        if branch.startswith("work/"):
            b_role = branch[len("work/") :].strip()
            for r in ROLES:
                if r.lower() == b_role.lower():
                    return r
    except Exception:
        pass

    # 2. Попытка определить по git config user.name
    try:
        res = subprocess.run(
            ["git", "config", "user.name"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        uname = res.stdout.strip()
        for r in ROLES:
            if r.lower() == uname.lower():
                return r
    except Exception:
        pass

    return None


def parse_questions(repo_root: Path):
    questions_dir = repo_root / "docs" / "team" / "questions"
    if not questions_dir.is_dir():
        print(f"Каталог не найден: {questions_dir}", file=sys.stderr)
        return [], set(), collections.defaultdict(set)

    files = glob.glob(str(questions_dir / "*.md"))
    answered_ids = set()
    answered_by = collections.defaultdict(set)
    acknowledgments = collections.defaultdict(set)
    questions = []

    # 1. Первый проход: собираем ответы («ответ на <ID>») и отметки об ознакомлении из файлов ролей
    for f in files:
        basename = os.path.basename(f)
        if basename == "README.md":
            continue
        stem = os.path.splitext(basename)[0]
        file_role = next((r for r in ROLES if r.lower() == stem.lower()), None)

        try:
            with io.open(f, "r", encoding="utf-8") as fp:
                lines = fp.readlines()
        except OSError:
            continue

        in_code_block = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block:
                continue

            # Поиск блоков ответов («ответ на <ID>»)
            for m in re.finditer(r"ответ на ([A-Za-z0-9]+-\d+)", stripped):
                ans_id = m.group(1)
                answered_ids.add(ans_id)
                if file_role:
                    answered_by[ans_id].add(file_role)

            # Поиск отметок об ознакомлении в файле конкретной роли
            if file_role:
                kw_m = re.search(
                    r"(?:ознакомлен[а-я]*|ознакомил[а-я]*|ответ на|прочитан[оа]?|принят[оа]?|ack)\s+(?:с\s+|на\s+)?",
                    stripped,
                    re.IGNORECASE,
                )
                if kw_m:
                    after = stripped[kw_m.start() :]
                    for tid in re.findall(r"\b([A-Za-z0-9]+-\d+)\b", after):
                        acknowledgments[tid].add(file_role)

                # Чек-лист в файле роли: «- [x] Co-40»
                chk_m = re.match(r"^-\s+\[[xX]\]\s+.*?\b([A-Za-z0-9]+-\d+)\b", stripped)
                if chk_m:
                    acknowledgments[chk_m.group(1)].add(file_role)

    # 2. Второй проход: собираем заголовки вопросов и уведомлений, а также отметки внутри блоков
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
        current_q = None

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
                author = q_id.split("-")[0]
                recipients_raw = m.group(2).strip()
                rest = m.group(3).strip()
                recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

                date_m = re.search(r"\b\d{2}\.\d{2}\.\d{4}\b", rest)
                date_str = date_m.group(0) if date_m else ""

                parts = [p.strip() for p in rest.split("·")]
                parts_lower = [p.lower() for p in parts]

                is_notification = any("уведомление" in p for p in parts_lower)
                is_closed = any("закрыт" in p for p in parts_lower)
                is_open = any("открыт" in p for p in parts_lower)
                is_ack_or_reply = (not is_notification and not is_closed and not is_open) and any(
                    p.startswith(("ответ на", "ознакомлен", "ознакомил", "прочитан", "ack"))
                    for p in parts_lower
                )

                if is_ack_or_reply:
                    current_q = None
                    continue
                elif is_notification:
                    kind = "notification"
                    status = "уведомление"
                elif is_closed:
                    kind = "question"
                    status = "закрыт"
                elif is_open:
                    kind = "question"
                    status = "открыт"
                else:
                    kind = "unknown"
                    status = rest

                desc = ""
                for next_line in lines[line_idx:]:
                    ns = next_line.strip()
                    if ns.startswith("## ") or ns.startswith("```"):
                        break
                    if ns:
                        desc = ns
                        break

                # Автор автоматически считается ознакомленным со своим уведомлением/вопросом
                if author in ROLES:
                    acknowledgments[q_id].add(author)

                if "все" in recipients:
                    expected_roles = [r for r in ROLES if r != author]
                else:
                    expected_roles = [r for r in recipients if r in ROLES and r != author]

                current_q = {
                    "id": q_id,
                    "author": author,
                    "file": os.path.relpath(f, repo_root),
                    "line": line_idx,
                    "recipients": recipients,
                    "expected_roles": expected_roles,
                    "date": date_str,
                    "kind": kind,
                    "status": status,
                    "has_answer": q_id in answered_ids,
                    "desc": desc,
                }
                questions.append(current_q)
            elif current_q:
                # Чек-листы прямо в теле уведомления: «- [x] Gf2»
                chk_role_m = re.match(r"^-\s+\[[xX]\]\s+([A-Za-z0-9]+)", stripped)
                if chk_role_m:
                    role_cand = chk_role_m.group(1)
                    if role_cand in ROLES:
                        acknowledgments[current_q["id"]].add(role_cand)

                # Списки в теле уведомления: «Ознакомлены: King, Gf2»
                ack_inline_m = re.search(
                    r"(?:ознакомлен[а-я]*|прочитали|приняли)[:\s]+([^.\n]+)",
                    stripped,
                    re.IGNORECASE,
                )
                if ack_inline_m:
                    for word in re.findall(r"[A-Za-z0-9]+", ack_inline_m.group(1)):
                        if word in ROLES:
                            acknowledgments[current_q["id"]].add(word)

    # 3. Финальный проход по questions: вычисляем acked_roles / unacked_roles и answered_by / unanswered_roles
    for q in questions:
        q_id = q["id"]
        acked = acknowledgments.get(q_id, set())
        ans_roles = answered_by.get(q_id, set())
        q["acked_roles"] = sorted(list(acked))
        q["answered_by"] = sorted(list(ans_roles))
        if q["status"] == "закрыт":
            q["unacked_roles"] = []
            q["is_fully_acked"] = True
            q["unanswered_roles"] = []
            q["is_fully_answered"] = True
        else:
            q["unacked_roles"] = [r for r in q["expected_roles"] if r not in acked]
            q["is_fully_acked"] = len(q["unacked_roles"]) == 0
            q["unanswered_roles"] = [r for r in q["expected_roles"] if r not in ans_roles]
            q["is_fully_answered"] = (
                len(q["unanswered_roles"]) == 0
                if q["expected_roles"]
                else (q_id in answered_ids)
            )

    return questions, answered_ids, acknowledgments


def handle_ack(repo_root: Path, target_role: str, ack_ids: list):
    role = get_current_role(repo_root, target_role)
    if not role:
        print(
            "ОШИБКА: Не удалось определить текущую роль. Укажите роль явно:\n"
            "  ./tools/questions.py <Роль> --ack <ID>",
            file=sys.stderr,
        )
        return 1

    questions, answered_ids, acknowledgments = parse_questions(repo_root)
    valid_ids = {q["id"]: q for q in questions}

    unknown_ids = [tid for tid in ack_ids if tid not in valid_ids]
    if unknown_ids:
        print(
            f"Предупреждение: ID не найдены в docs/team/questions/: {', '.join(unknown_ids)}",
            file=sys.stderr,
        )

    already_acked = [tid for tid in ack_ids if role in acknowledgments.get(tid, set())]
    needed_ids = [tid for tid in ack_ids if role not in acknowledgments.get(tid, set())]

    if not needed_ids:
        print(f"Роль '{role}' уже отметила ознакомление с: {', '.join(ack_ids)}")
        return 0

    role_file = repo_root / "docs" / "team" / "questions" / f"{role}.md"
    if not role_file.is_file():
        print(f"ОШИБКА: Файл вопросов роли не найден: {role_file}", file=sys.stderr)
        return 1

    try:
        with io.open(role_file, "r", encoding="utf-8") as fp:
            content = fp.read()
    except OSError as e:
        print(f"ОШИБКА чтения файла {role_file}: {e}", file=sys.stderr)
        return 1

    numbers = [
        int(m.group(1))
        for m in re.finditer(rf"^##\s+{re.escape(role)}-(\d+)\b", content, re.MULTILINE)
    ]
    next_num = max(numbers) + 1 if numbers else 1

    authors = sorted(list({valid_ids[tid]["author"] for tid in needed_ids if tid in valid_ids}))
    target_to = ", ".join(authors) if authors else "все"

    today_str = datetime.date.today().strftime("%d.%m.%Y")
    ids_str = ", ".join(needed_ids)

    block = f"\n\n## {role}-{next_num} → {target_to} · ознакомлен с {ids_str} · {today_str}\n\n"
    if len(needed_ids) == 1:
        block += f"Ознакомлен с уведомлением {ids_str}.\n"
    else:
        block += f"Ознакомлен с уведомлениями {ids_str}.\n"

    try:
        with io.open(role_file, "a", encoding="utf-8") as fp:
            fp.write(block)
    except OSError as e:
        print(f"ОШИБКА записи в файл {role_file}: {e}", file=sys.stderr)
        return 1

    print(f"[OK] Отметка об ознакомлении добавлена в {os.path.relpath(role_file, repo_root)}:")
    print(f"     ## {role}-{next_num} → {target_to} · ознакомлен с {ids_str} · {today_str}")
    if already_acked:
        print(f"     (ранее уже были отмечены: {', '.join(already_acked)})")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="FICSIT AI — Утилита проверки очереди вопросов docs/team/questions/"
    )
    parser.add_argument(
        "role_or_cmd",
        nargs="?",
        default=None,
        help="Роль для проверки (King, Co, Gs, Gf, Co2, Gs2, Co3, Gf2, Cf3, 'all') или команда 'ack'",
    )
    parser.add_argument(
        "extra_args",
        nargs="*",
        help="Дополнительные аргументы (например, ID вопросов для команды ack)",
    )
    parser.add_argument(
        "--ack",
        nargs="+",
        metavar="ID",
        help="Отметить уведомление(я) как прочитанное (ознакомлен)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Показать все вопросы и уведомления, включая закрытые и уже прочитанные",
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

    # Проверка команды ack
    if args.ack:
        target_role = (
            args.role_or_cmd
            if args.role_or_cmd and args.role_or_cmd.lower() != "ack"
            else None
        )
        return handle_ack(repo_root, target_role, args.ack)

    if args.role_or_cmd and args.role_or_cmd.lower() == "ack":
        if not args.extra_args:
            print(
                "ОШИБКА: Укажите ID уведомлений для команды ack. Пример: ./tools/questions.py ack Co-45",
                file=sys.stderr,
            )
            return 1
        return handle_ack(repo_root, None, args.extra_args)

    if args.extra_args and args.extra_args[0].lower() == "ack":
        ack_ids = args.extra_args[1:]
        if not ack_ids:
            print(
                f"ОШИБКА: Укажите ID уведомлений для команды ack. Пример: ./tools/questions.py {args.role_or_cmd} ack Co-45",
                file=sys.stderr,
            )
            return 1
        return handle_ack(repo_root, args.role_or_cmd, ack_ids)

    questions, answered_ids, acknowledgments = parse_questions(repo_root)

    if args.stats:
        print("=== Статистика очереди вопросов и уведомлений docs/team/questions/ ===")
        print(
            f"{'Роль':<8} | {'Уведомления':<12} | {'Ждут ответа':<12} | {'Отвечены (ждут закрытия)':<24} | {'Закрыты':<8}"
        )
        print("-" * 74)
        for r in ROLES:
            notifs = sum(
                1
                for q in questions
                if q["kind"] == "notification" and r in q["unacked_roles"]
            )
            waiting = sum(
                1
                for q in questions
                if q["kind"] == "question"
                and q["status"] == "открыт"
                and r in q["unanswered_roles"]
            )
            answ = sum(
                1
                for q in questions
                if q["kind"] == "question"
                and q["id"].startswith(f"{r}-")
                and q["status"] == "открыт"
                and q["is_fully_answered"]
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

    target_role = args.role_or_cmd
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

        if target_role:
            is_expected = target_role in q["expected_roles"]
            if not is_expected and not args.all:
                continue
            is_acked = target_role in q["acked_roles"]
        else:
            is_acked = q["is_fully_acked"]

        # Если уже ознакомлен — скрываем по умолчанию
        if is_acked and not args.all:
            continue

        notifications_count += 1
        recips = ", ".join(q["recipients"])
        dt = f" · {q['date']}" if q["date"] else ""
        status_tag = "[ОЗНАКОМЛЕН]" if is_acked else "[УВЕДОМЛЕНИЕ]"
        print(f"  {status_tag} {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")

        if not target_role and q["unacked_roles"]:
            print(f"    Не ознакомились: {', '.join(q['unacked_roles'])}")
        elif target_role and not is_acked:
            print(f"    (требуется отметка об ознакомлении: ./tools/questions.py ack {q['id']})")
        if q["desc"]:
            print(f"    Контекст: {q['desc']}")

    # 2. Вопросы (открытые, отвеченные, закрытые)
    for q in questions:
        if q["kind"] != "question":
            continue

        is_recipient = (
            (target_role in q["recipients"]) or ("все" in q["recipients"])
            if target_role
            else True
        )
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
        is_answered_here = (
            (target_role in q["answered_by"])
            if (target_role and target_role in q["expected_roles"])
            else q["is_fully_answered"]
        )

        if is_answered_here:
            # Отвечен (для роли или всеми адресатами)
            if is_author and q["is_fully_answered"]:
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
                print(
                    f"  [ОТВЕЧЕН (чужой)] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})"
                )
                if q["desc"]:
                    print(f"    Контекст: {q['desc']}")
        else:
            # Ждет ответа от адресата
            if is_recipient or args.all:
                unanswered_count += 1
                recips = ", ".join(q["recipients"])
                dt = f" · {q['date']}" if q["date"] else ""
                print(f"  [ЖДЕТ ОТВЕТА] {q['id']} → {recips}{dt} ({q['file']}:{q['line']})")
                if not target_role and q["answered_by"] and q["unanswered_roles"]:
                    print(
                        f"    Уже ответили: {', '.join(q['answered_by'])} · Ждут ответа: {', '.join(q['unanswered_roles'])}"
                    )
                if q["desc"]:
                    print(f"    Вопрос: {q['desc']}")

    print("\n---------------------------------------------------------")
    if target_role:
        print(f"Уведомлений, ожидающих вашей отметки: {notifications_count}")
    else:
        print(f"Уведомлений с ожиданием ознакомления: {notifications_count}")
    print(f"Открытых вопросов без ответа: {unanswered_count}")
    print(f"Отвеченных вопросов, ожидающих закрытия автором: {waiting_close_count}")
    if args.all:
        print(f"Закрытых вопросов: {closed_count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
