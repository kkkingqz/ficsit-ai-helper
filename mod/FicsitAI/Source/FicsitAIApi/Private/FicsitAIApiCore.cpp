#include "FicsitAIApiCore.h"

#include "FicsitAIApiClient.h"
#include "FicsitAIApiJson.h"
#include "HAL/PlatformTime.h"

DEFINE_LOG_CATEGORY(LogFicsitAIApi);

const TCHAR* FFicsitAIApiCore::ApiVersion = TEXT("0.5.0");

namespace
{
using FicsitAI::ApiJson::ToString;

FFicsitAIApiError ApiError(const TCHAR* Code, const FString& Message)
{
    return FFicsitAIApiError(Code, Message);
}

FString MajorOf(const FString& Version)
{
    FString Major;
    return Version.Split(TEXT("."), &Major, nullptr) ? Major : Version;
}

/** Курсор метрик: "m:<смещение>". Непрозрачен для клиента, разбирается строго. */
FString MetricCursor(int32 Offset)
{
    return FString::Printf(TEXT("m:%d"), Offset);
}

/** Курсор областей привязан к метрике (Gs-8.1): "s:<смещение>:<metricId>". */
FString ScopeCursor(int32 Offset, const FString& MetricId)
{
    return FString::Printf(TEXT("s:%d:%s"), Offset, *MetricId);
}

bool ParseOffset(const FString& Text, int32& Out)
{
    if (Text.IsEmpty() || Text.Len() > 9)
    {
        return false;
    }
    for (const TCHAR Ch : Text)
    {
        if (!FChar::IsDigit(Ch))
        {
            return false;
        }
    }
    Out = FCString::Atoi(*Text);
    return true;
}

TOptional<FFicsitAIApiError> ParseMetricCursor(const FString& Cursor, int32& OutOffset)
{
    OutOffset = 0;
    if (Cursor.IsEmpty())
    {
        return {};
    }
    if (Cursor.StartsWith(TEXT("s:"), ESearchCase::CaseSensitive))
    {
        // Курсор областей вместо курсора метрик — отказ, а не пустая страница (Gs-8.1).
        return ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("передан курсор областей вместо курсора метрик"));
    }
    if (!Cursor.StartsWith(TEXT("m:"), ESearchCase::CaseSensitive) || !ParseOffset(Cursor.Mid(2), OutOffset))
    {
        return ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("курсор метрик не разобран"));
    }
    return {};
}

TOptional<FFicsitAIApiError> ParseScopeCursor(const FString& Cursor, const FString& MetricId, int32& OutOffset)
{
    OutOffset = 0;
    if (Cursor.IsEmpty())
    {
        return {};
    }
    if (Cursor.StartsWith(TEXT("m:"), ESearchCase::CaseSensitive))
    {
        return ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("передан курсор метрик вместо курсора областей"));
    }
    FString OffsetText;
    FString CursorMetric;
    if (!Cursor.StartsWith(TEXT("s:"), ESearchCase::CaseSensitive)
        || !Cursor.Mid(2).Split(TEXT(":"), &OffsetText, &CursorMetric)
        || !ParseOffset(OffsetText, OutOffset))
    {
        return ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("курсор областей не разобран"));
    }
    if (!CursorMetric.Equals(MetricId, ESearchCase::CaseSensitive))
    {
        return ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("курсор областей выдан для другой метрики"));
    }
    return {};
}

TOptional<FFicsitAIApiError> CheckPageSize(const TOptional<int32>& PageSize, int32& Out)
{
    Out = PageSize.Get(FFicsitAIApiCore::DefaultPageSize);
    if (Out < 1 || Out > FFicsitAIApiCore::MaxPageSize)
    {
        return ApiError(FicsitAIApiErrors::InvalidArgument,
            FString::Printf(TEXT("pageSize вне границ 1…%d"), FFicsitAIApiCore::MaxPageSize));
    }
    return {};
}

bool Contains(const FString& Haystack, const FString& Needle)
{
    return Haystack.Contains(Needle, ESearchCase::IgnoreCase);
}

