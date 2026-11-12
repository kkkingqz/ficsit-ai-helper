#!/usr/bin/env bash
# FICSIT AI — Запуск автоматизированного бенчмарка кадрового времени и нагрузки S8 (Блок 5, #8)
# Роль: Gf2
#
# Запускает игру под Proton в монопольном режиме (--exclusive) со сборками спайка S8
# (FicsitAIWebRuntime + FicsitAIS8Probe) на тестовом сохранении Save B (s8_baseline_yt.sav).
# Во время прогона ведётся параллельный поминутный мониторинг памяти процессов игры и CEF,
# после чего логи разбираются утилитой parse-s8-benchmark.py с формированием отчёта для Ворот W.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Значения по умолчанию
SAVE_PATH="$REPO_ROOT/fixtures/saves/s8_baseline_yt.sav"
HANDOFF_DIR="/home/king/Projects/ficsitai-deps/handoff/s8-block3-20261112"
SML_ZIP="${FICSITAI_SML_ZIP:-/home/king/Projects/SML-gf2/Saved/ArchivedPlugins/SML/SML-Windows.zip}"
if [[ ! -f "$SML_ZIP" ]]; then
    SML_ZIP="/home/king/Projects/SatisfactoryModLoader/Saved/ArchivedPlugins/SML/SML-Windows.zip"
fi
SECONDS_LIMIT=260
OUTPUT_DIR=""
EXCLUSIVE=true
DRY_RUN=false

usage() {
    cat <<EOF
Использование: $(basename "$0") [ПАРАМЕТРЫ]

Запускает нагрузочный бенчмарк S8 (Блок 5) под Proton на Save B.

Параметры:
  -s, --save <файл>           Путь к .sav сохранению (по умолчанию: fixtures/saves/s8_baseline_yt.sav)
  -t, --seconds <сек>         Длительность прогона в секундах (по умолчанию: 260)
  --handoff <каталог>         Каталог со сборками S8 (по умолчанию: ~/Projects/ficsitai-deps/handoff/s8-block3-20261112)
  --sml <архив>               Архив SML-Windows.zip (по умолчанию: \$FICSITAI_SML_ZIP)
  -o, --output-dir <каталог>  Каталог для сбора артефактов (по умолчанию: tests/runs/benchmark_s8_<метка>)
  --shared                    Запуск без монопольной блокировки (-s вместо -x; не рекомендуется для замеров)
  --dry-run                   Проверка путей без запуска игры
  -h, --help                  Справка
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -s|--save) SAVE_PATH="$2"; shift 2 ;;
        -t|--seconds) SECONDS_LIMIT="$2"; shift 2 ;;
        --handoff) HANDOFF_DIR="$2"; shift 2 ;;
        --sml) SML_ZIP="$2"; shift 2 ;;
        -o|--output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --shared) EXCLUSIVE=false; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Неизвестный параметр: $1" >&2; usage; exit 1 ;;
    esac
done

echo "=== FICSIT AI — Бенчмарк нагрузки S8 (Блок 5, #8) ==="
echo "Роль:                 Gf2"
echo "Сохранение:           $SAVE_PATH"
echo "Сборки handoff:       $HANDOFF_DIR"
echo "Архив SML:            $SML_ZIP"
echo "Лимит времени:        ${SECONDS_LIMIT}с"
echo "Монопольный режим:    $EXCLUSIVE"

# Проверка исходных файлов
[[ -f "$SAVE_PATH" ]] || { echo "ОШИБКА: Файл сохранения не найден: $SAVE_PATH" >&2; exit 2; }
[[ -f "$SML_ZIP" ]] || { echo "ОШИБКА: Архив SML не найден: $SML_ZIP" >&2; exit 2; }
RT_ZIP="$HANDOFF_DIR/FicsitAIWebRuntime-Windows.zip"
PROBE_ZIP="$HANDOFF_DIR/FicsitAIS8Probe-Windows.zip"
[[ -f "$RT_ZIP" ]] || { echo "ОШИБКА: Не найден FicsitAIWebRuntime: $RT_ZIP" >&2; exit 2; }
[[ -f "$PROBE_ZIP" ]] || { echo "ОШИБКА: Не найден FicsitAIS8Probe: $PROBE_ZIP" >&2; exit 2; }

if [[ "$DRY_RUN" == "true" ]]; then
    echo "--- Режим проверки (--dry-run) завершён успешно ---"
    exit 0
fi

# Подключаем библиотеку host/lib.sh
if [[ -z "${FICSITAI_GIT:-}" && ! -x /usr/bin/git ]]; then
    export FICSITAI_GIT="$(command -v git || true)"
fi
# shellcheck source=host/lib.sh
source "$REPO_ROOT/tools/host/lib.sh"
fa_require_role

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$REPO_ROOT/tests/runs/benchmark_s8_${TIMESTAMP}"
fi
mkdir -p "$OUTPUT_DIR"
echo "Каталог результатов:  $OUTPUT_DIR"

