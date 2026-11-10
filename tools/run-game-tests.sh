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
GAME_DIR="${SATISFACTORY_GAME_PATH:-}"
COMPAT_DATA_DIR="${STEAM_COMPAT_DATA_PATH:-}"
PROTON_BIN="${PROTON_PATH:-}"

SATISFACTORY_APPID="526870"

usage() {
    cat <<EOF
Использование: $(basename "$0") [ПАРАМЕТРЫ]

Параметры:
  -s, --save <путь|имя>       Путь к .sav файлу или имя сохранения (P-5)
  -c, --scenario <имя>        Имя сценария проверок (S1, S3, S8, all; по умолчанию: S1)
  -t, --timeout <сек>         Таймаут выполнения в секундах (по умолчанию: 120)
  -o, --output-dir <каталог>  Каталог для сбора артефактов (по умолчанию: tests/runs/<метка>)
  --game-dir <каталог>        Путь к установленному каталогу Satisfactory
  --compat-dir <каталог>      Путь к compatdata Proton (где лежит pfx)
  --proton-bin <путь>         Путь к исполняемому файлу Proton (proton run)
  --dry-run                   Только проверка путей и сборки параметров без запуска игры
  --mock-run                  Имитация прогона (генерация образцового JSONL и проверка отчёта)
  -h, --help                  Справка

Примеры:
  $(basename "$0") --save fixtures/saves/SaveA.sav --scenario S1
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
        --game-dir)
            GAME_DIR="$2"
            shift 2
            ;;
        --compat-dir)
            COMPAT_DATA_DIR="$2"
            shift 2
            ;;
        --proton-bin)
            PROTON_BIN="$2"
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

# Поиск путей Steam, Proton и Satisfactory
STEAM_ROOT=""
for candidate in \
    "$HOME/.steam/steam" \
    "$HOME/.local/share/Steam" \
    "$HOME/.var/app/com.valvesoftware.Steam/.steam/steam" \
    "$HOME/.var/app/com.valvesoftware.Steam/.local/share/Steam"; do
    if [[ -d "$candidate" ]]; then
        STEAM_ROOT="$candidate"
        break
    fi
done

if [[ -z "$GAME_DIR" && -n "$STEAM_ROOT" ]]; then
    POSSIBLE_GAME="$STEAM_ROOT/steamapps/common/Satisfactory"
    if [[ -d "$POSSIBLE_GAME" ]]; then
        GAME_DIR="$POSSIBLE_GAME"
    fi
fi

if [[ -z "$COMPAT_DATA_DIR" && -n "$STEAM_ROOT" ]]; then
    POSSIBLE_COMPAT="$STEAM_ROOT/steamapps/compatdata/$SATISFACTORY_APPID"
    if [[ -d "$POSSIBLE_COMPAT" ]]; then
        COMPAT_DATA_DIR="$POSSIBLE_COMPAT"
    fi
fi

if [[ -z "$PROTON_BIN" && -n "$STEAM_ROOT" ]]; then
    # Ищем установленные версии Proton
    for p_candidate in \
        "$STEAM_ROOT/steamapps/common/Proton - Experimental/proton" \
        "$STEAM_ROOT/steamapps/common/Proton 9.0/proton" \
        "$STEAM_ROOT/steamapps/common/Proton 8.0/proton" \
        "$(command -v proton 2>/dev/null || true)"; do
        if [[ -n "$p_candidate" && -x "$p_candidate" ]]; then
            PROTON_BIN="$p_candidate"
            break
        fi
    done
fi

echo "Steam каталог:       ${STEAM_ROOT:-<не обнаружен>}"
echo "Satisfactory путь:   ${GAME_DIR:-<не обнаружен>}"
echo "Proton compatdata:   ${COMPAT_DATA_DIR:-<не обнаружен>}"
echo "Proton исполняемый:  ${PROTON_BIN:-<не обнаружен>}"

# Проверка сохранения
SAVE_BASE_NAME=""
if [[ -n "$SAVE_ARG" ]]; then
    if [[ -f "$SAVE_ARG" ]]; then
        SAVE_BASE_NAME="$(basename "$SAVE_ARG" .sav)"
        # Копируем сохранение в pfx, если каталог compatdata найден
        if [[ -n "$COMPAT_DATA_DIR" && -d "$COMPAT_DATA_DIR/pfx" ]]; then
            SAVED_GAMES_DIR=""
            SAVED_GAMES_DIR="$(find "$COMPAT_DATA_DIR/pfx/drive_c/users" -name "SaveGames" -type d 2>/dev/null | head -n 1 || true)"
            if [[ -n "$SAVED_GAMES_DIR" ]]; then
                STEAM_ID_DIR="$(find "$SAVED_GAMES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1 || true)"
                if [[ -n "$STEAM_ID_DIR" ]]; then
                    echo "Копирование сохранения $SAVE_ARG -> $STEAM_ID_DIR/"
                    cp "$SAVE_ARG" "$STEAM_ID_DIR/"
                fi
            fi
        fi
    else
        SAVE_BASE_NAME="$(basename "$SAVE_ARG" .sav)"
    fi
    echo "Имя сохранения:      $SAVE_BASE_NAME"