/** Описание метрики для клиента не изменилось: те же поля и тот же перечень областей в том же порядке. */
bool SameDescriptor(const FFicsitAIMetricDescriptor& A, const FFicsitAIMetricDescriptor& B)
{
    if (A.Id != B.Id || !A.DisplayName.EqualTo(B.DisplayName)
        || A.Unit != B.Unit || A.Scope != B.Scope || A.bHasSeries != B.bHasSeries || A.CostClass != B.CostClass
        || A.SampleIntervalSec != B.SampleIntervalSec || A.bExternal != B.bExternal
        || A.AvailableScopes.Num() != B.AvailableScopes.Num())
    {
        return false;
    }
    for (int32 Index = 0; Index < A.AvailableScopes.Num(); ++Index)
    {
        const FFicsitAIScopeRef& X = A.AvailableScopes[Index];
        const FFicsitAIScopeRef& Y = B.AvailableScopes[Index];
        if (!X.ScopeId.Equals(Y.ScopeId, ESearchCase::CaseSensitive) || !X.DisplayName.EqualTo(Y.DisplayName))
        {
            return false;
        }
    }
    return true;
}

bool SameSample(const FFicsitAIMetricSample& A, const FFicsitAIMetricSample& B)
{
    return A.State == B.State && A.SessionTimeSec == B.SessionTimeSec
        && (A.State == EFicsitAIValueState::NotApplicable || A.Value == B.Value);
}
} // namespace

FFicsitAIApiCore::FFicsitAIApiCore(TFunction<double()> InClock)
    : Clock(InClock ? MoveTemp(InClock) : TFunction<double()>([] { return FPlatformTime::Seconds(); }))
{
}

FFicsitAIApiCore::~FFicsitAIApiCore()
{
    if (Source.IsValid())
    {
        Source->Stop();
    }
}

TSharedRef<FFicsitAIApiClient> FFicsitAIApiCore::Connect(const FFicsitAIApiClientInfo& Info)
{
    TSharedRef<FFicsitAIApiClient> Client = MakeShareable(new FFicsitAIApiClient(AsShared(), Info, Clock()));
    Clients.RemoveAll([](const TWeakPtr<FFicsitAIApiClient>& Weak) { return !Weak.IsValid(); });
    Clients.Add(Client);

    const FString Mismatch = VersionMismatch(Info);
    UE_LOG(LogFicsitAIApi, Log, TEXT("FicsitAI API: подключён клиент «%s» (API %s)%s"),
        *Info.Name, *Info.RequiredApiVersion, Mismatch.IsEmpty() ? TEXT("") : *(TEXT(": ") + Mismatch));
    return Client;
}

void FFicsitAIApiCore::SetSource(TSharedPtr<IFicsitAIDataSource> NewSource)
{
    if (Source == NewSource)
    {
        return;
    }
    if (Source.IsValid())
    {
        Source->Stop();
    }
    ResetData();
    Source = MoveTemp(NewSource);
    UE_LOG(LogFicsitAIApi, Log, TEXT("FicsitAI API: источник данных — %s"),
        Source.IsValid() ? *ToString(Source->GetKind()) : TEXT("нет"));
    BroadcastStatusIfChanged();
    if (Source.IsValid())
    {
        Source->Start(*this);
    }
}

void FFicsitAIApiCore::SetModState(const FString& InSaveId, bool bInInert, const FText& InInertReason)
{
    SaveId = InSaveId;
    const bool bInertChanged = bInert != bInInert;
    bInert = bInInert;
    InertReason = bInInert ? InInertReason : FText::GetEmpty();
    if (bInertChanged)
    {
        UE_LOG(LogFicsitAIApi, Log, TEXT("FicsitAI API: инертный режим %s"), bInert ? TEXT("включён") : TEXT("выключен"));
        Broadcast(TEXT("mod.inert"), [this](const FFicsitAIApiClientInfo&)
        {
            TSharedRef<FJsonObject> Data = MakeShared<FJsonObject>();
            Data->SetBoolField(TEXT("inert"), bInert);
            Data->SetStringField(TEXT("reason"), InertReason.ToString());
            return Data;
        });
    }
    BroadcastStatusIfChanged();
}

