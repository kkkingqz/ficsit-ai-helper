# `@ficsitai/package` — Сборщик архива сайдкара FICSIT AI (S5-lite)

Пакет предназначен для сборки самодостаточного релизного архива сайдкара для альфа-тестирования (спайк S5-lite, задача [#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13), чек-лист `spikes-checklist.md` §4).

## Обзор

Позволяет собрать полностью автономный zip-архив сайдкара без Docker и без внешнего установщика:
- **Две целевые платформы:** `linux-x64` (для разработчиков и CI) и `win-x64` (для закрытой альфы игроков).
- **Портативный Node.js 22:** архив содержит распакованный бинарник Node.js (`v22.23.4`, зафиксированный в `sidecar/launcher/foreman.pin.json`). На машине пользователя Node.js ставить не требуется.
- **Ровно 3 процесса (ADR-015, Co2-18):**
  1. `sf-mcp` (порт 8723) — MCP-сервер игровых данных и разбора сохранений Foreman;
  2. `ff-server` (порт 8724) — бэкенд чата Foreman с Express и SQLite;
  3. `adapter` (порт 8730) — адаптер FICSIT AI с источником `save-source` и встроенным нормализатором провайдеров (порт 8731).
- **Инвариант безопасности (AC-12, V-08):** все процессы слушают строго локальную петлю `127.0.0.1`. Прослушивание `0.0.0.0` запрещено. Брандмауэр Windows не запрашивает разрешений на открытие сетевых портов.
- **Предсозданная база данных:** архив включает `data/foreman.db` со всеми 12 применёнными миграциями Prisma. Пользователю не требуется запускать миграции или генерацию схем.
- **Нативные модули для Windows:** для сборки `win-x64` нативный модуль `better-sqlite3` автоматически комплектуется предсобранным бинарником `better_sqlite3.node` под `win32-x64` Node 22 (ABI v127) и проверяется под Wine 11.0.

## Состав архива

```text
ficsitai-sidecar-<target>/
├── runtime/
│   └── node (Linux) / node.exe (Windows)
├── app/
│   ├── node_modules/
│   │   ├── @foreman/ (sf-core, sf-game-data, sf-save-data, sf-mcp, ff-server...)
│   │   ├── @ficsitai/save-source/
│   │   ├── better-sqlite3/
│   │   └── (все production-зависимости)
│   └── adapter/
│       └── dist/
├── data/
│   ├── foreman.db (SQLite с 12 применёнными миграциями)
│   └── saves/ (каталог для загрузки .sav)
├── logs/ (логи процессов: sf-mcp.log, ff-server.log, adapter.log)
├── run/ (PID-файлы запущенных служб)
├── launcher.js (кроссплатформенный менеджер процессов на Node.js)
├── start.sh / start.bat (запуск служб в фоне)
├── stop.sh / stop.bat (остановка служб)
├── status.sh / status.bat (проверка доступности служб)
└── README.txt (руководство для игрока)
```

## Команды

```bash
# Сборка пакета (компиляция TypeScript)
npm run build

# Запуск тестов (проверка pin, шаблонов, staging и верификация под Wine)
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
