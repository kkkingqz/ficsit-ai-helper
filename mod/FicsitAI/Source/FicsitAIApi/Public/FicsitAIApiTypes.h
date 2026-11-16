#pragma once

// Типы публичного API мода, версия 0 (docs/interfaces/public-api-v0.md).
// Перевод контракта в C++, а не вторая его редакция: при расхождении прав документ.

#include "CoreMinimal.h"
#include "FicsitAIApiTypes.generated.h"

/** Откуда пришло значение (§8.5). Несёт каждое значение, показывается в метке свежести. */
UENUM(BlueprintType)
enum class EFicsitAIDataSource : uint8
{
    Live,
    Save,
    SaveEstimated,
    Recorded,
    Fixture,
    Planned
};

/** Есть ли у значения смысл в этом снимке (Gs-13). NotApplicable — нормальное состояние мира, а не сбой. */
UENUM(BlueprintType)
enum class EFicsitAIValueState : uint8
{
    Value,
    NotApplicable
};

/** Единицы (§5.6). Переводы делаются один раз, на границе источника. */
UENUM(BlueprintType)
enum class EFicsitAIUnit : uint8
{
    ItemsPerMinute,
    CubicMetersPerMinute,
    Megawatt,
    MegawattHour,
    Percent,
    Count,
    Seconds
};

/** К чему относится метрика. Line в v0.1 не заполняется. */
UENUM(BlueprintType)
enum class EFicsitAIMetricScope : uint8
{
    Factory,
    PowerNetwork,
    Item,
    MachineType,
    Line
};

/** Окна графиков v1.0 — от начала сессии (§8.2). */
UENUM(BlueprintType)
enum class EFicsitAISeriesWindow : uint8
{
    Last5Min,
    Last15Min,
    Last60Min
};

/** Состояние ассистента (0.5.0). */
UENUM(BlueprintType)
enum class EFicsitAIAssistantState : uint8
{
    Unavailable,
    SigningIn,
    Ready
};

/** Кто подключился к API. Права и лимиты различаются только этим (раздел «Клиенты и их равноправие»). */
UENUM(BlueprintType)
enum class EFicsitAIApiClientKind : uint8
{
    /** Экранный модуль: ручной клиент от имени игрока, 10 запросов в секунду. */
    Screen,
    /** Модель через адаптер: только инструменты белого списка, 2 запроса в секунду. */
    Model,
    /** Другой мод или компьютер FIN (v1.1): ручной клиент, лимит экранов. */
    External
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIScopeRef
{
    GENERATED_BODY()

    /** Непрозрачная для клиента строка: className предмета, id сети. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString ScopeId;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FText DisplayName;
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIMetricDescriptor
{
    GENERATED_BODY()

    /** Устойчивый идентификатор: "power.consumption". Внешние — "ext.<modId>.<name>". */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString Id;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FText DisplayName;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIUnit Unit = EFicsitAIUnit::Count;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIMetricScope Scope = EFicsitAIMetricScope::Factory;
    /** Есть ли временной ряд. Без флага клиент ряд не запрашивает. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") bool bHasSeries = false;
    /** cheap | normal | heavy (§8.2). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FName CostClass = TEXT("normal");
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") float SampleIntervalSec = 5.0f;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") bool bExternal = false;
    /** В ответе — страница областей (не больше 50); у источника — полный перечень. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") TArray<FFicsitAIScopeRef> AvailableScopes;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") bool bScopesTruncated = false;
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIValue
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString MetricId;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString ScopeId;
    /** Value читается только при State == Value (Gs-13). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIValueState State = EFicsitAIValueState::Value;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") double Value = 0.0;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIUnit Unit = EFicsitAIUnit::Count;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIDataSource Source = EFicsitAIDataSource::Live;
    /** Секунды от начала сессии, когда значение снято. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") double SessionTimeSec = 0.0;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") int32 PrecisionDigits = 1;
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAISeries
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString MetricId;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString ScopeId;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAISeriesWindow Window = EFicsitAISeriesWindow::Last15Min;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIUnit Unit = EFicsitAIUnit::Count;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIDataSource Source = EFicsitAIDataSource::Live;
    /** Номинальный шаг сетки, а не гарантия равномерности. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") float IntervalSec = 5.0f;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") TArray<double> Values;
    /** Время каждой точки, той же длины, что Values. Единственный источник времени точки (Gs-3.3). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") TArray<double> Timestamps;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") double FirstPointSessionTimeSec = 0.0;
    /** Сессия короче окна — экран обязан сказать это игроку (AC-04). */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") bool bWindowIncomplete = false;
};

USTRUCT(BlueprintType)
struct FICSITAIAPI_API FFicsitAIApiStatus
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString ApiVersion;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString SaveId;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIDataSource Source = EFicsitAIDataSource::Live;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") bool bInert = false;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") double LastSnapshotSessionTimeSec = 0.0;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") bool bSidecarConnected = false;
    /** Пусто — версии совпали. Иначе причина для игрока, та же у события api.status. */
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString ApiVersionMismatch;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FText Reason;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") EFicsitAIAssistantState AssistantState = EFicsitAIAssistantState::Unavailable;
    UPROPERTY(BlueprintReadOnly, Category = "FICSIT AI|Api") FString AssistantModel;
};

