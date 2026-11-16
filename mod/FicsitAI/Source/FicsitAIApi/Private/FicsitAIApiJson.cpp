#include "FicsitAIApiJson.h"

#include "Dom/JsonValue.h"

namespace FicsitAI::ApiJson
{
namespace
{
template <typename E, int32 N>
FString Name(E Value, const TCHAR* const (&Names)[N])
{
    const int32 Index = static_cast<int32>(Value);
    return Index >= 0 && Index < N ? FString(Names[Index]) : FString();
}

template <typename E, int32 N>
bool FromName(const FString& Text, E& Out, const TCHAR* const (&Names)[N])
{
    for (int32 Index = 0; Index < N; ++Index)
    {
        // Регистр важен: каноническая форма одна, "Last15Min" — не окно контракта.
        if (Text.Equals(Names[Index], ESearchCase::CaseSensitive))
        {
            Out = static_cast<E>(Index);
            return true;
        }
    }
    return false;
}

// Порядок — как в UENUM: индекс массива совпадает со значением перечисления.
const TCHAR* const SourceNames[] = {TEXT("live"), TEXT("save"), TEXT("saveEstimated"), TEXT("recorded"), TEXT("fixture"), TEXT("planned")};
const TCHAR* const StateNames[] = {TEXT("value"), TEXT("notApplicable")};
const TCHAR* const UnitNames[] = {TEXT("itemsPerMinute"), TEXT("cubicMetersPerMinute"), TEXT("megawatt"), TEXT("megawattHour"), TEXT("percent"), TEXT("count"), TEXT("seconds")};
const TCHAR* const ScopeNames[] = {TEXT("factory"), TEXT("powerNetwork"), TEXT("item"), TEXT("machineType"), TEXT("line")};
const TCHAR* const WindowNames[] = {TEXT("last5Min"), TEXT("last15Min"), TEXT("last60Min")};
const TCHAR* const AssistantNames[] = {TEXT("unavailable"), TEXT("signingIn"), TEXT("ready")};

TArray<TSharedPtr<FJsonValue>> Numbers(const TArray<double>& Values)
{
    TArray<TSharedPtr<FJsonValue>> Out;
    Out.Reserve(Values.Num());
    for (const double Value : Values)
    {
        Out.Add(MakeShared<FJsonValueNumber>(Value));
    }
    return Out;
}

TSharedRef<FJsonObject> ScopeJson(const FFicsitAIScopeRef& Scope)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("scopeId"), Scope.ScopeId);
    Out->SetStringField(TEXT("displayName"), Scope.DisplayName.ToString());
    return Out;
}

TArray<TSharedPtr<FJsonValue>> ScopesJson(const TArray<FFicsitAIScopeRef>& Scopes)
{
    TArray<TSharedPtr<FJsonValue>> Out;
    Out.Reserve(Scopes.Num());
    for (const FFicsitAIScopeRef& Scope : Scopes)
    {
        Out.Add(MakeShared<FJsonValueObject>(ScopeJson(Scope)));
    }
    return Out;
}

void SetStatusFields(FJsonObject& Out, const FFicsitAIApiStatus& Status)
{
    Out.SetBoolField(TEXT("sidecarConnected"), Status.bSidecarConnected);
    Out.SetStringField(TEXT("source"), ToString(Status.Source));
    Out.SetBoolField(TEXT("inert"), Status.bInert);
    Out.SetStringField(TEXT("apiVersionMismatch"), Status.ApiVersionMismatch);
    Out.SetStringField(TEXT("reason"), Status.Reason.ToString());
    Out.SetStringField(TEXT("assistantState"), ToString(Status.AssistantState));
    Out.SetStringField(TEXT("assistantModel"), Status.AssistantModel);
}
} // namespace

FString ToString(EFicsitAIDataSource Value) { return Name(Value, SourceNames); }
FString ToString(EFicsitAIValueState Value) { return Name(Value, StateNames); }
FString ToString(EFicsitAIUnit Value) { return Name(Value, UnitNames); }
FString ToString(EFicsitAIMetricScope Value) { return Name(Value, ScopeNames); }
FString ToString(EFicsitAISeriesWindow Value) { return Name(Value, WindowNames); }
FString ToString(EFicsitAIAssistantState Value) { return Name(Value, AssistantNames); }

bool Parse(const FString& Text, EFicsitAIMetricScope& Out) { return FromName(Text, Out, ScopeNames); }
bool Parse(const FString& Text, EFicsitAISeriesWindow& Out) { return FromName(Text, Out, WindowNames); }

double WindowSeconds(EFicsitAISeriesWindow Window)
{
    switch (Window)
    {
    case EFicsitAISeriesWindow::Last5Min: return 300.0;
    case EFicsitAISeriesWindow::Last15Min: return 900.0;
    case EFicsitAISeriesWindow::Last60Min: return 3600.0;
    }
    return 900.0;
}

