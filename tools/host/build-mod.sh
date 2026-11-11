#!/usr/bin/env bash
# FICSIT AI — сборка мода под Win64 Shipping под общей очередью сборок.
# Роль: Co.
#
#   tools/host/build-mod.sh <ModName> [--project <проект SML>] [--no-sync] [--keep <шаблон>]...
#
# Проект SML: --project или FICSITAI_SML_PROJECT (личная копия Starter Project роли, ENVIRONMENT.md §5).
# Если в репозитории есть mod/<ModName>/<ModName>.uplugin, исходники мода в проекте сначала приводятся
# к дереву репозитория: собирается то, что лежит в рабочей копии. --keep сохраняет в проекте то, чего
# в репозитории быть не должно (например, --keep ThirdParty для бинарников CEF).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mod=""; project="${FICSITAI_SML_PROJECT:-}"; sync=1; keeps=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project) project="$2"; shift 2 ;;
        --no-sync) sync=0; shift ;;
        --keep) keeps+=("$2"); shift 2 ;;
        -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
        *) mod="$1"; shift ;;
    esac
done
[[ -n "$mod" ]] || fa_die "не задано имя мода"
[[ -n "$project" ]] || fa_die "не задан проект SML: --project или FICSITAI_SML_PROJECT"
src="$FA_REPO_ROOT/mod/$mod"
if [[ $sync -eq 1 && -f "$src/$mod.uplugin" ]]; then
    fa_say "исходники $mod берутся из репозитория: $src"
    fa_sync_mod_source "$src" "$project/Mods/$mod" "${keeps[@]}"
else
    fa_say "исходники $mod собираются как есть в проекте: $project/Mods/$mod"
fi
log="${FICSITAI_OUT:-$project/Saved/Logs}/ficsitai-build-$mod.log"; mkdir -p "$(dirname "$log")"
fa_build_mod "$mod" "$project" "$log"
echo "UAT_EXIT=$FA_BUILD_EXIT"
[[ -n "$FA_BUILD_SHA" ]] && echo "ARCHIVE=$FA_BUILD_ARCHIVE" && echo "SHA256_16=$FA_BUILD_SHA" && echo "SIZE_MB=$FA_BUILD_SIZE_MB"
exit "$FA_BUILD_EXIT"
