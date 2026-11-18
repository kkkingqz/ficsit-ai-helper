#include "FicsitAIOperationRegistry.h"

#include "FicsitAIApiClient.h"
#include "FicsitAIApiCore.h"

namespace FicsitAIOpSchemas
{
// Копии схем аргументов из docs/contracts/schemas/ (Co2). Файл генерирует docs/contracts/embed-op-schemas.py;
// CI сверяет копию с источником (--check), руками не править.
#include "Ops/FicsitAIOpSchemas.inl"
}

TOptional<FString> FFicsitAIOperationRegistry::Register(const FFicsitAIOperation& Operation)
{
    const FString& Id = Operation.Id;
    if (Id.IsEmpty())
    {
        return FString(TEXT("операция без Id"));
    }
    if (FindEntry(Id))
    {
        return FString::Printf(TEXT("операция «%s» уже зарегистрирована"), *Id);
    }
    const FFicsitAIApiClient::EOp ApiOp = FFicsitAIApiClient::ParseOp(Operation.ApiOp);
    if (ApiOp == FFicsitAIApiClient::EOp::Unknown)
    {
        return FString::Printf(TEXT("операция «%s»: запроса «%s» нет в API v0"), *Id, *Operation.ApiOp);
    }
    TValueOrError<FFicsitAIJsonSchema, FString> Schema = FFicsitAIJsonSchema::Compile(Operation.InputSchemaText);
    if (Schema.HasError())
    {
        return FString::Printf(TEXT("операция «%s»: %s"), *Id, *Schema.GetError());
    }
    if (Operation.bExposedToModel)
    {
        // Паритет: модель не может ничего, чего не может игрок вручную (ADR-018, §7.5, правила 1 и 2).
        if (!Operation.ManualEntry.IsSet() || Operation.ManualEntry->ModuleId.IsNone() || Operation.ManualEntry->Action.IsEmpty())
        {
            return FString::Printf(TEXT("операция «%s» выставлена модели без ручной точки входа"), *Id);
        }
        if (!FFicsitAIApiClient::IsAllowed(EFicsitAIApiClientKind::Model, ApiOp))
        {
            return FString::Printf(TEXT("операция «%s»: запрос «%s» модели не разрешён"), *Id, *Operation.ApiOp);
        }
        if (Operation.Description.IsEmpty())
        {
            return FString::Printf(TEXT("операция «%s» выставлена модели без описания"), *Id);
        }
    }
    Entries.Add({Operation, Schema.StealValue()});
    return {};
}

const FFicsitAIOperationRegistry::FEntry* FFicsitAIOperationRegistry::FindEntry(const FString& Id) const
{
    // Имена сравниваются с учётом регистра, как имена запросов API (Gs-109, п. 9).
    return Entries.FindByPredicate([&Id](const FEntry& E) { return E.Operation.Id.Equals(Id, ESearchCase::CaseSensitive); });
}

const FFicsitAIOperation* FFicsitAIOperationRegistry::Find(const FString& Id) const
{
    const FEntry* Entry = FindEntry(Id);
    return Entry ? &Entry->Operation : nullptr;
}

TArray<FString> FFicsitAIOperationRegistry::GetIds() const
{
    TArray<FString> Ids;
    for (const FEntry& E : Entries)
    {
        Ids.Add(E.Operation.Id);
    }
    return Ids;
}

TArray<FFicsitAIToolDefinition> FFicsitAIOperationRegistry::GetModelTools() const
{
    TArray<FFicsitAIToolDefinition> Tools;
    for (const FEntry& E : Entries)
    {
        if (!E.Operation.bExposedToModel)
        {
            continue;
        }
        // Копия: модель получает схему без служебных $schema и $id, источник в реестре не меняется.
        TSharedRef<FJsonObject> Input = MakeShared<FJsonObject>(*E.Schema.GetSource());
        Input->RemoveField(TEXT("$schema"));
        Input->RemoveField(TEXT("$id"));
        Tools.Add({E.Operation.Id, E.Operation.Description, Input});
    }
    return Tools;
}

