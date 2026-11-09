---
title: "FICSIT AI — публичный API мода, версия 0"
subtitle: "Замороженный контракт: запросы, события, ошибки и лимиты"
author: "Co, технический лидер мода"
date: "09.11.2026"
lang: ru-RU
---

# Статус

| Поле | Значение |
|---|---|
| Что это | **Замороженный контракт API v0** — имена, формы и семантика. Не реализация |
| `apiVersion` | **0.1.0** |
| Заморожен | Неделя 1–2 вместо недели 6 (решение King 09.11.2026) |
| Зачем раньше плана | Co2 строит фасад API для страниц в S6 на неделе 4. Без замороженного контракта он построит его по эскизу, и переделка попадёт в недели 6–7, где у него уже V-5, V-6 и V-7 |
| Ревью | Gs |
| Источник истины | `ARCHITECTURE.md` §3.6, §5.5, §5.6, §7.1, §7.4, §7.5, §8.2, §8.5, ADR-023, ADR-025 |
| Реализация | V-2 ([#19](https://github.com/kkkingqz/ficsit-ai-helper/issues/19)): Co — API, Gf — источники Live и Fixture в игре, Co2 — фасад для страниц |

**Что значит «заморожен».** Имена, формы структур и смысл полей ниже не меняются без мажорной версии. Добавление необязательного поля или нового запроса аддитивно и версию не поднимает (§5.5). Удаление или смена смысла — ломающее изменение, и до релиза v1.0 его делать нельзя, потому что на контракт уже опираются три клиента.

**Что НЕ заморожено и где решается:** состав каталога метрик и интервалы сбора — на воротах G1 по замерам S3; JSON Schema инструментов `list_metrics` и `query_metric` — их пишет Co2 в V-3 по формам из этого документа; имена конкретных метрик — вместе с каталогом метрик в S3.

# Область v0

v0 обслуживает вертикальный срез v0.1 и ровно его: экраны «Статистика» и «Чат с ИИ», и те же данные для модели через адаптер.

| Есть в v0 | Нет в v0 | Когда появится |
|---|---|---|
| Метрики: каталог, значение, временной ряд | Линии, заметки, экраны, планы, Work Orders | Milestone 1 и далее |
| Состояние API и мода | Операции записи — **никаких** | Заметки и экраны — Milestone 1 |
| События `metrics.snapshot`, `mod.inert` | `line.changed`, `plan.updated`, `screen.updated`, `note.changed` | вместе со своими сущностями |
| Сменный источник данных | Внешние поставщики метрик (`ext.<modId>.<name>`) | v1.1 вместе с публикацией API |

Запись в v0 отсутствует не потому, что не успели: в v0.1 у модели нет ни одного пишущего инструмента, а паритет (§7.5) требует, чтобы инструмент не появлялся раньше ручного пути. Пустое множество операций записи — это проверяемое состояние, а не заготовка.

# Клиенты и их равноправие

Клиенты API: экранные модули (`FicsitAIUI`), модель через адаптер, в v1.1 — FicsIt-Networks и другие моды (ADR-023). Все получают **один и тот же** контракт; различаются только права и лимиты:

- Экраны и внешние моды — ручные клиенты от имени игрока.
- Модель — только инструменты из белого списка, то есть в v0 только `list_metrics` и `query_metric`.
- Лимиты частоты и размера — на каждого клиента отдельно.

Клиент при подключении объявляет свою требуемую версию. При несовпадении мажорной версии AI-функции отключаются с видимым игроку сообщением, ручные продолжают работать (§5.5).

# Общие типы

```cpp
/** Откуда пришло значение (§8.5). Несёт каждое значение, показывается в метке свежести. */
UENUM(BlueprintType)
enum class EFicsitAIDataSource : uint8
{
    Live,            // живая игра
    Save,            // разбор .sav, номинальные скорости
    SaveEstimated,   // разбор .sav, оценка установившихся потоков
    Recorded,        // воспроизведение записи сессии
    Fixture,         // подготовленный набор для тестов
    Planned          // плановое значение, не наблюдаемое (§8.4)
};

/** Единицы (§5.6). Переводы делаются один раз, на границе CatalogProvider. */
UENUM(BlueprintType)
enum class EFicsitAIUnit : uint8
{
    ItemsPerMinute,  // твёрдые предметы
    CubicMetersPerMinute, // жидкости и газы
    Megawatt,
    MegawattHour,    // ёмкость накопителей
    Percent,
    Count,
    Seconds
};

/** К чему относится метрика. LineId в v0.1 не заполняется: экрана линий в срезе нет. */
UENUM(BlueprintType)
enum class EFicsitAIMetricScope : uint8
{
    Factory,         // вся фабрика
    PowerNetwork,    // электросеть
    Item,            // предмет
    MachineType,     // тип машины
    Line             // производственная линия, с Milestone 1
};

USTRUCT(BlueprintType)
struct FFicsitAIMetricDescriptor
{
    GENERATED_BODY()

    /** Устойчивый идентификатор: "power.consumption", "items.produced". Внешние — "ext.<modId>.<name>". */
    UPROPERTY(BlueprintReadOnly) FString Id;
    UPROPERTY(BlueprintReadOnly) FText DisplayName;
    UPROPERTY(BlueprintReadOnly) EFicsitAIUnit Unit = EFicsitAIUnit::Count;
    UPROPERTY(BlueprintReadOnly) EFicsitAIMetricScope Scope = EFicsitAIMetricScope::Factory;

    /** Есть ли временной ряд. Без этого флага клиент не должен запрашивать серию. */
    UPROPERTY(BlueprintReadOnly) bool bHasSeries = false;

    /** Класс стоимости выборки: от него зависит интервал и нижний порог refresh (§8.2). */
    UPROPERTY(BlueprintReadOnly) FName CostClass = TEXT("normal"); // cheap | normal | heavy
    UPROPERTY(BlueprintReadOnly) float SampleIntervalSec = 5.0f;

    /** Зарегистрирована другим модом или компьютером FIN (v1.1). */
    UPROPERTY(BlueprintReadOnly) bool bExternal = false;
};

USTRUCT(BlueprintType)
struct FFicsitAIValue
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly) FString MetricId;

    /** Идентификатор объекта в пределах Scope: className предмета, id сети. Пусто для Factory. */
    UPROPERTY(BlueprintReadOnly) FString ScopeId;

    UPROPERTY(BlueprintReadOnly) double Value = 0.0;
    UPROPERTY(BlueprintReadOnly) EFicsitAIUnit Unit = EFicsitAIUnit::Count;
    UPROPERTY(BlueprintReadOnly) EFicsitAIDataSource Source = EFicsitAIDataSource::Live;

    /** Секунды от начала сессии, когда значение снято. Разбор — в открытых вопросах. */
    UPROPERTY(BlueprintReadOnly) double SessionTimeSec = 0.0;

    /** Сколько знаков имеет смысл показывать. UI не придумывает точность сам. */
    UPROPERTY(BlueprintReadOnly) int32 PrecisionDigits = 1;
};

/** Окна графиков v1.0 — от начала сессии (§8.2). Персистентный ряд за 24 ч — v1.1. */
UENUM(BlueprintType)
enum class EFicsitAISeriesWindow : uint8 { Last5Min, Last15Min, Last60Min };

USTRUCT(BlueprintType)
struct FFicsitAISeries
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly) FString MetricId;
    UPROPERTY(BlueprintReadOnly) FString ScopeId;
    UPROPERTY(BlueprintReadOnly) EFicsitAISeriesWindow Window = EFicsitAISeriesWindow::Last15Min;
    UPROPERTY(BlueprintReadOnly) EFicsitAIUnit Unit = EFicsitAIUnit::Count;
    UPROPERTY(BlueprintReadOnly) EFicsitAIDataSource Source = EFicsitAIDataSource::Live;

    UPROPERTY(BlueprintReadOnly) float IntervalSec = 5.0f;
    UPROPERTY(BlueprintReadOnly) TArray<double> Values;
    UPROPERTY(BlueprintReadOnly) double FirstPointSessionTimeSec = 0.0;

    /** true — сессия короче запрошенного окна. UI обязан сказать это игроку, а не рисовать пустой график (AC-04). */
    UPROPERTY(BlueprintReadOnly) bool bWindowIncomplete = false;
};
```

# Запросы v0

Все запросы читают **последний снимок**: они дешёвые и не задевают GameThread (§3.6, §8.2). Ни один не инициирует сбор.

| Запрос | Вход | Выход |
|---|---|---|
| `GetStatus` | — | `FFicsitAIApiStatus`: `apiVersion`, `saveId`, текущий `EFicsitAIDataSource`, `bInert`, `LastSnapshotSessionTimeSec`, `bSidecarConnected` |
| `ListMetrics` | необязательный фильтр по `Scope` и подстроке, `PageSize`, `Cursor` | страница `FFicsitAIMetricDescriptor` плюс `NextCursor` |
| `QueryMetric` | `MetricId`, необязательный `ScopeId` | `FFicsitAIValue` |
| `QuerySeries` | `MetricId`, `Window`, необязательный `ScopeId` | `FFicsitAISeries` |

**Почему `GetStatus` в API, а не в хосте.** Верхняя полоса статуса каркаса терминала (§6.7) показывает состояние телеметрии и связи с сайдкаром, а экран «Чат» — состояние «не подключено». И то и другое нужно модулям, а модули знают только API. Хост про сайдкар не знает и знать не должен.

**Почему каталог метрик отдаётся страницами.** Та же причина, что у каталога рецептов (ADR-017): перечень из десятков метрик в одном ответе модели не нужен, а пагинация с фильтром заставляет её спрашивать то, что ей действительно нужно. Для экранов страница просто большая.

# Операции v0

Операция — запись в `OperationRegistry` со схемой аргументов, схемой результата, лимитами и **обязательной ручной точкой входа** (§7.5). В v0 их две, и обе читающие:

| Операция | Инструмент модели | Ручной путь |
|---|---|---|
| `list_metrics` | да | «Статистика»: выбор метрики |
| `query_metric` | да | «Статистика»: выбор метрики и окна |

`QuerySeries` отдельной операцией не выставляется: для модели ряд — это тот же `query_metric` с окном, иначе у неё окажется два способа спросить одно и то же. Внутри API это разные запросы, наружу — одна операция. Описания инструментов для адаптера генерируются из реестра, а не пишутся в адаптере (§7.5, правило 2).

# События v0

```cpp
/** Новый снимок телеметрии готов. Клиент перерисовывает только то, что изменилось. */
// metrics.snapshot → { SessionTimeSec, TArray<FString> ChangedMetricIds, EFicsitAIDataSource Source }

/** Мод перешёл в инертный режим или вышел из него (§4.2). */
// mod.inert → { bool bInert, FText Reason }
```

Правило частоты: событие приходит по поступлению снимка, а не по таймеру. Виджет не перерисовывается чаще, чем приходят данные (§8.2) — в 1.0-draft это было сделано неверно, и исправление зафиксировано как требование.

# Коды ошибок

Машиночитаемый код плюс текст для игрока. Коды — часть контракта и заморожены вместе с ним:

| Код | Когда |
|---|---|
| `MOD_INERT` | мультиплеерная сессия или вошёл удалённый игрок (§4.2) |
| `API_VERSION_MISMATCH` | мажорная версия клиента не совпала (§5.5) |
| `UNKNOWN_METRIC` | `MetricId` нет в живом каталоге метрик |
| `SCOPE_REQUIRED` | метрика требует `ScopeId`, а он не передан |
| `SERIES_NOT_AVAILABLE` | у метрики нет ряда (`bHasSeries = false`) |
| `RATE_LIMITED` | клиент превысил свой лимит (§7.4) |
| `SOURCE_UNAVAILABLE` | источник данных не готов: игра не загружена, запись не открыта |

`UNKNOWN_METRIC` важнее, чем выглядит: идентификаторы метрик, пришедшие от модели, сверяются с живым каталогом, а не принимаются из текста (§7.3). Это один из трёх механизмов, которыми закрыта инъекция через авторский текст игрока.

# Лимиты

Стартовые значения, уточняются по замерам S3 на воротах G1:

- Запросы на клиента: 10/с для экранов, 2/с для модели.
- `PageSize` для `ListMetrics`: по умолчанию 50, максимум 200.
- Нижний порог обновления виджета: `SampleIntervalSec` метрики, для `CostClass = heavy` — не чаще 15 с.
- Превышение — `RATE_LIMITED`, а не молчаливое отбрасывание.

# Открытые вопросы

1. **Время в значениях.** Я беру секунды от начала сессии, потому что в v1.0 телеметрия не персистится и окна отсчитываются от запуска (§8.2). Но для записи Recording и отчётов об ошибках нужна и реальная метка. Предлагаю добавить реальную метку в заголовок снимка, а не в каждое значение — решим с Gf2 при формате Recording в S6.
2. **`ScopeId` как строка.** Для предмета это `className`, для электросети — её игровой идентификатор. Типизировать сейчас не берусь: ключ сети выяснится в S3 вместе с `buildingId` (R-19). Строка переживёт любой исход, но проверить форму надо на воротах G1.
3. **`bSidecarConnected` в `GetStatus`.** Это единственное поле, которое тянет в API знание про сайдкар. Альтернатива — отдельный запрос `GetSidecarStatus`. Оставляю в статусе: экрану «Чат» и полосе статуса оно нужно одновременно, а два запроса ради чистоты дадут гонку между ними.
4. **Внешние метрики `ext.<modId>.<name>`.** Пространство имён заморожено сейчас, чтобы в v1.1 не ломать форму идентификатора, но регистрация внешних поставщиков в v0 не реализуется.

# Что от кого требуется дальше

- **Co2** — фасад API для страниц в S6 (неделя 4) строится на этом контракте. **Схемы `list_metrics` и `query_metric` с примерами в `docs/contracts/schemas/` остаются твоими** по плану V-3: я задаю формы и семантику, ты пишешь JSON Schema и примеры, которые проверяет CI. В своём указании в [#4](https://github.com/kkkingqz/ficsit-ai-helper/issues/4) я написал, что схемы приду с контрактом — это было неточно, границу возвращаю к плану.
- **Gf** — источники Live и Fixture в игре (V-2). Fixture должен отдавать те же структуры, иначе экраны разойдутся между игрой и Screen Lab.
- **Gs** — ревью контракта. Больше всего прошу посмотреть пункт 2 открытых вопросов: если ключ электросети окажется нестроковым, это единственное место, где контракт придётся ломать.
- **Gf2** — тест паритета (V-3) проверяет, что у каждой выставленной модели операции есть ручная точка входа. В v0 операций две, обе с путём в «Статистике».