void FFicsitAIApiCore::Shutdown()
{
    if (Source.IsValid())
    {
        Source->Stop();
        Source.Reset();
    }
    ResetData();
    for (const TWeakPtr<FFicsitAIApiClient>& Weak : Clients)
    {
        if (const TSharedPtr<FFicsitAIApiClient> Client = Weak.Pin())
        {
            Client->Core.Reset();
        }
    }
    Clients.Reset();
}

void FFicsitAIApiCore::ResetData()
{
    bHasSnapshot = false;
    bUnavailable = false;
    UnavailableReason = FText::GetEmpty();
    LastSnapshotTime = 0.0;
    Metrics.Reset();
    MetricIndex.Reset();
}

void FFicsitAIApiCore::PublishSnapshot(const FFicsitAISnapshot& Snapshot)
{
    if (!FMath::IsFinite(Snapshot.SessionTimeSec) || (bHasSnapshot && Snapshot.SessionTimeSec < LastSnapshotTime))
    {
        UE_LOG(LogFicsitAIApi, Warning, TEXT("FicsitAI API: снимок отброшен — время %f раньше прежнего %f"),
            Snapshot.SessionTimeSec, LastSnapshotTime);
        return;
    }

    TArray<FMetricState> Fresh;
    TMap<FString, int32> FreshIndex;
    TArray<FString> Changed;
    Fresh.Reserve(Snapshot.Metrics.Num());

    for (const FFicsitAIMetricSnapshot& In : Snapshot.Metrics)
    {
        const FString& Id = In.Descriptor.Id;
        if (Id.IsEmpty() || FreshIndex.Contains(Id))
        {
            UE_LOG(LogFicsitAIApi, Warning, TEXT("FicsitAI API: метрика «%s» пропущена — пустой или повторный id"), *Id);
            continue;
        }
        const FMetricState* Previous = FindMetric(Id);

        FMetricState& State = Fresh.AddDefaulted_GetRef();
        State.Descriptor = In.Descriptor;
        State.Descriptor.bScopesTruncated = false;
        State.PrecisionDigits = In.PrecisionDigits;
        // Изменилось описание или перечень областей — тоже изменение: «Статистика» обновляет только
        // перечисленные метрики и иначе держала бы старый каталог (Gs-109, п. 3).
        bool bChanged = Previous == nullptr || !SameDescriptor(Previous->Descriptor, In.Descriptor)
            || Previous->PrecisionDigits != In.PrecisionDigits;

        TSet<FString> Known;
        Known.Reserve(In.Descriptor.AvailableScopes.Num());
        for (const FFicsitAIScopeRef& Scope : In.Descriptor.AvailableScopes)
        {
            Known.Add(Scope.ScopeId);
        }

        for (const FFicsitAIMetricSample& Sample : In.Samples)
        {
            const bool bFactory = In.Descriptor.Scope == EFicsitAIMetricScope::Factory;
            const bool bScopeOk = bFactory ? Sample.ScopeId.IsEmpty() : Known.Contains(Sample.ScopeId);
            const bool bNumberOk = (Sample.State == EFicsitAIValueState::NotApplicable || FMath::IsFinite(Sample.Value))
                && FMath::IsFinite(Sample.SessionTimeSec);
            // Значение из будущего снимка заняло бы окно и вытеснило бы последующие нормальные точки (Gs-109, п. 4).
            const bool bTimeOk = bNumberOk && Sample.SessionTimeSec <= Snapshot.SessionTimeSec;
            if (!bScopeOk || !bNumberOk || !bTimeOk)
            {
                // NaN в JSON не пишется вовсе, а значение чужой области экран не найдёт: отбрасываем у границы.
                UE_LOG(LogFicsitAIApi, Warning, TEXT("FicsitAI API: значение «%s» / «%s» отброшено — %s"), *Id, *Sample.ScopeId,
                    !bScopeOk ? TEXT("области нет в перечне") : !bNumberOk ? TEXT("не конечное число") : TEXT("время позже снимка"));
                continue;
            }
            const FFicsitAIMetricSample* Old = Previous ? Previous->Samples.Find(Sample.ScopeId) : nullptr;
            bChanged |= Old == nullptr || !SameSample(*Old, Sample);
            State.Samples.Add(Sample.ScopeId, Sample);
        }
        bChanged |= Previous && Previous->Samples.Num() != State.Samples.Num();

        // Ряды переезжают из прежнего снимка: история живёт в API, а не в источнике.
        if (State.Descriptor.bHasSeries)
        {
            if (Previous && Previous->Descriptor.bHasSeries)
            {
                for (const TPair<FString, TArray<FPoint>>& Pair : Previous->Series)
                {
                    if (State.Descriptor.Scope == EFicsitAIMetricScope::Factory ? Pair.Key.IsEmpty() : Known.Contains(Pair.Key))
                    {
                        State.Series.Add(Pair.Key, Pair.Value);
                    }
                }
            }
            for (const TPair<FString, FFicsitAIMetricSample>& Pair : State.Samples)
            {
                const FFicsitAIMetricSample& Sample = Pair.Value;
                // Неприменимые точки в ряд не пишутся: разрыв линии и есть «нет значения» (Gs-13).
                if (Sample.State != EFicsitAIValueState::Value)
                {
                    continue;
                }
                TArray<FPoint>& Points = State.Series.FindOrAdd(Pair.Key);
                if (Points.IsEmpty() || Sample.SessionTimeSec > Points.Last().Time)
                {
                    Points.Add({Sample.SessionTimeSec, Sample.Value});
                }
            }
            // Час обрезается у всех рядов, и у областей, по которым в этом снимке значения нет (Gs-109, п. 4).
            const double Oldest = Snapshot.SessionTimeSec - MaxWindowSec;
            for (auto It = State.Series.CreateIterator(); It; ++It)
            {
                TArray<FPoint>& Points = It.Value();
                int32 Drop = 0;
                while (Drop < Points.Num() && Points[Drop].Time < Oldest)
                {
                    ++Drop;
                }
                if (Drop > 0)
                {
                    Points.RemoveAt(0, Drop, EAllowShrinking::No);
                }
                if (Points.IsEmpty())
                {
                    It.RemoveCurrent();
                }
            }
        }

        FreshIndex.Add(Id, Fresh.Num() - 1);
        if (bChanged)
        {
            Changed.Add(Id);
        }
    }

    // Исчезнувшая метрика — тоже изменение: клиент, не найдя её в каталоге, убирает её с экрана.
    for (const FMetricState& Old : Metrics)
    {
        if (!FreshIndex.Contains(Old.Descriptor.Id))
        {
            Changed.Add(Old.Descriptor.Id);
        }
    }

    Metrics = MoveTemp(Fresh);
    MetricIndex = MoveTemp(FreshIndex);
    bHasSnapshot = true;
    bUnavailable = false;
    UnavailableReason = FText::GetEmpty();
    LastSnapshotTime = Snapshot.SessionTimeSec;
    BroadcastStatusIfChanged();

    if (IsInert())
    {
        return;
    }
    const EFicsitAIDataSource Kind = Source.IsValid() ? Source->GetKind() : EFicsitAIDataSource::Live;
    Broadcast(TEXT("metrics.snapshot"), [&](const FFicsitAIApiClientInfo&)
    {
        TSharedRef<FJsonObject> Data = MakeShared<FJsonObject>();
        Data->SetNumberField(TEXT("sessionTimeSec"), Snapshot.SessionTimeSec);
        TArray<TSharedPtr<FJsonValue>> Ids;
        for (const FString& Id : Changed)
        {
            Ids.Add(MakeShared<FJsonValueString>(Id));
        }
        Data->SetArrayField(TEXT("changedMetricIds"), Ids);
        Data->SetStringField(TEXT("source"), ToString(Kind));
        return Data;
    });
}

