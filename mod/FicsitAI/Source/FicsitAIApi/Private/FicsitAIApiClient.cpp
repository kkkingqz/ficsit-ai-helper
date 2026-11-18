#include "FicsitAIApiClient.h"

#include "Dom/JsonValue.h"
#include "FicsitAIApiCore.h"
#include "FicsitAIApiJson.h"

namespace
{
FFicsitAIApiError Closed()
{
    return FFicsitAIApiError(FicsitAIApiErrors::SourceUnavailable, TEXT("API мода закрыт: мир выгружен или клиент отключён"));
}

FFicsitAIApiError BadArg(const FString& Message)
{
    return FFicsitAIApiError(FicsitAIApiErrors::InvalidArgument, Message);
}

/** Строковый аргумент: нет поля — не задан; null и другой тип — INVALID_ARGUMENT, а не молчаливая подмена. */
TOptional<FFicsitAIApiError> ReadString(const FJsonObject& Args, const TCHAR* Name, TOptional<FString>& Out)
{
    const TSharedPtr<FJsonValue> Field = Args.TryGetField(Name);
    if (!Field.IsValid())
    {
        return {};
    }
    if (Field->Type != EJson::String)
    {
        return BadArg(FString::Printf(TEXT("%s должен быть строкой"), Name));
    }
    Out = Field->AsString();
    return {};
}

TOptional<FFicsitAIApiError> ReadString(const FJsonObject& Args, const TCHAR* Name, FString& Out)
{
    TOptional<FString> Value;
    TOptional<FFicsitAIApiError> Bad = ReadString(Args, Name, Value);
    Out = Value.Get(FString());
    return Bad;
}

TOptional<FFicsitAIApiError> ReadInt(const FJsonObject& Args, const TCHAR* Name, TOptional<int32>& Out)
{
    const TSharedPtr<FJsonValue> Field = Args.TryGetField(Name);
    if (!Field.IsValid())
    {
        return {};
    }
    const double Number = Field->Type == EJson::Number ? Field->AsNumber() : 0.5;
    if (Field->Type != EJson::Number || FMath::Frac(Number) != 0.0 || Number < MIN_int32 || Number > MAX_int32)
    {
        return BadArg(FString::Printf(TEXT("%s должен быть целым числом"), Name));
    }
    Out = static_cast<int32>(Number);
    return {};
}

TOptional<FFicsitAIApiError> ReadWindow(const FJsonObject& Args, TOptional<EFicsitAISeriesWindow>& Out)
{
    TOptional<FString> Text;
    if (TOptional<FFicsitAIApiError> Bad = ReadString(Args, TEXT("window"), Text))
    {
        return Bad;
    }
    if (!Text.IsSet())
    {
        return {};
    }
    EFicsitAISeriesWindow Window;
    if (!FicsitAI::ApiJson::Parse(Text.GetValue(), Window))
    {
        return BadArg(FString::Printf(TEXT("окно «%s» не из контракта: last5Min, last15Min, last60Min"), *Text.GetValue()));
    }
    Out = Window;
    return {};
}

TOptional<FFicsitAIApiError> RequireMetricId(const FJsonObject& Args, FString& Out)
{
    if (TOptional<FFicsitAIApiError> Bad = ReadString(Args, TEXT("metricId"), Out))
    {
        return Bad;
    }
    if (Out.IsEmpty())
    {
        return BadArg(TEXT("нужен metricId"));
    }
    return {};
}

template <typename T>
FFicsitAIApiClient::TResult<TSharedRef<FJsonObject>> ToBody(FFicsitAIApiClient::TResult<T>&& Result)
{
    if (Result.HasError())
    {
        return MakeError(Result.StealError());
    }
    return MakeValue(FicsitAI::ApiJson::ToJson(Result.GetValue()));
}
} // namespace

FFicsitAIApiClient::FFicsitAIApiClient(const TSharedRef<FFicsitAIApiCore>& InCore, const FFicsitAIApiClientInfo& InInfo, double Now)
    : Core(InCore)
    , Info(InInfo)
    , Tokens(FFicsitAIApiCore::RateLimitPerSec(InInfo.Kind))
    , LastRefill(Now)
{
}

void FFicsitAIApiClient::Disconnect()
{
    OnEvent.Reset();
    Core.Reset();
}

