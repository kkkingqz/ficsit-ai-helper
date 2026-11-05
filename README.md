# FICSIT AI Helper

Мод к Satisfactory и локальный сервис-компаньон, делающие [FICSIT Foreman](https://github.com/StuartMeeks/ficsit-foreman)
инженерным помощником прямо в игре: AI Terminal с переиспользуемыми экранами (Dashboard, Chat,
Notes, Work Orders, Screens), подключаемый планировщик производства и запросы на создание Blueprint.
Экипируемый AI Assistant и HUD — v1.4.

**Статус: только архитектура.** Кода пока нет. Репозиторий содержит проект архитектуры
релизной версии, вынесенный на согласование, — не описание реализованного продукта.

## Документация

| Файл | Что это |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектурный документ v2.1-draft (источник истины) |
| [docs/README.md](docs/README.md) | Состав пакета документа, сборка схем и PDF/DOCX |
| [docs/assets/*.dot](docs/assets) | Исходники схем Graphviz |
| [docs/contracts/*.json](docs/contracts) | Примеры предлагаемых контрактов (не runtime API) |
| [docs/contracts/schemas](docs/contracts/schemas) | JSON Schema контрактов; примеры проверяются в CI |

## Главное из архитектуры

- **Целевой стек:** Satisfactory 1.2, SML 3.12, Windows game client.
- **Топология:** только одиночная игра. Мультиплеер и Dedicated Server — вне v1.x (v2.0).
- **Два рантайма:** игровой процесс (презентационный слой, authority-слой) и локальный
  сайдкар: vanilla Foreman плюс тонкий адаптер, через который мод подключается к Foreman
  исходящим соединением. Foreman не форкается и не патчится.
- **UI:** переиспользуемые экранные модули, которые открываются в любом хосте. В v1.0 хост —
  AI Terminal (потребляет 10 MW); в v1.4 те же экраны откроет AI Assistant.
- **Планировщик:** стандартизированная обёртка (`PlanRequest` → `ProductionPlan`, интерфейс
  провайдера и UI плана), в v1.0 — заглушка. Первый кандидат провайдера — ядро
  [Satisfactory Build Calculator](https://github.com/AutoCrafter1223/satisfactory-build-calculator-mod) (MIT).
- **Объём v1.0:** AI Terminal; экраны Dashboard, Chat, Notes, Work Orders, Screens (редактор
  экранов вместе с инструментами модели); обёртки Planning и Graph; состояние в сохранении.
  Первым идёт вертикальный срез v0.1 (терминал, Chat, Dashboard). Blueprint Builder — v1.1,
  голос — v1.2, подключение планировщика и UI плана — v1.3, AI Assistant с HUD — v1.4.
- **Контракты:** `GameCatalog`, `PlanRequest`, `ProductionPlan`, `ScreenDefinition`, `BlueprintRequest`.
- **Ручной паритет:** всё, что может модель (экран, график, заметка, Work Order, чертёж, план),
  игрок делает вручную через UI без LLM — UI и модель вызывают одни и те же операции.
- **Граница доверия LLM:** закрытый набор инструментов без доступа к миру (только заметки,
  экраны и чертежи в библиотеку), каждый вызов валидируется authority-слоем; никакого исполняемого
  кода от LLM.
- **Работа без LLM:** ручные функции мода работают при остановленном сайдкаре (FR-10); Work Orders
  требуют сайдкар, но не LLM.

## Блокирующие проверки до начала работ

| ID | Что проверить |
|---|---|
| R-12 | Лицензия Ficsit Remote Monitoring (источник кода телеметрии, лицензия не установлена) |
| S2 | Адаптер сайдкара и канал к моду (Spike S2) |
| R-16 | Оценка трудозатрат и состава команды |

## Лицензия

Не выбрана — открытый вопрос §2.2 документа. Apache-2.0 у Foreman (внешний сервис, не
линкуется) и MIT у Satisfactory Build Calculator и Factory Spawner допускают выпуск мода под MIT или Apache-2.0.
Заимствованный код размещается в `third_party/` с `LICENSE`, `NOTICE` и перечнем патчей.
