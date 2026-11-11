#!/usr/bin/env bash
# FICSIT AI — протокол проверки для PR: собрать мод под Win64 Shipping и загрузить в игре под Proton.
# Роль: Co.
#
#   tools/host/verify-pr.sh [--project <проект SML>] [--sml <архив SML>] [--extra-mod <архив>]...
#                           [--seconds N] [--keep <шаблон>]... [--no-sync] <ModName> [<ModName>...]
#
# Печатает блок Markdown для вставки в PR. Код возврата 0 — только если все моды собрались,
# игра дошла до главного меню, дожила до таймера и не записала ни одной критической ошибки.
# Ревью начинается при наличии этого блока в PR (решение King 11.11.2026).
#
# Что протокол НЕ проверяет: загрузку сохранения, поведение мода в мире, EGS-сборку в игре, Windows.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
project="${FICSITAI_SML_PROJECT:-}"; sml="${FICSITAI_SML_ZIP:-}"; extra=(); seconds=120; keeps=(); sync=1; mods=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project) project="$2"; shift 2 ;;
        --sml) sml="$2"; shift 2 ;;
        --extra-mod) extra+=("$2"); shift 2 ;;
        --seconds) seconds="$2"; shift 2 ;;
        --keep) keeps+=("$2"); shift 2 ;;
        --no-sync) sync=0; shift ;;
        -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
        *) mods+=("$1"); shift ;;
    esac
done
[[ ${#mods[@]} -gt 0 ]] || fa_die "не задан ни один мод"
[[ -n "$project" ]] || fa_die "не задан проект SML: --project или FICSITAI_SML_PROJECT"
role="$(fa_role)"; out="$(fa_role_dir)/runs/verify-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$out"
ok=1; lines=(); zips=()

for mod in "${mods[@]}"; do
    src="$FA_REPO_ROOT/mod/$mod"; origin="каталог проекта SML, вне репозитория"
    if [[ $sync -eq 1 && -f "$src/$mod.uplugin" ]]; then
        fa_sync_mod_source "$src" "$project/Mods/$mod" "${keeps[@]}"
        origin="репозиторий, \`mod/$mod\`"
    fi
    if fa_build_mod "$mod" "$project" "$out/build-$mod.log"; then
        lines+=("- Сборка Win64 Shipping, \`$mod\`: успешно; исходники — $origin; архив ${FA_BUILD_SIZE_MB} МБ, sha256 \`${FA_BUILD_SHA}…\`")
        zips+=("$FA_BUILD_ARCHIVE")
    else
        ok=0
        lines+=("- Сборка Win64 Shipping, \`$mod\`: **ошибка**, код $FA_BUILD_EXIT; исходники — $origin; первая ошибка: \`$(grep -m1 -E 'error [A-Z]+[0-9]+|ERROR:' "$out/build-$mod.log" | cut -c1-160)\`")
    fi
done

if [[ $ok -eq 1 ]]; then
    fa_game_copy_ensure "$sml"
    fa_install_mods "${extra[@]}" "${zips[@]}"
    fa_run_game "$seconds" "$out" -s --
    fa_parse_game_log "$FA_RUN_LOG"
    alive="нет, вышла с кодом $FA_RUN_EXIT"; [[ "$FA_RUN_EXIT" == 124 ]] && alive="да"
    menu="нет"; [[ "$FA_LOG_MENU" == yes ]] && menu="да"
    lines+=("- Игра: CL ${FA_LOG_CL:-не определён}, Proton, без клиента Steam; загружены: ${FA_LOG_MODS:-ни одного мода}")
    lines+=("- Запуск на $seconds с: главное меню — $menu; дожила до таймера — $alive; критических ошибок — $FA_LOG_FATAL; ошибок загрузки плагинов — $FA_LOG_PLUGIN_ERRORS")
    [[ "$FA_RUN_EXIT" == 124 && "$FA_LOG_MENU" == yes && "$FA_LOG_FATAL" == 0 && "$FA_LOG_PLUGIN_ERRORS" == 0 ]] || ok=0
    for mod in "${mods[@]}"; do
        [[ ", $FA_LOG_MODS," == *", $mod: "* ]] || { ok=0; lines+=("- **\`$mod\` нет в списке загруженных модов SML**"); }
    done
else
    lines+=("- Игра не запускалась: сборка не прошла")
fi

rev="$("$FA_GIT" -C "$FA_REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
branch="$("$FA_GIT" -C "$FA_REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
dirty="чистое"; [[ -n "$("$FA_GIT" -C "$FA_REPO_ROOT" status --porcelain -- mod 2>/dev/null)" ]] && dirty="**есть незакоммиченные правки в \`mod/\`**"
smlrev="$("$FA_GIT" -C "$project" rev-parse --short HEAD 2>/dev/null || echo 'не git')"
{
    echo "**Протокол проверки** · роль ${role^} · $(date '+%d.%m.%Y %H:%M') · \`tools/host/verify-pr.sh\`"
    echo
    echo "- Репозиторий: \`$rev\` (\`$branch\`), рабочее дерево — $dirty"
    echo "- Проект SML: \`${project/#$HOME/\~}\` на \`$smlrev\`"
    printf '%s\n' "${lines[@]}"
    echo "- Не проверялось: загрузка сохранения, поведение в мире, EGS в игре, Windows"
    echo
    [[ $ok -eq 1 ]] && echo "**Итог: пройдено.**" || echo "**Итог: не пройдено.** Журналы: \`${out/#$HOME/\~}\`"
} | tee "$out/protocol.md"
[[ $ok -eq 1 ]]
