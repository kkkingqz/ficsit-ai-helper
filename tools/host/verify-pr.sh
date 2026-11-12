#!/usr/bin/env bash
# FICSIT AI — протокол проверки для PR: собрать мод под Win64 Shipping и загрузить в игре под Proton.
# Роль: Co.
#
#   tools/host/verify-pr.sh [--project <проект SML>] [--sml <архив SML>] [--extra-mod <архив>]...
#                           [--seconds N] [--keep <шаблон>]... [--no-sync] <ModName> [<ModName>...]
#
# Печатает блок Markdown для вставки в PR. Код возврата 0 — только если исходники подготовлены без ошибок,
# все моды собрались, игра дошла до главного меню, дожила до таймера и не записала критических ошибок.
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
fa_require_role
fa_new_dir runs "verify-"; out="$FA_NEW_DIR"
ok=1; lines=(); zips=(); declare -A want=()

for mod in "${mods[@]}"; do
    if fa_build_mod "$mod" "$project" "$out" "$sync" "${keeps[@]}"; then
        lines+=("- Сборка Win64 Shipping, \`$mod\`: успешно; исходники — $FA_BUILD_ORIGIN; архив ${FA_BUILD_SIZE_MB} МБ, sha256 \`${FA_BUILD_SHA}…\`")
        zips+=("$FA_BUILD_ARCHIVE")
        d="$(_fa_mod_descriptor "$FA_BUILD_ARCHIVE" 2>/dev/null)" && want[$mod]="${d##*$'\t'}"
    else
        ok=0
        first="$(grep -m1 -E 'error [A-Z]+[0-9]+|ERROR:' "$FA_BUILD_LOG" 2>/dev/null | cut -c1-160)"
        lines+=("- Сборка Win64 Shipping, \`$mod\`: **не выполнена** — $FA_BUILD_STAGE; исходники — $FA_BUILD_ORIGIN${first:+; первая ошибка: \`$first\`}")
    fi
done

if [[ $ok -eq 1 ]]; then
    FA_G_MODS=("${extra[@]}" "${zips[@]}")
    fa_game_session "$seconds" "$out" -s "$sml"
    fa_parse_game_log "$FA_RUN_LOG"
    if [[ "$FA_RUN_EXIT" == 97 ]]; then
        lines+=("- Игра: **не запущена** — не удалось подготовить личную копию или установить моды")
    else
        alive="нет, вышла с кодом $FA_RUN_EXIT"; [[ "$FA_RUN_EXIT" == 124 ]] && alive="да"
        menu="нет"; [[ "$FA_LOG_MENU" == yes ]] && menu="да"
        lines+=("- Игра: CL ${FA_LOG_CL:-не определён}, Proton, без клиента Steam; загружены: ${FA_LOG_MODS:-ни одного мода}")
        lines+=("- Запуск на $seconds с: главное меню — $menu; дожила до таймера — $alive; критических ошибок — $FA_LOG_FATAL; ошибок загрузки плагинов — $FA_LOG_PLUGIN_ERRORS")
        # Загружен должен быть именно собранный архив: имя и SemVersion из его дескриптора.
        for mod in "${mods[@]}"; do
            if [[ ", $FA_LOG_MODS," != *", $mod: "* ]]; then
                ok=0; lines+=("- **\`$mod\` нет в списке загруженных модов SML**")
            elif [[ -z "${want[$mod]:-}" ]]; then
                ok=0; lines+=("- **У \`$mod\` в дескрипторе нет \`SemVersion\`** — нельзя проверить, что загружена свежая сборка")
            elif [[ ", $FA_LOG_MODS," != *", $mod: ${want[$mod]},"* ]]; then
                got="$(grep -o "$mod: [^,]*" <<<"$FA_LOG_MODS" | head -1)"
                ok=0; lines+=("- **Загружена не та версия \`$mod\`:** в журнале \`$got\`, в собранном архиве \`${want[$mod]}\`")
            fi
        done
    fi
    fa_run_ok || ok=0
else
    lines+=("- Игра не запускалась: сборка не прошла")
fi

rev="$("$FA_GIT" -C "$FA_REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
branch="$("$FA_GIT" -C "$FA_REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
dirty="чистое"; [[ -n "$("$FA_GIT" -C "$FA_REPO_ROOT" status --porcelain -- mod 2>/dev/null)" ]] && dirty="**есть незакоммиченные правки в \`mod/\`**"
smlrev="$("$FA_GIT" -C "$project" rev-parse --short HEAD 2>/dev/null || echo 'не git')"
{
    echo "**Протокол проверки** · роль ${FA_ROLE^} · $(date '+%d.%m.%Y %H:%M') · \`tools/host/verify-pr.sh\`"
    echo
    echo "- Репозиторий: \`$rev\` (\`$branch\`), рабочее дерево — $dirty"
    echo "- Проект SML: \`${project/#$HOME/\~}\` на \`$smlrev\`"
    printf '%s\n' "${lines[@]}"
    echo "- Не проверялось: загрузка сохранения, поведение в мире, EGS в игре, Windows"
    echo
    [[ $ok -eq 1 ]] && echo "**Итог: пройдено.**" || echo "**Итог: не пройдено.** Журналы: \`${out/#$HOME/\~}\`"
} | tee "$out/protocol.md"
[[ $ok -eq 1 ]]
