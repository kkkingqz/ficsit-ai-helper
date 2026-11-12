#!/usr/bin/env bash
# FICSIT AI — самопроверка tools/host/ без движка и без игры.
# Роль: Co.
#
#   tools/host/selftest.sh
#
# Подменяет UAT, Flatpak, wine и установку Steam заглушками во временном каталоге и проверяет ветки отказа,
# найденные на ревью #42: ошибка копирования исходников, устаревший архив, зависание до главного меню,
# критическая ошибка в журнале, неполученная блокировка, неопределённая роль, два запуска одной роли.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
check() { if [[ "$2" == "$3" ]]; then pass=$((pass+1)); echo "  ok    $1"; else fail=$((fail+1)); echo "  FAIL  $1: ожидалось '$3', получено '$2'"; fi; }

# --- заглушки -------------------------------------------------------------------------------------
mkdir -p "$T/bin" "$T/msvc/bin/x64" "$T/engine/Engine/Build/BatchFiles/Linux" "$T/proj/Mods" "$T/repo/tools" "$T/repo/mod/TestMod/Source"
cp -r "$HERE" "$T/repo/tools/host"
echo '{}' > "$T/repo/mod/TestMod/TestMod.uplugin"; echo 'int a;' > "$T/repo/mod/TestMod/Source/a.cpp"
touch "$T/proj/FactoryGame.uproject"
for f in "$T/bin/wine" "$T/msvc/bin/x64/cl" "$T/msvc/bin/x64/rc.exe"; do printf '#!/bin/sh\nexit 0\n' > "$f"; chmod +x "$f"; done
# UAT: по STUB_UAT — ok (свежий архив), stale (архив не трогает), fail (код 6). Архив содержит исходники проекта.
cat > "$T/engine/Engine/Build/BatchFiles/RunUAT.sh" <<'STUB'
#!/usr/bin/env bash
proj=""; mod=""
for a in "$@"; do case "$a" in -Project=*) proj="$(dirname "${a#-Project=}")";; -dlcname=*) mod="${a#-dlcname=}";; esac; done
[[ -n "${STUB_UAT_SLEEP:-}" ]] && sleep "$STUB_UAT_SLEEP"
case "${STUB_UAT:-ok}" in
  fail) echo "error C1234: stub"; exit 6 ;;
  stale) exit 0 ;;
esac
[[ -f "$proj/Mods/$mod/Source/a.cpp" ]] || { echo "ERROR: no Source"; exit 7; }
mkdir -p "$proj/Saved/ArchivedPlugins/$mod" && cd "$proj/Mods/$mod" && rm -f "$proj/Saved/ArchivedPlugins/$mod/$mod-Windows.zip" \
  && zip -q -r "$proj/Saved/ArchivedPlugins/$mod/$mod-Windows.zip" . && exit 0
