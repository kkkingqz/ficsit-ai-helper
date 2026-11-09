# `mod/` — плагины SML

Подключаются в `Mods/` стартового проекта SML. Раскладка — по [плану §10](../docs/PLAN-v0.1.md).

| Каталог | Что внутри |
|---|---|
| `FicsitAI/Source/FicsitAIApi/` | интерфейсы и типы контрактов, `apiVersion` |
| `FicsitAI/Source/FicsitAIUI/` | хост, каркас терминала, веб-контейнер или UMG-экраны |
| `FicsitAI/Source/FicsitAICore/GameFacade/` | **единственное** место типов `AFG*`/`UFG*` (ADR-029) |
| `FicsitAI/Source/FicsitAICore/core/` | логика без Unreal, собирается и на хосте через CMake |
| `FicsitAIWebRuntime/` | мод-библиотека BLUI и CEF — только если ADR-032 принят на воротах W |

Инварианты проверяет CI (`tools/`): `AFG*`/`UFG*` только в `GameFacade/`, `FicsitAIUI` — без заголовков игры и SML. Каждый PR в мод проходит ревью Co, см. [CONTRIBUTING.md](../CONTRIBUTING.md).