fi

# Формирование URL карты и аргументов командной строки Satisfactory
# Согласно проверке архитектуры и исходников AFGGameMode:
# Map URL опция loadgame обрабатывается движком: AFGGameMode::LoadGameOption = TEXT("loadgame")
MAP_URL="/Game/FactoryGame/Map/GameLevel01/Persistent_Level"
if [[ -n "$SAVE_BASE_NAME" ]]; then
    MAP_URL="${MAP_URL}?loadgame=${SAVE_BASE_NAME}"
fi

GAME_ARGS=(
    "$MAP_URL"
    "-FicsitAIDiagnostics=1"
    "-FicsitAITestScenario=${SCENARIO}"
    "-Log"
    "-stdout"
    "-FORCELOGFLUSH"
    "-NoSplash"
    "-Unattended"
)

echo "Параметры запуска:   ${GAME_ARGS[*]}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo "--- Режим проверки (--dry-run) завершён без запуска процесса ---"
    exit 0
fi

# Проверка наличия обязательных компонентов для реального запуска
if [[ -z "$GAME_DIR" || ! -d "$GAME_DIR" ]]; then
    echo "ОШИБКА: Каталог игры Satisfactory не найден. Укажите через --game-dir или проверьте установку Steam." >&2
    exit 1
fi

if [[ -z "$PROTON_BIN" || ! -x "$PROTON_BIN" ]]; then
    echo "ОШИБКА: Исполняемый файл Proton не найден. Укажите через --proton-bin." >&2
    exit 1
fi

GAME_EXE="$GAME_DIR/FactoryGameSteam.exe"
if [[ ! -f "$GAME_EXE" ]]; then
    GAME_EXE="$GAME_DIR/FactoryGame/Binaries/Win64/FactoryGameSteam-Win64-Shipping.exe"
fi

if [[ ! -f "$GAME_EXE" ]]; then
    echo "ОШИБКА: Бинарный файл игры FactoryGameSteam.exe не найден в $GAME_DIR" >&2
    exit 1
fi

echo "Запуск игры под Proton..."
export STEAM_COMPAT_CLIENT_INSTALL_PATH="${STEAM_ROOT}"
export STEAM_COMPAT_DATA_PATH="${COMPAT_DATA_DIR}"

# Запуск с ограничением по времени (timeout)
set +e
timeout --preserve-status --kill-after=10s "${TIMEOUT_SEC}s" \
    "$PROTON_BIN" run "$GAME_EXE" "${GAME_ARGS[@]}" > "$OUTPUT_DIR/stdout_stderr.log" 2>&1
RUN_EXIT_CODE=$?
set -e

echo "Игра завершена с кодом: $RUN_EXIT_CODE"

# Сбор артефактов из Proton prefix
if [[ -n "$COMPAT_DATA_DIR" && -d "$COMPAT_DATA_DIR/pfx" ]]; then
    APPDATA_SAVED="$(find "$COMPAT_DATA_DIR/pfx/drive_c/users" -path "*/AppData/Local/FactoryGame/Saved" -type d 2>/dev/null | head -n 1 || true)"
    if [[ -n "$APPDATA_SAVED" && -d "$APPDATA_SAVED" ]]; then
        # 1. Лог игры
        if [[ -f "$APPDATA_SAVED/Logs/FactoryGame.log" ]]; then
            cp "$APPDATA_SAVED/Logs/FactoryGame.log" "$OUTPUT_DIR/FactoryGame.log"
            echo "Скопирован FactoryGame.log"
        fi
        # 2. Файлы Recording (JSONL)
        if [[ -d "$APPDATA_SAVED/Recording" ]]; then
            mkdir -p "$OUTPUT_DIR/Recording"
            cp -r "$APPDATA_SAVED/Recording/"* "$OUTPUT_DIR/Recording/" 2>/dev/null || true
            echo "Скопированы файлы Recording (JSONL)"
        fi
        # 3. Скриншоты
        if [[ -d "$APPDATA_SAVED/Screenshots" ]]; then
            mkdir -p "$OUTPUT_DIR/Screenshots"
            cp -r "$APPDATA_SAVED/Screenshots/"* "$OUTPUT_DIR/Screenshots/" 2>/dev/null || true
            echo "Скопированы скриншоты"
        fi
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

exit $RUN_EXIT_CODE