FFicsitAIApiClient::EOp FFicsitAIApiClient::ParseOp(const FString& Op)
{
    struct FName2Op { const TCHAR* Name; EOp Op; };
    static const FName2Op Known[] = {
        { TEXT("getStatus"), EOp::GetStatus },
        { TEXT("listMetrics"), EOp::ListMetrics },
        { TEXT("listScopes"), EOp::ListScopes },
        { TEXT("queryMetric"), EOp::QueryMetric },
        { TEXT("querySeries"), EOp::QuerySeries },
        { TEXT("chatSend"), EOp::ChatSend },
        { TEXT("chatCancel"), EOp::ChatCancel },
        { TEXT("chatHistory"), EOp::ChatHistory },
    };
    for (const FName2Op& Entry : Known)
    {
        // Имена — каноническая форма, регистр важен: GETSTATUS — не getStatus (Gs-109, п. 9).
        if (Op.Equals(Entry.Name, ESearchCase::CaseSensitive))
        {
            return Entry.Op;
        }
    }
    return EOp::Unknown;
}

bool FFicsitAIApiClient::IsAllowed(EFicsitAIApiClientKind Kind, EOp Op)
{
    if (Op == EOp::Unknown)
    {
        return false;
    }
    if (Kind == EFicsitAIApiClientKind::Model)
    {
        return Op == EOp::ListMetrics || Op == EOp::QueryMetric;
    }
    return true;
}

TOptional<FFicsitAIApiError> FFicsitAIApiClient::Admit(EOp Op, const FString& OpName)
{
    const TSharedPtr<FFicsitAIApiCore> Api = Core.Pin();
    if (!Api.IsValid())
    {
        return Closed();
    }

    const double Rate = FFicsitAIApiCore::RateLimitPerSec(Info.Kind);
    const double Now = Api->Now();
    Tokens = FMath::Min(Rate, Tokens + FMath::Max(0.0, Now - LastRefill) * Rate);
    LastRefill = Now;
    if (Tokens < 1.0)
    {
        // Превышение — отказ с кодом, а не молчаливое отбрасывание (§7.4).
        return FFicsitAIApiError(FicsitAIApiErrors::RateLimited,
            FString::Printf(TEXT("больше %.0f запросов в секунду"), Rate));
    }
    Tokens -= 1.0;

    if (Op != EOp::GetStatus && Api->IsInert())
    {
        return FFicsitAIApiError(FicsitAIApiErrors::ModInert, TEXT("мод в инертном режиме: мультиплеерная сессия"));
    }
    if (!IsAllowed(Info.Kind, Op))
    {
        return FFicsitAIApiError(FicsitAIApiErrors::UnknownOp, Op == EOp::Unknown
            ? FString::Printf(TEXT("запроса «%s» нет в API v0"), *OpName)
            : FString::Printf(TEXT("запрос «%s» модели недоступен: у неё только list_metrics и query_metric"), *OpName));
    }
    // При расхождении мажорной версии AI-функции отключаются, ручные продолжают работать (§5.5).
    if (Info.Kind == EFicsitAIApiClientKind::Model && Op != EOp::GetStatus)
    {
        const FString Mismatch = FFicsitAIApiCore::VersionMismatch(Info);
        if (!Mismatch.IsEmpty())
        {
            return FFicsitAIApiError(FicsitAIApiErrors::ApiVersionMismatch, Mismatch);
        }
    }
    return {};
}

bool FFicsitAIApiClient::AcceptsEvent(const FString& Event) const
{
    // Несовместимая модель узнаёт о состоянии (api.status, mod.inert), но данных не получает: её запросы данных
    // всё равно отклоняются, а рассылка снимков ей — работа впустую.
    if (Info.Kind == EFicsitAIApiClientKind::Model && Event == TEXT("metrics.snapshot"))
    {
        return FFicsitAIApiCore::VersionMismatch(Info).IsEmpty();
    }
    return true;
}

FFicsitAIApiClient::TResult<FFicsitAIApiStatus> FFicsitAIApiClient::GetStatus()
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(EOp::GetStatus, TEXT("getStatus")))
    {
        return MakeError(Denied.GetValue());
    }
    return MakeValue(Core.Pin()->BuildStatus(Info));
}

FFicsitAIApiClient::TResult<FFicsitAIMetricPage> FFicsitAIApiClient::ListMetrics(const FFicsitAIListMetricsArgs& Args)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(EOp::ListMetrics, TEXT("listMetrics")))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->ListMetrics(Args);
}

FFicsitAIApiClient::TResult<FFicsitAIScopePage> FFicsitAIApiClient::ListScopes(const FFicsitAIListScopesArgs& Args)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(EOp::ListScopes, TEXT("listScopes")))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->ListScopes(Args);
}

FFicsitAIApiClient::TResult<FFicsitAIValue> FFicsitAIApiClient::QueryMetric(const FString& MetricId, const FString& ScopeId)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(EOp::QueryMetric, TEXT("queryMetric")))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->QueryMetric(MetricId, ScopeId);
}

