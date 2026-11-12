#!/usr/bin/env bash
# FICSIT AI — сборка мода под Win64 Shipping под общей очередью сборок.
# Роль: Co.
#
#   tools/host/build-mod.sh <ModName> [--project <проект SML>] [--out <каталог>] [--no-sync] [--keep <шаблон>]...
#
# Проект SML: --project или FICSITAI_SML_PROJECT (личная копия Starter Project роли, ENVIRONMENT.md §5).
# Если в репозитории есть mod/<ModName>/<ModName>.uplugin, исходники мода в проекте сначала приводятся
# к дереву репозитория: собирается то, что лежит в рабочей копии. --keep сохраняет в проекте то, чего
# в репозитории быть не должно (например, --keep ThirdParty для бинарников CEF).
# Архив копируется в каталог результата; путь к копии печатается в ARCHIVE=.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
mod=""; project="${FICSITAI_SML_PROJECT:-}"; sync=1; keeps=(); out=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project) project="$2"; shift 2 ;;
        --out) out="$2"; shift 2 ;;
        --no-sync) sync=0; shift ;;
        --keep) keeps+=("$2"); shift 2 ;;
        -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
        *) mod="$1"; shift ;;
    esac
done
[[ -n "$mod" ]] || fa_die "не задано имя мода"
[[ -n "$project" ]] || fa_die "не задан проект SML: --project или FICSITAI_SML_PROJECT"
fa_require_role
if [[ -z "$out" ]]; then fa_new_dir builds ""; out="$FA_NEW_DIR"; fi
fa_build_mod "$mod" "$project" "$out" "$sync" "${keeps[@]}"
echo "BUILD_EXIT=$FA_BUILD_EXIT"
echo "SOURCE=$FA_BUILD_ORIGIN"
echo "LOG=$FA_BUILD_LOG"
if [[ $FA_BUILD_EXIT -eq 0 ]]; then
    echo "ARCHIVE=$FA_BUILD_ARCHIVE"; echo "SHA256_16=$FA_BUILD_SHA"; echo "SIZE_MB=$FA_BUILD_SIZE_MB"
else
    echo "FAILED_AT=$FA_BUILD_STAGE"
fi
exit "$FA_BUILD_EXIT"