void FFicsitAIApiCore::ReportUnavailable(const FText& Reason)
{
    bUnavailable = true;
    UnavailableReason = Reason;
    UE_LOG(LogFicsitAIApi, Log, TEXT("FicsitAI API: источник недоступен — %s"), *Reason.ToString());
    BroadcastStatusIfChanged();
}

FString FFicsitAIApiCore::VersionMismatch(const FFicsitAIApiClientInfo& Client)
{
    if (Client.RequiredApiVersion.IsEmpty() || MajorOf(Client.RequiredApiVersion) == MajorOf(ApiVersion))
    {
        return FString();
    }
    return FString::Printf(TEXT("клиент «%s» собран на API %s, мод отдаёт %s"), *Client.Name, *Client.RequiredApiVersion, ApiVersion);
}

double FFicsitAIApiCore::RateLimitPerSec(EFicsitAIApiClientKind Kind)
{
    return Kind == EFicsitAIApiClientKind::Model ? 2.0 : 10.0;
}

FFicsitAIApiStatus FFicsitAIApiCore::BuildStatus(const FFicsitAIApiClientInfo& Client) const
{
    FFicsitAIApiStatus Status;
    Status.ApiVersion = ApiVersion;
    Status.SaveId = SaveId;
    Status.Source = Source.IsValid() ? Source->GetKind() : EFicsitAIDataSource::Live;
    Status.bInert = IsInert();
    Status.LastSnapshotSessionTimeSec = LastSnapshotTime;
    // Канал к сайдкару в продукте ещё никто не поднимает (S2): связи нет, ассистент недоступен.
    Status.bSidecarConnected = false;
    Status.AssistantState = EFicsitAIAssistantState::Unavailable;
    Status.ApiVersionMismatch = VersionMismatch(Client);

    // Причина — самое важное для игрока: инертный режим, затем расхождение версий, затем данные, затем ассистент.
    // Расхождение версий видно в Reason и при инертном режиме: контракт требует его в обоих полях (Gs-109, п. 6).
    TArray<FString> Reasons;
    if (Status.bInert)
    {
        Reasons.Add((bInert && !InertReason.IsEmpty() ? InertReason : NSLOCTEXT("FicsitAIApi", "Inert", "Мод в инертном режиме: мультиплеерная сессия")).ToString());
    }
    if (!Status.ApiVersionMismatch.IsEmpty())
    {
        Reasons.Add(Status.ApiVersionMismatch);
    }
    if (Reasons.IsEmpty())
    {
        if (const TOptional<FFicsitAIApiError> DataError = CheckData())
        {
            Reasons.Add(DataError->Message);
        }
        else
        {
            // Ассистент недоступен всегда, пока нет канала S2: причина не должна быть пустой (Gs-109, п. 10).
            Reasons.Add(TEXT("ассистент недоступен: нет связи с сайдкаром"));
        }
    }
    Status.Reason = FText::FromString(FString::Join(Reasons, TEXT("; ")));
    return Status;
}

