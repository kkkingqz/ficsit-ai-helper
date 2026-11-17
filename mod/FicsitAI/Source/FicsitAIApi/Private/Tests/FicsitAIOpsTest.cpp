// Автотест OperationRegistry и Validator v0 без мира (V-3): схемы операций, регистрация по правилу паритета,
// инструменты для канала, вызов через подключение модели к ядру API.

#include "Misc/AutomationTest.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "FicsitAIApiClient.h"
#include "FicsitAIApiCore.h"
#include "FicsitAIJsonSchema.h"
#include "FicsitAIOperationRegistry.h"
#include "IFicsitAIDataSource.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace
{
TSharedRef<FJsonObject> Obj(const TCHAR* Json)
{
    TSharedPtr<FJsonObject> Out;
    FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Out);
    return Out.IsValid() ? Out.ToSharedRef() : MakeShared<FJsonObject>();
}

class FOneSnapshotSource : public IFicsitAIDataSource
{
public:
    virtual EFicsitAIDataSource GetKind() const override { return EFicsitAIDataSource::Fixture; }
    virtual void Start(IFicsitAISnapshotSink& Sink) override
    {
        FFicsitAISnapshot Snap;
        Snap.SessionTimeSec = 30.0;
        FFicsitAIMetricSnapshot& Power = Snap.Metrics.AddDefaulted_GetRef();
        Power.Descriptor.Id = TEXT("power.consumption");
        Power.Descriptor.DisplayName = FText::FromString(TEXT("Потребление"));
        Power.Descriptor.Unit = EFicsitAIUnit::Megawatt;
        Power.Descriptor.bHasSeries = true;
        FFicsitAIMetricSample& S = Power.Samples.AddDefaulted_GetRef();
        S.Value = 420.0;
        S.SessionTimeSec = 30.0;
        Sink.PublishSnapshot(Snap);
    }
    virtual void Stop() override {}
};