/** Ошибка API: машиночитаемый код из таблицы контракта и текст для игрока. */
struct FICSITAIAPI_API FFicsitAIApiError
{
    FString Code;
    FString Message;

    FFicsitAIApiError() = default;
    FFicsitAIApiError(FString InCode, FString InMessage) : Code(MoveTemp(InCode)), Message(MoveTemp(InMessage)) {}
};

/** Коды ошибок контракта. Клиент обязан трактовать незнакомый код как общую ошибку. */
namespace FicsitAIApiErrors
{
    inline const TCHAR* ModInert = TEXT("MOD_INERT");
    inline const TCHAR* ApiVersionMismatch = TEXT("API_VERSION_MISMATCH");
    inline const TCHAR* UnknownMetric = TEXT("UNKNOWN_METRIC");
    inline const TCHAR* ScopeRequired = TEXT("SCOPE_REQUIRED");
    inline const TCHAR* SeriesNotAvailable = TEXT("SERIES_NOT_AVAILABLE");
    inline const TCHAR* RateLimited = TEXT("RATE_LIMITED");
    inline const TCHAR* ScopeNotFound = TEXT("SCOPE_NOT_FOUND");
    inline const TCHAR* SourceUnavailable = TEXT("SOURCE_UNAVAILABLE");
    inline const TCHAR* InvalidArgument = TEXT("INVALID_ARGUMENT");
    inline const TCHAR* SidecarUnavailable = TEXT("SIDECAR_UNAVAILABLE");
    /** Не из таблицы контракта, а из конверта моста: запроса с таким именем в API нет. */
    inline const TCHAR* UnknownOp = TEXT("UNKNOWN_OP");
}

struct FICSITAIAPI_API FFicsitAIListMetricsArgs
{
    /** Задан — ответ содержит ровно этот дескриптор, и допустимы ScopeFilter и ScopeCursor. */
    FString MetricId;
    TOptional<EFicsitAIMetricScope> Scope;
    /** Подстрока по id и названию метрики. */
    FString Filter;
    TOptional<FString> ScopeFilter;
    TOptional<int32> PageSize;
    FString Cursor;
    TOptional<FString> ScopeCursor;
};

struct FICSITAIAPI_API FFicsitAIMetricPage
{
    TArray<FFicsitAIMetricDescriptor> Metrics;
    FString NextCursor;
    /** Только при заданном MetricId; пусто — областей больше нет. */
    TOptional<FString> NextScopeCursor;
};

struct FICSITAIAPI_API FFicsitAIListScopesArgs
{
    FString MetricId;
    FString ScopeFilter;
    TOptional<int32> PageSize;
    FString Cursor;
};

struct FICSITAIAPI_API FFicsitAIScopePage
{
    TArray<FFicsitAIScopeRef> Scopes;
    FString NextCursor;
};

/** Кто подключается: от этого зависят права, лимит и проверка версии (§5.5). */
struct FICSITAIAPI_API FFicsitAIApiClientInfo
{
    EFicsitAIApiClientKind Kind = EFicsitAIApiClientKind::Screen;
    /** Версия контракта, на которой собран клиент. Сверяется мажорная часть. */
    FString RequiredApiVersion;
    /** Для журнала: "web:statistics", "adapter". */
    FString Name;
};
