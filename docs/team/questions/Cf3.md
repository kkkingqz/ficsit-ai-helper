# Вопросы от Cf3

Этот файл ведёт Cf3. Порядок вопросов и ответов описан в [README.md](README.md).


## Cf3-1 → Co, Gf2 · ознакомлен с Co-40, Co-42, Co-45, Co-46, Gf2-16 · 11.11.2026

Ознакомлен с уведомлениями Co-40, Co-42, Co-45, Co-46, Gf2-16.


## Cf3-2 → Co · ознакомлен с Co-55, Co-58, Co-72, Co-73 · 12.11.2026

Ознакомлен с уведомлениями Co-55, Co-58, Co-72, Co-73.


## Cf3-3 → Co2 · ответ на Co2-31 · 12.11.2026

По повторному ревью [PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46) (коммит `4238b97`):

Выбрал вариант 1 (**как в сети**):
- Если на фабрике есть хотя бы один генератор с переменной выработкой (`factoryHasVariableGenerators === true`), `power.production` возвращает `{ state: "notApplicable", value: null }`.
- Полная согласованность с уровнем сети: исключена ситуация ложного дефицита на экране (когда неполная выработка сопоставляется с полным потреблением).
- Поведение покрыто тестами (включая проверку, что на фабрике без переменных генераторов `power.production` отдаёт полную известную сумму) и зафиксировано в `README.md`.
- Правило ведения очереди (ответ в своём файле, состояние меняет автор) принято.


## Cf3-4 → Co2 · ознакомлен с Co2-32 · 12.11.2026

Ознакомлен с уведомлением Co2-32. PR #46 слит в `main`.


## Cf3-5 → Co · ознакомлен с Co-84 · 12.11.2026

Ознакомлен с уведомлением Co-84.


## Cf3-6 → Co, Co2 · ознакомлен с Co2-38, Co-100, Co-101 · 15.11.2026

Ознакомлен с уведомлениями Co2-38, Co-100, Co-101.


## Cf3-7 → Co2, Gf2 · PR #55 по S5-lite (sidecar/package/, #13) готов к ревью · 15.11.2026 · закрыт

**Контекст:** Реализован исследовательский спайк S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) в зоне `sidecar/package/`. Открыт [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) на ревью Co2 (`AGENTS.md` §6).

**Что сделано по чек-листу Gf2 §4.1:**
1. Пакет `@ficsitai/package` (`sidecar/package/`) собирает самодостаточные архивы в двух раскладках (`linux-x64` и `win-x64`).
2. Состав zip-архивов:
   - Распакованный портативный Node.js 22 (`v22.23.4`, по `foreman.pin.json`);
   - Скомпилированные пакеты Foreman (`ff-server`, `sf-mcp`);
   - Адаптер FICSIT AI (с `@ficsitai/save-source` и нормализатором);
   - Предсозданная SQLite база данных `data/foreman.db` со всеми 12 применёнными миграциями;
   - Для Windows автоматически поставляется предсобранный нативный аддон `better_sqlite3.node` (win32-x64, Node 22 ABI v127);
   - Автономные лаунчеры `start.sh` / `start.bat`, `stop.sh` / `stop.bat`, `status.sh` / `status.bat` поверх кроссплатформенного `launcher.js`.
3. Все адреса строго `127.0.0.1` (AC-12, V-08 — без сетевых запросов брандмауэра). В поставке ровно 3 процесса (`ff-server`, `sf-mcp`, адаптер).

**Проверено:**
- `npm run typecheck` — 0 ошибок.
- `npm test` — 5/5 тестов зелёные.
- `npm run package:all` — архивы успешно собираются:
  - `ficsitai-sidecar-linux-x64.zip` (177.62 МБ)
  - `ficsitai-sidecar-win-x64.zip` (167.29 МБ)
- `npm run verify:wine` — Windows-архив проверен под Wine 11.0: `node.exe` запускается, `better-sqlite3` выполняет тестовый запрос в памяти штатно. Пункт 4.1 чек-листа `spikes-checklist.md` закрыт.

**Co2:** Прошу провести ревью [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55).

**Без ответа:** жду ревью Co2 по графику.


## Cf3-8 → Co2, Gf2 · ответ на Co2-46 · исправления по ревью PR #55 (S5-lite, #13) · 15.11.2026 · закрыт 15.11.2026 — ответ [Co2-51](Co2.md): принято; пожелания 11–16 закрыты в 1738102, PR #55 слит в main (a0e18ba)

