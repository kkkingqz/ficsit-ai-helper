# `@ficsitai/package` — Сборщик архива сайдкара FICSIT AI (S5-lite)

Пакет предназначен для сборки самодостаточного релизного архива сайдкара для альфа-тестирования (спайк S5-lite, задача [#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13), чек-лист `spikes-checklist.md` §4).

## Обзор

Позволяет собрать полностью автономный zip-архив сайдкара без Docker и без внешнего установщика:
- **Две целевые платформы:** `linux-x64` (для разработчиков и CI) и `win-x64` (для закрытой альфы игроков).
- **Портативный Node.js 22:** архив содержит распакованный бинарник Node.js (`v22.23.4`, зафиксированный в `sidecar/launcher/foreman.pin.json`). На машине пользователя Node.js ставить не требуется. Все скачиваемые дистрибутивы проверяются по официальным контрольным суммам SHA-256.
- **Ровно 3 процесса (ADR-015, Co2-18):**
  1. `sf-mcp` (порт 8723) — MCP-сервер игровых данных и разбора сохранений Foreman;
  2. `ff-server` (порт 8724) — бэкенд чата Foreman с Express и SQLite;
  3. `adapter` (порт 8730) — адаптер FICSIT AI с источником `save-source` и встроенным нормализатором провайдеров (порт 8731).
- **Инвариант безопасности (AC-12, V-08):** все процессы слушают строго локальную петлю `127.0.0.1`. Прослушивание `0.0.0.0` запрещено. Брандмауэр Windows не запрашивает разрешений на открытие сетевых портов.
- **Системный промпт и аккаунт:** в раскладку включается адаптированный промпт `third_party/foreman/SYSTEM_PROMPT.md`, согласующийся с белым списком адаптера (`sidecar/adapter/src/whitelist.ts`), и экспортируются переменные `SYSTEM_PROMPT_PATH` и `FOREMAN_ACCOUNT_PATH` (`data/adapter-account.json`).
- **Предсозданная база данных:** архив включает `data/foreman.db` со всеми 12 применёнными миграциями Prisma. Пользователю не требуется запускать миграции или генерацию схем.
- **Очистка от dev-инструментов:** из раскладки исключены компилятор Prisma CLI (`prisma`), декларации `@types`, линтеры и тестовые фреймворки, что снижает размер зависимостей до необходимого минимума (~159 МБ в раскладке).
- **Нативные модули, ABI и дымовые тесты:**
  - Для `win-x64`: предсобранный бинарник `better_sqlite3.node` под `win32-x64` Node 22 (ABI v127); строгая верификация под Wine 11.0 встроена в этап `stagePackage` и прерывает сборку при сбое.
  - Для `linux-x64`: нативный аддон проверяется на совместимость через тестовый запуск с портативным бинарником `node`; сборка включает дымовой прогон запуска `ff-server` с контролем открытия порта и чтения системного промпта.

## Состав архива

```text
ficsitai-sidecar-<target>/
├── package.json (объявление CommonJS: {"type": "commonjs"})
├── runtime/
│   └── node (Linux) / node.exe (Windows)
├── app/
│   ├── foreman/
│   │   └── SYSTEM_PROMPT.md
│   ├── node_modules/
│   │   ├── @foreman/ (sf-core, sf-game-data, sf-save-data, sf-mcp, ff-server...)
│   │   ├── @ficsitai/save-source/
│   │   ├── better-sqlite3/
│   │   └── (только production-зависимости, без dev-инструментов)
│   └── adapter/
│       └── dist/
├── data/
│   ├── foreman.db (SQLite с 12 применёнными миграциями)
│   ├── adapter-account.json (генерируется при первом старте адаптера)
│   └── saves/ (каталог для загрузки .sav)
├── logs/ (логи процессов: sf-mcp.log, ff-server.log, adapter.log)
├── run/ (PID-файлы запущенных служб)
├── launcher.cjs (кроссплатформенный менеджер процессов на CommonJS)
├── start.sh / start.bat (запуск служб в фоне; поддерживают подкоманду set-key)
├── stop.sh / stop.bat (остановка служб)
├── status.sh / status.bat (проверка доступности служб)
└── README.txt (руководство для игрока)
```

## Предварительные требования перед тестированием

Для прогона тестов сборщика (`npm test`) и проверки типов (`npm run typecheck`) необходимо, чтобы зависимые пакеты были собраны:
```bash
# 1. Собрать библиотеку источника сохранений
cd sidecar/save-source && npm run build

# 2. Собрать адаптер FICSIT AI
cd sidecar/adapter && npm run build

# 3. Сборка и тесты пакета
cd sidecar/package && npm run build && npm test
```

## Команды

```bash
# Сборка пакета (компиляция TypeScript)
npm run build

# Проверка типов (включая исходники и тесты через tsconfig.test.json)
npm run typecheck

# Запуск тестов (проверка pin, шаблонов, staging, Linux- и Wine-верификация)
npm test

# Сборка архивов для обеих платформ (linux-x64 и win-x64)
npm run package:all

# Сборка только для Windows
npm run package:win

# Сборка только для Linux
npm run package:linux

# Автономная верификация Windows-сборки под Wine
npm run verify:wine
```

## Проверка под Wine

Сборка `win-x64` валидируется вызовом `npm run verify:wine`:
1. Запуск портативного `runtime/node.exe` под Wine.
2. Проверка загрузки нативного C++ аддона `better-sqlite3` (`better_sqlite3.node`).
3. Выполнение тестового SQLite-запроса в памяти (`SELECT 1 + 1 as res`).
4. Подтверждение отсутствия сбоев ABI и ошибок загрузки dll/so.
