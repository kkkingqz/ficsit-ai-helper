# `FicsitAIWebRuntime` — мод-библиотека встроенного браузера

BLUI (форк getnamo, v5.1.0, MIT) и CEF 128 отдельным модом-библиотекой: основной мод объявляет её зависимостью, менеджер модов ставит вместе с ним. Вынесена отдельно не ради размера поставки (он ограничением не считается), а чтобы CEF обновлялся независимо от мода — ARCHITECTURE §6.3.1.

**Решение по ADR-032 принимается на воротах W** по итогам спайка S8 ([#8](https://github.com/kkkingqz/ficsit-ai-helper/issues/8)). При отклонении экраны остаются на UMG, а этот каталог и `web/` удаляются целиком.

| Что | Где |
|---|---|
| Исходники `Blu` и `BluLoader` — BLUI с нашими правками | `Source/` |
| Происхождение, лицензии, перечень правок | [`third_party/blui/`](../../third_party/blui/CHANGES.md) |
| Лицензии для поставки | `LICENSE-BLUI`, `CREDITS-BLUI.md`, `LICENSE-CEF` |
| Бинарники, библиотеки и заголовки CEF | **не в репозитории**: `ThirdParty/cef/Win/` из архива релиза |
| Страницы на время спайка | **не в репозитории**: `Web/` плагина. Страницы спайка — в `web/spikes/s8/` |

## Сборка

```bash
tools/host/prepare-webruntime-cef.sh <архив BLUI-v5.1.0-UE5.8.7z>
tools/host/build-mod.sh FicsitAIWebRuntime --keep ThirdParty --keep Web
```

Первый скрипт сверяет sha256 архива и кладёт `ThirdParty/cef/Win/` в плагин внутри проекта SML (`FICSITAI_SML_PROJECT`). `--keep` при сборке оставляет в проекте то, чего нет в репозитории: CEF и страницы.