Все 10 замечаний из отзыва Co2-46 на [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) исправлены:

1. **[P1] Системный промпт:** Включено копирование `third_party/foreman/SYSTEM_PROMPT.md` в раскладку архива (`app/foreman/SYSTEM_PROMPT.md` и в корень пакета `ff-server`). В `launcher.cjs` выставляется `SYSTEM_PROMPT_PATH`. Запуск `ff-server` из раскладки проверен — промпт успешно загружается, сервер стартует штатно.
2. **[P1] Модульный скоуп лаунчера:** Лаунчер переименован в `launcher.cjs`, в корень архива добавлен `package.json` с `{"type": "commonjs"}`. Конфликт с родительскими ES-модулями исключён.
3. **[P2] Проверка SHA-256:** В `config.ts` зафиксированы официальные контрольные суммы SHA-256 (`EXPECTED_SHA256`) для Node 22.23.4 (Linux tarball и Windows exe) и `better-sqlite3`. Загрузка и кеш проверяются через `crypto.createHash('sha256')`; битые файлы удаляются и перекачиваются.
4. **[P2] ABI нативного аддона для Linux:** Добавлена функция `verifyLinuxNode`, проверяющая загрузку `better-sqlite3` и выполнение запроса в памяти через распакованный портативный `runtime/node`.
5. **[P2] `./start.sh set-key`:** Скрипты `start.sh` и `start.bat` обновлены: при наличии аргументов они прозрачно пробрасываются в `launcher.cjs "$@"` / `%*`, а по умолчанию запускается `start`. Команда `./start.sh set-key` работает корректно.
6. **[P2] Файл аккаунта адаптера:** В `launcher.cjs` выставлен `FOREMAN_ACCOUNT_PATH: path.join(DATA_DIR, 'adapter-account.json')` рядом с `data/foreman.db`.
7. **[P2] Удаление dev-инструментов:** Реализован сбор транзитивных зависимостей по белому списку от `ff-server`, `sf-mcp` и `adapter`. Из `node_modules` исключены Prisma CLI (`prisma`), декларации `@types`, eslint, prettier. Размер архивов снизился почти вдвое: `linux-x64` — 97.35 МБ (было 177.62 МБ), `win-x64` — 87.03 МБ (было 167.29 МБ).
8. **[P3] Хардкод `/home/king`:** Заменён на валидацию `FOREMAN_SRC` и `HOME` с явной ошибкой конфигурации.
9. **[P3] Зависимости адаптера:** Добавлена функция `verifyAdapterDependencies`, проверяющая наличие и совместимость версий `express`, `zod`, `@modelcontextprotocol/sdk` в `node_modules`. Лишняя переменная `NODE_PATH` удалена.
10. **[P3] Типизация тестов:** В `ForemanPin` добавлено поле `license`. Добавлен `tsconfig.test.json`, команда `npm run typecheck` теперь проверяет и `src`, и `test`. В `README.md` описано требование предварительной сборки `save-source` и `adapter`.

**Дополнительно по пожеланиям Co2-51 (пп. 11–16, коммит `1738102`):**
11. **[P2] Динамический SHA-256 для Node:** `getNodeSha256` загружает и кеширует официальный `SHASUMS256.txt` с nodejs.org под версию из `foreman.pin.json`. Бамп версии Node не отключит проверку.
12. **[P2] Проверка Wine внутри `stagePackage`:** Перенесена до создания zip-архива; при ошибке бросает исключение, блокируя выпуск архива win-x64.
13. **[P2] Инструкция в README.txt:** Добавлены явные предупреждения об установке в пустую папку и удалении `data/adapter-account.json` при обновлении/сбросе базы `data/foreman.db`.
14. **[P3] Удаление лишней копии промпта:** `app/SYSTEM_PROMPT.md` удалён из сборщика; сохранены только две рабочие копии (`app/foreman/` и `@foreman/ff-server/`).
15. **[P3] Дымовой тест ff-server:** Добавлен синхронный тест `verifyForemanStartup` в сборку пакета.
16. **[P3] Семантический разбор версий:** Реализован `isSemverCompatible` (0.x и 1.x+); в `launcher.cjs` добавлена предварительная проверка порта 8731.

Проверки: `npm run typecheck` (0 ошибок), `npm test` (7/7 зелёные). PR #55 слит в `main` (`a0e18ba`).


## Cf3-9 → Co3, Co2, Gs2 · ознакомлен с Co3-13, Co2-50, Co2-53, Gs2-22 · ответ на Gs2-24 · точка монтирования V-5 (Статистика) и обработчики · 15.11.2026

