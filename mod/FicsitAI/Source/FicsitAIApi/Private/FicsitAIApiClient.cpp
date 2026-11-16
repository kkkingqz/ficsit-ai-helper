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

/** Строковый аргумент: нет поля или null — не задан; другой тип — INVALID_ARGUMENT, а не молчаливая подмена. */
TOptional<FFicsitAIApiError> ReadString(const FJsonObject& Args, const TCHAR* Name, TOptional<FString>& Out)
{
    const TSharedPtr<FJsonValue> Field = Args.TryGetField(Name);
    if (!Field.IsValid() || Field->IsNull())
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
    if (!Field.IsValid() || Field->IsNull())
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
    OnEvent = nullptr;
    Core.Reset();
}

TOptional<FFicsitAIApiError> FFicsitAIApiClient::Admit(bool bStatusOnly)
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

    if (bStatusOnly)
    {
        return {};
    }
    if (Api->IsInert())
    {
        return FFicsitAIApiError(FicsitAIApiErrors::ModInert, TEXT("мод в инертном режиме: мультиплеерная сессия"));
    }
    // При расхождении мажорной версии AI-функции отключаются, ручные продолжают работать (§5.5).
    if (Info.Kind == EFicsitAIApiClientKind::Model)
    {
        const FString Mismatch = FFicsitAIApiCore::VersionMismatch(Info);
        if (!Mismatch.IsEmpty())
        {
            return FFicsitAIApiError(FicsitAIApiErrors::ApiVersionMismatch, Mismatch);
        }
    }
    return {};
}

FFicsitAIApiClient::TResult<FFicsitAIApiStatus> FFicsitAIApiClient::GetStatus()
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(true))
    {
        return MakeError(Denied.GetValue());
    }
    return MakeValue(Core.Pin()->BuildStatus(Info));
}

FFicsitAIApiClient::TResult<FFicsitAIMetricPage> FFicsitAIApiClient::ListMetrics(const FFicsitAIListMetricsArgs& Args)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(false))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->ListMetrics(Args);
}

FFicsitAIApiClient::TResult<FFicsitAIScopePage> FFicsitAIApiClient::ListScopes(const FFicsitAIListScopesArgs& Args)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(false))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->ListScopes(Args);
}

FFicsitAIApiClient::TResult<FFicsitAIValue> FFicsitAIApiClient::QueryMetric(const FString& MetricId, const FString& ScopeId)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(false))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->QueryMetric(MetricId, ScopeId);
}

FFicsitAIApiClient::TResult<FFicsitAISeries> FFicsitAIApiClient::QuerySeries(const FString& MetricId, EFicsitAISeriesWindow Window, const FString& ScopeId)
{
    if (TOptional<FFicsitAIApiError> Denied = Admit(false))
    {
        return MakeError(Denied.GetValue());
    }
    return Core.Pin()->QuerySeries(MetricId, Window, ScopeId);
}

FFicsitAIApiClient::TResult<TSharedRef<FJsonObject>> FFicsitAIApiClient::Dispatch(const FString& Op, const TSharedRef<FJsonObject>& Args)
{
    if (Op == TEXT("getStatus"))
    {
        TResult<FFicsitAIApiStatus> Status = GetStatus();
        return ToBody(MoveTemp(Status));
    }

    if (Op == TEXT("listMetrics"))
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
        return ToBody(ListMetrics(Typed));
    }

    if (Op == TEXT("listScopes"))
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
        return ToBody(ListScopes(Typed));
    }

    // queryMetric с окном — ряд: так его видит модель, у которой одна операция query_metric (раздел «Операции v0»).
    if (Op == TEXT("queryMetric") || Op == TEXT("querySeries"))
    {
        FString MetricId;
        FString ScopeId;
        TOptional<EFicsitAISeriesWindow> Window;
        TOptional<FFicsitAIApiError> Bad = RequireMetricId(*Args, MetricId);
        Bad = Bad ? Bad : ReadString(*Args, TEXT("scopeId"), ScopeId);
        Bad = Bad ? Bad : ReadWindow(*Args, Window);
        if (!Bad && Op == TEXT("querySeries") && !Window.IsSet())
        {
            Bad = BadArg(TEXT("querySeries требует window"));
        }
        if (Bad)
        {
            return MakeError(Bad.GetValue());
        }
        if (Window.IsSet())
        {
            return ToBody(QuerySeries(MetricId, Window.GetValue(), ScopeId));
        }
        return ToBody(QueryMetric(MetricId, ScopeId));
    }

    if (Op == TEXT("chatSend") || Op == TEXT("chatCancel") || Op == TEXT("chatHistory"))
    {
        if (TOptional<FFicsitAIApiError> Denied = Admit(false))
        {
            return MakeError(Denied.GetValue());
        }
        // Без связи с сайдкаром все три запроса чата отвечают сразу, без ожидания (0.5.0).
        return MakeError(FFicsitAIApiError(FicsitAIApiErrors::SidecarUnavailable, TEXT("нет связи с сайдкаром")));
    }

    return MakeError(FFicsitAIApiError(FicsitAIApiErrors::UnknownOp, FString::Printf(TEXT("запроса «%s» нет в API v0"), *Op)));
}
