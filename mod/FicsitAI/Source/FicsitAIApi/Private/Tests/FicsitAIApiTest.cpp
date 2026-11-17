// Автотест API v0 без мира: ядро, подключение клиента и каноническая форма (V-2).
// Проверяет то, что контракт public-api-v0.md называет поведением, а не только формой: страницы и курсоры,
// неприменимое значение, ряд с пропуском, лимиты, инертный режим, версии, события.

#include "Misc/AutomationTest.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "FicsitAIApiClient.h"
#include "FicsitAIApiCore.h"
#include "IFicsitAIDataSource.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace
{
class FTestSource : public IFicsitAIDataSource
{
public:
    explicit FTestSource(EFicsitAIDataSource InKind = EFicsitAIDataSource::Fixture) : Kind(InKind) {}

    virtual EFicsitAIDataSource GetKind() const override { return Kind; }
    virtual void Start(IFicsitAISnapshotSink& InSink) override { Sink = &InSink; ++Starts; }
    virtual void Stop() override { Sink = nullptr; ++Stops; }

    EFicsitAIDataSource Kind;
    IFicsitAISnapshotSink* Sink = nullptr;
    int32 Starts = 0;
    int32 Stops = 0;
};

FFicsitAIMetricSnapshot Metric(const TCHAR* Id, EFicsitAIMetricScope Scope, EFicsitAIUnit Unit, bool bSeries)
{
    FFicsitAIMetricSnapshot M;
    M.Descriptor.Id = Id;
    M.Descriptor.DisplayName = FText::FromString(FString(Id).Replace(TEXT("."), TEXT(" ")));
    M.Descriptor.Scope = Scope;
    M.Descriptor.Unit = Unit;
    M.Descriptor.bHasSeries = bSeries;
    M.Descriptor.SampleIntervalSec = 5.0f;
    return M;
}

FFicsitAIMetricSample Sample(const FString& ScopeId, double Value, double Time)
{
    FFicsitAIMetricSample S;
    S.ScopeId = ScopeId;
    S.Value = Value;
    S.SessionTimeSec = Time;
    return S;
}

/** Каталог из трёх метрик: фабричная с рядом, по сетям (сеть 2 без батарей), по 60 предметам. */
FFicsitAISnapshot MakeSnapshot(double Time, double Power)
{
    FFicsitAISnapshot Snap;
    Snap.SessionTimeSec = Time;

    FFicsitAIMetricSnapshot& PowerMetric = Snap.Metrics.Add_GetRef(Metric(TEXT("power.consumption"), EFicsitAIMetricScope::Factory, EFicsitAIUnit::Megawatt, true));
    PowerMetric.Samples.Add(Sample(FString(), Power, Time));

    FFicsitAIMetricSnapshot& Battery = Snap.Metrics.Add_GetRef(Metric(TEXT("power.network.battery_time_to_empty"), EFicsitAIMetricScope::PowerNetwork, EFicsitAIUnit::Seconds, false));
    Battery.PrecisionDigits = 0;
    Battery.Descriptor.AvailableScopes = {{TEXT("1"), FText::FromString(TEXT("Сеть 1"))}, {TEXT("2"), FText::FromString(TEXT("Сеть 2"))}};
    Battery.Samples.Add(Sample(TEXT("1"), 900.0, Time));
    FFicsitAIMetricSample NotApplicable = Sample(TEXT("2"), 0.0, Time);
    NotApplicable.State = EFicsitAIValueState::NotApplicable;
    Battery.Samples.Add(NotApplicable);

    FFicsitAIMetricSnapshot& Items = Snap.Metrics.Add_GetRef(Metric(TEXT("items.produced"), EFicsitAIMetricScope::Item, EFicsitAIUnit::ItemsPerMinute, true));
    for (int32 Index = 1; Index <= 60; ++Index)
    {
        const FString Id = FString::Printf(TEXT("Desc_Item%d_C"), Index);
        Items.Descriptor.AvailableScopes.Add({Id, FText::FromString(FString::Printf(TEXT("Item %d"), Index))});
        Items.Samples.Add(Sample(Id, Index, Time));
    }
    return Snap;
}

struct FEventLog
{
    TArray<FString> Names;
    TArray<TSharedRef<FJsonObject>> Data;

    int32 Count(const TCHAR* Name) const { return Names.FilterByPredicate([Name](const FString& N) { return N == Name; }).Num(); }
    TSharedPtr<FJsonObject> Last(const TCHAR* Name) const
    {
        for (int32 Index = Names.Num() - 1; Index >= 0; --Index)
        {
            if (Names[Index] == Name) { return Data[Index]; }
        }
        return nullptr;
    }
};

FFicsitAIApiClientInfo ClientInfo(EFicsitAIApiClientKind Kind, const TCHAR* Version = TEXT("0.5.0"))
{
    FFicsitAIApiClientInfo Info;
    Info.Kind = Kind;
    Info.RequiredApiVersion = Version;
    Info.Name = TEXT("test");
    return Info;
}

struct FArg
{
    const TCHAR* Key;
    TSharedPtr<FJsonValue> Value;
};

TSharedRef<FJsonObject> Args(std::initializer_list<FArg> Fields)
{
    TSharedRef<FJsonObject> Out = MakeShared<FJsonObject>();
    for (const FArg& Field : Fields)
    {
        Out->SetField(Field.Key, Field.Value);
    }
    return Out;
}

TSharedPtr<FJsonValue> Str(const TCHAR* Text) { return MakeShared<FJsonValueString>(Text); }
TSharedPtr<FJsonValue> Num(double Value) { return MakeShared<FJsonValueNumber>(Value); }
} // namespace

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAIApiV0Test, "FicsitAI.Api.V0", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAIApiV0Test::RunTest(const FString& Parameters)
{
    // Четыре предупреждения ядра — ожидаемые: снимок из прошлого (шаг 7), бесконечность и чужая область (шаг 8),
    // значение из будущего (шаг 18).
    AddExpectedMessage(TEXT("отброшен"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 4);

    double Now = 1000.0;
    TSharedRef<FFicsitAIApiCore> Core = MakeShared<FFicsitAIApiCore>([&Now] { return Now; });
    TSharedRef<FFicsitAIApiClient> Screen = Core->Connect(ClientInfo(EFicsitAIApiClientKind::Screen));
    FEventLog Events;
    Screen->SetEventHandler([&Events](const FString& Name, const TSharedRef<FJsonObject>& Data)
    {
        Events.Names.Add(Name);
        Events.Data.Add(Data);
    });

    // Каждый шаг теста — через секунду: лимит частоты проверяется отдельно и не должен мешать остальным.
    auto Call = [&Now, &Screen](const TCHAR* Op, const TSharedRef<FJsonObject>& In)
    {
        Now += 1.0;
        return Screen->Dispatch(Op, In);
    };
    auto Code = [](const FFicsitAIApiClient::TResult<TSharedRef<FJsonObject>>& Result)
    {
        return Result.HasError() ? Result.GetError().Code : FString(TEXT("OK"));
    };

    // 1. Без источника: статус отвечает, данные — SOURCE_UNAVAILABLE.
    {
        auto Status = Call(TEXT("getStatus"), MakeShared<FJsonObject>());
        TestFalse(TEXT("1: getStatus без источника — успех"), Status.HasError());
        if (!Status.HasError())
        {
            TestEqual(TEXT("1: apiVersion"), Status.GetValue()->GetStringField(TEXT("apiVersion")), FString(TEXT("0.5.0")));
            TestEqual(TEXT("1: причина"), Status.GetValue()->GetStringField(TEXT("reason")), FString(TEXT("источник данных не подключён")));
            TestEqual(TEXT("1: assistantState"), Status.GetValue()->GetStringField(TEXT("assistantState")), FString(TEXT("unavailable")));
        }
        TestEqual(TEXT("1: queryMetric без источника"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}))), FString(TEXT("SOURCE_UNAVAILABLE")));
    }

    // 2. Источник подключён, снимка ещё нет.
    TSharedRef<FTestSource> Source = MakeShared<FTestSource>();
    Core->SetSource(Source);
    TestEqual(TEXT("2: источник запущен"), Source->Starts, 1);
    TestEqual(TEXT("2: до первого снимка"), Code(Call(TEXT("listMetrics"), MakeShared<FJsonObject>())), FString(TEXT("SOURCE_UNAVAILABLE")));

    // 3. Снимки с пропуском: 10, 20, 40 с; в 30 с значение не снималось (время прежнее).
    Source->Sink->PublishSnapshot(MakeSnapshot(10.0, 400.0));
    Source->Sink->PublishSnapshot(MakeSnapshot(20.0, 410.0));
    {
        FFicsitAISnapshot Repeat = MakeSnapshot(30.0, 410.0);
        for (FFicsitAIMetricSnapshot& M : Repeat.Metrics)
        {
            for (FFicsitAIMetricSample& S : M.Samples) { S.SessionTimeSec = 20.0; }
        }
        Source->Sink->PublishSnapshot(Repeat);
        TSharedPtr<FJsonObject> Snapshot = Events.Last(TEXT("metrics.snapshot"));
        TestTrue(TEXT("3: событие снимка"), Snapshot.IsValid());
        if (Snapshot.IsValid())
        {
            TestEqual(TEXT("3: без новых значений changedMetricIds пуст"), Snapshot->GetArrayField(TEXT("changedMetricIds")).Num(), 0);
            TestEqual(TEXT("3: source в событии"), Snapshot->GetStringField(TEXT("source")), FString(TEXT("fixture")));
        }
    }
    Source->Sink->PublishSnapshot(MakeSnapshot(40.0, 420.0));
    {
        TSharedPtr<FJsonObject> Snapshot = Events.Last(TEXT("metrics.snapshot"));
        TestEqual(TEXT("3: новые значения у всех трёх метрик"), Snapshot.IsValid() ? Snapshot->GetArrayField(TEXT("changedMetricIds")).Num() : -1, 3);
        TestEqual(TEXT("3: снимков — четыре события"), Events.Count(TEXT("metrics.snapshot")), 4);
        TSharedPtr<FJsonObject> Status = Events.Last(TEXT("api.status"));
        // Данные пошли — причина больше не про источник, а про ассистента: до S2 его нет (Gs-109, п. 10).
        TestTrue(TEXT("3: api.status на первом снимке — причина про ассистента"), Status.IsValid()
            && Status->GetStringField(TEXT("reason")) == TEXT("ассистент недоступен: нет связи с сайдкаром"));
    }

    // 4. Каталог страницами.
    {
        auto Page = Call(TEXT("listMetrics"), Args({{TEXT("pageSize"), Num(2)}}));
        TestFalse(TEXT("4: listMetrics"), Page.HasError());
        if (!Page.HasError())
        {
            const TArray<TSharedPtr<FJsonValue>>& Metrics = Page.GetValue()->GetArrayField(TEXT("metrics"));
            TestEqual(TEXT("4: страница из двух"), Metrics.Num(), 2);
            const FString Next = Page.GetValue()->GetStringField(TEXT("nextCursor"));
            TestFalse(TEXT("4: есть следующая страница"), Next.IsEmpty());
            TestFalse(TEXT("4: nextScopeCursor только с metricId"), Page.GetValue()->HasField(TEXT("nextScopeCursor")));

            auto Second = Call(TEXT("listMetrics"), Args({{TEXT("pageSize"), Num(2)}, {TEXT("cursor"), MakeShared<FJsonValueString>(Next)}}));
            TestFalse(TEXT("4: вторая страница"), Second.HasError());
            if (!Second.HasError())
            {
                const TArray<TSharedPtr<FJsonValue>>& Rest = Second.GetValue()->GetArrayField(TEXT("metrics"));
                TestEqual(TEXT("4: на второй — одна"), Rest.Num(), 1);
                TestEqual(TEXT("4: курсора дальше нет"), Second.GetValue()->GetStringField(TEXT("nextCursor")), FString());
                const TSharedPtr<FJsonObject> Items = Rest.Num() ? Rest[0]->AsObject() : nullptr;
                TestTrue(TEXT("4: items.produced обрезан до 50"), Items.IsValid() && Items->GetArrayField(TEXT("availableScopes")).Num() == 50 && Items->GetBoolField(TEXT("scopesTruncated")));
                TestEqual(TEXT("4: unit lowerCamelCase"), Items.IsValid() ? Items->GetStringField(TEXT("unit")) : FString(), FString(TEXT("itemsPerMinute")));
            }
        }
        auto ByScope = Call(TEXT("listMetrics"), Args({{TEXT("scope"), Str(TEXT("powerNetwork"))}}));
        TestTrue(TEXT("4: фильтр по scope"), !ByScope.HasError() && ByScope.GetValue()->GetArrayField(TEXT("metrics")).Num() == 1);
        auto ByText = Call(TEXT("listMetrics"), Args({{TEXT("filter"), Str(TEXT("CONSUMPTION"))}}));
        TestTrue(TEXT("4: фильтр по подстроке без регистра"), !ByText.HasError() && ByText.GetValue()->GetArrayField(TEXT("metrics")).Num() == 1);

        TestEqual(TEXT("4: scopeFilter без metricId"), Code(Call(TEXT("listMetrics"), Args({{TEXT("scopeFilter"), Str(TEXT("Item"))}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("4: pageSize 0"), Code(Call(TEXT("listMetrics"), Args({{TEXT("pageSize"), Num(0)}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("4: pageSize 201"), Code(Call(TEXT("listMetrics"), Args({{TEXT("pageSize"), Num(201)}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("4: pageSize дробный"), Code(Call(TEXT("listMetrics"), Args({{TEXT("pageSize"), Num(2.5)}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("4: metricId не строка"), Code(Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Num(1)}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("4: scope не из контракта"), Code(Call(TEXT("listMetrics"), Args({{TEXT("scope"), Str(TEXT("Factory"))}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("4: незнакомая метрика"), Code(Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("nope"))}}))), FString(TEXT("UNKNOWN_METRIC")));
    }

    // 5. Области одной метрики: курсор привязан к метрике и не взаимозаменяем с курсором метрик (Gs-8.1).
    {
        auto First = Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}}));
        FString ScopeNext;
        if (!First.HasError())
        {
            ScopeNext = First.GetValue()->GetStringField(TEXT("nextScopeCursor"));
            TestEqual(TEXT("5: ровно один дескриптор"), First.GetValue()->GetArrayField(TEXT("metrics")).Num(), 1);
        }
        TestFalse(TEXT("5: есть курсор областей"), ScopeNext.IsEmpty());
        auto Second = Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("scopeCursor"), MakeShared<FJsonValueString>(ScopeNext)}}));
        if (!Second.HasError())
        {
            const TSharedPtr<FJsonObject> D = Second.GetValue()->GetArrayField(TEXT("metrics"))[0]->AsObject();
            TestEqual(TEXT("5: на второй странице 10 областей"), D->GetArrayField(TEXT("availableScopes")).Num(), 10);
            TestFalse(TEXT("5: дальше не обрезано"), D->GetBoolField(TEXT("scopesTruncated")));
            TestEqual(TEXT("5: курсор областей кончился"), Second.GetValue()->GetStringField(TEXT("nextScopeCursor")), FString());
        }
        else
        {
            AddError(TEXT("5: вторая страница областей — ") + Second.GetError().Code);
        }
        TestEqual(TEXT("5: курсор чужой метрики"), Code(Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("power.network.battery_time_to_empty"))}, {TEXT("scopeCursor"), MakeShared<FJsonValueString>(ScopeNext)}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("5: курсор метрик вместо курсора областей"), Code(Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("scopeCursor"), Str(TEXT("m:2"))}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("5: курсор областей вместо курсора метрик"), Code(Call(TEXT("listMetrics"), Args({{TEXT("cursor"), MakeShared<FJsonValueString>(ScopeNext)}}))), FString(TEXT("INVALID_ARGUMENT")));

        auto Filtered = Call(TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("scopeFilter"), Str(TEXT("item 5"))}}));
        TestTrue(TEXT("5: scopeFilter до страницы — Item 5 и 50–59"), !Filtered.HasError()
            && Filtered.GetValue()->GetArrayField(TEXT("metrics"))[0]->AsObject()->GetArrayField(TEXT("availableScopes")).Num() == 11);

        auto Scopes = Call(TEXT("listScopes"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("pageSize"), Num(25)}}));
        FString Next;
        if (!Scopes.HasError())
        {
            TestEqual(TEXT("5: listScopes страница"), Scopes.GetValue()->GetArrayField(TEXT("scopes")).Num(), 25);
            Next = Scopes.GetValue()->GetStringField(TEXT("nextCursor"));
        }
        auto Tail = Call(TEXT("listScopes"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("pageSize"), Num(50)}, {TEXT("cursor"), MakeShared<FJsonValueString>(Next)}}));
        TestTrue(TEXT("5: listScopes хвост 35 и без курсора"), !Tail.HasError() && Tail.GetValue()->GetArrayField(TEXT("scopes")).Num() == 35
            && Tail.GetValue()->GetStringField(TEXT("nextCursor")).IsEmpty());
        TestEqual(TEXT("5: listScopes без metricId"), Code(Call(TEXT("listScopes"), MakeShared<FJsonObject>())), FString(TEXT("INVALID_ARGUMENT")));
    }

    // 6. Значения.
    {
        auto Value = Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}));
        TestFalse(TEXT("6: значение"), Value.HasError());
        if (!Value.HasError())
        {
            const TSharedRef<FJsonObject>& V = Value.GetValue();
            TestEqual(TEXT("6: kind"), V->GetStringField(TEXT("kind")), FString(TEXT("value")));
            TestEqual(TEXT("6: value"), V->GetNumberField(TEXT("value")), 420.0);
            TestEqual(TEXT("6: state"), V->GetStringField(TEXT("state")), FString(TEXT("value")));
            TestEqual(TEXT("6: unit"), V->GetStringField(TEXT("unit")), FString(TEXT("megawatt")));
            TestEqual(TEXT("6: source"), V->GetStringField(TEXT("source")), FString(TEXT("fixture")));
            TestEqual(TEXT("6: scopeId пуст"), V->GetStringField(TEXT("scopeId")), FString());
        }
        auto Na = Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.network.battery_time_to_empty"))}, {TEXT("scopeId"), Str(TEXT("2"))}}));
        TestFalse(TEXT("6: неприменимое — успех, а не ошибка"), Na.HasError());
        if (!Na.HasError())
        {
            TestEqual(TEXT("6: state notApplicable"), Na.GetValue()->GetStringField(TEXT("state")), FString(TEXT("notApplicable")));
            const TSharedPtr<FJsonValue> Raw = Na.GetValue()->TryGetField(TEXT("value"));
            TestTrue(TEXT("6: value: null"), Raw.IsValid() && Raw->IsNull());
            TestEqual(TEXT("6: precisionDigits"), static_cast<int32>(Na.GetValue()->GetNumberField(TEXT("precisionDigits"))), 0);
        }
        TestEqual(TEXT("6: нужна область"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.network.battery_time_to_empty"))}}))), FString(TEXT("SCOPE_REQUIRED")));
        TestEqual(TEXT("6: области нет"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.network.battery_time_to_empty"))}, {TEXT("scopeId"), Str(TEXT("9"))}}))), FString(TEXT("SCOPE_NOT_FOUND")));
        TestEqual(TEXT("6: фабричной метрике область не нужна"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("scopeId"), Str(TEXT("1"))}}))), FString(TEXT("SCOPE_NOT_FOUND")));
        TestEqual(TEXT("6: незнакомая метрика"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.unknown"))}}))), FString(TEXT("UNKNOWN_METRIC")));
        TestEqual(TEXT("6: без metricId"), Code(Call(TEXT("queryMetric"), MakeShared<FJsonObject>())), FString(TEXT("INVALID_ARGUMENT")));
    }

    // 7. Ряд: пропуск виден по timestamps, повторное значение не пишется дважды.
    {
        auto Series = Call(TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("last5Min"))}}));
        TestFalse(TEXT("7: ряд"), Series.HasError());
        if (!Series.HasError())
        {
            const TSharedRef<FJsonObject>& S = Series.GetValue();
            TArray<double> Times;
            for (const TSharedPtr<FJsonValue>& T : S->GetArrayField(TEXT("timestamps"))) { Times.Add(T->AsNumber()); }
            TestTrue(TEXT("7: точки 10, 20, 40"), Times == TArray<double>({10.0, 20.0, 40.0}));
            TestEqual(TEXT("7: values той же длины"), S->GetArrayField(TEXT("values")).Num(), 3);
            TestEqual(TEXT("7: kind"), S->GetStringField(TEXT("kind")), FString(TEXT("series")));
            TestTrue(TEXT("7: сессия короче окна"), S->GetBoolField(TEXT("windowIncomplete")));
            TestEqual(TEXT("7: firstPointSessionTimeSec"), S->GetNumberField(TEXT("firstPointSessionTimeSec")), 10.0);
        }
        auto ViaQuery = Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("scopeId"), Str(TEXT("Desc_Item3_C"))}, {TEXT("window"), Str(TEXT("last15Min"))}}));
        TestTrue(TEXT("7: queryMetric с окном — ряд"), !ViaQuery.HasError() && ViaQuery.GetValue()->GetStringField(TEXT("kind")) == TEXT("series"));
        TestEqual(TEXT("7: у метрики нет ряда"), Code(Call(TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.network.battery_time_to_empty"))}, {TEXT("window"), Str(TEXT("last5Min"))}, {TEXT("scopeId"), Str(TEXT("1"))}}))), FString(TEXT("SERIES_NOT_AVAILABLE")));
        TestEqual(TEXT("7: окно не из контракта"), Code(Call(TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("Last5Min"))}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("7: querySeries без окна"), Code(Call(TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}))), FString(TEXT("INVALID_ARGUMENT")));

        // Через час старые точки уходят, окно 5 минут берёт только своё.
        Source->Sink->PublishSnapshot(MakeSnapshot(3700.0, 500.0));
        Source->Sink->PublishSnapshot(MakeSnapshot(3800.0, 510.0));
        auto Late = Call(TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("last60Min"))}}));
        if (!Late.HasError())
        {
            TestEqual(TEXT("7: точки старше часа отброшены"), Late.GetValue()->GetArrayField(TEXT("timestamps")).Num(), 2);
            TestFalse(TEXT("7: окно 60 минут полное"), Late.GetValue()->GetBoolField(TEXT("windowIncomplete")));
        }
        // Снимок из прошлого — отброшен целиком.
        Source->Sink->PublishSnapshot(MakeSnapshot(100.0, 1.0));
        auto After = Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}));
        TestTrue(TEXT("7: снимок из прошлого не принят"), !After.HasError() && After.GetValue()->GetNumberField(TEXT("value")) == 510.0);
    }

    // 8. Не конечное число и чужая область отбрасываются у границы.
    {
        FFicsitAISnapshot Bad = MakeSnapshot(3900.0, 0.0);
        volatile double Zero = 0.0;
        Bad.Metrics[0].Samples[0].Value = 1.0 / Zero;
        Bad.Metrics[1].Samples.Add(Sample(TEXT("99"), 1.0, 3900.0));
        Source->Sink->PublishSnapshot(Bad);
        TestEqual(TEXT("8: значение NaN/inf не отдаётся"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}))), FString(TEXT("SOURCE_UNAVAILABLE")));
    }

    // 9. Прочее в конверте: незнакомый запрос, чат без сайдкара.
    TestEqual(TEXT("9: незнакомый запрос"), Code(Call(TEXT("dropTables"), MakeShared<FJsonObject>())), FString(TEXT("UNKNOWN_OP")));
    TestEqual(TEXT("9: chatSend без сайдкара"), Code(Call(TEXT("chatSend"), Args({{TEXT("text"), Str(TEXT("привет"))}}))), FString(TEXT("SIDECAR_UNAVAILABLE")));

    // 10. Лимит: 10 в секунду у экрана, 2 у модели; превышение — RATE_LIMITED.
    {
        Now += 10.0;
        int32 Passed = 0;
        for (int32 Index = 0; Index < 12; ++Index)
        {
            Passed += Screen->Dispatch(TEXT("getStatus"), MakeShared<FJsonObject>()).HasError() ? 0 : 1;
        }
        TestEqual(TEXT("10: экрану — 10 подряд"), Passed, 10);
        TestEqual(TEXT("10: 13-й — RATE_LIMITED"), Code(Screen->Dispatch(TEXT("getStatus"), MakeShared<FJsonObject>())), FString(TEXT("RATE_LIMITED")));
        // 0,11, а не 0,1: при Now около тысячи разность double даёт 0,0999…, и токена не хватает на волос.
        Now += 0.11;
        TestEqual(TEXT("10: через 0,11 с — снова можно"), Code(Screen->Dispatch(TEXT("getStatus"), MakeShared<FJsonObject>())), FString(TEXT("OK")));

        TSharedRef<FFicsitAIApiClient> Model = Core->Connect(ClientInfo(EFicsitAIApiClientKind::Model));
        int32 ModelPassed = 0;
        for (int32 Index = 0; Index < 4; ++Index)
        {
            ModelPassed += Model->Dispatch(TEXT("listMetrics"), MakeShared<FJsonObject>()).HasError() ? 0 : 1;
        }
        TestEqual(TEXT("10: модели — 2 подряд"), ModelPassed, 2);
    }

    // 11. Версии: у модели мажор не совпал — AI выключен; экран работает и видит причину (§5.5).
    {
        Now += 10.0;
        TSharedRef<FFicsitAIApiClient> OldModel = Core->Connect(ClientInfo(EFicsitAIApiClientKind::Model, TEXT("1.0.0")));
        TestEqual(TEXT("11: модель с другим мажором"), Code(OldModel->Dispatch(TEXT("listMetrics"), MakeShared<FJsonObject>())), FString(TEXT("API_VERSION_MISMATCH")));
        TSharedRef<FFicsitAIApiClient> NewScreen = Core->Connect(ClientInfo(EFicsitAIApiClientKind::Screen, TEXT("1.2.0")));
        TestEqual(TEXT("11: экран с другим мажором работает"), Code(NewScreen->Dispatch(TEXT("listMetrics"), MakeShared<FJsonObject>())), FString(TEXT("OK")));
        auto Status = NewScreen->Dispatch(TEXT("getStatus"), MakeShared<FJsonObject>());
        TestTrue(TEXT("11: причина в apiVersionMismatch и reason"), !Status.HasError()
            && !Status.GetValue()->GetStringField(TEXT("apiVersionMismatch")).IsEmpty()
            && Status.GetValue()->GetStringField(TEXT("reason")) == Status.GetValue()->GetStringField(TEXT("apiVersionMismatch")));
    }

    // 12. Инертный режим: данные — MOD_INERT, статус отвечает, события mod.inert и api.status.
    {
        const int32 InertBefore = Events.Count(TEXT("mod.inert"));
        Core->SetModState(TEXT("save-1"), true, FText::FromString(TEXT("мультиплеер")));
        TestEqual(TEXT("12: событие mod.inert"), Events.Count(TEXT("mod.inert")), InertBefore + 1);
        TSharedPtr<FJsonObject> Inert = Events.Last(TEXT("mod.inert"));
        TestTrue(TEXT("12: inert: true"), Inert.IsValid() && Inert->GetBoolField(TEXT("inert")));
        TSharedPtr<FJsonObject> Status = Events.Last(TEXT("api.status"));
        TestTrue(TEXT("12: api.status с inert"), Status.IsValid() && Status->GetBoolField(TEXT("inert")));
        TestEqual(TEXT("12: данные в инертном"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}))), FString(TEXT("MOD_INERT")));
        auto Read = Call(TEXT("getStatus"), MakeShared<FJsonObject>());
        TestTrue(TEXT("12: статус в инертном"), !Read.HasError() && Read.GetValue()->GetBoolField(TEXT("inert"))
            && Read.GetValue()->GetStringField(TEXT("saveId")) == TEXT("save-1"));
        const int32 SnapshotsBefore = Events.Count(TEXT("metrics.snapshot"));
        Source->Sink->PublishSnapshot(MakeSnapshot(4000.0, 1.0));
        TestEqual(TEXT("12: в инертном снимки не рассылаются"), Events.Count(TEXT("metrics.snapshot")), SnapshotsBefore);
        Core->SetModState(TEXT("save-1"), false, FText::GetEmpty());
        TestEqual(TEXT("12: выход из инертного"), Code(Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}))), FString(TEXT("OK")));
    }

    // 13. Источник недоступен, затем замена источника: прежний остановлен, ряды забыты.
    {
        Source->Sink->ReportUnavailable(FText::FromString(TEXT("запись кончилась")));
        auto Gone = Call(TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}}));
        TestTrue(TEXT("13: недоступен с причиной"), Gone.HasError() && Gone.GetError().Code == TEXT("SOURCE_UNAVAILABLE") && Gone.GetError().Message == TEXT("запись кончилась"));
        TSharedPtr<FJsonObject> Status = Events.Last(TEXT("api.status"));
        TestTrue(TEXT("13: api.status с причиной"), Status.IsValid() && Status->GetStringField(TEXT("reason")) == TEXT("запись кончилась"));

        TSharedRef<FTestSource> Live = MakeShared<FTestSource>(EFicsitAIDataSource::Live);
        Core->SetSource(Live);
        TestEqual(TEXT("13: прежний остановлен"), Source->Stops, 1);
        Live->Sink->PublishSnapshot(MakeSnapshot(5.0, 7.0));
        auto Fresh = Call(TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("last60Min"))}}));
        TestTrue(TEXT("13: ряд нового источника с нуля"), !Fresh.HasError() && Fresh.GetValue()->GetArrayField(TEXT("timestamps")).Num() == 1
            && Fresh.GetValue()->GetStringField(TEXT("source")) == TEXT("live"));
    }

    // 14. Закрытие API: клиент жив, но отвечает SOURCE_UNAVAILABLE и событий не получает.
    {
        const int32 Before = Events.Names.Num();
        Core->Shutdown();
        TestEqual(TEXT("14: после закрытия"), Code(Call(TEXT("getStatus"), MakeShared<FJsonObject>())), FString(TEXT("SOURCE_UNAVAILABLE")));
        TestEqual(TEXT("14: событий нет"), Events.Names.Num(), Before);
    }

    // 15–21: правки по ревью #71 (Gs-109) — на отдельном ядре, чтобы не зависеть от шагов выше.
    {
        double T = 5000.0;
        TSharedRef<FFicsitAIApiCore> Api = MakeShared<FFicsitAIApiCore>([&T] { return T; });
        TSharedRef<FTestSource> Src = MakeShared<FTestSource>(EFicsitAIDataSource::Fixture);
        Api->SetSource(Src);
        Src->Sink->PublishSnapshot(MakeSnapshot(5.0, 7.0));
        TSharedRef<FFicsitAIApiClient> Scr = Api->Connect(ClientInfo(EFicsitAIApiClientKind::Screen));
        FEventLog Log;
        Scr->SetEventHandler([&Log](const FString& Name, const TSharedRef<FJsonObject>& Data) { Log.Names.Add(Name); Log.Data.Add(Data); });
        auto Do = [&T](const TSharedRef<FFicsitAIApiClient>& C, const TCHAR* Op, const TSharedRef<FJsonObject>& In)
        {
            T += 1.0;
            return C->Dispatch(Op, In);
        };

        // 15. Права модели: только listMetrics и queryMetric (с окном — ряд), и в Dispatch, и в типизированных.
        TSharedRef<FFicsitAIApiClient> Model = Api->Connect(ClientInfo(EFicsitAIApiClientKind::Model));
        TestEqual(TEXT("15: модели listScopes нет"), Code(Do(Model, TEXT("listScopes"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}}))), FString(TEXT("UNKNOWN_OP")));
        TestEqual(TEXT("15: модели querySeries нет"), Code(Do(Model, TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("last5Min"))}}))), FString(TEXT("UNKNOWN_OP")));
        TestEqual(TEXT("15: модели getStatus нет"), Code(Do(Model, TEXT("getStatus"), MakeShared<FJsonObject>())), FString(TEXT("UNKNOWN_OP")));
        TestEqual(TEXT("15: модели чата нет"), Code(Do(Model, TEXT("chatSend"), Args({{TEXT("text"), Str(TEXT("x"))}}))), FString(TEXT("UNKNOWN_OP")));
        auto ModelSeries = Do(Model, TEXT("queryMetric"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("last5Min"))}}));
        TestTrue(TEXT("15: модели queryMetric с окном — ряд"), !ModelSeries.HasError() && ModelSeries.GetValue()->GetStringField(TEXT("kind")) == TEXT("series"));
        T += 1.0;
        FFicsitAIListScopesArgs ScopesArgs;
        ScopesArgs.MetricId = TEXT("items.produced");
        auto TypedScopes = Model->ListScopes(ScopesArgs);
        TestTrue(TEXT("15: типизированный ListScopes модели — UNKNOWN_OP"), TypedScopes.HasError() && TypedScopes.GetError().Code == TEXT("UNKNOWN_OP"));
        T += 1.0;
        auto TypedStatus = Model->GetStatus();
        TestTrue(TEXT("15: типизированный GetStatus модели — UNKNOWN_OP"), TypedStatus.HasError() && TypedStatus.GetError().Code == TEXT("UNKNOWN_OP"));

        // 16. Единый допуск: ошибочные запросы тратят токен и подчиняются инертному режиму; имена — с учётом регистра.
        T += 10.0;
        for (int32 Index = 0; Index < 5; ++Index)
        {
            Scr->Dispatch(TEXT("nope"), MakeShared<FJsonObject>());
            Scr->Dispatch(TEXT("listMetrics"), Args({{TEXT("pageSize"), Str(TEXT("x"))}}));
        }
        TestEqual(TEXT("16: десять ошибочных исчерпали лимит"), Code(Scr->Dispatch(TEXT("getStatus"), MakeShared<FJsonObject>())), FString(TEXT("RATE_LIMITED")));
        TestEqual(TEXT("16: GETSTATUS — не getStatus"), Code(Do(Scr, TEXT("GETSTATUS"), MakeShared<FJsonObject>())), FString(TEXT("UNKNOWN_OP")));
        TestEqual(TEXT("16: null вместо строки"), Code(Do(Scr, TEXT("listMetrics"), Args({{TEXT("metricId"), MakeShared<FJsonValueNull>()}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("16: null вместо числа"), Code(Do(Scr, TEXT("listMetrics"), Args({{TEXT("pageSize"), MakeShared<FJsonValueNull>()}}))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("16: metricId и cursor вместе"), Code(Do(Scr, TEXT("listMetrics"), Args({{TEXT("metricId"), Str(TEXT("items.produced"))}, {TEXT("cursor"), Str(TEXT("m:1"))}}))), FString(TEXT("INVALID_ARGUMENT")));
        Api->SetModState(TEXT("s"), true, FText::FromString(TEXT("мультиплеер")));
        TestEqual(TEXT("16: инертный — незнакомый запрос"), Code(Do(Scr, TEXT("nope"), MakeShared<FJsonObject>())), FString(TEXT("MOD_INERT")));
        TestEqual(TEXT("16: инертный — неверные аргументы"), Code(Do(Scr, TEXT("listMetrics"), Args({{TEXT("pageSize"), Str(TEXT("x"))}}))), FString(TEXT("MOD_INERT")));

        // 17. Причина статуса: при инертном режиме видно и расхождение версий; без проблем — недоступность ассистента.
        TSharedRef<FFicsitAIApiClient> Future = Api->Connect(ClientInfo(EFicsitAIApiClientKind::Screen, TEXT("1.0.0")));
        auto Both = Do(Future, TEXT("getStatus"), MakeShared<FJsonObject>());
        TestTrue(TEXT("17: reason — инертный режим и версия"), !Both.HasError()
            && Both.GetValue()->GetStringField(TEXT("reason")).Contains(TEXT("мультиплеер"))
            && Both.GetValue()->GetStringField(TEXT("reason")).Contains(Both.GetValue()->GetStringField(TEXT("apiVersionMismatch"))));
        Api->SetModState(TEXT("s"), false, FText::GetEmpty());
        auto Calm = Do(Scr, TEXT("getStatus"), MakeShared<FJsonObject>());
        TestTrue(TEXT("17: reason при готовых данных — ассистент"), !Calm.HasError() && Calm.GetValue()->GetStringField(TEXT("reason")).Contains(TEXT("сайдкар")));

        // 18. Каталог в changedMetricIds: снятая метрика и изменённые области; значение из будущего отброшено.
        auto Frozen = [](double Time)
        {
            FFicsitAISnapshot S = MakeSnapshot(Time, 7.0);
            for (FFicsitAIMetricSnapshot& M : S.Metrics)
            {
                for (FFicsitAIMetricSample& V : M.Samples) { V.SessionTimeSec = 5.0; }
            }
            S.Metrics.RemoveAt(2); // без items.produced
            return S;
        };
        Src->Sink->PublishSnapshot(Frozen(6.0));
        auto ChangedIds = [&Log]()
        {
            TArray<FString> Ids;
            if (TSharedPtr<FJsonObject> E = Log.Last(TEXT("metrics.snapshot")))
            {
                for (const TSharedPtr<FJsonValue>& V : E->GetArrayField(TEXT("changedMetricIds"))) { Ids.Add(V->AsString()); }
            }
            return Ids;
        };
        TestTrue(TEXT("18: снятая метрика в changedMetricIds"), ChangedIds() == TArray<FString>({TEXT("items.produced")}));
        FFicsitAISnapshot Wider = Frozen(7.0);
        Wider.Metrics[1].Descriptor.AvailableScopes.Add({TEXT("3"), FText::FromString(TEXT("Сеть 3"))});
        Src->Sink->PublishSnapshot(Wider);
        TestTrue(TEXT("18: новая область без новых значений — изменение"), ChangedIds() == TArray<FString>({TEXT("power.network.battery_time_to_empty")}));
        Src->Sink->PublishSnapshot(Frozen(8.0));
        FFicsitAISnapshot Ahead = Frozen(9.0);
        Ahead.Metrics[0].Samples[0] = Sample(FString(), 99.0, 1000.0);
        Src->Sink->PublishSnapshot(Ahead);
        FFicsitAISnapshot Next = Frozen(10.0);
        Next.Metrics[0].Samples[0] = Sample(FString(), 8.0, 10.0);
        Src->Sink->PublishSnapshot(Next);
        auto Points = Do(Scr, TEXT("querySeries"), Args({{TEXT("metricId"), Str(TEXT("power.consumption"))}, {TEXT("window"), Str(TEXT("last5Min"))}}));
        TArray<double> Times;
        if (!Points.HasError())
        {
            for (const TSharedPtr<FJsonValue>& V : Points.GetValue()->GetArrayField(TEXT("timestamps"))) { Times.Add(V->AsNumber()); }
        }
        TestTrue(TEXT("18: точка из будущего не вытеснила следующую"), Times == TArray<double>({5.0, 10.0}));

        // 19. Обработчик события отключает своего клиента — вызов доживает до конца.
        TSharedRef<FFicsitAIApiClient> Leaver = Api->Connect(ClientInfo(EFicsitAIApiClientKind::Screen));
        TSharedRef<int32> Calls = MakeShared<int32>(0);
        TWeakPtr<FFicsitAIApiClient> WeakLeaver = Leaver;
        Leaver->SetEventHandler([WeakLeaver, Calls](const FString&, const TSharedRef<FJsonObject>&)
        {
            if (TSharedPtr<FFicsitAIApiClient> Self = WeakLeaver.Pin()) { Self->Disconnect(); }
            ++(*Calls); // захват жив: обработчик вызван на копии
        });
        Src->Sink->PublishSnapshot(Frozen(11.0));
        Src->Sink->PublishSnapshot(Frozen(12.0));
        TestEqual(TEXT("19: обработчик вызван один раз и отписан"), *Calls, 1);

        // 20. Несовместимая модель: состояние получает, снимков — нет.
        TSharedRef<FFicsitAIApiClient> OldModel = Api->Connect(ClientInfo(EFicsitAIApiClientKind::Model, TEXT("1.0.0")));
        FEventLog ModelLog;
        OldModel->SetEventHandler([&ModelLog](const FString& Name, const TSharedRef<FJsonObject>& Data) { ModelLog.Names.Add(Name); ModelLog.Data.Add(Data); });
        Src->Sink->PublishSnapshot(MakeSnapshot(13.0, 9.0));
        Api->SetModState(TEXT("s"), true, FText::FromString(TEXT("мультиплеер")));
        Api->SetModState(TEXT("s"), false, FText::GetEmpty());
        TestEqual(TEXT("20: снимков несовместимой модели нет"), ModelLog.Count(TEXT("metrics.snapshot")), 0);
        TestTrue(TEXT("20: состояние доходит"), ModelLog.Count(TEXT("mod.inert")) == 2 && ModelLog.Count(TEXT("api.status")) >= 1);

        // 21. Сетевой режим мира: инертность без проводки.
        Api->SetNetInertProbe([] { return true; });
        TestEqual(TEXT("21: не одиночная игра — MOD_INERT"), Code(Do(Scr, TEXT("listMetrics"), MakeShared<FJsonObject>())), FString(TEXT("MOD_INERT")));
        auto NetStatus = Do(Scr, TEXT("getStatus"), MakeShared<FJsonObject>());
        TestTrue(TEXT("21: статус inert"), !NetStatus.HasError() && NetStatus.GetValue()->GetBoolField(TEXT("inert")));
        Api->SetNetInertProbe(nullptr);
        TestEqual(TEXT("21: одиночная — снова можно"), Code(Do(Scr, TEXT("listMetrics"), MakeShared<FJsonObject>())), FString(TEXT("OK")));
        Api->Shutdown();
    }
    return true;
}

#endif