FFicsitAIApiClient::TResult<FFicsitAISeries> FFicsitAIApiClient::QuerySeries(const FString& MetricId, EFicsitAISeriesWindow Window, const FString& ScopeId)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(EOp::QuerySeries, TEXT("querySeries")))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->QuerySeries(MetricId, Window, ScopeId);
}

FFicsitAIApiClient::TResult<TSharedRef<FJsonObject>> FFicsitAIApiClient::Dispatch(const FString& Op, const TSharedRef<FJsonObject>& Args)
{
    return Dispatch(Op, Args, [] { return TOptional<FFicsitAIApiError>(); });
}

FFicsitAIApiClient::TResult<TSharedRef<FJsonObject>> FFicsitAIApiClient::Dispatch(const FString& Op, const TSharedRef<FJsonObject>& Args, FArgsCheck Check)
{
    // Сначала допуск, потом аргументы: иначе ошибочные запросы шли бы мимо лимита и инертного режима (Gs-109, п. 2).
    const EOp Kind = ParseOp(Op);
    if (TOptional<FFicsitAIApiError> Denied = Admit(Kind, Op))
    {
        return MakeError(Denied.GetValue());
    }
    if (TOptional<FFicsitAIApiError> Bad = Check())
    {
        return MakeError(Bad.GetValue());
    }
    const TSharedPtr<FFicsitAIApiCore> Api = Core.Pin();

    switch (Kind)
    {
    case EOp::GetStatus:
        return MakeValue(FicsitAI::ApiJson::ToJson(Api->BuildStatus(Info)));

    case EOp::ListMetrics:
    {
        FFicsitAIListMetricsArgs Typed;
        TOptional<FString> Scope;
        TOptional<FFicsitAIApiError> Bad = ReadString(*Args, TEXT("metricId"), Typed.MetricId);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("scope"), Scope);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("filter"), Typed.Filter);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("scopeFilter"), Typed.ScopeFilter);
        Bad = Bad ? Bad : ReadInt(*Args, TEXT("pageSize"), Typed.PageSize);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("cursor"), Typed.Cursor);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("scopeCursor"), Typed.ScopeCursor);
        if (!Bad && Scope.IsSet())
        {
            EFicsitAIMetricScope Parsed;
            if (FicsitAI::ApiJson::Parse(Scope.GetValue(), Parsed))
            {
                Typed.Scope = Parsed;
            }
            else
            {
                Bad = BadArg(FString::Printf(TEXT("область «%s» не из контракта"), *Scope.GetValue()));
            }
        }
        if (Bad)
        {
            return MakeError(Bad.GetValue());
        }
        return ToBody(Api->ListMetrics(Typed));
    }

    case EOp::ListScopes:
    {
        FFicsitAIListScopesArgs Typed;
        TOptional<FFicsitAIApiError> Bad = RequireMetricId(*Args, Typed.MetricId);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("scopeFilter"), Typed.ScopeFilter);
        Bad = Bad ? Bad : ReadInt(*Args, TEXT("pageSize"), Typed.PageSize);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("cursor"), Typed.Cursor);
        if (Bad)
        {
            return MakeError(Bad.GetValue());
        }
        return ToBody(Api->ListScopes(Typed));
    }

    // queryMetric с окном — ряд: так его видит модель, у которой одна операция query_metric (раздел «Операции v0»).
    case EOp::QueryMetric:
    case EOp::QuerySeries:
    {
        FString MetricId;
        FString ScopeId;
        TOptional<EFicsitAISeriesWindow> Window;
        TOptional<FFicsitAIApiError> Bad = RequireMetricId(*Args, MetricId);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("scopeId"), ScopeId);
        Bad = Bad ? Bad : ReadWindow(*Args, Window);
        if (!Bad && Kind == EOp::QuerySeries && !Window.IsSet())
        {
            Bad = BadArg(TEXT("querySeries требует window"));
        }
        if (Bad)
        {
            return MakeError(Bad.GetValue());
        }
        if (Window.IsSet())
        {
            return ToBody(Api->QuerySeries(MetricId, Window.GetValue(), ScopeId));
        }
        return ToBody(Api->QueryMetric(MetricId, ScopeId));
    }

    case EOp::ChatSend:
    case EOp::ChatCancel:
    case EOp::ChatHistory:
        // Без связи с сайдкаром все три запроса чата отвечают сразу, без ожидания (0.5.0).
        return MakeError(FFicsitAIApiError(FicsitAIApiErrors::SidecarUnavailable, TEXT("нет связи с сайдкаром")));

    case EOp::Unknown:
        break;
    }
    return MakeError(FFicsitAIApiError(FicsitAIApiErrors::UnknownOp, FString::Printf(TEXT("запроса «%s» нет в API v0"), *Op)));
}
