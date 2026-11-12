#!/usr/bin/env bash
# FICSIT AI — запуск игры под Proton в личной копии роли.
# Роль: Co.
#
#   tools/host/run-game.sh [--mod <архив>]... [--seconds N] [--exclusive] [--out <каталог>]
#                          [--sml <архив SML>] [--env KEY=VALUE]... [-- <аргументы игры>]
#
# Создаёт при первом запуске личную копию игры и префикс Proton, ставит в неё перечисленные моды
# (всё прежнее, кроме SML, убирается), запускает игру на N секунд и собирает журнал. Архив мода — zip с одним
# дескриптором .uplugin в корне; имя мода берётся из дескриптора, имя файла архива любое.
# Второй запуск той же роли ждёт первого. --exclusive — для замеров: ждёт, пока на машине
# не останется запусков других ролей, и не пускает новые.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
seconds=120; mode=-s; out=""; sml="${FICSITAI_SML_ZIP:-}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mod) FA_G_MODS+=("$2"); shift 2 ;;
        --seconds) seconds="$2"; shift 2 ;;
        --exclusive) mode=-x; shift ;;
        --out) out="$2"; shift 2 ;;
        --sml) sml="$2"; shift 2 ;;
        --env) FA_G_ENVS+=("$2"); shift 2 ;;
        --) shift; FA_G_ARGS=("$@"); break ;;
        -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
        *) fa_die "неизвестный параметр $1" ;;
    esac
done
fa_require_role
if [[ -z "$out" ]]; then fa_new_dir runs ""; out="$FA_NEW_DIR"; fi
fa_game_session "$seconds" "$out" "$mode" "$sml"
fa_parse_game_log "$FA_RUN_LOG"
echo "RUN_EXIT=$FA_RUN_EXIT"
echo "GAME_CL=$FA_LOG_CL"
echo "MODS=$FA_LOG_MODS"
echo "MAIN_MENU=$FA_LOG_MENU"
echo "FATAL=$FA_LOG_FATAL"
echo "PLUGIN_ERRORS=$FA_LOG_PLUGIN_ERRORS"
echo "LOG=$FA_RUN_LOG"
fa_run_ok