FFicsitAIApiClientInfo Info(EFicsitAIApiClientKind Kind)
{
    FFicsitAIApiClientInfo I;
    I.Kind = Kind;
    I.RequiredApiVersion = TEXT("0.5.0");
    I.Name = TEXT("ops-test");
    return I;
}
} // namespace

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAIOpsV0Test, "FicsitAI.Ops.V0", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAIOpsV0Test::RunTest(const FString& Parameters)
{
    const FFicsitAIOperationRegistry& Registry = FFicsitAIOperationRegistry::V0();

    // 1. Реестр v0: две операции, обе выставлены модели и у обеих ручной путь в «Статистике».
    TestTrue(TEXT("1: операции v0"), Registry.GetIds() == TArray<FString>({TEXT("list_metrics"), TEXT("query_metric")}));
    for (const FString& Id : Registry.GetIds())
    {
        const FFicsitAIOperation* Op = Registry.Find(Id);
        TestTrue(FString::Printf(TEXT("1: %s — ручной путь в Statistics"), *Id), Op && Op->ManualEntry.IsSet() && Op->ManualEntry->ModuleId == FName(TEXT("Statistics")));
    }
    const TArray<FFicsitAIToolDefinition> Tools = Registry.GetModelTools();
    TestEqual(TEXT("1: инструментов модели два"), Tools.Num(), 2);
    for (const FFicsitAIToolDefinition& Tool : Tools)
    {
        TestFalse(FString::Printf(TEXT("1: %s — описание"), *Tool.Name), Tool.Description.IsEmpty());
        TestTrue(FString::Printf(TEXT("1: %s — схема без $schema и $id"), *Tool.Name), Tool.InputSchema.IsValid()
            && !Tool.InputSchema->HasField(TEXT("$schema")) && !Tool.InputSchema->HasField(TEXT("$id"))
            && Tool.InputSchema->GetStringField(TEXT("type")) == TEXT("object"));
    }
    TestNull(TEXT("1: имя с другим регистром не находится"), Registry.Find(TEXT("LIST_METRICS")));

    // 2. Validator по схемам v0: примеры контракта проходят, нарушения — INVALID_ARGUMENT с путём поля.
    {
        TValueOrError<FFicsitAIJsonSchema, FString> List = FFicsitAIJsonSchema::Compile(Registry.Find(TEXT("list_metrics"))->InputSchemaText);
        TValueOrError<FFicsitAIJsonSchema, FString> Query = FFicsitAIJsonSchema::Compile(Registry.Find(TEXT("query_metric"))->InputSchemaText);
        TestFalse(TEXT("2: схемы компилируются"), List.HasError() || Query.HasError());
        if (!List.HasError() && !Query.HasError())
        {
            const FFicsitAIJsonSchema& L = List.GetValue();
            const FFicsitAIJsonSchema& Q = Query.GetValue();
            auto Message = [](const TOptional<FFicsitAIApiError>& E) { return E.IsSet() ? E->Message : FString(TEXT("OK")); };
            // Примеры из docs/contracts/*-request.example.json.
            TestFalse(TEXT("2: пример list_metrics"), L.Validate(Obj(TEXT("{\"metricId\":\"items.produced\",\"scopeFilter\":\"Iron\",\"pageSize\":20}"))).IsSet());
            TestFalse(TEXT("2: пример query_metric"), Q.Validate(Obj(TEXT("{\"metricId\":\"power.consumption\",\"window\":\"last15Min\"}"))).IsSet());
            TestFalse(TEXT("2: list_metrics без аргументов"), L.Validate(Obj(TEXT("{}"))).IsSet());

            TestEqual(TEXT("2: лишнее поле"), Message(L.Validate(Obj(TEXT("{\"savePath\":\"C:/x.sav\"}")))), FString(TEXT("savePath: поля нет в схеме")));
            TestEqual(TEXT("2: обязательное поле"), Message(Q.Validate(Obj(TEXT("{}")))), FString(TEXT("metricId: нет обязательного поля")));
            TestEqual(TEXT("2: тип"), Message(L.Validate(Obj(TEXT("{\"pageSize\":\"10\"}")))), FString(TEXT("pageSize: ожидается целое число, пришло «10»")));
            TestEqual(TEXT("2: дробное вместо целого"), Message(L.Validate(Obj(TEXT("{\"pageSize\":2.5}")))), FString(TEXT("pageSize: ожидается целое число, пришло 2.5")));
            TestEqual(TEXT("2: максимум"), Message(L.Validate(Obj(TEXT("{\"pageSize\":500}")))), FString(TEXT("pageSize: 500.0 больше максимума 200.0")));
            TestEqual(TEXT("2: минимум"), Message(L.Validate(Obj(TEXT("{\"pageSize\":0}")))), FString(TEXT("pageSize: 0.0 меньше минимума 1.0")));
            TestTrue(TEXT("2: enum, регистр важен"), Message(Q.Validate(Obj(TEXT("{\"metricId\":\"a\",\"window\":\"Last5Min\"}")))).StartsWith(TEXT("window: «Last5Min» не из допустимых")));
            TestEqual(TEXT("2: пустая строка"), Message(Q.Validate(Obj(TEXT("{\"metricId\":\"\"}")))), FString(TEXT("metricId: строка короче 1")));
            const FString Filter128 = FString::Printf(TEXT("{\"filter\":\"%s\"}"), *FString::ChrN(128, TEXT('ж')));
            const FString Filter129 = FString::Printf(TEXT("{\"filter\":\"%s\"}"), *FString::ChrN(129, TEXT('ж')));
            TestEqual(TEXT("2: длина в символах, а не в байтах"), Message(L.Validate(Obj(*Filter128))), FString(TEXT("OK")));
            TestEqual(TEXT("2: длиннее 128"), Message(L.Validate(Obj(*Filter129))), FString(TEXT("filter: строка длиннее 128")));
            TestEqual(TEXT("2: dependentRequired"), Message(L.Validate(Obj(TEXT("{\"scopeCursor\":\"s:50:items.produced\"}")))), FString(TEXT("scopeCursor: допустимо только вместе с metricId")));
            TestEqual(TEXT("2: null"), Message(Q.Validate(Obj(TEXT("{\"metricId\":null}")))), FString(TEXT("metricId: ожидается строка, пришло null")));
            TestEqual(TEXT("2: код"), L.Validate(Obj(TEXT("{\"x\":1}")))->Code, FString(TEXT("INVALID_ARGUMENT")));
        }
    }

    // 3. Компиляция строгая: незнакомое ключевое слово и неподдерживаемая форма — отказ, а не пропуск.
    TestTrue(TEXT("3: pattern не поддержан"), FFicsitAIJsonSchema::Compile(TEXT("{\"type\":\"string\",\"pattern\":\"^a\"}")).HasError());
    TestTrue(TEXT("3: oneOf не поддержан"), FFicsitAIJsonSchema::Compile(TEXT("{\"oneOf\":[{\"type\":\"string\"}]}")).HasError());
    TestTrue(TEXT("3: additionalProperties-схема не поддержана"), FFicsitAIJsonSchema::Compile(TEXT("{\"type\":\"object\",\"additionalProperties\":{\"type\":\"string\"}}")).HasError());
    TestTrue(TEXT("3: незнакомое ключевое слово во вложенной схеме"), FFicsitAIJsonSchema::Compile(TEXT("{\"type\":\"object\",\"properties\":{\"a\":{\"type\":\"string\",\"format\":\"uri\"}}}")).HasError());
    TestTrue(TEXT("3: аннотации допустимы"), !FFicsitAIJsonSchema::Compile(TEXT("{\"$comment\":\"c\",\"title\":\"t\",\"type\":\"integer\",\"default\":5,\"examples\":[1]}")).HasError());
    TestTrue(TEXT("3: не JSON"), FFicsitAIJsonSchema::Compile(FString(TEXT("{"))).HasError());

    // 4. Регистрация по правилу паритета (ADR-018): без ручного пути модели не выставляется.
    {
        FFicsitAIOperationRegistry R;
        FFicsitAIOperation Op;
        Op.Id = TEXT("list_metrics");
        Op.ApiOp = TEXT("listMetrics");
        Op.Description = TEXT("каталог");
        Op.InputSchemaText = TEXT("{\"type\":\"object\",\"additionalProperties\":false}");
        Op.bExposedToModel = true;
        TestTrue(TEXT("4: без ручного пути — отказ"), R.Register(Op).IsSet());
        Op.ManualEntry = FFicsitAIManualEntry{FName(TEXT("Statistics")), TEXT("выбор метрики")};
        TestFalse(TEXT("4: с ручным путём — принята"), R.Register(Op).IsSet());
        TestTrue(TEXT("4: повторный Id — отказ"), R.Register(Op).IsSet());

        FFicsitAIOperation Scopes = Op;
        Scopes.Id = TEXT("list_scopes");
        Scopes.ApiOp = TEXT("listScopes");
        TestTrue(TEXT("4: запрос, модели не разрешённый, — отказ"), R.Register(Scopes).IsSet());
        Scopes.bExposedToModel = false;
        Scopes.ManualEntry.Reset();
        TestFalse(TEXT("4: тот же запрос только для ручного пути — принят"), R.Register(Scopes).IsSet());
        TestEqual(TEXT("4: инструментов модели — только выставленные"), R.GetModelTools().Num(), 1);

        FFicsitAIOperation Bad = Op;
        Bad.Id = TEXT("drop_tables");
        Bad.ApiOp = TEXT("dropTables");
        TestTrue(TEXT("4: запроса нет в API — отказ"), R.Register(Bad).IsSet());
        Bad.ApiOp = TEXT("queryMetric");
        Bad.InputSchemaText = TEXT("{\"type\":\"object\",\"patternProperties\":{}}");
        TestTrue(TEXT("4: схема не компилируется — отказ"), R.Register(Bad).IsSet());
        Bad.InputSchemaText = TEXT("{\"type\":\"object\"}");
        Bad.Description.Reset();
        TestTrue(TEXT("4: выставлена без описания — отказ"), R.Register(Bad).IsSet());
    }

    // 5. Вызов через подключение модели к ядру: Validator до API, допуск подключения до Validator.
    {
        double Now = 100.0;
        TSharedRef<FFicsitAIApiCore> Core = MakeShared<FFicsitAIApiCore>([&Now] { return Now; });
        Core->SetSource(MakeShared<FOneSnapshotSource>());
        TSharedRef<FFicsitAIApiClient> Model = Core->Connect(Info(EFicsitAIApiClientKind::Model));
        auto Code = [](const FFicsitAIOperationRegistry::TResult<TSharedRef<FJsonObject>>& R) { return R.HasError() ? R.GetError().Code : FString(TEXT("OK")); };
        auto Call = [&](const TCHAR* Id, const TCHAR* Args) { Now += 1.0; return Registry.Invoke(Id, Obj(Args), *Model); };

        auto Value = Call(TEXT("query_metric"), TEXT("{\"metricId\":\"power.consumption\"}"));
        TestTrue(TEXT("5: query_metric — значение"), !Value.HasError() && Value.GetValue()->GetNumberField(TEXT("value")) == 420.0);
        auto Series = Call(TEXT("query_metric"), TEXT("{\"metricId\":\"power.consumption\",\"window\":\"last5Min\"}"));
        TestTrue(TEXT("5: query_metric с окном — ряд"), !Series.HasError() && Series.GetValue()->GetStringField(TEXT("kind")) == TEXT("series"));
        auto Page = Call(TEXT("list_metrics"), TEXT("{}"));
        TestTrue(TEXT("5: list_metrics — каталог"), !Page.HasError() && Page.GetValue()->GetArrayField(TEXT("metrics")).Num() == 1);

        auto Extra = Call(TEXT("list_metrics"), TEXT("{\"savePath\":\"C:/x.sav\"}"));
        TestTrue(TEXT("5: лишнее поле — INVALID_ARGUMENT от Validator"), Extra.HasError() && Extra.GetError().Code == TEXT("INVALID_ARGUMENT")
            && Extra.GetError().Message.StartsWith(TEXT("savePath")));
        TestEqual(TEXT("5: пустой scopeId модели не пропускает схема"), Code(Call(TEXT("query_metric"), TEXT("{\"metricId\":\"power.consumption\",\"scopeId\":\"\"}"))), FString(TEXT("INVALID_ARGUMENT")));
        TestEqual(TEXT("5: незнакомая метрика — от API, после схемы"), Code(Call(TEXT("query_metric"), TEXT("{\"metricId\":\"nope\"}"))), FString(TEXT("UNKNOWN_METRIC")));
        TestEqual(TEXT("5: незнакомая операция"), Code(Call(TEXT("delete_everything"), TEXT("{}"))), FString(TEXT("UNKNOWN_OP")));

        // Ошибочные вызовы тратят токен: две ошибки схемы подряд исчерпывают лимит модели.
        Now += 10.0;
        Registry.Invoke(TEXT("list_metrics"), Obj(TEXT("{\"x\":1}")), *Model);
        Registry.Invoke(TEXT("list_metrics"), Obj(TEXT("{\"x\":1}")), *Model);
        TestEqual(TEXT("5: ошибки схемы тратят токены"), Code(Registry.Invoke(TEXT("list_metrics"), Obj(TEXT("{}")), *Model)), FString(TEXT("RATE_LIMITED")));

        // Инертный режим важнее ошибки схемы: порядок допуска один для всех путей.
        Core->SetModState(TEXT("s"), true, FText::FromString(TEXT("мультиплеер")));
        TestEqual(TEXT("5: инертный режим раньше схемы"), Code(Call(TEXT("list_metrics"), TEXT("{\"x\":1}"))), FString(TEXT("MOD_INERT")));
        Core->SetModState(TEXT("s"), false, FText::GetEmpty());

        // Экран идёт тем же реестром, но и ему схема не даёт лишнего.
        TSharedRef<FFicsitAIApiClient> Screen = Core->Connect(Info(EFicsitAIApiClientKind::Screen));
        Now += 1.0;
        TestEqual(TEXT("5: экран — та же схема"), Code(Registry.Invoke(TEXT("list_metrics"), Obj(TEXT("{\"pageSize\":0}")), *Screen)), FString(TEXT("INVALID_ARGUMENT")));
        Core->Shutdown();
    }
    return true;
}

#endif