# Подготовка Save B как main_continue.sav под блокировкой роли
_gf2_prepare_benchmark_save() {
    _fa_game_copy_ensure "$SML_ZIP" || return 1
    local saved_root="$FA_ROLE_DIR/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames"
    local target_dir=""
    if [[ -d "$saved_root" ]]; then
        target_dir="$(find "$saved_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1 || true)"
    fi
    if [[ -z "$target_dir" ]]; then
        target_dir="$saved_root/76561198014740064"
        mkdir -p "$target_dir"
    fi
    echo "Копирование сохранения $SAVE_PATH -> $target_dir/main_continue.sav"
    cp -f "$SAVE_PATH" "$target_dir/main_continue.sav"
    cp -f "$SAVE_PATH" "$target_dir/yt.sav"
}
fa_with_lock "role-$FA_ROLE" -x _gf2_prepare_benchmark_save

# Запуск фонового мониторинга процессов (ps poll 1Hz)
METRICS_FILE="$OUTPUT_DIR/process_metrics.tsv"
printf "timestamp\telapsed_sec\tgame_pid\tgame_rss_mb\tcef_count\tcef_total_rss_mb\tcef_max_rss_mb\n" > "$METRICS_FILE"

MONITOR_PID=""
_start_process_monitor() {
    local start_ts
    start_ts="$(date +%s)"
    (
        while true; do
            local now elapsed
            now="$(date +%s)"
            elapsed=$(( now - start_ts ))
            
            # Поиск процессов
            local game_line cef_lines
            game_line="$(ps -eo pid,rss,comm,args 2>/dev/null | grep -i "FactoryGameSteam.exe" | grep -v grep | head -1 || true)"
            cef_lines="$(ps -eo pid,rss,comm,args 2>/dev/null | grep -i "BluBrowserProcess.exe" | grep -v grep || true)"
            
            local g_pid=0 g_rss_mb=0.0
            if [[ -n "$game_line" ]]; then
                g_pid="$(awk '{print $1}' <<< "$game_line")"
                local g_rss_kb
                g_rss_kb="$(awk '{print $2}' <<< "$game_line")"
                g_rss_mb="$(awk "BEGIN {printf \"%.2f\", ${g_rss_kb:-0}/1024}")"
            fi
            
            local c_count=0 c_total_mb=0.0 c_max_mb=0.0
            if [[ -n "$cef_lines" ]]; then
                c_count="$(wc -l <<< "$cef_lines")"
                local c_total_kb c_max_kb
                c_total_kb="$(awk '{sum += $2} END {print sum+0}' <<< "$cef_lines")"
                c_max_kb="$(awk 'BEGIN{max=0} {if ($2>max) max=$2} END {print max+0}' <<< "$cef_lines")"
                c_total_mb="$(awk "BEGIN {printf \"%.2f\", ${c_total_kb:-0}/1024}")"
                c_max_mb="$(awk "BEGIN {printf \"%.2f\", ${c_max_kb:-0}/1024}")"
            fi
            
            if [[ "$g_pid" -ne 0 || "$c_count" -ne 0 ]]; then
                printf "%s\t%d\t%s\t%s\t%d\t%s\t%s\n" \
                    "$(date '+%Y-%m-%d %H:%M:%S')" "$elapsed" "$g_pid" "$g_rss_mb" "$c_count" "$c_total_mb" "$c_max_mb" >> "$METRICS_FILE"
            fi
            sleep 1
        done
    ) &
    MONITOR_PID=$!
}

_stop_process_monitor() {
    if [[ -n "$MONITOR_PID" ]] && kill -0 "$MONITOR_PID" 2>/dev/null; then
        kill "$MONITOR_PID" 2>/dev/null || true
        wait "$MONITOR_PID" 2>/dev/null || true
    fi
}
trap _stop_process_monitor EXIT

GAME_MODE="-s"
if [[ "$EXCLUSIVE" == "true" ]]; then
    GAME_MODE="-x"
fi

FA_G_MODS=("$RT_ZIP" "$PROBE_ZIP")
FA_G_ENVS=()
FA_G_ARGS=(
    "-FicsitAIS8Auto"
    "-windowed"
    "-ResX=1280"
    "-ResY=720"
    "-NoSplash"
    "-log"
    "-FORCELOGFLUSH"
)

echo "Запуск фонового мониторинга процессов..."
_start_process_monitor

echo "Запуск игры через tools/host/lib.sh (fa_game_session, ${SECONDS_LIMIT}с, $GAME_MODE)..."
fa_game_session "$SECONDS_LIMIT" "$OUTPUT_DIR" "$GAME_MODE" "$SML_ZIP"
RUN_EXIT_CODE=$FA_RUN_EXIT
_stop_process_monitor
trap - EXIT

fa_parse_game_log "$FA_RUN_LOG"
echo "Игра завершена с кодом: $RUN_EXIT_CODE"
echo "Log: $FA_RUN_LOG (CL=${FA_LOG_CL:-?}, MENU=$FA_LOG_MENU, FATAL=$FA_LOG_FATAL)"

# Копируем cef.log если есть
APPDATA_SAVED="$FA_ROLE_DIR/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved"
if [[ -f "$APPDATA_SAVED/FicsitAI/Cef/cef.log" ]]; then
    cp "$APPDATA_SAVED/FicsitAI/Cef/cef.log" "$OUTPUT_DIR/cef.log" 2>/dev/null || true
fi

# Запуск анализатора отчёта
echo ""
echo "=== Анализ результатов бенчмарка ==="
REPORT_FILE="$OUTPUT_DIR/s8-benchmark-report.md"
python3 "$REPO_ROOT/tools/parse-s8-benchmark.py" "$OUTPUT_DIR" -o "$REPORT_FILE"

exit 0
