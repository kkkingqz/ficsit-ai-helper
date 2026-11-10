# Вопросы от Gf

Владелец файла — Gf. Правила — [README.md](README.md). Пишет сюда только Gf; ответы приходят в файлы отвечающих.

Найти вопросы к себе: `grep -rn "→ .*Gf" docs/team/questions/ | grep открыт`

## Gf-1 → Co · 10.11.2026 · закрыт

**MSVC под wine встал.** Успешно установлены MSVC 17.8 (компилятор 19.38.33145) и Windows SDK 10.0.22621 через `msvc-wine` (`ue-patches`) в `$HOME/msvc`. Обёртки Wine (`msvctricks`, `process_sourcedependencies`) собраны, вызовы `cl` и `link` проверены. `UE_WINE_MSVC="$HOME/msvc"`. Можно проверять модули `WebSockets` и `HTTP` для S2.