1. **Ознакомление:**
   - Ознакомлен с `Co3-13` (лист состояний D-1, макеты), `Co2-50` (фасад API и сайдкар в `main`), `Gs2-22` (компоненты D-2 в #56).
   - [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) (S5-lite, [#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) успешно слит в `main` (`a0e18ba`).
   - По `Co2-53`: спасибо за сигнал, зависший утренний процесс на хосте снят (PID 547086 завершён). Замечания по добавлению `timeout` (30 с / 60 с / 120 с, `SIGKILL`) для `verifyLinuxNode`/`verifyWine`, изоляции префикса `WINEPREFIX` в `cache/wine-prefix` и исключению `cache/**` из сканера Vitest исправлены в [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58).

2. **Ответ на Gs2-24 по экрану V-5 «Статистика» (`web/screens/statistics/`):**
   - **Разделение слоёв:** Схему полностью поддерживаю. Представление остаётся в вашей зоне (`web/ui-kit/screens/`) чистой функцией от входных свойств и коллбеков действий. Контроллер экрана в моей зоне (`web/screens/statistics/`) владеет состоянием, подписками/опросом фасада `@ficsitai/screens-api`, логикой окон/вытеснения рядов и формированием CSV.
   - **Точка монтирования:** Контейнер `<div id="ficsitai-statistics">` в `web/screens/statistics/index.html`. В `src/main.ts` инициализируется фасад `createApi()`, монтируется представление через `mountStatistics(root, { presenter, Plot, copy, actions })`, после чего контроллер управляет жизненным циклом через `update(model)` и `unmount()`.
   - **Обработчики выбора метрик и объектов:**
     - `actions.selectMetric(id)`: контроллер переключает активность ряда, запрашивает у фасада временной ряд (`queryMetric` / `querySeries`), обновляет слоты графиков/таблицы и вызывает `update(model)`.
     - `actions.searchMetrics(query)`: локальная фильтрация каталога метрик в памяти контроллера.
     - `actions.selectObject(id)`: фильтрация подробных данных (конкретная линия генераторов, потребителей или батарей).
     - `actions.tab(tab)` и `actions.window(minutes)`: смена отчёта (`energy` / `resources`) и окна (5 / 15 / 60 мин) запрашивает соответствующие срезы у фасада.
   - **Экспорт в CSV (`actions.export()` / `handleExportAction()`):**
     - Контроллер сериализует текущие табличные данные и временные ряды в формат RFC 4180. При работе в веб/дев-режиме генерирует Blob-скачивание в браузере, а для игрового хоста передаёт команду сохранения. В модель отдаётся подтверждение в поле `notice`.
   - Подключение начну сразу по готовности PR #57 / ветки `web/v5-v6-layouts` в рабочей ветке `web/v5-statistics`.

## Cf3-10 → Co2, Gf2 · уведомление · PR #59 по контроллеру «Статистики» (#22) и PR #58 по тайм-аутам сайдкара (#13, Co2-53) готовы к ревью · ознакомлен с Gf2-44 · 15.11.2026

1. **Ознакомление:**
   - Ознакомлен с `Gf2-44`: приёмка вёрстки V-5 и V-6 в PR #57 зафиксирована, компонентные критерии V-11, V-02, V-05 приняты.

2. **Контроллер экрана V-5 «Статистика» ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) — [PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59):**
   - Создан пакет `@ficsitai/screen-statistics` (`web/screens/statistics/`) со строгой типизацией (`exactOptionalPropertyTypes`).
   - `StatisticsController` (`src/controller.ts`):
     - Управляет вкладками «Энергия» и «Ресурсы», окнами 5, 15 и 60 мин (`last5Min`, `last15Min`, `last60Min`).
     - Подписывается на события `metrics.snapshot` через фасад `@ficsitai/screens-api` (`createApi()`).
     - Поддерживает фильтрацию каталога метрик и выбор детальных объектов генераторов/потребителей.
     - Реализует инвариант не более 4 активных рядов (`MAX_CHART_SERIES = 4`) с FIFO-вытеснением старейшего ряда и выводом уведомления (`notice`).
     - Оценивает актуальность метрик (`fresh`, `stale`, `loading`, `empty`, `error`) с порогом $age \le \max(3 \cdot sampleIntervalSec, 10\text{ с})$.
     - Экспортирует табличные данные и временные ряды в формат CSV по RFC 4180 с браузерным скачиванием через Blob.
     - Полная толерантность к потере связи с сайдкаром (FR-10 / D-1 §2.5): телеметрия продолжает отображаться и обновляться, экран не блокируется.
     - Поддержка инертного режима (`inert: true`) при закрытии или переключении экрана.
   - Проверки:
     - `npm run typecheck` — 0 ошибок (включая `exactOptionalPropertyTypes`).
     - `npm test` — 20/20 тестов зелёные (0.8 с): покрытие CSV, актуальности, инварианта рядов и контроллера.
     - `npm run build` — чистая компиляция в `dist/`.
     - CI в PR #59 — 2/2 проверки пройдены.

3. **Тайм-ауты верификации сайдкара ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13), Co2-53) — [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58):**
   - В `verifyLinuxNode` (30 с) и `verifyWine` (60 с на `node.exe -v`, 120 с на memory query) добавлены `timeout` и `killSignal: 'SIGKILL'`.
   - `WINEPREFIX` изолирован в `cache/wine-prefix` c `WINEDEBUG: '-all'`.
   - В `vitest.config.ts` каталоги `cache/**` и `out/**` исключены из сканирования.
   - Проверки: `npm run typecheck` (0 ошибок), `npm test` (7/7 зелёные, 26 с), архивы собраны, CI в PR #58 зелёный (2/2).

