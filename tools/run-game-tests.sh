#!/usr/bin/env bash
# FICSIT AI — Скрипт автоматического запуска игры под Proton для автотестов (P-8, #39)
# Роль: Gf2
#
# Запускает Satisfactory под Proton с выбранным сохранением и сценарием проверок,
# отслеживает завершение по таймауту, собирает логи, JSONL-записи и скриншоты,
# после чего генерирует сводный отчёт проверки для King.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Значения по умолчанию
SAVE_ARG=""
SCENARIO="S1"
TIMEOUT_SEC=120
OUTPUT_DIR=""
DRY_RUN=false
MOCK_RUN=false
EXCLUSIVE=false
SML_ZIP="${FICSITAI_SML_ZIP:-}"
MOD_ZIPS=()

usage() {
    cat <<EOF
Использование: $(basename "$0") [ПАРАМЕТРЫ]

Запускает игру через tools/host/lib.sh (общие блокировки сборки/игры и личная копия роли).

Параметры:
  -s, --save <путь|имя>       Путь к .sav файлу или имя сохранения (P-5)
  -c, --scenario <имя>        Имя сценария проверок (S1, S3, S8, all; по умолчанию: S1)
  -t, --timeout <сек>         Таймаут выполнения в секундах (по умолчанию: 120)
  -o, --output-dir <каталог>  Каталог для сбора артефактов (по умолчанию: tests/runs/<метка>)
  --mod <архив>               Архив мода (zip/.smod) для установки в личную копию; можно повторять
  --sml <архив>               Архив SML-Windows.zip (по умолчанию: \$FICSITAI_SML_ZIP)
  --exclusive                 Монопольный запуск для замеров (-x вместо общего режима -s)
  --dry-run                   Только проверка путей и сборки параметров без запуска игры
  --mock-run                  Имитация прогона (генерация образцового JSONL и проверка отчёта)
  -h, --help                  Справка

Примеры:
  $(basename "$0") --mod build/FicsitAI-Windows.zip --save fixtures/saves/save_a_starter.sav --scenario S1
  $(basename "$0") --dry-run --save SaveA --scenario S1
  $(basename "$0") --mock-run --scenario S1
EOF
}

# Разбор аргументов
while [[ $# -gt 0 ]]; do
    case "$1" in
        -s|--save)
            SAVE_ARG="$2"
            shift 2
            ;;
        -c|--scenario)
            SCENARIO="$2"
            shift 2
            ;;
        -t|--timeout)
            TIMEOUT_SEC="$2"
            shift 2
            ;;
        -o|--output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --mod)
            MOD_ZIPS+=("$2")
            shift 2
            ;;
        --sml)
            SML_ZIP="$2"
            shift 2
            ;;
        --exclusive)
            EXCLUSIVE=true
            shift
            ;;
        --game-dir|--compat-dir|--proton-bin)
            echo "ПРЕДУПРЕЖДЕНИЕ: параметр $1 устарел — пути роли и Proton задаются через tools/host/lib.sh" >&2
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --mock-run)
            MOCK_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Неизвестный параметр: $1" >&2
            usage
            exit 1
            ;;
    esac
done

echo "=== FICSIT AI — Автопрогон проверок в игре под Proton (P-8, #39) ==="
echo "Сценарий: $SCENARIO"
echo "Таймаут:  ${TIMEOUT_SEC}с"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$REPO_ROOT/tests/runs/${TIMESTAMP}_${SCENARIO}"
fi
mkdir -p "$OUTPUT_DIR"
echo "Каталог артефактов: $OUTPUT_DIR"

# Режим mock-run: тестирование пайплайна генерации отчётов без игры
if [[ "$MOCK_RUN" == "true" ]]; then
    echo "--- Режим имитации (--mock-run) ---"
    MOCK_JSONL="$OUTPUT_DIR/mock_recording.jsonl"
    cat <<EOF > "$MOCK_JSONL"
{"type":"test_event", "scenario":"$SCENARIO", "test":"terminal_host_init", "status":"PASS", "duration_ms":12.4, "details":"Host initialized with NoPower state", "timestamp":"$(date -Iseconds)"}
{"type":"test_event", "scenario":"$SCENARIO", "test":"terminal_open_interact", "status":"PASS", "duration_ms":35.1, "details":"Terminal opened by E keypress", "screenshot":"s1_terminal_open.png", "timestamp":"$(date -Iseconds)"}
{"type":"test_event", "scenario":"$SCENARIO", "test":"module_chat_switch", "status":"PASS", "duration_ms":18.2, "details":"Switched to Chat module, input focused", "timestamp":"$(date -Iseconds)"}
{"type":"test_event", "scenario":"$SCENARIO", "test":"module_stats_switch", "status":"PASS", "duration_ms":22.0, "details":"Switched to Stats module, charts initialized", "timestamp":"$(date -Iseconds)"}
{"type":"test_event", "scenario":"$SCENARIO", "test":"terminal_no_power_state", "status":"PASS", "duration_ms":15.0, "details":"Circuit fuse breaker tripped, UI shows Disconnected/NoPower", "timestamp":"$(date -Iseconds)"}
{"type":"benchmark", "scope":"GameFacade_SampleTelemetry", "calls":60, "avg_ms":0.84, "max_ms":1.62, "budget_ms":2.0}
{"type":"benchmark", "scope":"ScreenModule_Tick", "calls":3600, "avg_ms":0.12, "max_ms":0.45, "budget_ms":0.5}
EOF
    # Создаём фиктивный скриншот
    touch "$OUTPUT_DIR/s1_terminal_open.png"

    REPORT_FILE="$OUTPUT_DIR/report.md"
    python3 "$REPO_ROOT/tools/parse-test-results.py" "$OUTPUT_DIR" \
        --save "${SAVE_ARG:-MockSave}" \
        --scenario "$SCENARIO" \
        -o "$REPORT_FILE"

    echo ""
    echo "Отчёт сформирован успешно:"
    cat "$REPORT_FILE"
    exit 0