void FFicsitAIApiCore::BroadcastStatusIfChanged()
{
    // Переход отслеживается по общему для всех клиентов: расхождение версий у клиента постоянно и перехода не даёт.
    const FFicsitAIApiStatus Common = BuildStatus(FFicsitAIApiClientInfo());
    const FString Signature = FString::Printf(TEXT("%d|%d|%d|%d|%s"),
        static_cast<int32>(Common.Source), Common.bInert ? 1 : 0, Common.bSidecarConnected ? 1 : 0,
        static_cast<int32>(Common.AssistantState), *Common.Reason.ToString());
    if (Signature == LastStatusSignature)
    {
        return;
    }
    LastStatusSignature = Signature;
    Broadcast(TEXT("api.status"), [this](const FFicsitAIApiClientInfo& Client)
    {
        return FicsitAI::ApiJson::StatusEventJson(BuildStatus(Client));
    });
}

void FFicsitAIApiCore::Broadcast(const FString& Event, TFunctionRef<TSharedRef<FJsonObject>(const FFicsitAIApiClientInfo&)> Data)
{
    // Копия: обработчик события может подключить или отключить клиента.
    const TArray<TWeakPtr<FFicsitAIApiClient>> Snapshot = Clients;
    for (const TWeakPtr<FFicsitAIApiClient>& Weak : Snapshot)
    {
        const TSharedPtr<FFicsitAIApiClient> Client = Weak.Pin();
        if (Client.IsValid() && Client->OnEvent && Client->Core.IsValid() && Client->AcceptsEvent(Event))
        {
            // Копия обработчика: он может отключить своего клиента, и сброс OnEvent уничтожил бы захват
            // посреди вызова (Gs-109, п. 5). Client держит само подключение до конца итерации.
            const FFicsitAIApiClient::FEventHandler Handler = Client->OnEvent;
            Handler(Event, Data(Client->Info));
        }
    }
}

