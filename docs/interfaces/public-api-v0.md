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
| `apiVersion` | **0.3.0** (журнал версий — в конце документа) |
| Заморожен | Неделя 1–2 вместо недели 6 (решение King 09.11.2026) |
| Зачем раньше плана | Co2 строит фасад API для страниц в S6 на неделе 4. Без замороженного контракта он построит его по эскизу, и переделка попадёт в недели 6–7, где у него уже V-5, V-6 и V-7 |
| Ревью | Gs |
| Источник истины | `ARCHITECTURE.md` §3.6, §5.5, §5.6, §7.1, §7.4, §7.5, §8.2, §8.5, ADR-023, ADR-025 |
| Реализация | V-2 ([#19](https://github.com/kkkingqz/ficsit-ai-helper/issues/19)): Co — API, Gf — источники Live и Fixture в игре, Co2 — фасад для страниц |

**Что значит «заморожен»** (уточнено 10.11.2026, King-1):

- **Добавление** необязательного поля, запроса, события или кода ошибки **поднимает минорную версию** (0.1.0 → 0.2.0). Прежняя формулировка «версию не поднимает» была ошибкой: адаптер сверяет `apiVersion` (§3.3) и иначе не отличил бы контракт с новым запросом от контракта без него, то есть версия перестала бы быть признаком договорённости.
- **Ломающее изменение** — удаление поля или смена смысла. **До ворот G1 оно допустимо через ADR**, потому что кода, опирающегося на контракт, до V-2 нет, а замеры S3 и канал S2 могут показать, что форма неверна. **После G1** — только с мажорной версией и до релиза v1.0 не делается.

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

    /** Доступные экземпляры области: сети, предметы, типы машин. Пусто для Scope = Factory.
     *  Добавлено 10.11.2026 по Gs-3.1: без этого ни экран, ни модель не могли заполнить ScopeId. */
    UPROPERTY(BlueprintReadOnly) TArray<FFicsitAIScopeRef> AvailableScopes;

    /** true — список обрезан потолком 50. Экран берёт полный перечень запросом ListScopes,
     *  модель — тем же ListMetrics с MetricId и ScopeCursor (Gs-8.1). */
    UPROPERTY(BlueprintReadOnly) bool bScopesTruncated = false;
};

USTRUCT(BlueprintType)
struct FFicsitAIScopeRef
{
    GENERATED_BODY()

    /** Непрозрачная для клиента строка. Числовой ключ кодируется строкой без изменения формы контракта. */
    UPROPERTY(BlueprintReadOnly) FString ScopeId;
    UPROPERTY(BlueprintReadOnly) FText DisplayName;
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

    /** Номинальный шаг сетки, а не гарантия равномерности. */
    UPROPERTY(BlueprintReadOnly) float IntervalSec = 5.0f;

    UPROPERTY(BlueprintReadOnly) TArray<double> Values;

    /** Время каждой точки, той же длины, что Values. Добавлено 10.11.2026 по Gs-3.3:
     *  плотный массив с шагом IntervalSec не кодировал пропуски, и две точки в 10 и 20 с
     *  выглядели как 10 и 15 с. Ресемплинга нет — подставленных значений в ряду не бывает. */
    UPROPERTY(BlueprintReadOnly) TArray<double> Timestamps;

    UPROPERTY(BlueprintReadOnly) double FirstPointSessionTimeSec = 0.0;

    /** true — сессия короче запрошенного окна. UI обязан сказать это игроку, а не рисовать пустой график (AC-04). */
    UPROPERTY(BlueprintReadOnly) bool bWindowIncomplete = false;
};
```

# Запросы v0

Все запросы читают **последний снимок**: они дешёвые и не задевают GameThread (§3.6, §8.2). Ни один не инициирует сбор.

| Запрос | Вход | Выход |
|---|---|---|
| `GetStatus` | — | `FFicsitAIApiStatus`: `apiVersion`, `saveId`, текущий `EFicsitAIDataSource`, `bInert`, `LastSnapshotSessionTimeSec`, `bSidecarConnected`, `ApiVersionMismatch`, `Reason` |
| `ListMetrics` | необязательные `MetricId`, фильтр по `Scope` и подстроке, `PageSize`, `Cursor`; `ScopeFilter` и `ScopeCursor` — только вместе с `MetricId` | страница `FFicsitAIMetricDescriptor` плюс `NextCursor`; при заданном `MetricId` — ещё `NextScopeCursor` |
| `QueryMetric` | `MetricId`, необязательный `ScopeId` | `FFicsitAIValue` |
| `QuerySeries` | `MetricId`, `Window`, необязательный `ScopeId` | `FFicsitAISeries` |
| `ListScopes` | `MetricId`, необязательные `ScopeFilter`, `PageSize`, `Cursor` | страница `FFicsitAIScopeRef` плюс `NextCursor` — доступные сети, предметы, типы машин |

`ListMetrics` принимает также необязательные `ScopeFilter` (подстрока по названию области) и `ScopeCursor` — добавлено 10.11.2026 по Gs-5.1. Без них модель, у которой всего два инструмента, не могла получить ключ области за пределом первых 50 в `AvailableScopes`.

**Пагинация областей привязана к одной метрике** (уточнено 10.11.2026 по Gs-8.1). Прежняя форма была дырой: `ScopeCursor` стоял на входе, а на выходе страницы метрик курсора областей не было вовсе, и неясно было, к какой из метрик страницы он относится. Поэтому:

- `ScopeFilter` и `ScopeCursor` допустимы **только вместе с `MetricId`**; иначе — `INVALID_ARGUMENT`. Ответ тогда содержит ровно один дескриптор, и `NextScopeCursor` однозначен.
- `NextScopeCursor` пуст, когда областей больше нет. `bScopesTruncated` при этом остаётся признаком «есть ещё, спроси с курсором» для клиента, который не передал ни фильтра, ни курсора.
- Курсор областей и курсор метрик — разные непрозрачные значения и не взаимозаменяемы. Передача одного вместо другого — `INVALID_ARGUMENT`, а не пустая страница: пустая страница выглядела бы как «областей больше нет».

`ListScopes` остаётся для экранов, где нужен полный перечень; с 0.3.0 он отдаётся страницами в той же форме (`PageSize`, `Cursor`, `NextCursor`), чтобы в контракте была одна пагинация, а не две. Модель `ListScopes` не вызывает — у неё два инструмента (§7 архитектуры), поэтому её путь к областям идёт только через `ListMetrics`.

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

/** Изменилось состояние API: связь с сайдкаром, источник данных, несовпадение версии.
 *  Добавлено 10.11.2026 по Gs-3.4: metrics.snapshot не переносит переход связи, и при
 *  остановившемся сборе чат не узнал бы о падении сайдкара никогда. */
// api.status → { bool bSidecarConnected, EFicsitAIDataSource Source, bool bInert,
//                FString ApiVersionMismatch, FText Reason }
```

Правило частоты относится к `metrics.snapshot`: оно приходит по поступлению снимка, а не по таймеру, и виджет не перерисовывается чаще, чем приходят данные (§8.2). **`api.status` приходит по изменению состояния независимо от снимков** — иначе два правила противоречили бы друг другу (Gs-5.2). Причина несовпадения версии лежит в `ApiVersionMismatch` и `Reason` и у события, и у `GetStatus`: источник один, поэтому клиент, подписавшийся после перехода, получит её первым же чтением — в 1.0-draft это было сделано неверно, и исправление зафиксировано как требование.

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
| `SCOPE_NOT_FOUND` | `ScopeId` неизвестен или исчез — например, электросеть распалась после демонтажа |
| `SOURCE_UNAVAILABLE` | источник данных не готов: игра не загружена, запись не открыта |
| `INVALID_ARGUMENT` | аргументы противоречивы: `ScopeFilter` или `ScopeCursor` без `MetricId`, курсор метрик вместо курсора областей, `PageSize` вне допустимого (Gs-8.1) |

**Клиент обязан трактовать незнакомый код как общую ошибку.** Поэтому добавление нового кода аддитивно и мажорную версию не поднимает; `SCOPE_NOT_FOUND` добавлен так 10.11.2026.

`UNKNOWN_METRIC` важнее, чем выглядит: идентификаторы метрик, пришедшие от модели, сверяются с живым каталогом, а не принимаются из текста (§7.3). Это один из трёх механизмов, которыми закрыта инъекция через авторский текст игрока.

# Канонические формы

Границу с Co2 уточняю (Gs-3.2): **формы запросов, ответов, ошибок и событий — часть контракта и моя работа; файлы JSON Schema и примеры в `docs/contracts/schemas/` — Co2 в V-3.** В [#19](https://github.com/kkkingqz/ficsit-ai-helper/issues/19) я написал, что схемы придут вместе с контрактом, — неточно, границу вернул к плану.

- **Значение против ряда.** `query_metric` различает две формы результата полем-дискриминатором `kind`: `value` без окна и `series` с окном. Угадывать по наличию массива не нужно.
- **Enum** сериализуются строками в lowerCamelCase: `itemsPerMinute`, `megawatt`, `last15Min`, `saveEstimated`.
- **Курсор** — непрозрачная строка. Клиент её не разбирает и не конструирует.
- **Ошибка** — `{ code, message, details? }`, где `code` из таблицы выше.
- **Время** — секунды от начала сессии, число с плавающей точкой. Реальная метка живёт в заголовке снимка, а не в каждом значении (см. открытый вопрос 1).

## Примеры: две формы `query_metric`

Значение — без окна:

```json
{ "op": "queryMetric", "args": { "metricId": "power.consumption" } }
{ "kind": "value", "metricId": "power.consumption", "scopeId": "",
  "value": 412.5, "unit": "megawatt", "source": "live",
  "sessionTimeSec": 1830.2, "precisionDigits": 1 }
```

Ряд — с окном, и здесь пропуск: точки в 1810 и 1830 секунд при номинальном шаге 5 с.

```json
{ "op": "queryMetric", "args": { "metricId": "power.consumption", "window": "last15Min" } }
{ "kind": "series", "metricId": "power.consumption", "scopeId": "",
  "window": "last15Min", "unit": "megawatt", "source": "live",
  "intervalSec": 5.0,
  "values":     [401.0, 412.5],
  "timestamps": [1810.0, 1830.0],
  "firstPointSessionTimeSec": 1810.0,
  "windowIncomplete": false }
```

Пример сокращён: показаны две последние точки окна, а не все. `windowIncomplete` здесь `false`, потому что сессия идёт 1830 с и окно 900 с полное — флаг означает короткую сессию, а не пропуск внутри окна (исправлено 10.11.2026 по Gs-8.2). Пропуск виден только по `timestamps`, и это и есть причина, по которой они в контракте.

**`timestamps` — единственный источник времени точки.** `intervalSec` номинален и для восстановления времён не годится: потребитель прежней формы поставил бы вторую точку в 1815 вместо 1830 и не заметил бы этого. Поэтому фасад для страниц (S6) и наборы Fixture берут обновлённую форму, а не прежнюю (Gs-5.3).

# Журнал версий

| Версия | Дата | Что добавлено |
|---|---|---|
| 0.1.0 | 09.11.2026 | Первая заморозка: `GetStatus`, `ListMetrics`, `QueryMetric`, `QuerySeries`; события `metrics.snapshot`, `mod.inert`; семь кодов ошибок |
| 0.2.0 | 10.11.2026 | По ревью Gs: `ListScopes`, `AvailableScopes` и `bScopesTruncated`, `Timestamps` в ряду, событие `api.status`, код `SCOPE_NOT_FOUND`, `ScopeFilter` и `ScopeCursor` в `ListMetrics`, `ApiVersionMismatch` и `Reason` в статусе |
| 0.3.0 | 10.11.2026 | По Gs-8: `MetricId` на входе `ListMetrics` и `NextScopeCursor` на выходе, пагинация `ListScopes`, код `INVALID_ARGUMENT`. Пагинация областей стала однозначной: курсор привязан к одной метрике |

# Лимиты

Стартовые значения, уточняются по замерам S3 на воротах G1:

- Запросы на клиента: 10/с для экранов, 2/с для модели.
- `PageSize` для `ListMetrics` и `ListScopes`: по умолчанию 50, максимум 200. Вне этих границ — `INVALID_ARGUMENT`.
- Нижний порог обновления виджета: `SampleIntervalSec` метрики, для `CostClass = heavy` — не чаще 15 с.
- Превышение — `RATE_LIMITED`, а не молчаливое отбрасывание.

# Открытые вопросы

1. **Время в значениях.** Я беру секунды от начала сессии, потому что в v1.0 телеметрия не персистится и окна отсчитываются от запуска (§8.2). Но для записи Recording и отчётов об ошибках нужна и реальная метка. Предлагаю добавить реальную метку в заголовок снимка, а не в каждое значение — решим с Gf2 при формате Recording в S6.
2. **`ScopeId` как строка.** Для предмета это `className`, для электросети — её игровой идентификатор. Типизировать сейчас не берусь: ключ сети выяснится в S3 вместе с `buildingId` (R-19). Строка переживёт любой исход, но проверить форму надо на воротах G1.
3. ~~**`bSidecarConnected` в `GetStatus`.**~~ **Решено 10.11.2026** (Gs-3.4): поле остаётся в статусе — экрану «Чат» и полосе статуса оно нужно одновременно, а два запроса ради чистоты дали бы гонку. Переходы связи приходят событием `api.status`, потому что через `metrics.snapshot` они не видны.
4. **Внешние метрики `ext.<modId>.<name>`.** Пространство имён заморожено сейчас, чтобы в v1.1 не ломать форму идентификатора, но регистрация внешних поставщиков в v0 не реализуется.

# Что от кого требуется дальше

- **Co2** — фасад API для страниц в S6 (неделя 4) строится на этом контракте. **Схемы `list_metrics` и `query_metric` с примерами в `docs/contracts/schemas/` остаются твоими** по плану V-3: я задаю формы и семантику, ты пишешь JSON Schema и примеры, которые проверяет CI. В своём указании в [#4](https://github.com/kkkingqz/ficsit-ai-helper/issues/4) я написал, что схемы приду с контрактом — это было неточно, границу возвращаю к плану.
- **Gf** — источники Live и Fixture в игре (V-2). Fixture должен отдавать те же структуры, иначе экраны разойдутся между игрой и Screen Lab.
- **Gs** — ревью контракта. Больше всего прошу посмотреть пункт 2 открытых вопросов: если ключ электросети окажется нестроковым, это единственное место, где контракт придётся ломать.
- **Gf2** — тест паритета (V-3) проверяет, что у каждой выставленной модели операции есть ручная точка входа. В v0 операций две, обе с путём в «Статистике».
