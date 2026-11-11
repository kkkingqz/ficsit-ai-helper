#!/usr/bin/env bash
# FICSIT AI — выполнить любую команду под общей очередью машины.
# Роль: Co.
#
#   tools/host/with-lock.sh build -- <команда сборки, редактор, cook>
#   tools/host/with-lock.sh game  -- <запуск игры для замера>
#
# Для того, что не идёт через build-mod.sh и run-game.sh: сборка редактора, UnrealEditor-Cmd с тестами,
# cook с компиляцией шейдеров. Вторая роль не падает на блокировке UnrealBuildTool, а ждёт.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[[ $# -ge 3 && "$2" == "--" ]] || { echo "Использование: $(basename "$0") <build|game> -- <команда...>" >&2; exit 2; }
name="$1"; shift 2
[[ "$name" == build || "$name" == game ]] || fa_die "очередь '$name' неизвестна: build или game"
fa_with_lock "$name" -x "$@"
