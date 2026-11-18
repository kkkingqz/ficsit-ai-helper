#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Templates/ValueOrError.h"
#include "FicsitAIApiTypes.h"
#include "IFicsitAIDataSource.h"

class FFicsitAIApiClient;

DECLARE_LOG_CATEGORY_EXTERN(LogFicsitAIApi, Log, All);

/**
 * Идентификаторы метрик и областей непрозрачны и сравниваются с учётом регистра (CheckScope, Gs-109 п. 9).
 * Ключ FString в TMap и TSet движка по умолчанию сравнивается без учёта регистра, и «ScopeA» и «scopea» делили бы
 * одно значение и одну историю (ревью #71). Поэтому все карты по ID в ядре — с этими функциями ключа.
 */
template <typename ValueType>
struct TFicsitAICaseSensitiveMapKeyFuncs : TDefaultMapKeyFuncs<FString, ValueType, false>
{
    static bool Matches(const FString& A, const FString& B) { return A.Equals(B, ESearchCase::CaseSensitive); }
    static uint32 GetKeyHash(const FString& Key) { return FCrc::StrCrc32(*Key); }
};

struct FFicsitAICaseSensitiveSetKeyFuncs : DefaultKeyFuncs<FString>
{
    static bool Matches(const FString& A, const FString& B) { return A.Equals(B, ESearchCase::CaseSensitive); }
    static uint32 GetKeyHash(const FString& Key) { return FCrc::StrCrc32(*Key); }
};

template <typename ValueType>
using TFicsitAIIdMap = TMap<FString, ValueType, FDefaultSetAllocator, TFicsitAICaseSensitiveMapKeyFuncs<ValueType>>;
using FFicsitAIIdSet = TSet<FString, FFicsitAICaseSensitiveSetKeyFuncs>;

/**
 * Состояние и логика API v0 без мира и UObject — поэтому проверяется автотестом без игры.
 *
 * Держит последний снимок источника и ряды за 60 минут, отвечает на запросы, раздаёт события. Всё на GameThread.
 */
class FFicsitAIApiCore : public IFicsitAISnapshotSink, public TSharedFromThis<FFicsitAIApiCore>
{
public:
    /** Версия контракта, которую реализует мод. Источник версии — журнал public-api-v0.md. */
    static const TCHAR* ApiVersion;

    /** Потолок областей в дескрипторе (контракт: AvailableScopes не длиннее 50). */
    static constexpr int32 MaxInlineScopes = 50;
    static constexpr int32 DefaultPageSize = 50;
    static constexpr int32 MaxPageSize = 200;
    /** Самое длинное окно ряда: дальше точки не хранятся. */
    static constexpr double MaxWindowSec = 3600.0;

    template <typename T>
    using TResult = TValueOrError<T, FFicsitAIApiError>;

    /** Clock — секунды для лимита частоты; по умолчанию FPlatformTime::Seconds. Тесты подставляют свои. */
    explicit FFicsitAIApiCore(TFunction<double()> InClock = nullptr);
    virtual ~FFicsitAIApiCore() override;

    TSharedRef<FFicsitAIApiClient> Connect(const FFicsitAIApiClientInfo& Info);
    void SetSource(TSharedPtr<IFicsitAIDataSource> Source);
    void SetModState(const FString& SaveId, bool bInert, const FText& InertReason);
    /** Остановить источник и отпустить клиентов. После этого запросы клиентов отвечают SOURCE_UNAVAILABLE. */
    void Shutdown();

    // IFicsitAISnapshotSink
    virtual void PublishSnapshot(const FFicsitAISnapshot& Snapshot) override;
    virtual void ReportUnavailable(const FText& Reason) override;

    // Запросы. Лимит, инертный режим и версию проверяет подключение до вызова.
    FFicsitAIApiStatus BuildStatus(const FFicsitAIApiClientInfo& Client) const;
    TResult<FFicsitAIMetricPage> ListMetrics(const FFicsitAIListMetricsArgs& Args) const;
    TResult<FFicsitAIScopePage> ListScopes(const FFicsitAIListScopesArgs& Args) const;
    TResult<FFicsitAIValue> QueryMetric(const FString& MetricId, const FString& ScopeId) const;
    TResult<FFicsitAISeries> QuerySeries(const FString& MetricId, EFicsitAISeriesWindow Window, const FString& ScopeId) const;

    /** Инертный режим: по проводке мода или сразу по сетевому режиму мира (Gs-109, п. 6). */
    bool IsInert() const { return bInert || (NetInertProbe && NetInertProbe()); }

    /**
     * Проверка сетевого режима мира без опроса: true — игра не одиночная, мод инертен. Подсистема ставит её при
     * создании, поэтому API клиента в чужой сессии и хоста до первой синхронизации проводки не отдаёт данные.
     */
    void SetNetInertProbe(TFunction<bool()> Probe) { NetInertProbe = MoveTemp(Probe); }
    double Now() const { return Clock(); }

    /** Причина расхождения версий для этого клиента; пусто — мажорные версии совпали или клиент версию не назвал. */
    static FString VersionMismatch(const FFicsitAIApiClientInfo& Client);
    /** Лимит запросов в секунду для вида клиента (§7.4). */
    static double RateLimitPerSec(EFicsitAIApiClientKind Kind);

private:
    struct FPoint
    {
        double Time = 0.0;
        double Value = 0.0;
    };

    struct FMetricState
    {
        FFicsitAIMetricDescriptor Descriptor; // AvailableScopes — полный перечень
        int32 PrecisionDigits = 1;
        TFicsitAIIdMap<FFicsitAIMetricSample> Samples; // по ScopeId
        TFicsitAIIdMap<TArray<FPoint>> Series;         // по ScopeId, по возрастанию времени
    };

    const FMetricState* FindMetric(const FString& MetricId) const;
    TOptional<FFicsitAIApiError> CheckData() const;
    static TOptional<FFicsitAIApiError> CheckScope(const FMetricState& Metric, const FString& ScopeId);
    static TArray<FFicsitAIScopeRef> FilterScopes(const FMetricState& Metric, const FString& Filter);

    void ResetData();
    void BroadcastStatusIfChanged();
    void Broadcast(const FString& Event, TFunctionRef<TSharedRef<FJsonObject>(const FFicsitAIApiClientInfo&)> Data);

    TFunction<double()> Clock;
    TArray<TWeakPtr<FFicsitAIApiClient>> Clients;

    TSharedPtr<IFicsitAIDataSource> Source;
    bool bHasSnapshot = false;
    bool bUnavailable = false;
    FText UnavailableReason;
    double LastSnapshotTime = 0.0;
    TArray<FMetricState> Metrics;
    TFicsitAIIdMap<int32> MetricIndex;

    FString SaveId;
    bool bInert = false;
    TFunction<bool()> NetInertProbe;
    FText InertReason;

    /** Что последним ушло событием api.status: шлём только переходы. */
    FString LastStatusSignature;
};
