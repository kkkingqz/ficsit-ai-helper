#!/usr/bin/env bash
# FICSIT AI — запуск игры под Proton в личной копии роли.
# Роль: Co.
#
#   tools/host/run-game.sh [--mod <архив>]... [--seconds N] [--exclusive] [--out <каталог>]
#                          [--sml <архив SML>] [--env KEY=VALUE]... [-- <аргументы игры>]
#
# Создаёт при первом запуске личную копию игры и префикс Proton, ставит в неё перечисленные моды
# (всё прежнее, кроме SML, убирается), запускает игру на N секунд и собирает журнал.
# --exclusive — для замеров: ждёт, пока на машине не останется других запусков игры, и не пускает новые.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mods=(); seconds=120; mode=-s; out=""; sml="${FICSITAI_SML_ZIP:-}"; envs=(); args=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --mod) mods+=("$2"); shift 2 ;;
        --seconds) seconds="$2"; shift 2 ;;
        --exclusive) mode=-x; shift ;;
        --out) out="$2"; shift 2 ;;
        --sml) sml="$2"; shift 2 ;;
        --env) envs+=("$2"); shift 2 ;;
        --) shift; args=("$@"); break ;;
        -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
        *) fa_die "неизвестный параметр $1" ;;
    esac
done
out="${out:-$(fa_role_dir)/runs/$(date +%Y%m%d-%H%M%S)}"
fa_game_copy_ensure "$sml"
fa_install_mods "${mods[@]}"
fa_run_game "$seconds" "$out" "$mode" "${envs[@]}" -- "${args[@]}"
fa_parse_game_log "$FA_RUN_LOG"
echo "RUN_EXIT=$FA_RUN_EXIT"
echo "GAME_CL=$FA_LOG_CL"
echo "MODS=$FA_LOG_MODS"
echo "MAIN_MENU=$FA_LOG_MENU"
echo "FATAL=$FA_LOG_FATAL"
echo "PLUGIN_ERRORS=$FA_LOG_PLUGIN_ERRORS"
echo "LOG=$FA_RUN_LOG"
[[ "$FA_RUN_EXIT" == 124 && "$FA_LOG_MENU" == yes && "$FA_LOG_FATAL" == 0 && "$FA_LOG_PLUGIN_ERRORS" == 0 ]]
