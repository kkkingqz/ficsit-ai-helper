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

## Переменные окружения и поставка

- `FOREMAN_SRC` — путь к локальному checkout FICSIT Foreman (по умолчанию `~/Projects/foreman-src`). Зафиксированный коммит репозитория задан в `sidecar/launcher/foreman.pin.json`.
- В режиме разработки (S6) и Screen Lab пакет динамически загружает скомпилированные ESM-пакеты из `FOREMAN_SRC`. Для релизного архива (S5-lite / `sidecar/package/`) бандлы упаковываются сборщиком архива без необходимости наличия клона `foreman-src` на целевой системе.
- `FICSIT_TEST_SAV_PATH` — путь к тестовому файлу `.sav` для запуска интеграционных тестов с реальным бинарным сохранением. Если переменная не задана, интеграционный тест с `.sav` безопасно пропускается (в CI и средах без внешних сохранений).

## Особенности вычислений телеметрии

- **Генераторы с переменной мощностью (Geothermal):** в статических сохранениях игра не сохраняет фиксированную мощность геотермальных генераторов (она зависит от гейзера). Поэтому `generators.production` для Geothermal, а также `power.network.production`, `capacity`, `fuse_tripped`, `battery_output` и времена батарей в сетях с геотермальными генераторами возвращают честное `notApplicable` (вместо ложного нуля и ложной аварии сети). `battery_charge` рассчитывается из сохранённого заряда `mPowerStore`. Фабричный `power.production` при наличии хотя бы одного генератора с переменной мощностью также возвращает `notApplicable` для полной согласованности с уровнем сетей и исключения ложного дефицита на главном экране (когда неполная выработка сопоставляется с полным потреблением всей фабрики).
- **Ограничение отдачи батарей (Power Storage Mk1):** максимальная мощность разряда ограничена 100 МВт на одну батарею (`BATTERY_MK1_MAX_DISCHARGE_MW`). Если дефицит сети превышает суммарную предельную мощность разряда батарей, отдача ограничивается, а предохранитель выбивает (`fuse_tripped = 1`).
- **Имена метрик:** строковые `displayName` метрик соответствуют оригинальным идентификаторам и строкам интерфейса Satisfactory v0.1 на английском языке согласно `AGENTS.md` §9. Локализация интерфейса запланирована в v0.2.
