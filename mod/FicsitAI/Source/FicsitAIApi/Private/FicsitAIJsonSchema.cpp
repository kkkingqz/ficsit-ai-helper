#include "FicsitAIJsonSchema.h"

#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
enum EType : uint8
{
    TObject = 1 << 0,
    TString = 1 << 1,
    TInteger = 1 << 2,
    TNumber = 1 << 3,
    TBoolean = 1 << 4,
    TNull = 1 << 5,
};

/** Ключевые слова, которые проверку не меняют. */
bool IsAnnotation(const FString& Key)
{
    static const TSet<FString> Annotations = {
        TEXT("$schema"), TEXT("$id"), TEXT("$comment"), TEXT("title"), TEXT("description"),
        TEXT("default"), TEXT("examples"), TEXT("deprecated"), TEXT("readOnly"), TEXT("writeOnly"),
    };
    return Annotations.Contains(Key);
}

/** Длина строки в символах Юникода, как её считает JSON Schema: суррогатная пара — один символ. */
int32 CodePoints(const FString& Text)
{
    int32 Count = 0;
    for (int32 Index = 0; Index < Text.Len(); ++Index)
    {
        const TCHAR Ch = Text[Index];
        if (Ch >= 0xD800 && Ch <= 0xDBFF && Index + 1 < Text.Len() && Text[Index + 1] >= 0xDC00 && Text[Index + 1] <= 0xDFFF)
        {
            ++Index;
        }
        ++Count;
    }
    return Count;
}

FString Where(const FString& Path)
{
    return Path.IsEmpty() ? FString(TEXT("аргументы")) : Path;
}

FString Join(const FString& Path, const FString& Key)
{
    return Path.IsEmpty() ? Key : Path + TEXT(".") + Key;
}

FString Describe(const FJsonValue& Value)
{
    switch (Value.Type)
    {
    case EJson::String: return FString::Printf(TEXT("«%s»"), *Value.AsString().Left(64));
    case EJson::Number: return FString::SanitizeFloat(Value.AsNumber());
    case EJson::Boolean: return Value.AsBool() ? TEXT("true") : TEXT("false");
    case EJson::Null: return TEXT("null");
    case EJson::Array: return TEXT("массив");
    case EJson::Object: return TEXT("объект");
    default: return TEXT("пусто");
    }
}

bool SameScalar(const FJsonValue& A, const FJsonValue& B)
{
    if (A.Type != B.Type)
    {
        return false;
    }
    switch (A.Type)
    {
    case EJson::String: return A.AsString().Equals(B.AsString(), ESearchCase::CaseSensitive);
    case EJson::Number: return A.AsNumber() == B.AsNumber();
    case EJson::Boolean: return A.AsBool() == B.AsBool();
    case EJson::Null: return true;
    default: return false;
    }
}
} // namespace

struct FFicsitAIJsonSchema::FNode
{
    uint8 Types = 0; // 0 — тип не ограничен
    TArray<TSharedPtr<FJsonValue>> Enum;
    TOptional<int32> MinLength;
    TOptional<int32> MaxLength;
    TOptional<double> Minimum;
    TOptional<double> Maximum;
    TMap<FString, TSharedPtr<FNode>> Properties;
    TArray<FString> PropertyOrder;
    TArray<FString> Required;
    bool bNoAdditional = false;
    TArray<TPair<FString, TArray<FString>>> DependentRequired;

    static TOptional<FString> Compile(const FJsonObject& Schema, const FString& Path, FNode& Out);
    TOptional<FString> Check(const FJsonValue& Value, const FString& Path) const;
};

