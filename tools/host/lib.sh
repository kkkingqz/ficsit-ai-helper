#!/usr/bin/env bash
# FICSIT AI — общие функции для сборки мода и запуска игры на общей машине команды.
# Роль: Co (зона tools/ — Gf2, внесено с его согласия).
#
# Зачем: на одной машине работают несколько ролей. UnrealBuildTool держит одну блокировку на движок,
# поэтому вторая сборка не ждёт, а падает; общая копия игры ломается от чужого мода; замеры кадрового
# времени портит чужая игра рядом. Здесь — очередь сборок, личная копия игры и единый способ запуска.
#
# Подключается через `source`. Все функции пишут пояснения в stderr, результат — в stdout или в переменные.

set -u

FA_HOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FA_REPO_ROOT="$(cd "$FA_HOST_DIR/../.." && pwd)"
FA_GIT="${FICSITAI_GIT:-/usr/bin/git}"
FA_LOCK_DIR="${FICSITAI_LOCK_DIR:-/tmp/ficsitai-locks}"
FA_ENGINE="${FICSITAI_ENGINE:-$HOME/UnrealEngineCSS}"
FA_STEAM_APP="${FICSITAI_STEAM_APP:-$HOME/.var/app/com.valvesoftware.Steam}"
FA_STEAM_ROOT="$FA_STEAM_APP/.local/share/Steam"
FA_APPID=526870
FA_SHADER_WORKERS="${FICSITAI_SHADER_WORKERS:-5}"

fa_say() { echo "[ficsitai] $*" >&2; }
fa_die() { echo "[ficsitai] ОШИБКА: $*" >&2; exit 2; }