const FFicsitAIApiCore::FMetricState* FFicsitAIApiCore::FindMetric(const FString& MetricId) const
{
    const int32* Index = MetricIndex.Find(MetricId);
    return Index ? &Metrics[*Index] : nullptr;
}

TOptional<FFicsitAIApiError> FFicsitAIApiCore::CheckData() const
{
    if (!Source.IsValid())
    {
        return ApiError(FicsitAIApiErrors::SourceUnavailable, TEXT("источник данных не подключён"));
    }
    if (bUnavailable)
    {
        return ApiError(FicsitAIApiErrors::SourceUnavailable,
            UnavailableReason.IsEmpty() ? FString(TEXT("источник данных недоступен")) : UnavailableReason.ToString());
    }
    if (!bHasSnapshot)
    {
        return ApiError(FicsitAIApiErrors::SourceUnavailable, TEXT("первого снимка ещё нет"));
    }
    return {};
}

TOptional<FFicsitAIApiError> FFicsitAIApiCore::CheckScope(const FMetricState& Metric, const FString& ScopeId)
{
    const FString& Id = Metric.Descriptor.Id;
    if (Metric.Descriptor.Scope == EFicsitAIMetricScope::Factory)
    {
        // Фабричной метрике область не нужна, но выдуманную она не принимает.
        if (!ScopeId.IsEmpty())
        {
            return ApiError(FicsitAIApiErrors::ScopeNotFound, FString::Printf(TEXT("у метрики «%s» нет областей"), *Id));
        }
        return {};
    }
    if (ScopeId.IsEmpty())
    {
        return ApiError(FicsitAIApiErrors::ScopeRequired, FString::Printf(TEXT("метрике «%s» нужен scopeId"), *Id));
    }
    for (const FFicsitAIScopeRef& Scope : Metric.Descriptor.AvailableScopes)
    {
        if (Scope.ScopeId.Equals(ScopeId, ESearchCase::CaseSensitive))
        {
            return {};
        }
    }
    return ApiError(FicsitAIApiErrors::ScopeNotFound, FString::Printf(TEXT("области «%s» у метрики «%s» нет"), *ScopeId, *Id));
}

TArray<FFicsitAIScopeRef> FFicsitAIApiCore::FilterScopes(const FMetricState& Metric, const FString& Filter)
{
    const FString Needle = Filter.TrimStartAndEnd();
    if (Needle.IsEmpty())
    {
        return Metric.Descriptor.AvailableScopes;
    }
    // Фильтр — до выбора страницы, иначе на фильтр без совпадений приходила бы полная страница.
    return Metric.Descriptor.AvailableScopes.FilterByPredicate([&Needle](const FFicsitAIScopeRef& Scope)
    {
        return Contains(Scope.DisplayName.ToString(), Needle) || Contains(Scope.ScopeId, Needle);
    });
}