TOptional<FString> FFicsitAIJsonSchema::FNode::Compile(const FJsonObject& Schema, const FString& Path, FNode& Out)
{
    auto Bad = [&Path](const FString& What) { return TOptional<FString>(FString::Printf(TEXT("схема %s: %s"), *Where(Path), *What)); };
    auto ReadCount = [&](const FString& Key, const TSharedPtr<FJsonValue>& V, TOptional<int32>& Into) -> TOptional<FString>
    {
        double N = 0.0;
        if (!V->TryGetNumber(N) || N < 0.0 || FMath::Frac(N) != 0.0 || N > MAX_int32)
        {
            return Bad(Key + TEXT(" — неотрицательное целое"));
        }
        Into = static_cast<int32>(N);
        return {};
    };

    for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : Schema.Values)
    {
        const FString& Key = Pair.Key;
        const TSharedPtr<FJsonValue>& V = Pair.Value;
        if (IsAnnotation(Key))
        {
            continue;
        }
        if (Key == TEXT("type"))
        {
            TArray<FString> Names;
            if (V->Type == EJson::String)
            {
                Names.Add(V->AsString());
            }
            else if (V->Type == EJson::Array)
            {
                for (const TSharedPtr<FJsonValue>& Item : V->AsArray())
                {
                    Names.Add(Item->Type == EJson::String ? Item->AsString() : FString());
                }
            }
            for (const FString& Name : Names)
            {
                if (Name == TEXT("object")) { Out.Types |= TObject; }
                else if (Name == TEXT("string")) { Out.Types |= TString; }
                else if (Name == TEXT("integer")) { Out.Types |= TInteger; }
                else if (Name == TEXT("number")) { Out.Types |= TNumber; }
                else if (Name == TEXT("boolean")) { Out.Types |= TBoolean; }
                else if (Name == TEXT("null")) { Out.Types |= TNull; }
                else { return Bad(FString::Printf(TEXT("тип «%s» Validator v0 не поддерживает"), *Name)); }
            }
            if (Names.IsEmpty())
            {
                return Bad(TEXT("type — строка или массив строк"));
            }
        }
        else if (Key == TEXT("enum"))
        {
            if (V->Type != EJson::Array || V->AsArray().IsEmpty())
            {
                return Bad(TEXT("enum — непустой массив"));
            }
            for (const TSharedPtr<FJsonValue>& Item : V->AsArray())
            {
                if (Item->Type == EJson::Array || Item->Type == EJson::Object)
                {
                    return Bad(TEXT("enum из массивов и объектов Validator v0 не поддерживает"));
                }
                Out.Enum.Add(Item);
            }
        }
        else if (Key == TEXT("minLength") || Key == TEXT("maxLength"))
        {
            if (TOptional<FString> E = ReadCount(Key, V, Key == TEXT("minLength") ? Out.MinLength : Out.MaxLength))
            {
                return E;
            }
        }
        else if (Key == TEXT("minimum") || Key == TEXT("maximum"))
        {
            double N = 0.0;
            if (!V->TryGetNumber(N))
            {
                return Bad(Key + TEXT(" — число"));
            }
            (Key == TEXT("minimum") ? Out.Minimum : Out.Maximum) = N;
        }
        else if (Key == TEXT("properties"))
        {
            if (V->Type != EJson::Object)
            {
                return Bad(TEXT("properties — объект"));
            }
            for (const TPair<FString, TSharedPtr<FJsonValue>>& Prop : V->AsObject()->Values)
            {
                if (Prop.Value->Type != EJson::Object)
                {
                    return Bad(FString::Printf(TEXT("свойство «%s» — не схема"), *Prop.Key));
                }
                TSharedPtr<FNode> Child = MakeShared<FNode>();
                if (TOptional<FString> E = Compile(*Prop.Value->AsObject(), Join(Path, Prop.Key), *Child))
                {
                    return E;
                }
                Out.Properties.Add(Prop.Key, Child);
                Out.PropertyOrder.Add(Prop.Key);
            }
        }
        else if (Key == TEXT("required"))
        {
            if (V->Type != EJson::Array)
            {
                return Bad(TEXT("required — массив строк"));
            }
            for (const TSharedPtr<FJsonValue>& Item : V->AsArray())
            {
                if (Item->Type != EJson::String)
                {
                    return Bad(TEXT("required — массив строк"));
                }
                Out.Required.Add(Item->AsString());
            }
        }
        else if (Key == TEXT("additionalProperties"))
        {
            // Схема дополнительных свойств в v0 не нужна: аргументы операций закрыты (additionalProperties: false).
            if (V->Type != EJson::Boolean)
            {
                return Bad(TEXT("additionalProperties в Validator v0 — только true или false"));
            }
            Out.bNoAdditional = !V->AsBool();
        }
        else if (Key == TEXT("dependentRequired"))
        {
            if (V->Type != EJson::Object)
            {
                return Bad(TEXT("dependentRequired — объект"));
            }
            for (const TPair<FString, TSharedPtr<FJsonValue>>& Dep : V->AsObject()->Values)
            {
                TArray<FString> Needs;
                if (Dep.Value->Type != EJson::Array)
                {
                    return Bad(TEXT("dependentRequired — объект массивов строк"));
                }
                for (const TSharedPtr<FJsonValue>& Item : Dep.Value->AsArray())
                {
                    if (Item->Type != EJson::String)
                    {
                        return Bad(TEXT("dependentRequired — объект массивов строк"));
                    }
                    Needs.Add(Item->AsString());
                }
                Out.DependentRequired.Emplace(Dep.Key, MoveTemp(Needs));
            }
        }
        else
        {
            return Bad(FString::Printf(TEXT("ключевое слово «%s» Validator v0 не поддерживает"), *Key));
        }
    }
    return {};
}