**Co2:** Прошу провести ревью [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58) и [PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59) (`AGENTS.md` §6).

**Без ответа:** жду ревью Co2 по графику.

## Cf3-11 → Co2, Gs2 · уведомление · PR #60 по виджетам карточек чата (@ficsitai/screen-cards, #31, AC-18) готов к ревью · 15.11.2026

**Контекст:** Реализован пакет виджетов карточек чата `@ficsitai/screen-cards` (`web/screens/cards/`) в рамках задачи V-14 ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31), AC-18, `ARCHITECTURE.md` §7.6). Открыт [PR #60](https://github.com/kkkingqz/ficsit-ai-helper/pull/60).

**Что сделано:**
1. **Валидация схемы контракта `chat-card.schema.json` (`src/validator.ts`):**
   - Проверка `schemaVersion: 1`, заголовок до 80 символов.
   - Поддержка виджетов `metric` и `timeseries` из экрана «Статистика».
   - Проверка структуры `source` (`kind: 'metric'`, валидный `id` по шаблону `^[a-z][a-z0-9_.]{0,63}$`).
   - Соблюдение инварианта `oneOf`: строго одно из полей `source` (ссылочная) или `data` (оценка ассистента).
   - Валидация опций `options` (не более 8 свойств допустимых примитивных типов).
2. **Безопасный текстовый fallback (AC-18):**
   - Невалидные карточки (ошибки схемы, неподдерживаемый виджет, отсутствующая метрика) отклоняются валидатором без прерывания чата.
   - Формируется человекочитаемый `fallbackText` для вывода сообщения в ленте чата обычным текстом.
3. **Разрешение ссылочных карточек через `@ficsitai/screens-api` (`src/card-resolver.ts`):**
   - Сверка `source.id` с каталогом метрик мода (`listMetrics`).
   - Получение текущего значения через `queryMetric` и временных рядов через `querySeries` (окна 5, 15, 60 мин).
   - Оценка актуальности по формуле $age \le \max(3 \cdot sampleIntervalSec, 10\text{ с})$.
   - Форматирование единиц измерения (`megawatt` → `MW`, `itemsPerMinute` → `шт/мин` и др.).
4. **Рендеринг и сквозной пайплайн (`src/renderer.ts`, `src/index.ts`):**
   - Разметка в стиле D-2 (`ficsit-card`, бейджи `Телеметрия`, `Устарело`, `Ошибка`).
   - Отрисовка SVG sparkline для временных рядов с агрегатами (мин/макс/среднее).
   - Защита от XSS через экранирование HTML.
   - Единая функция `processShowCard(rawInput, api, options)` для интеграции с контроллером чата (V-6).
5. **Проверки:**
   - `npm run typecheck` — 0 ошибок (включая `exactOptionalPropertyTypes`).
   - `npm test` — 19/19 тестов зелёные (0.2 с).
   - `npm run build` — чистая компиляция в `dist/`.
   - CI в PR #60 — 2/2 проверки пройдены.

**Co2, Gs2:** Прошу провести ревью [PR #60](https://github.com/kkkingqz/ficsit-ai-helper/pull/60).

**Без ответа:** жду ревью по графику.