FFicsitAIApiCore::TResult<FFicsitAIMetricPage> FFicsitAIApiCore::ListMetrics(const FFicsitAIListMetricsArgs& Args) const
{
    int32 PageSize = 0;
    if (TOptional<FFicsitAIApiError> Bad = CheckPageSize(Args.PageSize, PageSize))
    {
        return MakeError(Bad.GetValue());
    }
    if (Args.MetricId.IsEmpty() && (Args.ScopeFilter.IsSet() || Args.ScopeCursor.IsSet()))
    {
        return MakeError(ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("scopeFilter и scopeCursor допустимы только вместе с metricId")));
    }
    if (!Args.MetricId.IsEmpty() && !Args.Cursor.IsEmpty())
    {
        // С metricId ответ — один дескриптор, курсора метрик у него нет; курсор областей идёт в scopeCursor (Gs-109, п. 1).
        return MakeError(ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("с metricId курсор передаётся в scopeCursor, а не в cursor")));
    }
    if (TOptional<FFicsitAIApiError> NoData = CheckData())
    {
        return MakeError(NoData.GetValue());
    }

    FFicsitAIMetricPage Page;
    if (!Args.MetricId.IsEmpty())
    {
        const FMetricState* Metric = FindMetric(Args.MetricId);
        if (!Metric)
        {
            return MakeError(ApiError(FicsitAIApiErrors::UnknownMetric, FString::Printf(TEXT("метрики «%s» нет в каталоге"), *Args.MetricId)));
        }
        int32 Offset = 0;
        if (TOptional<FFicsitAIApiError> Bad = ParseScopeCursor(Args.ScopeCursor.Get(FString()), Metric->Descriptor.Id, Offset))
        {
            return MakeError(Bad.GetValue());
        }
        const TArray<FFicsitAIScopeRef> All = FilterScopes(*Metric, Args.ScopeFilter.Get(FString()));
        FFicsitAIMetricDescriptor& Descriptor = Page.Metrics.Add_GetRef(Metric->Descriptor);
        Descriptor.AvailableScopes.Reset();
        for (int32 Index = Offset; Index < All.Num() && Descriptor.AvailableScopes.Num() < MaxInlineScopes; ++Index)
        {
            Descriptor.AvailableScopes.Add(All[Index]);
        }
        const int32 Next = Offset + Descriptor.AvailableScopes.Num();
        Descriptor.bScopesTruncated = Next < All.Num();
        Page.NextScopeCursor = Descriptor.bScopesTruncated ? ScopeCursor(Next, Metric->Descriptor.Id) : FString();
        return MakeValue(MoveTemp(Page));
    }

    int32 Offset = 0;
    if (TOptional<FFicsitAIApiError> Bad = ParseMetricCursor(Args.Cursor, Offset))
    {
        return MakeError(Bad.GetValue());
    }
    const FString Needle = Args.Filter.TrimStartAndEnd();
    int32 Matched = 0;
    for (const FMetricState& Metric : Metrics)
    {
        const FFicsitAIMetricDescriptor& D = Metric.Descriptor;
        if (Args.Scope.IsSet() && D.Scope != Args.Scope.GetValue())
        {
            continue;
        }
        if (!Needle.IsEmpty() && !Contains(D.Id, Needle) && !Contains(D.DisplayName.ToString(), Needle))
        {
            continue;
        }
        if (Matched++ < Offset || Page.Metrics.Num() >= PageSize)
        {
            continue;
        }
        FFicsitAIMetricDescriptor& Out = Page.Metrics.Add_GetRef(D);
        if (Out.AvailableScopes.Num() > MaxInlineScopes)
        {
            Out.AvailableScopes.SetNum(MaxInlineScopes);
            Out.bScopesTruncated = true;
        }
    }
    const int32 Next = Offset + Page.Metrics.Num();
    Page.NextCursor = Next < Matched ? MetricCursor(Next) : FString();
    return MakeValue(MoveTemp(Page));
}

FFicsitAIApiCore::TResult<FFicsitAIScopePage> FFicsitAIApiCore::ListScopes(const FFicsitAIListScopesArgs& Args) const
{
    int32 PageSize = 0;
    if (TOptional<FFicsitAIApiError> Bad = CheckPageSize(Args.PageSize, PageSize))
    {
        return MakeError(Bad.GetValue());
    }
    if (Args.MetricId.IsEmpty())
    {
        return MakeError(ApiError(FicsitAIApiErrors::InvalidArgument, TEXT("listScopes требует metricId")));
    }
    if (TOptional<FFicsitAIApiError> NoData = CheckData())
    {
        return MakeError(NoData.GetValue());
    }
    const FMetricState* Metric = FindMetric(Args.MetricId);
    if (!Metric)
    {
        return MakeError(ApiError(FicsitAIApiErrors::UnknownMetric, FString::Printf(TEXT("метрики «%s» нет в каталоге"), *Args.MetricId)));
    }
    int32 Offset = 0;
    if (TOptional<FFicsitAIApiError> Bad = ParseScopeCursor(Args.Cursor, Metric->Descriptor.Id, Offset))
    {
        return MakeError(Bad.GetValue());
    }
    const TArray<FFicsitAIScopeRef> All = FilterScopes(*Metric, Args.ScopeFilter);
    FFicsitAIScopePage Page;
    for (int32 Index = Offset; Index < All.Num() && Page.Scopes.Num() < PageSize; ++Index)
    {
        Page.Scopes.Add(All[Index]);
    }
    const int32 Next = Offset + Page.Scopes.Num();
    Page.NextCursor = Next < All.Num() ? ScopeCursor(Next, Metric->Descriptor.Id) : FString();
    return MakeValue(MoveTemp(Page));
}