fi

# Подключаем общую библиотеку запуска игры под Proton (tools/host/lib.sh, Co-72 / Gf2-19)
if [[ -z "${FICSITAI_GIT:-}" && ! -x /usr/bin/git ]]; then
    export FICSITAI_GIT="$(command -v git || true)"
fi
# shellcheck source=host/lib.sh
source "$REPO_ROOT/tools/host/lib.sh"
fa_require_role

SAVE_BASE_NAME=""
if [[ -n "$SAVE_ARG" ]]; then
    SAVE_BASE_NAME="$(basename "$SAVE_ARG" .sav)"
fi

MAP_URL="/Game/FactoryGame/Map/GameLevel01/Persistent_Level"
if [[ -n "$SAVE_BASE_NAME" ]]; then
    MAP_URL="${MAP_URL}?loadgame=${SAVE_BASE_NAME}"
fi

GAME_ARGS=(
    "$MAP_URL"
    "-FicsitAIDiagnostics=1"
    "-FicsitAITestScenario=${SCENARIO}"
    "-stdout"
    "-Unattended"
)

GAME_MODE="-s"
if [[ "$EXCLUSIVE" == "true" ]]; then
    GAME_MODE="-x"
fi

echo "Роль:                $FA_ROLE"
echo "Каталог роли:        $FA_ROLE_DIR"
echo "Режим блокировки:    $GAME_MODE"
echo "Имя сохранения:      ${SAVE_BASE_NAME:-<не задано>}"
echo "Модов к установке:   ${#MOD_ZIPS[@]}"
echo "Параметры запуска:   ${GAME_ARGS[*]}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo "--- Режим проверки (--dry-run) завершён без запуска процесса ---"
    exit 0
fi

# Если передан локальный .sav файл, гарантируем префикс роли и копируем сохранение под блокировкой роли.
if [[ -n "$SAVE_ARG" ]]; then
    if [[ ! -f "$SAVE_ARG" ]]; then
        echo "ОШИБКА: файл сохранения не найден: $SAVE_ARG" >&2
        exit 1
    fi
    _gf2_prepare_save() {
        _fa_game_copy_ensure "$SML_ZIP" || return 1
        local saved_root="$FA_ROLE_DIR/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames"
        local target_dir=""
        if [[ -d "$saved_root" ]]; then
            target_dir="$(find "$saved_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1 || true)"
        fi
        if [[ -z "$target_dir" ]]; then
            target_dir="$saved_root/common"
            mkdir -p "$target_dir"
        fi
        echo "Копирование сохранения $SAVE_ARG -> $target_dir/"
        cp "$SAVE_ARG" "$target_dir/"
    }
    fa_with_lock "role-$FA_ROLE" -x _gf2_prepare_save || exit 1
fi

FA_G_MODS=("${MOD_ZIPS[@]}")
FA_G_ENVS=()
FA_G_ARGS=("${GAME_ARGS[@]}")

echo "Запуск игры через tools/host/lib.sh (fa_game_session)..."
fa_game_session "$TIMEOUT_SEC" "$OUTPUT_DIR" "$GAME_MODE" "$SML_ZIP"
RUN_EXIT_CODE=$FA_RUN_EXIT
fa_parse_game_log "$FA_RUN_LOG"
echo "Игра завершена с кодом: $RUN_EXIT_CODE (CL=${FA_LOG_CL:-?}, MENU=$FA_LOG_MENU, FATAL=$FA_LOG_FATAL, PLUGIN_ERR=$FA_LOG_PLUGIN_ERRORS)"

# Сбор артефактов Recording / Screenshots из префикса роли
APPDATA_SAVED="$FA_ROLE_DIR/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved"
if [[ -d "$APPDATA_SAVED" ]]; then
    if [[ -d "$APPDATA_SAVED/Recording" ]]; then
        mkdir -p "$OUTPUT_DIR/Recording"
        cp -r "$APPDATA_SAVED/Recording/"* "$OUTPUT_DIR/Recording/" 2>/dev/null || true
        echo "Скопированы файлы Recording (JSONL)"
    fi
    if [[ -d "$APPDATA_SAVED/Screenshots" ]]; then
        mkdir -p "$OUTPUT_DIR/Screenshots"
        cp -r "$APPDATA_SAVED/Screenshots/"* "$OUTPUT_DIR/Screenshots/" 2>/dev/null || true
        echo "Скопированы скриншоты"
    fi
fi

# Генерация отчёта Markdown
REPORT_FILE="$OUTPUT_DIR/report.md"
python3 "$REPO_ROOT/tools/parse-test-results.py" "$OUTPUT_DIR" \
    --save "${SAVE_BASE_NAME:-UnknownSave}" \
    --scenario "$SCENARIO" \
    -o "$REPORT_FILE"

echo ""
echo "=== Сводный отчёт проверки ==="
cat "$REPORT_FILE"

if [[ -n "$SAVE_BASE_NAME" ]]; then
    # При прямом ?loadgame= движок пропускает MenuScenes/, поэтому проверяем выход по таймеру и отсутствие фатальных ошибок
    if [[ ( "$FA_RUN_EXIT" != 124 && "$FA_RUN_EXIT" != 0 ) || "$FA_LOG_FATAL" != 0 || "$FA_LOG_PLUGIN_ERRORS" != 0 ]]; then
        exit 1
    fi
elif ! fa_run_ok; then
    exit 1
fi
exit 0
