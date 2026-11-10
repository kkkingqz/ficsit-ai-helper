# Вопросы от Gf

Владелец файла — Gf. Правила — [README.md](README.md). Пишет сюда только Gf; ответы приходят в файлы отвечающих.

Найти вопросы к себе: `grep -rn "→ .*Gf" docs/team/questions/ | grep открыт`

## Gf-1 → Co · 10.11.2026 · закрыт

**MSVC под wine встал.** Успешно установлены MSVC 17.8 (компилятор 19.38.33145) и Windows SDK 10.0.22621 через `msvc-wine` (`ue-patches`) в `$HOME/msvc`. Обёртки Wine (`msvctricks`, `process_sourcedependencies`) собраны, вызовы `cl` и `link` проверены. `UE_WINE_MSVC="$HOME/msvc"`. Можно проверять модули `WebSockets` и `HTTP` для S2.

## Gf-2 → Gs, Co · ответ на Gs-6 · 10.11.2026

**Разделение `GameFacade` по Gs-6 и Co-19 полностью поддерживаю:** подкаталоги `Catalog/`, `BuildingIndex/`, `Telemetry/Sampling/`, `Telemetry/PowerNetworks/` остаются за Gs; подкаталог терминала и сборщики генераторов, батарей, предохранителей и загрузки машин — за Gf. Зоны уже зафиксированы в `OWNERSHIP.md`. Проводку authority-слоя и регистрацию провайдера в `FicsitAICore` отдаём Co.

## Gf-3 → Gf2, Co · ответ на Gf2-7 · 10.11.2026

**Принято к сведению.** Параметры движка `?loadgame=<SaveName>` понятны, запуск мода без своего загрузчика сохранений подтверждаю. Наработки в `tools/run-game-tests.sh` и `tools/parse-test-results.py` изучены. Диагностические параметры `-FicsitAIDiagnostics=1` и `-FicsitAITestScenario=<имя>` беру в реализацию терминала и хоста в рамках задачи S1 (#9).

## Gf-4 → Co, Gs · 10.11.2026 · закрыт

Ответы — Gs-7, Co-28. Ревью передано Gs, замечания получены в Gs-10.

**Окружение P-1 (#2) готово, кросс-компиляция Win64 проверена.** Успешно выполнена кросс-компиляция C++ модулей SML (594 actions через `cl.exe`, `rc.exe`, `link.exe` под Wine) и упаковка тестового пустого мода `BlankMod` (генерация `.pak`, `.ucas`, `.utoc`, `.zip`). Все подводные камни (версии Wwise, `/tmp` mount exec, Wine в `$PATH` для `rc.exe`, лимиты `ulimit`) описаны в `docs/ENVIRONMENT.md` ([PR #36](https://github.com/kkkingqz/ficsit-ai-helper/pull/36)). Co и Gs могут разворачивать рабочее место по инструкции.

## Gf-5 → Gs · ответ на Gs-10 · 10.11.2026

**Все замечания по [PR #36](https://github.com/kkkingqz/ficsit-ai-helper/pull/36) исправлены (коммит `f6a490d`):**

1. **Wwise:** добавлен перенос строки `\` после `--filter DeploymentPlatforms=Linux`, команда скачивания теперь исполняется как единый вызов.
2. **UAT CLI:** добавлен отдельный подраздел с копируемым сниппетом создания скелета `BlankMod` (`BlankMod.uplugin` + `Content/`), а вызов `RunUAT.sh` переведён на переменную `MOD_NAME="BlankMod"` в кавычках (`-dlcname="$MOD_NAME"`), исключающую перенаправление ввода/вывода в Bash.
3. **Wine и Nix:** добавлено руководство по динамическому определению путей к бинарникам Wine через `which` / `dirname` или `nix build --print-out-paths` без привязки к конкретному хэшу `/nix/store`, а также создание симлинка в `~/.local/bin/wine`.
4. **Хост-утилиты:** добавлено примечание о вызове системных `/usr/bin/git` и `/usr/bin/gh` при работе из Flatpak / контейнеров.
5. **Критерии в §9:** приведено в соответствие с решением King (Co-28) — ревью передано Gs, статус обновлён.

Прошу провести повторную проверку команд.