# Роль: переменная FICSITAI_ROLE или ветка work/<роль> рабочей копии.
fa_role() {
    if [[ -n "${FICSITAI_ROLE:-}" ]]; then echo "${FICSITAI_ROLE,,}"; return; fi
    local branch
    branch="$("$FA_GIT" -C "$FA_REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ "$branch" == work/* ]]; then echo "${branch#work/}"; return; fi
    fa_die "роль не определена: задайте FICSITAI_ROLE (ветка '$branch' не work/<роль>)"
}

# Каталог роли внутри песочницы Steam Flatpak: в нём личная копия игры и префикс Proton.
# Снаружи это $FA_STEAM_APP/Projects/ficsitai-<роль>, изнутри песочницы — ~/Projects/ficsitai-<роль>.
fa_role_dir() { echo "$FA_STEAM_APP/Projects/ficsitai-$(fa_role)"; }

# fa_with_lock <имя> <-x|-s> <команда...>
# Очередь вместо отказа. -x — один владелец (сборка, замер), -s — можно вместе с другими (обычный запуск игры).
fa_with_lock() {
    local name="$1" mode="$2"; shift 2
    mkdir -p "$FA_LOCK_DIR" && chmod 1777 "$FA_LOCK_DIR" 2>/dev/null || true
    local lock="$FA_LOCK_DIR/$name.lock" holder="$FA_LOCK_DIR/$name.holder" fd rc
    exec {fd}>>"$lock"
    if ! flock -n "$mode" "$fd"; then
        fa_say "очередь '$name' занята: $(cat "$holder" 2>/dev/null || echo 'владелец неизвестен'). Жду."
        flock "$mode" "$fd"
    fi
    [[ "$mode" == "-x" ]] && echo "$(fa_role) с $(date '+%H:%M:%S'), pid $$: $*" | cut -c1-160 > "$holder"
    "$@"; rc=$?
    [[ "$mode" == "-x" ]] && rm -f "$holder"
    flock -u "$fd"; exec {fd}>&-
    return $rc
}

# Проверки окружения сборки из docs/ENVIRONMENT.md §7.1.
fa_check_build_env() {
    command -v wine64 >/dev/null || command -v wine >/dev/null || fa_die "wine не найден в PATH (ENVIRONMENT.md §7.1)"
    export UE_WINE_MSVC="${UE_WINE_MSVC:-$HOME/msvc}"
    [[ -x "$UE_WINE_MSVC/bin/x64/cl" && -x "$UE_WINE_MSVC/bin/x64/rc.exe" ]] || fa_die "обёртки MSVC не найдены в $UE_WINE_MSVC"
    [[ -x "$FA_ENGINE/Engine/Build/BatchFiles/RunUAT.sh" ]] || fa_die "движок не найден в $FA_ENGINE"
    local max; max="$(ulimit -Hn)"
    if [[ "$max" == unlimited || "$max" -gt 1048576 ]]; then max=1048576; fi
    ulimit -Sn "$max"
}

# fa_sync_mod_source <каталог в репозитории> <каталог мода в проекте SML> [шаблон для сохранения]...
# Приводит исходники мода в проекте к дереву репозитория, чтобы собиралась именно проверяемая ревизия.
# Binaries, Intermediate и Saved не трогает; дополнительные шаблоны — для того, чего в репозитории быть не должно
# (например, бинарники CEF в ThirdParty).
fa_sync_mod_source() {
    local src="$1" dst="$2"; shift 2
    local keep=(Binaries Intermediate Saved "$@") entry name k skip
    mkdir -p "$dst"
    for entry in "$dst"/* "$dst"/.[!.]*; do
        [[ -e "$entry" ]] || continue
        name="$(basename "$entry")"; skip=0
        for k in "${keep[@]}"; do [[ "$name" == $k ]] && skip=1; done
        [[ $skip -eq 1 ]] || rm -rf "$entry"
    done
    for entry in "$src"/* "$src"/.[!.]*; do
        [[ -e "$entry" ]] || continue
        name="$(basename "$entry")"; skip=0
        for k in "${keep[@]}"; do [[ "$name" == $k ]] && skip=1; done
        [[ $skip -eq 1 ]] || cp -a "$entry" "$dst/"
    done
}

# fa_build_mod <ModName> <проект SML> <файл лога>
# Сборка Win64 Shipping и упаковка через UAT под общей очередью. Результат — в переменных
# FA_BUILD_EXIT, FA_BUILD_ARCHIVE, FA_BUILD_SHA, FA_BUILD_SIZE_MB.
fa_build_mod() {
    local mod="$1" project="$2" log="$3" uproject attempt unused pct
    uproject="$project/FactoryGame.uproject"
    [[ -f "$uproject" ]] || fa_die "нет $uproject"
    [[ -f "$project/Mods/$mod/$mod.uplugin" ]] || fa_die "нет $project/Mods/$mod/$mod.uplugin"
    fa_check_build_env
    # Число процессов компиляции шейдеров (Gs-26): при 16 упирается в память.
    unused=$(( $(nproc) - FA_SHADER_WORKERS )); (( unused < 0 )) && unused=0
    pct=$(( (unused * 100 + $(nproc) - 1) / $(nproc) ))
    local cook="-ini:Engine:[DevOptions.Shaders]:NumUnusedShaderCompilingThreads=$unused -ini:Engine:[DevOptions.Shaders]:PercentageUnusedShaderCompilingThreads=$pct"
    _fa_uat() {
        for attempt in 1 2 3 4 5 6 7 8; do
            "$FA_ENGINE/Engine/Build/BatchFiles/RunUAT.sh" -ScriptsForProject="$uproject" PackagePlugin \
                -Project="$uproject" -dlcname="$mod" -merge -build -clientconfig=Shipping \
                -platform=Win64 -nocompileeditor -installed -AdditionalCookerOptions="$cook" > "$log" 2>&1
            FA_BUILD_EXIT=$?
            # Кто-то собирает мимо очереди: UBT не ждёт, а выходит. Повторяем.
            grep -q "ConflictingInstance" "$log" || return 0
            fa_say "UnrealBuildTool занят сборкой мимо очереди, попытка $attempt, жду 45 с"
            sleep 45
        done
    }
    fa_say "сборка $mod (Win64 Shipping), лог: $log"
    FA_BUILD_EXIT=1
    local started; started="$(mktemp)"
    fa_with_lock build -x _fa_uat
    FA_BUILD_ARCHIVE="$project/Saved/ArchivedPlugins/$mod/$mod-Windows.zip"
    FA_BUILD_SHA=""; FA_BUILD_SIZE_MB=""
    # Архив должен быть создан этой сборкой, а не остаться от прошлой.
    if [[ $FA_BUILD_EXIT -eq 0 && -f "$FA_BUILD_ARCHIVE" && "$FA_BUILD_ARCHIVE" -nt "$started" ]]; then
        FA_BUILD_SHA="$(sha256sum "$FA_BUILD_ARCHIVE" | cut -c1-16)"
        FA_BUILD_SIZE_MB=$(( $(stat -c %s "$FA_BUILD_ARCHIVE") / 1048576 ))
    elif [[ $FA_BUILD_EXIT -eq 0 ]]; then
        FA_BUILD_EXIT=3   # UAT сказал «успех», а свежего архива нет
    fi
    rm -f "$started"
    return $FA_BUILD_EXIT
}

# fa_game_copy_ensure [архив SML]
# Личная копия игры жёсткими ссылками (места не занимает) и свой префикс Proton. Общую установку не меняет.
fa_game_copy_ensure() {
    local sml_zip="${1:-}" dir src manifest buildid
    dir="$(fa_role_dir)"; src="$FA_STEAM_ROOT/steamapps/common/Satisfactory"
    manifest="$FA_STEAM_ROOT/steamapps/appmanifest_$FA_APPID.acf"
    [[ -f "$src/FactoryGameSteam.exe" ]] || fa_die "игра не найдена в $src"
    buildid="$(grep -o '"buildid"[[:space:]]*"[0-9]*"' "$manifest" 2>/dev/null | grep -o '[0-9]*' || echo unknown)"
    if [[ -d "$dir/game" && "$(cat "$dir/game/.ficsitai-buildid" 2>/dev/null)" != "$buildid" ]]; then
        fa_say "личная копия не соответствует установленной игре (сборка Steam $buildid): пересоздаю"
        rm -rf "$dir/game"
    fi
    if [[ ! -d "$dir/game" ]]; then
        fa_say "создаю личную копию игры в $dir/game"
        mkdir -p "$dir"
        cp -al "$src" "$dir/game" 2>/dev/null || { rm -rf "$dir/game"; cp -a --reflink=auto "$src" "$dir/game"; }
        rm -rf "$dir/game/FactoryGame/Mods"; mkdir -p "$dir/game/FactoryGame/Mods"
        echo "$buildid" > "$dir/game/.ficsitai-buildid"
    fi
    if [[ ! -d "$dir/compat/pfx" ]]; then
        [[ -d "$FA_STEAM_ROOT/steamapps/compatdata/$FA_APPID/pfx" ]] || fa_die "нет префикса Proton: запустите игру один раз из Steam"
        fa_say "создаю личный префикс Proton в $dir/compat"
        cp -a "$FA_STEAM_ROOT/steamapps/compatdata/$FA_APPID" "$dir/compat"
    fi
    if [[ ! -f "$dir/game/FactoryGame/Mods/SML/SML.uplugin" ]]; then
        [[ -f "$sml_zip" ]] || fa_die "в личной копии нет SML: передайте архив SML-Windows.zip (--sml или FICSITAI_SML_ZIP)"
        mkdir -p "$dir/game/FactoryGame/Mods/SML" && unzip -q "$sml_zip" -d "$dir/game/FactoryGame/Mods/SML"
    fi
}

# fa_install_mods <архив>...  — ставит моды в личную копию, заменяя всё, кроме SML.
fa_install_mods() {
    local mods zip name
    mods="$(fa_role_dir)/game/FactoryGame/Mods"
    for name in "$mods"/*; do [[ "$(basename "$name")" == SML ]] || rm -rf "$name"; done
    for zip in "$@"; do
        [[ -f "$zip" ]] || fa_die "нет архива $zip"
        name="$(basename "$zip")"; name="${name%-Windows.zip}"; name="${name%.zip}"
        mkdir -p "$mods/$name" && unzip -q "$zip" -d "$mods/$name"
        [[ -f "$mods/$name/$name.uplugin" ]] || fa_die "в архиве $zip нет $name.uplugin в корне"
    done
}

# fa_run_game <секунд> <каталог результата> <-s|-x> [KEY=VALUE]... [-- аргументы игры...]
# Запуск под Proton из песочницы Steam Flatpak, без клиента Steam, с ограничением по времени.
# Результат — в переменных FA_RUN_EXIT (124 — игра дожила до таймера), FA_RUN_LOG.
fa_run_game() {
    local seconds="$1" out="$2" mode="$3"; shift 3
    local dir role saved envs=() args=()
    role="$(fa_role)"; dir="$(fa_role_dir)"
    while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("--env=$1"); shift; done
    [[ $# -gt 0 ]] && shift
    args=("$@")
    saved="$dir/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved"
    mkdir -p "$out"; rm -f "$saved/Logs/FactoryGame.log"
    cat > "$dir/launch.sh" <<LAUNCH
#!/usr/bin/env bash
# Создано tools/host/lib.sh. Выполняется внутри песочницы Steam Flatpak.
S="\$HOME/.local/share/Steam"
export STEAM_COMPAT_CLIENT_INSTALL_PATH="\$S"
export STEAM_COMPAT_DATA_PATH="\$HOME/Projects/ficsitai-$role/compat"
export SteamAppId=$FA_APPID SteamGameId=$FA_APPID
T="\$1"; shift
timeout --signal=TERM --kill-after=20 "\$T" \\
  "\$S/steamapps/common/SteamLinuxRuntime_4/_v2-entry-point" --verb=waitforexitandrun -- \\
  "\$S/steamapps/common/Proton - Experimental/proton" waitforexitandrun \\
  "\$HOME/Projects/ficsitai-$role/game/FactoryGameSteam.exe" -windowed -ResX=1280 -ResY=720 -NoSplash -log -FORCELOGFLUSH "\$@"
echo "RUN_EXIT=\$?"
LAUNCH
    chmod +x "$dir/launch.sh"
    _fa_launch() {
        ( cd "$HOME" && flatpak run "${envs[@]}" --command=bash com.valvesoftware.Steam \
            "Projects/ficsitai-$role/launch.sh" "$seconds" "${args[@]}" ) > "$out/launch.log" 2>&1
    }
    fa_say "запуск игры на $seconds с ($([[ "$mode" == "-x" ]] && echo 'один на машине' || echo 'можно рядом с другими'))"
    fa_with_lock game "$mode" _fa_launch
    FA_RUN_EXIT="$(grep -o 'RUN_EXIT=[0-9]*' "$out/launch.log" | tail -1 | cut -d= -f2)"; FA_RUN_EXIT="${FA_RUN_EXIT:-1}"
    FA_RUN_LOG="$out/FactoryGame.log"
    cp "$saved/Logs/FactoryGame.log" "$FA_RUN_LOG" 2>/dev/null || : > "$FA_RUN_LOG"
}

# Разбор журнала игры. Переменные: FA_LOG_CL, FA_LOG_MODS, FA_LOG_FATAL, FA_LOG_PLUGIN_ERRORS, FA_LOG_MENU.
fa_parse_game_log() {
    local log="$1"
    FA_LOG_CL="$(grep -o 'Game Changelist: [0-9]*' "$log" | head -1 | grep -o '[0-9]*' || true)"
    FA_LOG_MODS="$(sed -n '/LogSatisfactoryModLoader: Display: List of loaded mods:/,/Discovered .* game instance modules/p' "$log" \
        | grep -o 'Display: [A-Za-z0-9_]*: [0-9][0-9.]*' | sed 's/Display: //' | grep -v '^FactoryGame:' | paste -sd, - | sed 's/,/, /g' || true)"
    FA_LOG_FATAL="$(grep -c -E 'Critical error|Fatal error|Unhandled Exception' "$log" || true)"
    FA_LOG_PLUGIN_ERRORS="$(grep -c 'LogPluginManager: Error' "$log" || true)"
    # Главное меню: счётчик кадров в журнале ушёл от нуля.
    FA_LOG_MENU=no; grep -q -E '^\[[0-9.:-]+\]\[ *[1-9][0-9]*\]' "$log" && FA_LOG_MENU=yes
}