exit 8
STUB
chmod +x "$T/engine/Engine/Build/BatchFiles/RunUAT.sh"
# Сборка редактора: по STUB_EDITOR — ok или fail (код 6).
printf '#!/bin/sh\n[ "${STUB_EDITOR:-ok}" = fail ] && { echo "error: stub editor"; exit 6; }\nexit 0\n' > "$T/engine/Engine/Build/BatchFiles/Linux/Build.sh"
chmod +x "$T/engine/Engine/Build/BatchFiles/Linux/Build.sh"
# Flatpak: пишет журнал игры по STUB_GAME — menu, hang (до меню не дошла), fatal; печатает RUN_EXIT.
cat > "$T/bin/flatpak" <<'STUB'
#!/usr/bin/env bash
saved="$STUB_SAVED"; mkdir -p "$saved/Logs"; log="$saved/Logs/FactoryGame.log"
[[ -n "${STUB_GAME_SLEEP:-}" ]] && sleep "$STUB_GAME_SLEEP"
mods="$(ls "$STUB_MODS" | grep -v '^SML$' | head -1)"
{
  echo "LogSatisfactoryModLoader: Display: Version check passed successfully! Game Changelist: 517554"
  echo "LogSatisfactoryModLoader: Display: List of loaded mods:"
  [[ -n "$mods" ]] && echo "LogSatisfactoryModLoader: Display: $mods: 0.1.0"
  echo "LogSatisfactoryModLoader: Display: FactoryGame: 517554.0.0"
  echo "LogSatisfactoryModLoader: Display: SML: 3.12.0"
  echo "LogSatisfactoryModLoader: Discovered 1 game instance modules"
  echo "[2026.11.11-10.00.00:000][  1]LogInit: one frame, no menu"
  if [[ "${STUB_GAME:-menu}" != hang ]]; then
    echo "[2026.11.11-10.00.01:000][  0]LogGlobalStatus: UEngine::LoadMap Load map complete /Game/FactoryGame/Map/MenuScenes/Map_Menu_1_02"
    echo "[2026.11.11-10.00.02:000][  3]LogBlueprintUserMessages: [BP_MainMenuWidget] Offline LastWidget: "
  fi
  [[ "${STUB_GAME:-menu}" == fatal ]] && echo "LogWindows: Error: Fatal error!"
} > "$log"
echo "MODS_AT_LAUNCH=$mods"
echo "RUN_EXIT=124"
STUB
chmod +x "$T/bin/flatpak"
S="$T/steam"; mkdir -p "$S/.local/share/Steam/steamapps/common/Satisfactory/FactoryGame" "$S/.local/share/Steam/steamapps/compatdata/526870/pfx"
touch "$S/.local/share/Steam/steamapps/common/Satisfactory/FactoryGameSteam.exe"
echo '"buildid" "1"' > "$S/.local/share/Steam/steamapps/appmanifest_526870.acf"
mkdir -p "$T/sml" && echo '{}' > "$T/sml/SML.uplugin" && ( cd "$T/sml" && zip -q "$T/SML-Windows.zip" SML.uplugin )

export PATH="$T/bin:$PATH" UE_WINE_MSVC="$T/msvc" FICSITAI_ENGINE="$T/engine" FICSITAI_STEAM_APP="$S" \
       FICSITAI_LOCK_DIR="$T/locks" FICSITAI_ROLE=test FICSITAI_GIT=/bin/false HOME="$T/home"
mkdir -p "$HOME"
export STUB_SAVED="$S/Projects/ficsitai-test/compat/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved"
export STUB_MODS="$S/Projects/ficsitai-test/game/FactoryGame/Mods"
V="$T/repo/tools/host/verify-pr.sh"; ARGS=(--project "$T/proj" --sml "$T/SML-Windows.zip" --seconds 1 TestMod)
run() { "$@" > "$T/out.txt" 2>&1; echo $?; }

echo "1. Протокол"
check "успешный прогон возвращает 0" "$(run "$V" "${ARGS[@]}")" 0
check "исходники взяты из репозитория" "$(grep -c 'исходники — репозиторий' "$T/out.txt")" 1
check "ошибка сборки редактора отклоняется" "$(STUB_EDITOR=fail run "$V" "${ARGS[@]}")" 1
check "причина названа в протоколе" "$(grep -c 'сборка редактора Linux для cook' "$T/out.txt")" 1
check "ошибка UAT отклоняется" "$(STUB_UAT=fail run "$V" "${ARGS[@]}")" 1
check "старый архив при коде UAT 0 отклоняется" "$(STUB_UAT=stale run "$V" "${ARGS[@]}")" 1
check "зависание до главного меню отклоняется" "$(STUB_GAME=hang run "$V" "${ARGS[@]}")" 1
check "в протоколе «главное меню — нет»" "$(grep -c 'главное меню — нет' "$T/out.txt")" 1
check "критическая ошибка игры отклоняется" "$(STUB_GAME=fatal run "$V" "${ARGS[@]}")" 1

echo "2. Ошибка копирования исходников (замечание 1)"
printf '#!/bin/sh\ncase "$*" in *mod/TestMod/Source*) exit 1;; esac\nexec /bin/cp "$@"\n' > "$T/bin/cp"; chmod +x "$T/bin/cp"
check "протокол не пройден" "$(run "$V" "${ARGS[@]}")" 1
check "причина названа в протоколе" "$(grep -c 'подготовка исходников' "$T/out.txt")" 1
check "UAT не запускался" "$(ls "$T"/steam/Projects/ficsitai-test/runs/*/build-TestMod.log 2>/dev/null | tail -1 | xargs -r cat | wc -c)" 0
rm -f "$T/bin/cp"