TSharedRef<FJsonObject> ToJson(const FFicsitAIApiStatus& Status)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("apiVersion"), Status.ApiVersion);
    Out->SetStringField(TEXT("saveId"), Status.SaveId);
    Out->SetNumberField(TEXT("lastSnapshotSessionTimeSec"), Status.LastSnapshotSessionTimeSec);
    SetStatusFields(*Out, Status);
    return Out;
}

TSharedRef<FJsonObject> StatusEventJson(const FFicsitAIApiStatus& Status)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    SetStatusFields(*Out, Status);
    return Out;
}

TSharedRef<FJsonObject> ToJson(const FFicsitAIMetricDescriptor& Descriptor)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("id"), Descriptor.Id);
    Out->SetStringField(TEXT("displayName"), Descriptor.DisplayName.ToString());
    Out->SetStringField(TEXT("unit"), ToString(Descriptor.Unit));
    Out->SetStringField(TEXT("scope"), ToString(Descriptor.Scope));
    Out->SetBoolField(TEXT("hasSeries"), Descriptor.bHasSeries);
    Out->SetStringField(TEXT("costClass"), Descriptor.CostClass.ToString());
    Out->SetNumberField(TEXT("sampleIntervalSec"), Descriptor.SampleIntervalSec);
    Out->SetBoolField(TEXT("external"), Descriptor.bExternal);
    Out->SetArrayField(TEXT("availableScopes"), ScopesJson(Descriptor.AvailableScopes));
    Out->SetBoolField(TEXT("scopesTruncated"), Descriptor.bScopesTruncated);
    return Out;
}

TSharedRef<FJsonObject> ToJson(const FFicsitAIMetricPage& Page)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    TArray<TSharedPtr<FJsonValue>> Metrics;
    Metrics.Reserve(Page.Metrics.Num());
    for (const FFicsitAIMetricDescriptor& Descriptor : Page.Metrics)
    {
        Metrics.Add(MakeShared<FJsonValueObject>(ToJson(Descriptor)));
    }
    Out->SetArrayField(TEXT("metrics"), Metrics);
    Out->SetStringField(TEXT("nextCursor"), Page.NextCursor);
    if (Page.NextScopeCursor.IsSet())
    {
        Out->SetStringField(TEXT("nextScopeCursor"), Page.NextScopeCursor.GetValue());
    }
    return Out;
}

TSharedRef<FJsonObject> ToJson(const FFicsitAIScopePage& Page)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetArrayField(TEXT("scopes"), ScopesJson(Page.Scopes));
    Out->SetStringField(TEXT("nextCursor"), Page.NextCursor);
    return Out;
}

TSharedRef<FJsonObject> ToJson(const FFicsitAIValue& Value)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("kind"), TEXT("value"));
    Out->SetStringField(TEXT("metricId"), Value.MetricId);
    Out->SetStringField(TEXT("scopeId"), Value.ScopeId);
    Out->SetStringField(TEXT("state"), ToString(Value.State));
    // value: null тогда и только тогда, когда state — notApplicable (Gs-13).
    if (Value.State == EFicsitAIValueState::NotApplicable)
    {
        Out->SetField(TEXT("value"), MakeShared<FJsonValueNull>());
    }
    else
    {
        Out->SetNumberField(TEXT("value"), Value.Value);
    }
    Out->SetStringField(TEXT("unit"), ToString(Value.Unit));
    Out->SetStringField(TEXT("source"), ToString(Value.Source));
    Out->SetNumberField(TEXT("sessionTimeSec"), Value.SessionTimeSec);
    Out->SetNumberField(TEXT("precisionDigits"), Value.PrecisionDigits);
    return Out;
}

TSharedRef<FJsonObject> ToJson(const FFicsitAISeries& Series)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    Out->SetStringField(TEXT("kind"), TEXT("series"));
    Out->SetStringField(TEXT("metricId"), Series.MetricId);
    Out->SetStringField(TEXT("scopeId"), Series.ScopeId);
    Out->SetStringField(TEXT("window"), ToString(Series.Window));
    Out->SetStringField(TEXT("unit"), ToString(Series.Unit));
    Out->SetStringField(TEXT("source"), ToString(Series.Source));
    Out->SetNumberField(TEXT("intervalSec"), Series.IntervalSec);
    Out->SetArrayField(TEXT("values"), Numbers(Series.Values));
    Out->SetArrayField(TEXT("timestamps"), Numbers(Series.Timestamps));
    Out->SetNumberField(TEXT("firstPointSessionTimeSec"), Series.FirstPointSessionTimeSec);
    Out->SetBoolField(TEXT("windowIncomplete"), Series.bWindowIncomplete);
    return Out;
}
} // namespace FicsitAI::ApiJson