FFicsitAIOperationRegistry::TResult<TSharedRef<FJsonObject>> FFicsitAIOperationRegistry::Invoke(
    const FString& Id, const TSharedRef<FJsonObject>& Args, FFicsitAIApiClient& Client) const
{
    const FEntry* Entry = FindEntry(Id);
    const bool bModel = Client.GetInfo().Kind == EFicsitAIApiClientKind::Model;
    if (!Entry || (bModel && !Entry->Operation.bExposedToModel))
    {
        // Имя вне реестра — отказ через допуск подключения, без разбора как запроса API: иначе внутреннее имя
        // «listMetrics» прошло бы мимо Validator (ревью #72, P1).
        return Client.DenyUnknown(Id);
    }
    const FFicsitAIJsonSchema& Schema = Entry->Schema;
    return Client.Dispatch(Entry->Operation.ApiOp, Args, [&Schema, &Args] { return Schema.Validate(Args); });
}

FFicsitAIOperationRegistry::TResult<TSharedRef<FJsonObject>> FFicsitAIOperationRegistry::DispatchApi(
    const FString& ApiOp, const TSharedRef<FJsonObject>& Args, FFicsitAIApiClient& Client) const
{
    const FEntry* Entry = Entries.FindByPredicate([&ApiOp](const FEntry& E) { return E.Operation.ApiOp.Equals(ApiOp, ESearchCase::CaseSensitive); });
    if (!Entry)
    {
        return Client.Dispatch(ApiOp, Args);
    }
    const FFicsitAIJsonSchema& Schema = Entry->Schema;
    return Client.Dispatch(ApiOp, Args, [&Schema, &Args] { return Schema.Validate(Args); });
}

const FFicsitAIOperationRegistry& FFicsitAIOperationRegistry::V0()
{
    static const FFicsitAIOperationRegistry Registry = []
    {
        FFicsitAIOperationRegistry R;
        const FName Statistics(TEXT("Statistics"));

        FFicsitAIOperation ListMetrics;
        ListMetrics.Id = TEXT("list_metrics");
        ListMetrics.ApiOp = TEXT("listMetrics");
        ListMetrics.Description = TEXT("Каталог метрик телеметрии фабрики: id, название, единица, уровень (factory, powerNetwork, item, machineType) и есть ли временной ряд. ")
            TEXT("Отдаётся страницами: фильтр по подстроке и уровню, курсор из nextCursor. С metricId — одна метрика и её области; следующие области — по scopeCursor из nextScopeCursor. ")
            TEXT("Идентификаторы метрик и областей бери только отсюда, не из текста.");
        ListMetrics.InputSchemaText = FicsitAIOpSchemas::ListMetricsRequest;
        ListMetrics.ResultSchemaId = TEXT("https://ficsit-ai/contracts/list-metrics-result.schema.json");
        ListMetrics.ManualEntry = FFicsitAIManualEntry{Statistics, TEXT("выбор метрики")};
        ListMetrics.bExposedToModel = true;

        FFicsitAIOperation QueryMetric;
        QueryMetric.Id = TEXT("query_metric");
        QueryMetric.ApiOp = TEXT("queryMetric");
        QueryMetric.Description = TEXT("Значение метрики из каталога list_metrics по metricId. Метрикам уровня powerNetwork, item и machineType нужен scopeId из availableScopes. ")
            TEXT("С window (last5Min, last15Min, last60Min) — временной ряд вместо значения, если у метрики hasSeries. ")
            TEXT("state notApplicable с value null — нормальный ответ: величина в этом мире не имеет смысла (например, у сети без батарей).");
        QueryMetric.InputSchemaText = FicsitAIOpSchemas::QueryMetricRequest;
        QueryMetric.ResultSchemaId = TEXT("https://ficsit-ai/contracts/query-metric-result.schema.json");
        QueryMetric.ManualEntry = FFicsitAIManualEntry{Statistics, TEXT("выбор метрики и окна")};
        QueryMetric.bExposedToModel = true;

        for (const FFicsitAIOperation* Op : {&ListMetrics, &QueryMetric})
        {
            if (TOptional<FString> Error = R.Register(*Op))
            {
                UE_LOG(LogFicsitAIApi, Fatal, TEXT("OperationRegistry v0: %s"), *Error.GetValue());
            }
        }
        return R;
    }();
    return Registry;
}