echo "3. Исходники и архив под блокировкой сборки (замечание 2)"
B="$T/repo/tools/host/build-mod.sh"
( STUB_UAT_SLEEP=2 "$B" TestMod --project "$T/proj" --out "$T/b1" > "$T/b1.txt" 2>&1 ) &
sleep 0.7
echo 'int changed;' > "$T/repo/mod/TestMod/Source/a.cpp"
"$B" TestMod --project "$T/proj" --out "$T/b2" > "$T/b2.txt" 2>&1; wait
check "первая сборка собрала свои исходники" "$(unzip -p "$T/b1/TestMod-Windows.zip" Source/a.cpp)" "int a;"
check "вторая сборка собрала свои" "$(unzip -p "$T/b2/TestMod-Windows.zip" Source/a.cpp)" "int changed;"
check "вторая ждала в очереди" "$(grep -c "очередь 'build' занята" "$T/b2.txt")" 1

echo "3а. Два запуска без --out в одну секунду (второе ревью)"
printf '#!/bin/sh\ncase "$*" in *%%Y%%m%%d-%%H%%M%%S*) echo 20261111-120000;; *) exec /bin/date "$@";; esac\n' > "$T/bin/date"; chmod +x "$T/bin/date"
echo 'int first;' > "$T/repo/mod/TestMod/Source/a.cpp"
"$B" TestMod --project "$T/proj" > "$T/s1.txt" 2>&1
echo 'int second;' > "$T/repo/mod/TestMod/Source/a.cpp"
"$B" TestMod --project "$T/proj" > "$T/s2.txt" 2>&1
A1="$(grep -o 'ARCHIVE=.*' "$T/s1.txt" | cut -d= -f2)"; A2="$(grep -o 'ARCHIVE=.*' "$T/s2.txt" | cut -d= -f2)"
check "каталоги результата разные" "$([[ -n "$A1" && "$A1" != "$A2" ]] && echo yes || echo no)" yes
check "архив первой сборки не перезаписан" "$(unzip -p "$A1" Source/a.cpp)" "int first;"
rm -f "$T/bin/date"

echo "4. Два запуска одной роли (замечание 3)"
R="$T/repo/tools/host/run-game.sh"
( cd "$T" && mkdir -p m1 m2 && echo '{}' > m1/ModA.uplugin && echo '{}' > m2/ModB.uplugin && (cd m1 && zip -q ../ModA-Windows.zip ModA.uplugin) && (cd m2 && zip -q ../ModB-Windows.zip ModB.uplugin) )
( STUB_GAME_SLEEP=2 "$R" --exclusive --mod "$T/ModA-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r1" > "$T/r1.txt" 2>&1 ) &
sleep 0.7
"$R" --mod "$T/ModB-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r2" > "$T/r2.txt" 2>&1; wait
check "первый запуск увидел свой мод" "$(grep -o 'MODS_AT_LAUNCH=.*' "$T/r1/launch.log")" "MODS_AT_LAUNCH=ModA"
check "журнал первого запуска — про его мод" "$(grep -c 'Display: ModA: ' "$T/r1/FactoryGame.log")" 1
check "второй запуск увидел свой мод" "$(grep -o 'MODS_AT_LAUNCH=.*' "$T/r2/launch.log")" "MODS_AT_LAUNCH=ModB"
check "второй ждал блокировку роли" "$(grep -c "очередь 'role-test' занята" "$T/r2.txt")" 1

echo "4а. Запуски разных ролей: обычные идут вместе, замер — один"
( STUB_GAME_SLEEP=2 "$R" --mod "$T/ModA-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r3" > "$T/r3.txt" 2>&1 ) &
sleep 0.7
STUB_SAVED="${STUB_SAVED/ficsitai-test/ficsitai-other}" STUB_MODS="${STUB_MODS/ficsitai-test/ficsitai-other}" FICSITAI_ROLE=other \
    "$R" --mod "$T/ModB-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r4" > "$T/r4.txt" 2>&1; wait
check "обычный запуск другой роли не ждёт" "$(grep -c "очередь 'game' занята" "$T/r4.txt")" 0
( STUB_GAME_SLEEP=2 "$R" --exclusive --mod "$T/ModA-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r5" > "$T/r5.txt" 2>&1 ) &
sleep 0.7
STUB_SAVED="${STUB_SAVED/ficsitai-test/ficsitai-other}" STUB_MODS="${STUB_MODS/ficsitai-test/ficsitai-other}" FICSITAI_ROLE=other \
    "$R" --mod "$T/ModB-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r6" > "$T/r6.txt" 2>&1; wait
