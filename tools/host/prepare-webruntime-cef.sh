#!/usr/bin/env bash
# FICSIT AI — бинарники, библиотеки и заголовки CEF для FicsitAIWebRuntime из архива релиза BLUI.
# Роль: Co.
#
#   tools/host/prepare-webruntime-cef.sh <BLUI-v5.1.0-UE5.8.7z> [--project <проект SML>]
#
# CEF в репозиторий не входит (third_party/blui/CHANGES.md). Скрипт сверяет sha256 архива с записанным,
# распаковывает ThirdParty/cef/Win/ в <проект>/Mods/FicsitAIWebRuntime/ и больше ничего не трогает.
# Сборка после этого: tools/host/build-mod.sh FicsitAIWebRuntime --keep ThirdParty --keep Web
# Распаковщик — 7z или bsdtar, что найдётся.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
SHA=f561505c6048f3a3293b9663a2033a6dcd59ac0040313ed5a68c4715c458b669
INNER=Plugins/BLUI-Unreal/ThirdParty/cef/Win
archive=""; project="${FICSITAI_SML_PROJECT:-}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project) project="$2"; shift 2 ;;
        -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
        *) archive="$1"; shift ;;
    esac
done
[[ -f "$archive" ]] || fa_die "нет архива: ${archive:-не задан}"
[[ -n "$project" && -d "$project/Mods" ]] || fa_die "не задан проект SML: --project или FICSITAI_SML_PROJECT"
got="$(sha256sum "$archive" | cut -d' ' -f1)"
[[ "$got" == "$SHA" ]] || fa_die "sha256 архива $got, ожидался $SHA — это не тот релиз BLUI"

dest="$project/Mods/FicsitAIWebRuntime/ThirdParty/cef/Win"
tmp="$(mktemp -d "$project/Saved/blui-cef.XXXXXX")" || fa_die "не создаётся временный каталог"
trap 'rm -rf "$tmp"' EXIT
if command -v 7z >/dev/null; then
    7z x -y -o"$tmp" "$archive" "$INNER/*" >/dev/null || fa_die "7z не распаковал архив"
elif command -v bsdtar >/dev/null; then
    bsdtar -xf "$archive" -C "$tmp" "$INNER" || fa_die "bsdtar не распаковал архив"
else
    fa_die "нужен 7z или bsdtar"
fi
for d in include lib shipping; do [[ -d "$tmp/$INNER/$d" ]] || fa_die "в архиве нет $INNER/$d"; done
rm -rf "$dest" && mkdir -p "$(dirname "$dest")" && mv "$tmp/$INNER" "$dest" || fa_die "не удалось положить CEF в $dest"
fa_say "CEF из BLUI v5.1.0: $(du -sh "$dest" | cut -f1) в $dest"
