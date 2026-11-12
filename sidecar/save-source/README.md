# `@ficsitai/save-source`

Библиотечный источник данных `Save` и `SaveEstimated` для FICSIT AI поверх пакетов FICSIT Foreman (`@foreman/sf-save-data`, `@foreman/sf-save-data-graph`, `@foreman/sf-game-data`, `@foreman/sf-flow`).

Пакет **не** является отдельным процессом: не открывает HTTP-портов, не требует API-ключей и не обращается к SQLite-базе Foreman. Он предназначен для встраивания в `sidecar/adapter/`.

## Контракт и метрики

- Реализует замороженный контракт Public API v0 (`apiVersion: "0.4.0"`, `docs/interfaces/public-api-v0.md`).
- Вычисляет все 20 метрик v0.1 (`Factory`, `PowerNetwork`, `MachineType`, `Item`, `Fluids`).
- Кэширует снимок по `mtimeMs` файла `.sav` и автоматически перечитывает файл при обновлении на диске.
- Для `QuerySeries` возвращает `SERIES_NOT_AVAILABLE` (`hasSeries: false` для `Save` и `SaveEstimated`).

## Использование

```ts
import { createSaveSource } from "@ficsitai/save-source";

const source = createSaveSource({
  saveDataDir: process.env.SAVE_DATA_DIR,
  saveId: "my-factory",
  // Опционально: saveFilePath: "/path/to/save.sav",
  // foremanSrcDir: "/path/to/foreman-src",
  // sourceMode: "save" | "saveEstimated",
});

const status = await source.getStatus();
const catalog = await source.listMetrics();
const power = await source.queryMetric({ metricId: "power.production" });
```

## Скрипты

```bash
npm run typecheck
npm run build
npm test
```

## Переменные окружения

- `FOREMAN_SRC` — путь к локальному checkout FICSIT Foreman (по умолчанию `~/Projects/foreman-src`). Интеграционный тест с реальным `.sav` использует также `FICSIT_TEST_SAV_PATH` (при наличии локальных файлов) и автоматически пропускается в окружениях без локального Foreman/`*.sav`.
