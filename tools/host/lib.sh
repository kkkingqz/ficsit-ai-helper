#!/usr/bin/env bash
# FICSIT AI — общие функции для сборки мода и запуска игры на общей машине команды.
# Роль: Co (зона tools/ — Gf2, внесено с его согласия, Gf2-19).
#
# Зачем: на одной машине работают несколько ролей. UnrealBuildTool держит одну блокировку на движок,
# поэтому вторая сборка не ждёт, а падает; общая копия игры ломается от чужого мода; замеры кадрового
# времени портит чужая игра рядом. Здесь — очередь сборок, личная копия игры и единый способ запуска.
#
# Подключается через `source`. Первым делом скрипт зовёт fa_require_role: без роли и без блокировки
# ни одна функция ничего не меняет на диске.

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
FA_ROLE=""; FA_ROLE_DIR=""

fa_say() { echo "[ficsitai] $*" >&2; }
fa_die() { echo "[ficsitai] ОШИБКА: $*" >&2; exit 2; }

# Роль: переменная FICSITAI_ROLE или ветка work/<роль>. Вызывается напрямую, не в $(...):
# иначе выход по ошибке остался бы в подоболочке, а каталог роли получился бы общим.
fa_require_role() {
    local branch
    if [[ -n "${FICSITAI_ROLE:-}" ]]; then
        FA_ROLE="${FICSITAI_ROLE,,}"
    else
        branch="$("$FA_GIT" -C "$FA_REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
        [[ "$branch" == work/* ]] && FA_ROLE="${branch#work/}"
    fi
    [[ "$FA_ROLE" =~ ^[a-z0-9]+$ ]] || fa_die "роль не определена: задайте FICSITAI_ROLE (ветка рабочей копии не work/<роль>)"
    # Каталог роли внутри песочницы Steam Flatpak: личная копия игры, префикс Proton, результаты прогонов.
    FA_ROLE_DIR="$FA_STEAM_APP/Projects/ficsitai-$FA_ROLE"
}

# fa_with_lock <имя> <-x|-s> <команда...>
# Очередь вместо отказа. -x — один владелец (сборка, замер, копия игры роли), -s — можно вместе с другими.
# Если блокировку получить не удалось, команда не выполняется.
fa_with_lock() {
    local name="$1" mode="$2"; shift 2
    local lock="$FA_LOCK_DIR/$name.lock" holder="$FA_LOCK_DIR/$name.holder" fd rc
    [[ -n "$FA_ROLE" ]] || fa_die "fa_with_lock вызван до fa_require_role"
    mkdir -p "$FA_LOCK_DIR" || fa_die "не создаётся каталог блокировок $FA_LOCK_DIR"
    chmod 1777 "$FA_LOCK_DIR" 2>/dev/null || true
    exec {fd}>>"$lock" || fa_die "не открывается файл блокировки $lock"
    if ! flock -n "$mode" "$fd"; then
        fa_say "очередь '$name' занята: $(cat "$holder" 2>/dev/null || echo 'владелец неизвестен'). Жду."
        flock "$mode" "$fd" || { exec {fd}>&-; fa_die "блокировку '$name' получить не удалось, команда не выполнена"; }
    fi
    [[ "$mode" == "-x" ]] && echo "$FA_ROLE с $(date '+%H:%M:%S'), pid $$: $*" | cut -c1-160 > "$holder"
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
# Приводит исходники мода в проекте к дереву репозитория. Binaries, Intermediate и Saved не трогает;
# дополнительные шаблоны — для того, чего в репозитории быть не должно (бинарники CEF в ThirdParty).
# Любая ошибка удаления или копирования — код 1: собирать неполное дерево нельзя.
fa_sync_mod_source() {
    local src="$1" dst="$2"; shift 2
    local keep=(Binaries Intermediate Saved "$@") entry name k skip
    mkdir -p "$dst" || return 1
    for entry in "$dst"/* "$dst"/.[!.]*; do
        [[ -e "$entry" || -L "$entry" ]] || continue
        name="$(basename "$entry")"; skip=0
        for k in "${keep[@]}"; do [[ "$name" == $k ]] && skip=1; done
        [[ $skip -eq 1 ]] || rm -rf "$entry" || return 1
    done
    for entry in "$src"/* "$src"/.[!.]*; do
        [[ -e "$entry" ]] || continue
        name="$(basename "$entry")"; skip=0
        for k in "${keep[@]}"; do [[ "$name" == $k ]] && skip=1; done
        [[ $skip -eq 1 ]] || cp -a "$entry" "$dst/" || return 1
    done
    [[ -f "$dst/$(basename "$src").uplugin" ]] || return 1
}

# fa_build_mod <ModName> <проект SML> <каталог результата> <sync: 0|1> [шаблон для сохранения]...
# Сборка Win64 Shipping и упаковка через UAT. Подготовка исходников, UAT, проверка свежести архива и его
# копирование в каталог результата идут под одной блокировкой: пока она держится, никто другой через
# эти скрипты не меняет ни исходники в проекте SML, ни архив.
# Результат: FA_BUILD_EXIT (0 — успех), FA_BUILD_STAGE (где остановилось), FA_BUILD_ORIGIN,
# FA_BUILD_ARCHIVE (копия в каталоге результата), FA_BUILD_SHA, FA_BUILD_SIZE_MB, FA_BUILD_LOG.
fa_build_mod() {
    local mod="$1" project="$2" out="$3" sync="$4"; shift 4
    local keeps=("$@") uproject="$project/FactoryGame.uproject" src="$FA_REPO_ROOT/mod/$mod"
    [[ -f "$uproject" ]] || fa_die "нет $uproject"
    fa_check_build_env
    mkdir -p "$out" || fa_die "не создаётся $out"
    FA_BUILD_LOG="$out/build-$mod.log"; FA_BUILD_EXIT=1; FA_BUILD_STAGE=""; FA_BUILD_ARCHIVE=""; FA_BUILD_SHA=""; FA_BUILD_SIZE_MB=""
    FA_BUILD_ORIGIN="каталог проекта SML, вне репозитория"
    local unused pct cook
    # Число процессов компиляции шейдеров (Gs-26): при 16 упирается в память.
    unused=$(( $(nproc) - FA_SHADER_WORKERS )); (( unused < 0 )) && unused=0
    pct=$(( (unused * 100 + $(nproc) - 1) / $(nproc) ))
    cook="-ini:Engine:[DevOptions.Shaders]:NumUnusedShaderCompilingThreads=$unused -ini:Engine:[DevOptions.Shaders]:PercentageUnusedShaderCompilingThreads=$pct"

    _fa_build_locked() {
        local attempt started produced
        if [[ "$sync" == 1 && -f "$src/$mod.uplugin" ]]; then
            FA_BUILD_ORIGIN="репозиторий, \`mod/$mod\`"
            if ! fa_sync_mod_source "$src" "$project/Mods/$mod" "${keeps[@]}"; then
                FA_BUILD_STAGE="подготовка исходников: копирование из репозитория в проект SML не удалось"; FA_BUILD_EXIT=4; return 4
            fi
        fi
        if [[ ! -f "$project/Mods/$mod/$mod.uplugin" ]]; then
            FA_BUILD_STAGE="подготовка исходников: нет $mod.uplugin в проекте SML"; FA_BUILD_EXIT=4; return 4
        fi
        started="$(mktemp)" || { FA_BUILD_STAGE="подготовка: mktemp"; FA_BUILD_EXIT=4; return 4; }
        for attempt in 1 2 3 4 5 6 7 8; do
            "$FA_ENGINE/Engine/Build/BatchFiles/RunUAT.sh" -ScriptsForProject="$uproject" PackagePlugin \
                -Project="$uproject" -dlcname="$mod" -merge -build -clientconfig=Shipping \
                -platform=Win64 -nocompileeditor -installed -AdditionalCookerOptions="$cook" > "$FA_BUILD_LOG" 2>&1
            FA_BUILD_EXIT=$?
            # Кто-то собирает мимо очереди: UBT не ждёт, а выходит. Повторяем.
            grep -q "ConflictingInstance" "$FA_BUILD_LOG" || break
            fa_say "UnrealBuildTool занят сборкой мимо очереди, попытка $attempt, жду 45 с"
            sleep 45
        done
        if [[ $FA_BUILD_EXIT -ne 0 ]]; then FA_BUILD_STAGE="сборка: UAT вернул $FA_BUILD_EXIT"; rm -f "$started"; return "$FA_BUILD_EXIT"; fi
        produced="$project/Saved/ArchivedPlugins/$mod/$mod-Windows.zip"
        # Архив должен быть создан этой сборкой, а не остаться от прошлой.
        if [[ ! -f "$produced" || ! "$produced" -nt "$started" ]]; then
            FA_BUILD_STAGE="упаковка: UAT сообщил успех, но свежего архива нет"; FA_BUILD_EXIT=3; rm -f "$started"; return 3
        fi
        rm -f "$started"
        # Копия в каталог прогона: дальше работаем с ней, а не с файлом, который перезапишет следующая сборка.
        if ! cp "$produced" "$out/$mod-Windows.zip"; then
            FA_BUILD_STAGE="упаковка: архив не копируется в каталог прогона"; FA_BUILD_EXIT=3; return 3
        fi
        FA_BUILD_ARCHIVE="$out/$mod-Windows.zip"
        FA_BUILD_SHA="$(sha256sum "$FA_BUILD_ARCHIVE" | cut -c1-16)"
        FA_BUILD_SIZE_MB=$(( $(stat -c %s "$FA_BUILD_ARCHIVE") / 1048576 ))
        return 0
    }
    fa_say "сборка $mod (Win64 Shipping), лог: $FA_BUILD_LOG"
    fa_with_lock build -x _fa_build_locked
    return "$FA_BUILD_EXIT"
}

# Личная копия игры жёсткими ссылками (места не занимает) и свой префикс Proton. Общую установку не меняет.
# Вызывается только под блокировкой роли.
_fa_game_copy_ensure() {
    local sml_zip="$1" dir="$FA_ROLE_DIR" src manifest buildid
    src="$FA_STEAM_ROOT/steamapps/common/Satisfactory"
    manifest="$FA_STEAM_ROOT/steamapps/appmanifest_$FA_APPID.acf"
    [[ -f "$src/FactoryGameSteam.exe" ]] || { fa_say "игра не найдена в $src"; return 1; }
    buildid="$(grep -o '"buildid"[[:space:]]*"[0-9]*"' "$manifest" 2>/dev/null | grep -o '[0-9]*' || echo unknown)"
    if [[ -d "$dir/game" && "$(cat "$dir/game/.ficsitai-buildid" 2>/dev/null)" != "$buildid" ]]; then
        fa_say "личная копия не соответствует установленной игре (сборка Steam $buildid): пересоздаю"
        rm -rf "$dir/game" || return 1
    fi
    if [[ ! -d "$dir/game" ]]; then
        fa_say "создаю личную копию игры в $dir/game"
        mkdir -p "$dir" || return 1
        cp -al "$src" "$dir/game" 2>/dev/null || { rm -rf "$dir/game"; cp -a --reflink=auto "$src" "$dir/game" || return 1; }
        rm -rf "$dir/game/FactoryGame/Mods"; mkdir -p "$dir/game/FactoryGame/Mods" || return 1
        echo "$buildid" > "$dir/game/.ficsitai-buildid"
    fi
    if [[ ! -d "$dir/compat/pfx" ]]; then
        [[ -d "$FA_STEAM_ROOT/steamapps/compatdata/$FA_APPID/pfx" ]] || { fa_say "нет префикса Proton: запустите игру один раз из Steam"; return 1; }
        fa_say "создаю личный префикс Proton в $dir/compat"
        cp -a "$FA_STEAM_ROOT/steamapps/compatdata/$FA_APPID" "$dir/compat" || return 1
    fi
    if [[ ! -f "$dir/game/FactoryGame/Mods/SML/SML.uplugin" ]]; then
        [[ -f "$sml_zip" ]] || { fa_say "в личной копии нет SML: передайте архив SML-Windows.zip (--sml или FICSITAI_SML_ZIP)"; return 1; }
        mkdir -p "$dir/game/FactoryGame/Mods/SML" && unzip -q "$sml_zip" -d "$dir/game/FactoryGame/Mods/SML" || return 1
    fi
}

# Ставит моды в личную копию, заменяя всё, кроме SML. Только под блокировкой роли.
_fa_install_mods() {
    local mods="$FA_ROLE_DIR/game/FactoryGame/Mods" zip name
    for name in "$mods"/*; do
        [[ -e "$name" ]] || continue
        [[ "$(basename "$name")" == SML ]] || rm -rf "$name" || return 1
    done
    for zip in "$@"; do
        [[ -f "$zip" ]] || { fa_say "нет архива $zip"; return 1; }
        name="$(basename "$zip")"; name="${name%-Windows.zip}"; name="${name%.zip}"
        mkdir -p "$mods/$name" && unzip -q "$zip" -d "$mods/$name" || return 1
        [[ -f "$mods/$name/$name.uplugin" ]] || { fa_say "в архиве $zip нет $name.uplugin в корне"; return 1; }
    done
}

# fa_game_session <секунд> <каталог результата> <-s|-x> <архив SML или ''>
# Моды, переменные окружения и аргументы игры — в массивах FA_G_MODS, FA_G_ENVS, FA_G_ARGS.
# Вся работа с личной копией — подготовка, установка модов, запуск, сохранение журнала — идёт под
# блокировкой роли: второй запуск той же роли ждёт и не трогает ни моды, ни журнал первого.
# Запуск игры дополнительно берёт общую очередь game: -s вместе с другими ролями, -x один на машине.
# Результат: FA_RUN_EXIT (124 — игра дожила до таймера, 97 — подготовка не удалась), FA_RUN_LOG.
FA_G_MODS=(); FA_G_ENVS=(); FA_G_ARGS=()
fa_game_session() {
    local seconds="$1" out="$2" mode="$3" sml_zip="$4"
    local saved="$FA_ROLE_DIR/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved"
    mkdir -p "$out" || fa_die "не создаётся $out"
    FA_RUN_EXIT=97; FA_RUN_LOG="$out/FactoryGame.log"; : > "$FA_RUN_LOG"

    _fa_launch() {
        local envs=() e
        for e in "${FA_G_ENVS[@]}"; do envs+=("--env=$e"); done
        ( cd "$HOME" && flatpak run "${envs[@]}" --command=bash com.valvesoftware.Steam \
            "Projects/ficsitai-$FA_ROLE/launch.sh" "$seconds" "${FA_G_ARGS[@]}" ) > "$out/launch.log" 2>&1
    }
    _fa_session_locked() {
        _fa_game_copy_ensure "$sml_zip" || return 97
        _fa_install_mods "${FA_G_MODS[@]}" || return 97
        rm -f "$saved/Logs/FactoryGame.log"
        cat > "$FA_ROLE_DIR/launch.sh" <<LAUNCH || return 97
#!/usr/bin/env bash
# Создано tools/host/lib.sh. Выполняется внутри песочницы Steam Flatpak.
S="\$HOME/.local/share/Steam"
export STEAM_COMPAT_CLIENT_INSTALL_PATH="\$S"
export STEAM_COMPAT_DATA_PATH="\$HOME/Projects/ficsitai-$FA_ROLE/compat"
export SteamAppId=$FA_APPID SteamGameId=$FA_APPID
T="\$1"; shift
timeout --signal=TERM --kill-after=20 "\$T" \\
  "\$S/steamapps/common/SteamLinuxRuntime_4/_v2-entry-point" --verb=waitforexitandrun -- \\
  "\$S/steamapps/common/Proton - Experimental/proton" waitforexitandrun \\
  "\$HOME/Projects/ficsitai-$FA_ROLE/game/FactoryGameSteam.exe" -windowed -ResX=1280 -ResY=720 -NoSplash -log -FORCELOGFLUSH "\$@"
echo "RUN_EXIT=\$?"
LAUNCH
        chmod +x "$FA_ROLE_DIR/launch.sh"
        fa_say "запуск игры на $seconds с ($([[ "$mode" == "-x" ]] && echo 'один на машине' || echo 'можно рядом с другими ролями'))"
        fa_with_lock game "$mode" _fa_launch
        FA_RUN_EXIT="$(grep -o 'RUN_EXIT=[0-9]*' "$out/launch.log" 2>/dev/null | tail -1 | cut -d= -f2)"; FA_RUN_EXIT="${FA_RUN_EXIT:-1}"
        cp "$saved/Logs/FactoryGame.log" "$FA_RUN_LOG" 2>/dev/null || : > "$FA_RUN_LOG"
        return 0
    }
    fa_with_lock "role-$FA_ROLE" -x _fa_session_locked || FA_RUN_EXIT=97
}

# Разбор журнала игры. Переменные: FA_LOG_CL, FA_LOG_MODS, FA_LOG_FATAL, FA_LOG_PLUGIN_ERRORS, FA_LOG_MENU.
# Главное меню считается достигнутым только по двум строкам настоящего журнала CL 517554:
# движок закончил загрузку карты меню и виджет главного меню начал работать.
fa_parse_game_log() {
    local log="$1"
    FA_LOG_CL="$(grep -o 'Game Changelist: [0-9]*' "$log" | head -1 | grep -o '[0-9]*' || true)"
    FA_LOG_MODS="$(sed -n '/LogSatisfactoryModLoader: Display: List of loaded mods:/,/Discovered .* game instance modules/p' "$log" \
        | grep -o 'Display: [A-Za-z0-9_]*: [0-9][0-9.]*' | sed 's/Display: //' | grep -v '^FactoryGame:' | paste -sd, - | sed 's/,/, /g' || true)"
    FA_LOG_FATAL="$(grep -c -E 'Critical error|Fatal error|Unhandled Exception' "$log" || true)"
    FA_LOG_PLUGIN_ERRORS="$(grep -c 'LogPluginManager: Error' "$log" || true)"
    FA_LOG_MENU=no
    if grep -q 'UEngine::LoadMap Load map complete /Game/FactoryGame/Map/MenuScenes/' "$log" \
        && grep -q 'LogBlueprintUserMessages: \[BP_MainMenuWidget\]' "$log"; then FA_LOG_MENU=yes; fi
}

# Общий вердикт запуска: игра дошла до меню, дожила до таймера, без критических ошибок и ошибок плагинов.
fa_run_ok() {
    [[ "$FA_RUN_EXIT" == 124 && "$FA_LOG_MENU" == yes && "$FA_LOG_FATAL" == 0 && "$FA_LOG_PLUGIN_ERRORS" == 0 ]]
}
