---
title: "FICSIT AI — интерфейсы хоста и экранного модуля"
subtitle: "Эскиз на ревью: IFicsitAIScreenHost и IFicsitAIScreenModule"
author: "Co, технический лидер мода"
date: "09.11.2026"
lang: ru-RU
---

# Статус

| Поле | Значение |
|---|---|
| Что это | **Эскиз**, а не реализация. Поставка Co на неделе 1 для S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)) |
| Кому | Gf — реализует хост и два тестовых модуля в S1; Co2 — строит фасад API для страниц на тех же понятиях |
| Ревью | Gs (решение King 09.11.2026) |
| Источник истины | `ARCHITECTURE.md` §3.1, §3.2.1, §6.1–6.3, §5.3, ADR-001, ADR-023, ADR-026, ADR-029, ADR-030 |
| Проверяется | Условие S1 из §13 и AC-14: каждый модуль открывается в тестовом хосте без изменений кода модуля |

Кода в репозитории пока нет: структуру каталогов создаёт P-2 ([#3](https://github.com/kkkingqz/ficsit-ai-helper/issues/3)). Поэтому эскиз лежит документом, а при появлении структуры переезжает в `mod/FicsitAI/Source/FicsitAIApi/` почти дословно.

# Где это живёт и почему так

Оба интерфейса объявляются в модуле **`FicsitAIApi`**, и это главное ограничение эскиза: `FicsitAIApi` не зависит ни от игры, ни от SML, ни от UMG (§3.2.1, ADR-029). Отсюда следствия, которые нельзя обойти:

- В сигнатурах **нет** типов `AFG*`/`UFG*`, типов SML и типов UMG. Интерфейс не возвращает `UUserWidget*`.
- Модули — виджеты UMG, но живут в `FicsitAIUI`, который зависит только от `FicsitAIApi` и UMG/Slate (ADR-026). Поэтому хост не создаёт виджеты сам, а просит **фабрику**: `IFicsitAIScreenModuleFactory` объявлена в `FicsitAIApi`, реализована в `FicsitAIUI`.
- Хост — игровой объект и живёт в `FicsitAICore`. Направление зависимостей: `FicsitAICore` → `FicsitAIUI` → `FicsitAIApi`. Обратных стрелок нет.

Это позволяет Screen Lab и автотестам поднимать модули вообще без игры (ADR-026, AC-20): там свой хост, своя фабрика не нужна, источник данных сменный (§8.5).

# Контекст, который хост даёт модулю

Модуль не знает, в каком хосте открыт, и получает всё через контекст. Состав — ровно то, что §6.3 требует от модуля, и ничего сверх:

```cpp
UENUM(BlueprintType)
enum class EFicsitAIScreenLayout : uint8
{
    Slots1,       // один слот main
    Slots2,       // main + side
    Slots3,       // main + side + foot
    HudCompact    // v1.4, HUD при AI Assistant
};

UENUM(BlueprintType)
enum class EFicsitAIHostState : uint8
{
    Ready,        // хост работает
    NoPower,      // терминал без питания (§6.1): модули не открываются
    Inert         // мультиплеерная сессия или вход удалённого игрока (§4.2)
};

USTRUCT(BlueprintType)
struct FFicsitAIScreenContext
{
    GENERATED_BODY()

    /** Идентификатор сохранения (§10). Ключ всего состояния мода. */
    UPROPERTY(BlueprintReadOnly) FString SaveId;

    /** Кто открыл: AI Terminal, AI Assistant (v1.4), тестовый хост, Screen Lab. */
    UPROPERTY(BlueprintReadOnly) FName HostId;

    /** Пресет раскладки (§5.3). Свободной сетки нет сознательно. */
    UPROPERTY(BlueprintReadOnly) EFicsitAIScreenLayout Layout = EFicsitAIScreenLayout::Slots3;

    /** Размер области модуля в пикселях и её пропорция. */
    UPROPERTY(BlueprintReadOnly) FIntPoint SizePx = FIntPoint::ZeroValue;
    UPROPERTY(BlueprintReadOnly) float AspectRatio = 16.0f / 9.0f;

    /** true — модуль рисуется в render target меша, значит 16:9 жёстко (§6.6, ADR-030). */
    UPROPERTY(BlueprintReadOnly) bool bWorldSurface = false;

    UPROPERTY(BlueprintReadOnly) EFicsitAIHostState HostState = EFicsitAIHostState::Ready;

    /** true — модуль получает ввод; false — только отображение. */
    UPROPERTY(BlueprintReadOnly) bool bHasInputFocus = false;

    /** Публичный API мода (§3.6). Единственный путь модуля к данным и операциям. */
    UPROPERTY(BlueprintReadOnly) TScriptInterface<IFicsitAIApi> Api;
};
```

**Чего в контексте нет и не будет:** указателей на терминал, на подсистемы игры, на `CatalogProvider` и `TelemetrySampler`. Модуль ходит за данными только через `Api` (ADR-023) — иначе экраны перестанут открываться вне игры, а AC-19 проверяет обратное.

**Чего в контексте нет по другой причине:** состояния сайдкара. «Не подключено» — это свойство API, а не хоста, и модуль узнаёт его из API (`mod.inert` — исключение, оно про хост). Иначе каждый хост пришлось бы учить знать про сайдкар.

# Экранный модуль

```cpp
UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenModule : public UInterface { GENERATED_BODY() };

class IFicsitAIScreenModule
{
    GENERATED_BODY()
public:
    /** Устойчивый идентификатор: "dashboard", "chat", "notes", … Ключ состояния и назначения экрана. */
    virtual FName GetModuleId() const = 0;

    /** Минимальная версия публичного API, нужная модулю (§5.5). Хост не открывает модуль при несовместимой мажорной. */
    virtual FString GetRequiredApiVersion() const = 0;

    /** Модуль открыт в хосте. Подписки на события API — здесь. */
    virtual void OnAttach(const FFicsitAIScreenContext& Context) = 0;

    /** Контекст изменился: размер, раскладка, фокус ввода, состояние хоста. Пересоздания нет. */
    virtual void OnContextChanged(const FFicsitAIScreenContext& Context) = 0;

    /** Модуль закрыт или хост выключается. Отписки — здесь. */
    virtual void OnDetach() = 0;

    /** Состояние модуля для сохранения в состоянии мода (§10), не в хосте. Пустая строка — нечего хранить. */
    virtual FString SavePersistentState() const { return FString(); }
    virtual void RestorePersistentState(const FString& State) {}

    /** Нужен ли модулю ввод: по нему хост решает, отдавать ли фокус и показывать ли курсор. */
    virtual bool WantsInputFocus() const { return true; }
};
```

# Хост

```cpp
UINTERFACE(MinimalAPI, BlueprintType)
class UFicsitAIScreenHost : public UInterface { GENERATED_BODY() };

class IFicsitAIScreenHost
{
    GENERATED_BODY()
public:
    virtual FFicsitAIScreenContext GetScreenContext() const = 0;

    /** Какие модули этот хост может открыть. Пункты будущих версий здесь не появляются (§6.7). */
    virtual TArray<FName> GetAvailableModules() const = 0;

    /** Открыть модуль. false — несовместимая версия API, нет такого модуля или HostState != Ready. */
    virtual bool OpenModule(FName ModuleId) = 0;
    virtual void CloseActiveModule() = 0;
    virtual FName GetActiveModuleId() const = 0;

    /** Модуль просит фокус ввода (поле чата) или отдаёт его. Решение за хостом. */
    virtual void RequestInputFocus(bool bWanted) = 0;

    /** Содержимое изменилось — хосту пора обновить экран в мире по renderRevision (§6.6, §10.1). */
    virtual void NotifyContentChanged() = 0;
};

/** Объявлена в FicsitAIApi, реализована в FicsitAIUI: так Core не зависит от UMG. */
UINTERFACE(MinimalAPI)
class UFicsitAIScreenModuleFactory : public UInterface { GENERATED_BODY() };

class IFicsitAIScreenModuleFactory
{
    GENERATED_BODY()
public:
    virtual TArray<FName> GetRegisteredModules() const = 0;
    virtual TScriptInterface<IFicsitAIScreenModule> CreateModule(FName ModuleId, UObject* Outer) = 0;
};
```

# Правила, которые эскиз навязывает

1. **Модуль не кастуется к хосту.** Нигде в `FicsitAIUI` не должно быть имени класса терминала. Это проверяется в S1 тестовым хостом (AC-14), и это же предлагаю добавить как grep-правило в инварианты CI (P-4): к трём правилам ADR-029 добавляется четвёртое.
2. **Данные и операции — только через `Api`.** Прямого доступа к подсистемам нет ни у одного модуля (ADR-023, AC-19).
3. **Состояние модуля — в состоянии мода по `saveId`**, не в хосте и не в виджете. Хост сохраняет то, что вернул `SavePersistentState`, и возвращает его при следующем `OnAttach`.
4. **Пересоздание вместо правки контекста не допускается.** Смена размера, раскладки и фокуса идёт через `OnContextChanged`: иначе на каждом переключении поедут скролл чата и окна графиков.
5. **`HostState != Ready` — модули не открываются.** Без питания терминал показывает только статус (§6.1), в инертном режиме UI закрыт (§4.2). Это забота хоста, а не каждого модуля.
6. **`bWorldSurface` обязывает к 16:9.** Модуль, попавший на меш, компонуется в этой пропорции, а редактор Screens показывает предпросмотр в обеих (ADR-030, AC-02).
7. **Версия API проверяется до открытия**, а не падением внутри модуля (§5.5).
8. **Ничего блокирующего.** Сеть и тяжёлые вычисления — не в модуле; модуль перерисовывается по событиям API (§8.2: частота обновления виджета не выше частоты данных).

# Открытые вопросы — к Gf, решаем на неделе 2

1. **Чем ключевать состояние модуля:** `(saveId, moduleId)` или `(saveId, hostId, moduleId)`. Первое проще и переносит состояние между терминалами; второе даёт каждому терминалу свой скролл и свой выбор метрики. Я склоняюсь к первому в v0.1 с запасом на второе в ключе.
2. **Жизнь экземпляров модуля при переключении:** держать живыми или пересоздавать. Дешевле держать, но тогда `OnDetach` не освобождает подписки — нужен третий метод или правило «отписка в `OnDetach`, экземпляр переживает». Прошу замер на двух тестовых модулях в S1.
3. **Enhanced Input:** объявляет ли модуль нужные ему действия или весь набор держит хост. Склоняюсь ко второму — иначе действия модулей не попадут в штатное меню переназначения, которое S1 как раз и проверяет (§2.3, A5).
4. **`NotifyContentChanged` против события API.** Возможно, хосту достаточно подписки на события API и этот метод лишний. Проверим на экране в мире в S4; пока оставляю, потому что убрать метод дешевле, чем добавить.

# Что я жду обратно

От Gf — реализацию хоста в терминале и два тестовых модуля, открывающиеся и в терминале, и в тестовом хосте без изменений кода модуля, плюс ответы на четыре вопроса выше по опыту реализации. От Gs — ревью эскиза до начала S1, в первую очередь пункта про направление зависимостей: если `FicsitAICore` → `FicsitAIUI` окажется неудобным, лучше узнать это сейчас, а не на неделе 6.