check "при замере другая роль ждёт" "$(grep -c "очередь 'game' занята" "$T/r6.txt")" 1

echo "4б. Мод с GameFeature ставится в Mods/GameFeatures (второе ревью)"
( cd "$T" && mkdir -p gf && printf '{\n\t"FileVersion": 3,\n\t"GameFeature" : true\n}\n' > gf/FeatMod.uplugin && (cd gf && zip -q ../FeatMod-Windows.zip FeatMod.uplugin) )
"$R" --mod "$T/FeatMod-Windows.zip" --mod "$T/ModA-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r7" > "$T/r7.txt" 2>&1
check "GameFeature-мод в GameFeatures" "$([[ -f "$STUB_MODS/GameFeatures/FeatMod/FeatMod.uplugin" ]] && echo yes || echo no)" yes
check "его нет в корне Mods" "$([[ -e "$STUB_MODS/FeatMod" ]] && echo yes || echo no)" no
check "обычный мод в корне Mods" "$([[ -f "$STUB_MODS/ModA/ModA.uplugin" ]] && echo yes || echo no)" yes
"$R" --mod "$T/ModB-Windows.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r8" > "$T/r8.txt" 2>&1
check "следующий запуск убирает прежний GameFeature-мод" "$([[ -e "$STUB_MODS/GameFeatures/FeatMod" ]] && echo yes || echo no)" no

echo "4в. Каталог мода — по корневому полю GameFeature и имени дескриптора (третье ревью)"
mkdir -p "$T/d1" "$T/d2" "$T/d3"
printf '{"GameFeature":false,"CustomMetadata":{"GameFeature":true}}' > "$T/d1/NestMod.uplugin"
printf '{"\\u0047ameFeature":true}' > "$T/d2/EscMod.uplugin"
printf '{}' > "$T/d3/One.uplugin"; printf '{}' > "$T/d3/Two.uplugin"
( cd "$T/d1" && zip -q ../download.zip NestMod.uplugin ) && ( cd "$T/d2" && zip -q ../EscMod.smod EscMod.uplugin ) && ( cd "$T/d3" && zip -q ../two.zip One.uplugin Two.uplugin )
"$R" --mod "$T/download.zip" --mod "$T/EscMod.smod" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r9" > "$T/r9.txt" 2>&1
check "вложенное GameFeature не переносит мод" "$([[ -f "$STUB_MODS/NestMod/NestMod.uplugin" && ! -e "$STUB_MODS/GameFeatures/NestMod" ]] && echo yes || echo no)" yes
check "экранированное имя поля распознано" "$([[ -f "$STUB_MODS/GameFeatures/EscMod/EscMod.uplugin" && ! -e "$STUB_MODS/EscMod" ]] && echo yes || echo no)" yes
check "архив с двумя дескрипторами отклонён" "$([[ "$(run "$R" --mod "$T/two.zip" --sml "$T/SML-Windows.zip" --seconds 1 --out "$T/r10")" != 0 ]] && echo yes || echo no)" yes
check "причина названа" "$(grep -c 'ровно один .uplugin' "$T/out.txt")" 1

echo "5. Блокировка и роль (замечание 5)"
W="$T/repo/tools/host/with-lock.sh"
printf '#!/bin/sh\nexit 1\n' > "$T/bin/flock"; chmod +x "$T/bin/flock"
check "без блокировки команда не выполняется" "$(run "$W" build -- touch "$T/ran-without-lock")" 2
check "файл не создан" "$([[ -e "$T/ran-without-lock" ]] && echo yes || echo no)" no
rm -f "$T/bin/flock"
check "без роли скрипт останавливается" "$(FICSITAI_ROLE= run "$W" build -- touch "$T/ran-without-role")" 2
check "файл не создан" "$([[ -e "$T/ran-without-role" ]] && echo yes || echo no)" no
check "общий каталог ролей не создан" "$([[ -e "$S/Projects/ficsitai-" ]] && echo yes || echo no)" no

echo; echo "Итог: пройдено $pass, не пройдено $fail"
[[ $fail -eq 0 ]]