TOptional<FString> FFicsitAIJsonSchema::FNode::Check(const FJsonValue& Value, const FString& Path) const
{
    if (Types != 0)
    {
        bool bOk = false;
        switch (Value.Type)
        {
        case EJson::Object: bOk = (Types & TObject) != 0; break;
        case EJson::String: bOk = (Types & TString) != 0; break;
        case EJson::Boolean: bOk = (Types & TBoolean) != 0; break;
        case EJson::Null: bOk = (Types & TNull) != 0; break;
        case EJson::Number:
            bOk = (Types & TNumber) != 0 || ((Types & TInteger) != 0 && FMath::IsFinite(Value.AsNumber()) && FMath::Frac(Value.AsNumber()) == 0.0);
            break;
        default: break;
        }
        if (!bOk)
        {
            const TCHAR* Want = (Types & TInteger) ? TEXT("целое число") : (Types & TNumber) ? TEXT("число") : (Types & TString) ? TEXT("строка")
                : (Types & TObject) ? TEXT("объект") : (Types & TBoolean) ? TEXT("true или false") : TEXT("null");
            return FString::Printf(TEXT("%s: ожидается %s, пришло %s"), *Where(Path), Want, *Describe(Value));
        }
    }

    if (!Enum.IsEmpty() && !Enum.ContainsByPredicate([&Value](const TSharedPtr<FJsonValue>& E) { return SameScalar(*E, Value); }))
    {
        TArray<FString> Allowed;
        for (const TSharedPtr<FJsonValue>& E : Enum)
        {
            Allowed.Add(E->Type == EJson::String ? E->AsString() : Describe(*E));
        }
        return FString::Printf(TEXT("%s: %s не из допустимых (%s)"), *Where(Path), *Describe(Value), *FString::Join(Allowed, TEXT(", ")));
    }

    if (Value.Type == EJson::String)
    {
        const int32 Len = CodePoints(Value.AsString());
        if (MinLength.IsSet() && Len < MinLength.GetValue())
        {
            return FString::Printf(TEXT("%s: строка короче %d"), *Where(Path), MinLength.GetValue());
        }
        if (MaxLength.IsSet() && Len > MaxLength.GetValue())
        {
            return FString::Printf(TEXT("%s: строка длиннее %d"), *Where(Path), MaxLength.GetValue());
        }
    }

    if (Value.Type == EJson::Number)
    {
        const double N = Value.AsNumber();
        if (Minimum.IsSet() && N < Minimum.GetValue())
        {
            return FString::Printf(TEXT("%s: %s меньше минимума %s"), *Where(Path), *Describe(Value), *FString::SanitizeFloat(Minimum.GetValue()));
        }
        if (Maximum.IsSet() && N > Maximum.GetValue())
        {
            return FString::Printf(TEXT("%s: %s больше максимума %s"), *Where(Path), *Describe(Value), *FString::SanitizeFloat(Maximum.GetValue()));
        }
    }

    if (Value.Type == EJson::Object)
    {
        const TSharedPtr<FJsonObject> Object = Value.AsObject();
        for (const FString& Name : Required)
        {
            if (!Object->HasField(Name))
            {
                return FString::Printf(TEXT("%s: нет обязательного поля"), *Join(Path, Name));
            }
        }
        for (const TPair<FString, TArray<FString>>& Dep : DependentRequired)
        {
            if (!Object->HasField(Dep.Key))
            {
                continue;
            }
            for (const FString& Need : Dep.Value)
            {
                if (!Object->HasField(Need))
                {
                    return FString::Printf(TEXT("%s: допустимо только вместе с %s"), *Join(Path, Dep.Key), *Need);
                }
            }
        }
        // Обход в порядке полей значения — первая ошибка детерминирована для одного и того же запроса.
        for (const TPair<FString, TSharedPtr<FJsonValue>>& Field : Object->Values)
        {
            if (const TSharedPtr<FNode>* Child = Properties.Find(Field.Key))
            {
                if (TOptional<FString> E = (*Child)->Check(*Field.Value, Join(Path, Field.Key)))
                {
                    return E;
                }
            }
            else if (bNoAdditional)
            {
                return FString::Printf(TEXT("%s: поля нет в схеме"), *Join(Path, Field.Key));
            }
        }
    }
    return {};
}

TValueOrError<FFicsitAIJsonSchema, FString> FFicsitAIJsonSchema::Compile(const TSharedRef<FJsonObject>& Schema)
{
    FFicsitAIJsonSchema Out;
    Out.Root = MakeShared<FNode>();
    if (TOptional<FString> Error = FNode::Compile(*Schema, FString(), *Out.Root))
    {
        return MakeError(Error.GetValue());
    }
    Out.Source = Schema;
    return MakeValue(MoveTemp(Out));
}

TValueOrError<FFicsitAIJsonSchema, FString> FFicsitAIJsonSchema::Compile(const FString& SchemaText)
{
    TSharedPtr<FJsonObject> Parsed;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(SchemaText);
    if (!FJsonSerializer::Deserialize(Reader, Parsed) || !Parsed.IsValid())
    {
        return MakeError(FString(TEXT("схема: не JSON-объект")));
    }
    return Compile(Parsed.ToSharedRef());
}

TOptional<FFicsitAIApiError> FFicsitAIJsonSchema::Validate(const TSharedRef<FJsonValue>& Value) const
{
    if (!Root.IsValid())
    {
        return FFicsitAIApiError(FicsitAIApiErrors::InvalidArgument, TEXT("схема не скомпилирована"));
    }
    if (TOptional<FString> Error = Root->Check(*Value, FString()))
    {
        return FFicsitAIApiError(FicsitAIApiErrors::InvalidArgument, Error.GetValue());
    }
    return {};
}

TOptional<FFicsitAIApiError> FFicsitAIJsonSchema::Validate(const TSharedRef<FJsonObject>& Object) const
{
    return Validate(MakeShared<FJsonValueObject>(Object));
}
