#!/usr/bin/env python3
# FICSIT AI — Разбор результатов автоматических проверок в игре (P-8, #39)
# Роль: Gf2
#
# Скрипт принимает каталог результатов запуска (или конкретный .jsonl файл),
# проверяет записи результатов проверок от мода (ARCHITECTURE §6.9, Co-16)
# и формирует сводный отчёт в формате Markdown для King.

import argparse
import datetime
import json
import os
import sys
from pathlib import Path


def parse_recording_jsonl(jsonl_path: Path):
    """
    Разбирает файл JSONL из каталога Recording.
    Отбирает записи типа test_event, telemetry_sample и benchmark_sample.
    """
    tests = []
    benchmarks = []
    telemetry_samples = []
    errors = []

    if not jsonl_path.is_file():
        return tests, benchmarks, telemetry_samples, [f"Файл не найден: {jsonl_path}"]

    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as err:
                    errors.append(f"Строка {line_no}: ошибка JSON: {err}")
                    continue

                rec_type = record.get("type")
                if rec_type == "test_event":
                    tests.append(record)
                elif rec_type in ("benchmark", "scoped_timer"):
                    benchmarks.append(record)
                elif rec_type == "telemetry_snapshot":
                    telemetry_samples.append(record)
    except OSError as err:
        errors.append(f"Ошибка чтения {jsonl_path}: {err}")

    return tests, benchmarks, telemetry_samples, errors


def generate_markdown_report(run_dir: Path, jsonl_file: Path, save_name: str, scenario: str,
                             tests: list, benchmarks: list, screenshots: list, errors: list) -> str:
    now_str = datetime.datetime.now(datetime.timezone.utc).strftime("%d.%m.%Y %H:%M:%S UTC")

    passed_count = sum(1 for t in tests if str(t.get("status", "")).upper() == "PASS")
    failed_count = sum(1 for t in tests if str(t.get("status", "")).upper() == "FAIL")
    skipped_count = sum(1 for t in tests if str(t.get("status", "")).upper() == "SKIP")
    total_count = len(tests)

    verdict = "PASSED" if (failed_count == 0 and total_count > 0) else "FAILED"
    if total_count == 0:
        verdict = "NO_TESTS_RUN"

    verdict_badge = "🟢 УСПЕШНО" if verdict == "PASSED" else ("🔴 ПРОВАЛЕНО" if verdict == "FAILED" else "🟡 НЕТ ДАННЫХ")

    lines = [
        f"# Отчёт об автопрогоне в игре под Proton (P-8, #39)",
        f"",
        f"- **Дата:** {now_str}",
        f"- **Сохранение:** `{save_name}`",
        f"- **Сценарий:** `{scenario}`",
        f"- **Каталог запуска:** `{run_dir}`",
        f"- **Вердикт:** {verdict_badge} (Всего: {total_count}, Успешно: {passed_count}, Ошибок: {failed_count}, Пропущено: {skipped_count})",
        f"",
        f"---",
        f"",
        f"## 1. Результаты проверок сценария",
        f"",
    ]

    if not tests:
        lines.append("> [!WARNING]")
        lines.append("> Записи проверок `type=test_event` не обнаружены в файле записи.")
        lines.append("")
    else:
        lines.append("| Сценарий | Проверка | Результат | Время (мс) | Сообщение / Значения | Скриншот |")
        lines.append("|---|---|---|---|---|---|")
        for t in tests:
            scen = t.get("scenario", scenario)
            name = t.get("test", t.get("name", "unknown"))
            status = str(t.get("status", "UNKNOWN")).upper()
            st_badge = "✅ PASS" if status == "PASS" else ("❌ FAIL" if status == "FAIL" else f"⚠️ {status}")
            duration = t.get("duration_ms", t.get("duration", "-"))
            if isinstance(duration, (int, float)):
                duration = f"{duration:.2f}"
            msg = t.get("message", t.get("details", ""))
            scr = t.get("screenshot", "")
            scr_link = f"[{scr}]({scr})" if scr else "—"
            lines.append(f"| `{scen}` | `{name}` | {st_badge} | {duration} | {msg} | {scr_link} |")
        lines.append("")

    lines.append("## 2. Замеры производительности (Scoped Timers)")
    lines.append("")
    if not benchmarks:
        lines.append("Замеры производительности не зарегистрированы в данном прогоне.")
        lines.append("")
    else:
        lines.append("| Участок кода | Вызовов | Среднее (мс) | Максимум (мс) | Бюджет (мс) | Статус |")
        lines.append("|---|---|---|---|---|---|")
        for b in benchmarks:
            scope = b.get("scope", b.get("name", "unknown"))
            calls = b.get("calls", 1)
            avg_ms = b.get("avg_ms", b.get("duration_ms", 0.0))
            max_ms = b.get("max_ms", avg_ms)
            budget_ms = b.get("budget_ms", 2.0)
            status_bm = "🟢 В норме" if max_ms <= budget_ms else "🔴 Превышение"
            lines.append(f"| `{scope}` | {calls} | {avg_ms:.3f} | {max_ms:.3f} | {budget_ms:.1f} | {status_bm} |")
        lines.append("")

    lines.append("## 3. Скриншоты прогона")
    lines.append("")
    if not screenshots:
        lines.append("Скриншоты отсутствуют в каталоге артефактов.")
        lines.append("")
    else:
        for scr in screenshots:
            scr_name = scr.name
            lines.append(f"- **{scr_name}**: `{scr}`")
        lines.append("")

    if errors:
        lines.append("## 4. Ошибки и предупреждения раннера")
        lines.append("")
        for err in errors:
            lines.append(f"- ⚠️ {err}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="FICSIT AI — Анализ логов JSONL автопроверок игры (P-8, #39)"
    )
    parser.add_argument("input_path", help="Путь к JSONL файлу или каталогу запуска с артефактами")
    parser.add_argument("--save", default="UnknownSave", help="Имя или путь сохранения")
    parser.add_argument("--scenario", default="all", help="Имя проверенного сценария (S1, S3, S8 и т.д.)")
    parser.add_argument("--output", "-o", default=None, help="Путь для сохранения сформированного отчёта .md")

    args = parser.parse_args()

    input_path = Path(args.input_path).resolve()
    errors = []

    if input_path.is_dir():
        run_dir = input_path
        # Ищем первый .jsonl файл в каталоге
        jsonl_files = list(run_dir.glob("*.jsonl")) + list(run_dir.glob("Recording/*.jsonl"))
        if not jsonl_files:
            jsonl_file = run_dir / "test_run.jsonl"
            errors.append(f"В каталоге {run_dir} не найден файл .jsonl")
        else:
            jsonl_file = jsonl_files[0]
    else:
        jsonl_file = input_path
        run_dir = input_path.parent

    # Собираем скриншоты
    screenshots = list(run_dir.glob("*.png")) + list(run_dir.glob("Screenshots/*.png"))

    tests, benchmarks, telemetry_samples, parse_errors = parse_recording_jsonl(jsonl_file)
    errors.extend(parse_errors)

    report_md = generate_markdown_report(
        run_dir=run_dir,
        jsonl_file=jsonl_file,
        save_name=args.save,
        scenario=args.scenario,
        tests=tests,
        benchmarks=benchmarks,
        screenshots=screenshots,
        errors=errors
    )

    if args.output:
        out_path = Path(args.output).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(report_md)
        print(f"Отчёт сохранён: {out_path}")
    else:
        print(report_md)

    # Возвращаем ненулевой код при наличии проваленных тестов
    failed_count = sum(1 for t in tests if str(t.get("status", "")).upper() == "FAIL")
    return 1 if failed_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