FFicsitAIApiCore::TResult<FFicsitAIValue> FFicsitAIApiCore::QueryMetric(const FString& MetricId, const FString& ScopeId) const
{
    if (TOptional<FFicsitAIApiError> NoData = CheckData())
    {
        return MakeError(NoData.GetValue());
    }
    const FMetricState* Metric = FindMetric(MetricId);
    if (!Metric)
    {
        return MakeError(ApiError(FicsitAIApiErrors::UnknownMetric, FString::Printf(TEXT("метрики «%s» нет в каталоге"), *MetricId)));
    }
    if (TOptional<FFicsitAIApiError> Bad = CheckScope(*Metric, ScopeId))
    {
        return MakeError(Bad.GetValue());
    }
    const FFicsitAIMetricSample* Sample = Metric->Samples.Find(ScopeId);
    if (!Sample)
    {
        return MakeError(ApiError(FicsitAIApiErrors::SourceUnavailable, FString::Printf(TEXT("значения «%s» ещё нет"), *MetricId)));
    }
    FFicsitAIValue Value;
    Value.MetricId = Metric->Descriptor.Id;
    Value.ScopeId = ScopeId;
    Value.State = Sample->State;
    Value.Value = Sample->State == EFicsitAIValueState::Value ? Sample->Value : 0.0;
    Value.Unit = Metric->Descriptor.Unit;
    Value.Source = Source->GetKind();
    Value.SessionTimeSec = Sample->SessionTimeSec;
    Value.PrecisionDigits = Metric->PrecisionDigits;
    return MakeValue(MoveTemp(Value));
}

FFicsitAIApiCore::TResult<FFicsitAISeries> FFicsitAIApiCore::QuerySeries(const FString& MetricId, EFicsitAISeriesWindow Window, const FString& ScopeId) const
{
    if (TOptional<FFicsitAIApiError> NoData = CheckData())
    {
        return MakeError(NoData.GetValue());
    }
    const FMetricState* Metric = FindMetric(MetricId);
    if (!Metric)
    {
        return MakeError(ApiError(FicsitAIApiErrors::UnknownMetric, FString::Printf(TEXT("метрики «%s» нет в каталоге"), *MetricId)));
    }
    if (!Metric->Descriptor.bHasSeries)
    {
        return MakeError(ApiError(FicsitAIApiErrors::SeriesNotAvailable, FString::Printf(TEXT("у метрики «%s» нет ряда"), *MetricId)));
    }
    if (TOptional<FFicsitAIApiError> Bad = CheckScope(*Metric, ScopeId))
    {
        return MakeError(Bad.GetValue());
    }

    const double WindowSec = FicsitAI::ApiJson::WindowSeconds(Window);
    const double From = LastSnapshotTime - WindowSec;
    FFicsitAISeries Series;
    Series.MetricId = Metric->Descriptor.Id;
    Series.ScopeId = ScopeId;
    Series.Window = Window;
    Series.Unit = Metric->Descriptor.Unit;
    Series.Source = Source->GetKind();
    Series.IntervalSec = Metric->Descriptor.SampleIntervalSec;
    if (const TArray<FPoint>* Points = Metric->Series.Find(ScopeId))
    {
        for (const FPoint& Point : *Points)
        {
            if (Point.Time >= From && Point.Time <= LastSnapshotTime)
            {
                Series.Timestamps.Add(Point.Time);
                Series.Values.Add(Point.Value);
            }
        }
    }
    Series.FirstPointSessionTimeSec = Series.Timestamps.IsEmpty() ? LastSnapshotTime : Series.Timestamps[0];
    // Флаг — про короткую сессию, а не про пропуски внутри окна (Gs-8.2).
    Series.bWindowIncomplete = LastSnapshotTime < WindowSec;
    return MakeValue(MoveTemp(Series));
}
